//! Public HTTP API: AI provider management, model installation, harness calls.
//! Every capability lives in Rust; Electron only reads and writes state through
//! these endpoints.
use crate::ai::{self, Provider};
use crate::harness;
use crate::models;
use crate::state::{AppState, InstallStatus};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value as JsonV};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, OnceLock};

fn cancels() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static CANCELS: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    CANCELS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn fail(status: StatusCode, message: impl ToString) -> Response {
    (status, Json(json!({ "error": message.to_string() }))).into_response()
}

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/ai/status", get(ai_status))
        .route("/api/ai/providers", get(list_providers).put(save_provider))
        .route("/api/ai/providers/{id}", axum::routing::delete(delete_provider))
        .route("/api/ai/providers/{id}/test", post(test_provider))
        .route("/api/models", get(list_models))
        .route("/api/models/catalog", get(list_catalog))
        .route("/api/models/install", post(start_install))
        .route("/api/models/import", post(import_model))
        .route("/api/models/import-local", post(import_local))
        .route("/api/models/install/{job}", get(install_status))
        .route("/api/models/install/{job}/cancel", post(cancel_install))
        .route("/api/models/remove", post(remove_model))
        .route("/api/harness/stylize", post(harness_stylize))
        .route("/api/harness/stylize/jobs", post(submit_stylize))
        .route("/api/harness/jobs/{id}", get(harness_job))
        .route("/api/harness/jobs/{id}/cancel", post(cancel_harness_job))
        .route("/api/harness/stitch-route", post(harness_stitch_route))
        .route("/api/runtime/devices", get(runtime_devices))
        .route("/api/runtime/servers", get(runtime_list))
        .route("/api/runtime/servers/{model}/start", post(runtime_start))
        .route("/api/runtime/servers/{model}/stop", post(runtime_stop))
        .route("/api/runtime/servers/{model}/touch", post(runtime_touch))
}

async fn ai_status(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    let providers: Vec<Provider> = st.providers.lock().unwrap().iter().map(Provider::masked).collect();
    let installed = models::installed(&st.data_root);
    Json(json!({
        "providers": providers,
        "runtime": {
            "sdBin": ai::local::sd_bin(&st.data_root).map(|p| p.to_string_lossy().to_string()),
            "llamaBin": ai::local::llama_bin(&st.data_root).map(|p| p.to_string_lossy().to_string()),
            "modelsRoot": models::runtime_root(&st.data_root).to_string_lossy().to_string(),
            "installed": installed.len(),
            "ready": installed.iter().filter(|m| m.ready).count(),
        }
    }))
}

async fn list_providers(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    let list: Vec<Provider> = st.providers.lock().unwrap().iter().map(Provider::masked).collect();
    Json(json!({ "providers": list }))
}

async fn save_provider(State(st): State<Arc<AppState>>, Json(mut provider): Json<Provider>) -> Response {
    if provider.id.trim().is_empty() {
        provider.id = uuid::Uuid::new_v4().to_string();
    }
    if provider.name.trim().is_empty() {
        provider.name = provider.id.clone();
    }
    match ai::upsert_provider(&st.data_root, provider) {
        Ok(list) => {
            *st.providers.lock().unwrap() = list.clone();
            Json(json!({ "providers": list.iter().map(Provider::masked).collect::<Vec<_>>() })).into_response()
        }
        Err(error) => fail(StatusCode::BAD_REQUEST, error),
    }
}

async fn delete_provider(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match ai::remove_provider(&st.data_root, &id) {
        Ok(list) => {
            *st.providers.lock().unwrap() = list.clone();
            Json(json!({ "providers": list.iter().map(Provider::masked).collect::<Vec<_>>() })).into_response()
        }
        Err(error) => fail(StatusCode::BAD_REQUEST, error),
    }
}

async fn test_provider(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    let Some(provider) = st.providers.lock().unwrap().iter().find(|p| p.id == id).cloned() else {
        return fail(StatusCode::NOT_FOUND, "provider not found");
    };
    match provider.kind {
        ai::ProviderKind::Builtin => Json(json!({ "ok": true, "detail": "the built-in algorithm needs no network" })).into_response(),
        ai::ProviderKind::Local => {
            let has_sd = ai::local::sd_bin(&st.data_root).is_some();
            let has_llm = ai::local::llama_bin(&st.data_root).is_some();
            Json(json!({ "ok": has_sd || has_llm, "detail": format!("sd: {} · llama: {}", has_sd, has_llm) })).into_response()
        }
        ai::ProviderKind::OpenAi => {
            let base = provider.base_url.trim_end_matches('/');
            if base.is_empty() {
                return Json(json!({ "ok": false, "detail": "Base URL is empty" })).into_response();
            }
            let client = reqwest::Client::new();
            let mut request = client.get(format!("{base}/models")).timeout(std::time::Duration::from_secs(12));
            if !provider.api_key.trim().is_empty() {
                request = request.bearer_auth(provider.api_key.trim());
            }
            match request.send().await {
                Ok(res) if res.status().is_success() => Json(json!({ "ok": true, "detail": "endpoint reachable" })).into_response(),
                Ok(res) => Json(json!({ "ok": false, "detail": format!("HTTP {}", res.status()) })).into_response(),
                Err(error) => Json(json!({ "ok": false, "detail": error.to_string() })).into_response(),
            }
        }
    }
}

async fn list_models(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    let installed = models::installed(&st.data_root);
    let catalog = models::catalog(&st.data_root);
    Json(json!({
        "installed": installed,
        "catalog": catalog.iter().map(|m| json!({
            "manifest": m,
            "installed": installed.iter().any(|i| i.manifest.id == m.id && i.ready)
        })).collect::<Vec<_>>(),
    }))
}

async fn list_catalog(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    let installed = models::installed(&st.data_root);
    let items: Vec<JsonV> = models::catalog(&st.data_root).into_iter().map(|m| {
        let state = installed.iter().find(|i| i.manifest.id == m.id);
        json!({
            "manifest": m,
            "ready": state.map(|s| s.ready).unwrap_or(false),
            "partial": state.map(|s| !s.ready).unwrap_or(false),
            "installedBytes": state.map(|s| s.bytes).unwrap_or(0),
        })
    }).collect();
    Json(json!({ "catalog": items }))
}

#[derive(Deserialize)]
struct InstallBody { id: String }

async fn start_install(State(st): State<Arc<AppState>>, Json(body): Json<InstallBody>) -> Response {
    let Some(manifest) = models::find(&st.data_root, &body.id) else {
        return fail(StatusCode::NOT_FOUND, format!("no model {} in the catalog", body.id));
    };
    let job = spawn_install(&st, manifest);
    Json(json!({ "job": job })).into_response()
}

/// Shared install driver: creates a job, streams progress to the store and WS,
/// and records the final state. Used by catalog install and URL import.
fn spawn_install(st: &Arc<AppState>, manifest: models::ModelManifest) -> String {
    let job = uuid::Uuid::new_v4().to_string();
    let cancel = Arc::new(AtomicBool::new(false));
    cancels().lock().unwrap().insert(job.clone(), cancel.clone());
    let status = InstallStatus {
        job: job.clone(),
        model_id: manifest.id.clone(),
        phase: "queued".into(),
        file: String::new(),
        file_index: 0,
        file_count: manifest.files.len(),
        received: 0,
        total: manifest.approx_bytes,
        message: "queued".into(),
        done: false,
        error: String::new(),
    };
    st.installs.lock().unwrap().insert(job.clone(), status);

    let task_state = st.clone();
    let task_job = job.clone();
    tokio::spawn(async move {
        let store = task_state.clone();
        let broadcast_state = task_state.clone();
        let result = models::installer::install(
            &task_state.data_root,
            &manifest,
            &task_job,
            cancel,
            move |progress| {
                let status = InstallStatus {
                    job: progress.job.clone(),
                    model_id: progress.model_id.clone(),
                    phase: progress.phase.clone(),
                    file: progress.file.clone(),
                    file_index: progress.file_index,
                    file_count: progress.file_count,
                    received: progress.received,
                    total: progress.total,
                    message: progress.message.clone(),
                    done: progress.phase == "done",
                    error: if progress.phase == "error" { progress.message.clone() } else { String::new() },
                };
                store.installs.lock().unwrap().insert(progress.job.clone(), status.clone());
                broadcast_state.broadcast(json!({ "type": "model.install", "data": status }));
            },
        ).await;
        let mut map = task_state.installs.lock().unwrap();
        let entry = map.entry(task_job.clone()).or_insert_with(|| status_template(&task_job, &manifest.id));
        entry.done = true;
        if let Err(error) = &result {
            entry.phase = "error".into();
            entry.error = error.to_string();
            entry.message = error.to_string();
        }
        let snapshot = entry.clone();
        drop(map);
        task_state.broadcast(json!({ "type": "model.install", "data": snapshot }));
        cancels().lock().unwrap().remove(&task_job);
    });
    job
}


/* ------------------------------------------------------------------ */
/* Import: URL and local files                                          */
/* ------------------------------------------------------------------ */

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportBody {
    url: String,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    runtime: Option<models::ModelRuntime>,
    #[serde(default)]
    sha256: Option<String>,
    #[serde(default)]
    bytes: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalImportBody {
    files: Vec<String>,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    family: Option<String>,
    #[serde(default)]
    runtime: Option<models::ModelRuntime>,
}

/// Guess the model family from file names. The family decides how the local
/// runtime builds its arguments (single checkpoint vs FLUX/Qwen multi-file).
fn infer_family(names: &[String]) -> String {
    let joined = names.join(" ").to_ascii_lowercase();
    if joined.contains("qwen-image") || joined.contains("qwen_image") { return "qwen-image".into(); }
    if joined.contains("flux") { return "flux".into(); }
    if joined.contains("sdxl") || joined.contains("sd_xl") { return "sdxl".into(); }
    if joined.contains("sd15") || joined.contains("v1-5") || joined.contains("v1.5") { return "sd15".into(); }
    let looks_llm = names.iter().any(|n| {
        let lower = n.to_ascii_lowercase();
        lower.ends_with(".gguf") && (lower.contains("instruct") || lower.contains("chat") || lower.contains("qwen2.5") || lower.contains("llm"))
    });
    if looks_llm { return "llm".into(); }
    "custom".into()
}

fn infer_runtime(family: &str, explicit: Option<models::ModelRuntime>) -> models::ModelRuntime {
    explicit.unwrap_or_else(|| {
        if family == "llm" { models::ModelRuntime::LlamaCpp } else { models::ModelRuntime::SdCpp }
    })
}

fn safe_file_name(raw: &str) -> Option<String> {
    let name = raw.rsplit(['/', '\\']).next()?.trim();
    if name.is_empty() || name == "." || name == ".." { return None; }
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')) { return None; }
    Some(name.to_string())
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn default_id(names: &[String]) -> String {
    let stem = names.first().map(|n| {
        let without_ext = n.rsplit_once('.').map(|(base, _)| base).unwrap_or(n);
        without_ext.to_string()
    }).unwrap_or_else(|| "model".into());
    let base = slug(&stem);
    if base.is_empty() { "model".into() } else { base }
}

fn build_manifest(
    id: String,
    name: String,
    family: String,
    runtime: models::ModelRuntime,
    files: Vec<models::ModelFile>,
    description: String,
) -> models::ModelManifest {
    let approx = files.iter().map(|f| f.bytes).sum();
    models::ModelManifest {
        id,
        name,
        family,
        runtime,
        description,
        license: "Imported by the user".into(),
        approx_bytes: approx,
        tags: vec!["imported".into()],
        files,
        defaults: models::ModelDefaults::default(),
    }
}

/// Install a model from a direct file URL (HuggingFace resolve link or any mirror).
async fn import_model(State(st): State<Arc<AppState>>, Json(body): Json<ImportBody>) -> Response {
    let url = body.url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return fail(StatusCode::BAD_REQUEST, "url must start with http:// or https://");
    }
    let path = url.split('?').next().unwrap_or(url);
    let Some(file_name) = safe_file_name(path) else {
        return fail(StatusCode::BAD_REQUEST, "cannot derive a safe file name from the url");
    };
    let family = body.family.clone().unwrap_or_else(|| infer_family(std::slice::from_ref(&file_name)));
    let runtime = infer_runtime(&family, body.runtime);
    let id = body.id.clone().filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| default_id(std::slice::from_ref(&file_name)));
    if models::model_dir(&st.data_root, &id).exists() {
        return fail(StatusCode::CONFLICT, format!("model {id} already exists"));
    }
    let name = body.name.clone().unwrap_or_else(|| file_name.clone());
    let manifest = build_manifest(
        id,
        name,
        family,
        runtime,
        vec![models::ModelFile {
            name: file_name,
            url: url.to_string(),
            sha256: body.sha256.clone().unwrap_or_default(),
            bytes: body.bytes.unwrap_or(0),
        }],
        "Imported from URL".into(),
    );
    let job = spawn_install(&st, manifest.clone());
    Json(json!({ "job": job, "model": manifest })).into_response()
}

/// Import local files by hard-linking them into the runtime model directory.
/// Hard links avoid duplicating multi-GB weights; cross-volume links are rejected
/// instead of silently copying.
async fn import_local(State(st): State<Arc<AppState>>, Json(body): Json<LocalImportBody>) -> Response {
    if body.files.is_empty() {
        return fail(StatusCode::BAD_REQUEST, "files must not be empty");
    }
    let mut sources: Vec<std::path::PathBuf> = Vec::new();
    let mut names: Vec<String> = Vec::new();
    for raw in &body.files {
        let path = std::path::PathBuf::from(raw);
        if !path.is_file() {
            return fail(StatusCode::BAD_REQUEST, format!("not a file: {raw}"));
        }
        let Some(name) = safe_file_name(raw) else {
            return fail(StatusCode::BAD_REQUEST, format!("unsupported file name: {raw}"));
        };
        if names.contains(&name) {
            return fail(StatusCode::BAD_REQUEST, format!("duplicate file name: {name}"));
        }
        sources.push(path);
        names.push(name);
    }

    let family = body.family.clone().unwrap_or_else(|| infer_family(&names));
    let runtime = infer_runtime(&family, body.runtime);
    let id = body.id.clone().filter(|s| !s.trim().is_empty()).unwrap_or_else(|| default_id(&names));
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) {
        return fail(StatusCode::BAD_REQUEST, "id may only contain letters, digits, '-', '_' and '.'");
    }
    let dir = models::model_dir(&st.data_root, &id);
    if dir.exists() {
        return fail(StatusCode::CONFLICT, format!("model {id} already exists"));
    }
    if let Err(error) = std::fs::create_dir_all(&dir) {
        return fail(StatusCode::INTERNAL_SERVER_ERROR, error);
    }

    let mut files = Vec::new();
    for (source, name) in sources.iter().zip(names.iter()) {
        let target = dir.join(name);
        if let Err(error) = std::fs::hard_link(source, &target) {
            let _ = std::fs::remove_dir_all(&dir);
            return fail(
                StatusCode::BAD_REQUEST,
                format!(
                    "cannot hard-link {}: {error}. Keep the model and the data root on the same volume, or import it from a URL.",
                    source.display()
                ),
            );
        }
        let bytes = std::fs::metadata(source).map(|m| m.len()).unwrap_or(0);
        files.push(models::ModelFile { name: name.clone(), url: String::new(), sha256: String::new(), bytes });
    }

    let name = body.name.clone().unwrap_or_else(|| names.first().cloned().unwrap_or_else(|| id.clone()));
    let manifest = build_manifest(id.clone(), name, family, runtime, files, "Imported from local files".into());
    let manifest_json = match serde_json::to_vec_pretty(&manifest) {
        Ok(value) => value,
        Err(error) => {
            let _ = std::fs::remove_dir_all(&dir);
            return fail(StatusCode::INTERNAL_SERVER_ERROR, error);
        }
    };
    if let Err(error) = std::fs::write(dir.join("manifest.json"), manifest_json) {
        let _ = std::fs::remove_dir_all(&dir);
        return fail(StatusCode::INTERNAL_SERVER_ERROR, error);
    }
    Json(json!({ "installed": manifest, "dir": dir.to_string_lossy() })).into_response()
}

fn status_template(job: &str, model_id: &str) -> InstallStatus {
    InstallStatus {
        job: job.to_string(),
        model_id: model_id.to_string(),
        phase: "error".into(),
        file: String::new(),
        file_index: 0,
        file_count: 0,
        received: 0,
        total: 0,
        message: String::new(),
        done: true,
        error: String::new(),
    }
}

async fn install_status(State(st): State<Arc<AppState>>, Path(job): Path<String>) -> Response {
    match st.installs.lock().unwrap().get(&job).cloned() {
        Some(status) => Json(status).into_response(),
        None => fail(StatusCode::NOT_FOUND, "job not found"),
    }
}

async fn cancel_install(State(st): State<Arc<AppState>>, Path(job): Path<String>) -> Json<JsonV> {
    if let Some(flag) = cancels().lock().unwrap().get(&job) {
        flag.store(true, std::sync::atomic::Ordering::Relaxed);
    }
    if let Some(entry) = st.installs.lock().unwrap().get_mut(&job) {
        entry.phase = "cancelled".into();
        entry.message = "cancel requested".into();
    }
    Json(json!({ "ok": true }))
}

async fn remove_model(State(st): State<Arc<AppState>>, Json(body): Json<InstallBody>) -> Response {
    match models::remove(&st.data_root, &body.id) {
        Ok(()) => Json(json!({ "ok": true })).into_response(),
        Err(error) => fail(StatusCode::BAD_REQUEST, error),
    }
}

async fn harness_stylize(State(st): State<Arc<AppState>>, Json(input): Json<harness::StylizeInput>) -> Response {
    let job = match harness::jobs::submit(st.clone(), input) {
        Ok(job) => job,
        Err(error) => return fail(StatusCode::BAD_REQUEST, error),
    };
    match harness::jobs::wait(&st, &job.id).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => fail(StatusCode::BAD_GATEWAY, error),
    }
}

async fn submit_stylize(State(st): State<Arc<AppState>>, Json(input): Json<harness::StylizeInput>) -> Response {
    match harness::jobs::submit(st, input) {
        Ok(job) => (StatusCode::ACCEPTED, Json(job)).into_response(),
        Err(error) => fail(StatusCode::BAD_REQUEST, error),
    }
}

async fn harness_job(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match harness::jobs::status(&st, &id) {
        Ok(job) => Json(job).into_response(),
        Err(error) => fail(StatusCode::NOT_FOUND, error),
    }
}

async fn cancel_harness_job(State(st): State<Arc<AppState>>, Path(id): Path<String>) -> Response {
    match harness::jobs::cancel(&st, &id) {
        Ok(job) => Json(job).into_response(),
        Err(error) => fail(StatusCode::NOT_FOUND, error),
    }
}

async fn harness_stitch_route(State(st): State<Arc<AppState>>, Json(input): Json<harness::stitch::RouteInput>) -> Response {
    match harness::stitch::route(&st, input).await {
        Ok(result) => Json(result).into_response(),
        Err(error) => fail(StatusCode::BAD_GATEWAY, error),
    }
}

/* ------------------------------------------------------------------ */
/* Model runtime: managed server lifecycle                             */
/* ------------------------------------------------------------------ */

async fn runtime_devices(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    let report = emby_runtime::device::probe();
    let binaries = json!({
        "sdCli": crate::ai::local::sd_bin(&st.data_root).map(|p| p.to_string_lossy().to_string()),
        "sdServer": crate::ai::local::sd_server_bin(&st.data_root).map(|p| p.to_string_lossy().to_string()),
        "llamaServer": crate::ai::local::llama_server_bin(&st.data_root).map(|p| p.to_string_lossy().to_string()),
    });
    Json(json!({
        "os": report.os,
        "devices": report.devices,
        "recommendedBackend": report.recommended_backend,
        "binaries": binaries,
    }))
}

async fn runtime_list(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    Json(json!(st.runtime.list().await))
}

async fn runtime_start(State(st): State<Arc<AppState>>, Path(model): Path<String>) -> Response {
    match crate::runtime_spec::serve_spec(&st.data_root, &model) {
        Ok(spec) => match st.runtime.start(&model, spec).await {
            Ok(status) => Json(status).into_response(),
            Err(error) => fail(StatusCode::BAD_GATEWAY, error),
        },
        Err(error) => fail(StatusCode::BAD_REQUEST, error),
    }
}

async fn runtime_stop(State(st): State<Arc<AppState>>, Path(model): Path<String>) -> Response {
    if st.runtime.get(&model).await.is_none() {
        return fail(StatusCode::NOT_FOUND, format!("no server registered for {model}"));
    }
    match st.runtime.stop(&model).await {
        Ok(status) => Json(status).into_response(),
        Err(error) => fail(StatusCode::INTERNAL_SERVER_ERROR, error),
    }
}

async fn runtime_touch(State(st): State<Arc<AppState>>, Path(model): Path<String>) -> Json<JsonV> {
    Json(json!({ "ok": st.runtime.touch(&model).await }))
}
