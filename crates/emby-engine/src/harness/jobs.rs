//! Durable image tasks. HTTP requests may disconnect without losing the result.
use super::{StylizeInput, StylizeResult};
use crate::{ai::routing::{self, Capability, RouteMetadata}, state::AppState};
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::Arc};
use tokio::sync::watch;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobProgress {
    pub stage: String,
    pub value: Option<u32>,
    pub max: Option<u32>,
}

pub fn progress(app: &AppState, id: Option<&str>, stage: &str, steps: Option<(u32, u32)>) {
    if let Some(id) = id {
        app.harness_progress.lock().unwrap().insert(id.into(), JobProgress {
            stage: stage.into(), value: steps.map(|s| s.0), max: steps.map(|s| s.1),
        });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub progress: Option<JobProgress>,
    pub id: String,
    #[serde(default = "first_attempt")]
    pub attempt: u32,
    pub phase: String,
    pub input: StylizeInput,
    #[serde(default)]
    pub source_snapshot: String,
    pub route: serde_json::Value,
    pub result: Option<StylizeResult>,
    pub error: Option<String>,
}

fn first_attempt() -> u32 { 1 }

pub fn write_json(path: &Path, value: &impl Serialize) -> anyhow::Result<()> {
    use std::io::Write;
    let temp = path.with_file_name(format!(".write-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> anyhow::Result<()> {
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        file.write_all(&serde_json::to_vec_pretty(value)?)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temp, path)?;
        Ok(())
    })();
    if result.is_err() { let _ = std::fs::remove_file(temp); }
    result
}

fn directory(root: &Path) -> PathBuf { root.join("engine").join("jobs") }

pub fn recover(root: &Path) -> anyhow::Result<()> {
    let dir = directory(root);
    std::fs::create_dir_all(&dir)?;
    for file in std::fs::read_dir(dir)? {
        let path = file?.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") { continue; }
        let mut job: Job = match serde_json::from_slice(&std::fs::read(&path)?) {
            Ok(job) => job,
            Err(error) => {
                eprintln!("[harness] unreadable task {}: {error}", path.display());
                continue;
            }
        };
        if job.phase == "queued" || job.phase == "running" {
            job.phase = "interrupted".into();
            job.error = Some("engine stopped before the task settled; retry explicitly".into());
            write_json(&path, &job)?;
        }
    }
    Ok(())
}

pub fn read(app: &AppState, id: &str) -> anyhow::Result<Job> {
    uuid::Uuid::parse_str(id)?;
    Ok(serde_json::from_slice(&std::fs::read(directory(&app.data_root).join(format!("{id}.json")))?)?)
}

fn publish(app: &AppState, job: &Job) -> anyhow::Result<()> {
    write_json(&directory(&app.data_root).join(format!("{}.json", job.id)), job)?;
    app.broadcast(serde_json::json!({ "type": "harness.job", "data": { "id": job.id, "phase": job.phase } }));
    Ok(())
}

pub fn submit(app: Arc<AppState>, input: StylizeInput) -> anyhow::Result<Job> {
    // Serialize admission so simultaneous retries of a candidate share one job.
    let mut cancellations = app.harness_cancels.lock().unwrap();
    let id = input.request_id.clone().unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    uuid::Uuid::parse_str(&id)?;
    let mut attempt = 1;
    let mut source_path = PathBuf::from(&input.image_path);
    if directory(&app.data_root).join(format!("{id}.json")).exists() {
        let previous = status(&app, &id)?;
        if serde_json::to_value(&previous.input)? != serde_json::to_value(&input)? {
            anyhow::bail!("request id is already bound to different inputs");
        }
        if matches!(previous.phase.as_str(), "queued" | "running" | "succeeded") || !input.retry {
            return Ok(previous);
        }
        attempt = previous.attempt.checked_add(1).ok_or_else(|| anyhow::anyhow!("too many task attempts"))?;
        if !previous.source_snapshot.is_empty() { source_path = PathBuf::from(&previous.source_snapshot); }
        let history = directory(&app.data_root).join("history");
        std::fs::create_dir_all(&history)?;
        write_json(&history.join(format!("{id}-{}.json", previous.attempt)), &previous)?;
    }
    if !source_path.is_file() { anyhow::bail!("source image not found"); }
    let route = routing::prepare(&app, Capability::Image, input.provider_id.as_deref(), input.model_id.as_deref())?;
    let metadata: &RouteMetadata = &route.metadata;
    let artifacts = app.data_root.join("engine").join("drafts").join(&id).join(format!("attempt-{attempt}"));
    std::fs::create_dir_all(&artifacts)?;
    let snapshot = artifacts.join("source.input");
    std::fs::copy(&source_path, &snapshot)?;
    let job = Job { progress: None, id, attempt, phase: "queued".into(), input, source_snapshot: snapshot.to_string_lossy().into(),
        route: serde_json::to_value(metadata)?, result: None, error: None };
    publish(&app, &job)?;
    let (cancel, mut cancelled) = watch::channel(false);
    app.harness_failures.lock().unwrap().remove(&job.id);
    cancellations.insert(job.id.clone(), cancel);
    drop(cancellations);
    let mut running = job.clone();
    tokio::spawn(async move {
        let local_model = (route.metadata.provider_kind == crate::ai::ProviderKind::Local)
            .then(|| route.metadata.model_id.clone());
        let mut permit = None;
        let execute = async {
            permit = Some(app.harness_slots.acquire().await?);
            running.phase = "running".into();
            publish(&app, &running)?;
            let mut input = running.input.clone();
            input.image_path = running.source_snapshot.clone();
            super::stylize(&app, input, route, &running.id, running.attempt).await
        };
        let outcome = tokio::select! {
            biased;
            _ = cancelled.changed() => None,
            result = execute => Some(result),
        };
        match outcome {
            Some(Ok(result)) => { running.phase = "succeeded".into(); running.result = Some(result); }
            Some(Err(error)) => { running.phase = "failed".into(); running.error = Some(format!("{error:#}")); }
            None => {
                // A managed HTTP request may keep computing after its client drops.
                // Only a task that acquired the slot owns the running local server.
                if running.phase == "running" {
                    if let Some(model) = local_model { let _ = app.runtime.stop(&model).await; }
                }
                running.phase = "cancelled".into();
                running.error = Some("cancelled by user".into());
            }
        }
        // Retain an in-memory terminal state if the disk fills while settling.
        let mut cancellations = app.harness_cancels.lock().unwrap();
        if let Err(error) = publish(&app, &running) {
            running.phase = "failed".into();
            running.error = Some(format!("could not persist task result: {error}"));
            app.harness_failures.lock().unwrap().insert(running.id.clone(), running.clone());
        }
        cancellations.remove(&running.id);
        app.harness_progress.lock().unwrap().remove(&running.id);
        drop(cancellations);
        drop(permit);
    });
    Ok(job)
}

pub fn status(app: &AppState, id: &str) -> anyhow::Result<Job> {
    if let Some(job) = app.harness_failures.lock().unwrap().get(id) { return Ok(job.clone()); }
    let mut job = read(app, id)?;
    if matches!(job.phase.as_str(), "queued" | "running") {
        job.progress = app.harness_progress.lock().unwrap().get(id).cloned();
    }
    Ok(job)
}

pub fn cancel(app: &AppState, id: &str) -> anyhow::Result<Job> {
    let job = status(app, id)?;
    if let Some(sender) = app.harness_cancels.lock().unwrap().get(id) { let _ = sender.send(true); }
    Ok(job)
}

pub async fn wait(app: &AppState, id: &str) -> anyhow::Result<StylizeResult> {
    loop {
        let job = status(app, id)?;
        match job.phase.as_str() {
            "queued" | "running" => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
            "succeeded" => return job.result.ok_or_else(|| anyhow::anyhow!("task result is missing")),
            _ => anyhow::bail!("{}", job.error.unwrap_or(job.phase)),
        }
    }
}
