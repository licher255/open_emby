//! The verified Qwen 2.1 editor, hosted locally under the existing Rust supervisor.
//! ComfyUI is an inference adapter; projects, routing, prompts and jobs stay in Rust.
use super::{ImageOutput, ImageRequest, Provider};
use crate::{models::InstalledModel, state::AppState};
use anyhow::Context;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const FAMILY: &str = "qwen-image-2.1";
const WEIGHTS: [&str; 3] = [
    "qwen_image_2.1_int8_convrot.safetensors",
    "qwen3vl_8b_int8_convrot.safetensors",
    "qwen_image_2.1_vae_bf16.safetensors",
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig { python: PathBuf, main: PathBuf }

fn config(root: &Path) -> anyhow::Result<RuntimeConfig> {
    let bytes = std::fs::read(root.join("runtime/comfy.json"))
        .context("local Qwen runtime is not registered (runtime/comfy.json)")?;
    let config: RuntimeConfig = serde_json::from_slice(&bytes)?;
    anyhow::ensure!(config.python.is_file() && config.main.is_file(), "local Qwen Python/main.py is missing");
    Ok(config)
}

fn weight_paths(model: &InstalledModel) -> anyhow::Result<Vec<PathBuf>> {
    anyhow::ensure!(model.manifest.family == FAMILY, "unsupported ComfyUI model family");
    WEIGHTS.iter().map(|name| {
        let file = model.manifest.files.iter().find(|f| Path::new(&f.name).file_name().and_then(|s| s.to_str()) == Some(name))
            .ok_or_else(|| anyhow::anyhow!("Qwen 2.1 requires {name}"))?;
        let path = Path::new(&model.dir).join(&file.name);
        anyhow::ensure!(path.is_file(), "missing Qwen weight: {}", path.display());
        Ok(path)
    }).collect()
}

pub fn validate(root: &Path, model: &InstalledModel) -> anyhow::Result<()> {
    config(root)?;
    weight_paths(model)?;
    Ok(())
}

pub fn serve_spec(root: &Path, model: &InstalledModel) -> anyhow::Result<emby_runtime::ServeSpec> {
    let config = config(root)?;
    let paths = weight_paths(model)?;
    let base = root.join("engine/comfy-local");
    std::fs::create_dir_all(base.join("user"))?;
    let yaml = base.join("model-paths.yaml");
    // JSON quoted paths are valid YAML scalars, including Windows backslashes.
    let mut text = String::from("verified_qwen:\n");
    for (key, path) in ["diffusion_models", "text_encoders", "vae"].iter().zip(&paths) {
        text.push_str(&format!("  {key}: {}\n", serde_json::to_string(&path.parent().unwrap())?));
    }
    std::fs::write(&yaml, text)?;
    Ok(emby_runtime::ServeSpec {
        program: config.python.to_string_lossy().into(),
        args: vec![
            "-B".into(), config.main.to_string_lossy().into(),
            "--listen".into(), "127.0.0.1".into(), "--port".into(), "{port}".into(),
            "--base-directory".into(), base.to_string_lossy().into(),
            "--user-directory".into(), base.join("user").to_string_lossy().into(),
            "--extra-model-paths-config".into(), yaml.to_string_lossy().into(),
            "--disable-auto-launch".into(), "--disable-all-custom-nodes".into(),
        ],
        env: vec![("PYTHONDONTWRITEBYTECODE".into(), "1".into())],
        cwd: Some(root.to_string_lossy().into()),
        health_url: "http://127.0.0.1:{port}/system_stats".into(),
        ready_timeout_secs: 240, idle_timeout_secs: 900, port: 0,
    })
}

fn workflow(req: &ImageRequest, uploaded: &str) -> Value {
    json!({
        "1": {"class_type":"LoadImage", "inputs":{"image":uploaded}},
        "2": {"class_type":"UNETLoader", "inputs":{"unet_name":WEIGHTS[0], "weight_dtype":"default"}},
        "3": {"class_type":"CLIPLoader", "inputs":{"clip_name":WEIGHTS[1], "type":"qwen_image", "device":"default"}},
        "4": {"class_type":"VAELoader", "inputs":{"vae_name":WEIGHTS[2]}},
        "5": {"class_type":"QwenImage21Cache", "inputs":{"model":["2",0], "device":"auto", "dtype":"default"}},
        "6": {"class_type":"TextEncodeQwenImage21", "inputs":{
            "clip":["3",0], "vae":["4",0], "prompt":req.prompt, "negative_prompt":"",
            "resolution":512, "images.image_1":["1",0]}},
        "8": {"class_type":"KSampler", "inputs":{
            "model":["5",0], "positive":["6",0], "negative":["6",1], "latent_image":["6",2],
            "seed":req.seed, "steps":20, "cfg":1, "sampler_name":"euler", "scheduler":"simple", "denoise":1}},
        "9": {"class_type":"VAEDecode", "inputs":{"samples":["8",0], "vae":["4",0]}},
        "10": {"class_type":"SaveImage", "inputs":{"images":["9",0], "filename_prefix":"emby/qwen21"}}
    })
}

// Dropping a cancelled/timed-out Rust job must not leave an orphaned GPU job.
struct Pending { client: reqwest::Client, base: String, id: Option<String> }
impl Drop for Pending {
    fn drop(&mut self) {
        let Some(id) = self.id.take() else { return };
        let client = self.client.clone();
        let base = self.base.clone();
        tokio::spawn(async move {
            let _ = client.post(format!("{base}/queue")).json(&json!({"delete":[id]})).send().await;
            if let Ok(response) = client.get(format!("{base}/queue")).send().await {
                if let Ok(queue) = response.json::<Value>().await {
                    if queue["queue_running"].as_array().is_some_and(|rows| rows.iter().any(|row| row[1].as_str() == Some(&id))) {
                        let _ = client.post(format!("{base}/interrupt")).send().await;
                    }
                }
            }
        });
    }
}

pub async fn image(app: &AppState, provider: &Provider, model: &InstalledModel, req: &ImageRequest) -> anyhow::Result<ImageOutput> {
    validate(&app.data_root, model)?;
    let source = req.source_image.as_ref().filter(|p| p.is_file())
        .ok_or_else(|| anyhow::anyhow!("Qwen stylization requires an existing reference image"))?;
    let out = req.out_path.as_ref().ok_or_else(|| anyhow::anyhow!("missing Qwen output path"))?;
    let spec = serve_spec(&app.data_root, model)?;
    crate::harness::jobs::progress(app, req.task_id.as_deref(), "loading", None);
    app.runtime.start(&model.manifest.id, spec).await?;
    let lease = app.runtime.acquire(&model.manifest.id).await?;
    let base = format!("http://127.0.0.1:{}", lease.server.port);
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(30)).build()?;
    let client_id = uuid::Uuid::new_v4().to_string();
    // Progress is optional telemetry; reconnecting/polling must never resubmit inference.
    let mut socket = match tokio::time::timeout(std::time::Duration::from_secs(5),
        tokio_tungstenite::connect_async(format!("ws://127.0.0.1:{}/ws?clientId={client_id}", lease.server.port))).await {
        Ok(Ok((socket, _))) => Some(socket),
        _ => None,
    };
    let nodes: Value = client.get(format!("{base}/object_info")).send().await?.error_for_status()?.json().await?;
    for node in ["TextEncodeQwenImage21", "QwenImage21Cache"] {
        anyhow::ensure!(nodes.get(node).is_some(), "local runtime lacks {node}; update the registered ComfyUI installation");
    }
    let upload_name = format!("emby-{}.png", uuid::Uuid::new_v4());
    let form = reqwest::multipart::Form::new().part("image",
        reqwest::multipart::Part::bytes(std::fs::read(source)?).file_name(upload_name).mime_str("image/png")?);
    let uploaded: Value = client.post(format!("{base}/upload/image")).multipart(form).send().await?.error_for_status()?.json().await?;
    let filename = uploaded["name"].as_str().ok_or_else(|| anyhow::anyhow!("reference upload returned no filename"))?;
    let subfolder = uploaded["subfolder"].as_str().unwrap_or("");
    let uploaded_path = if subfolder.is_empty() { filename.to_string() } else { format!("{subfolder}/{filename}") };
    let graph = workflow(req, &uploaded_path);
    let workflow_path = out.with_file_name("workflow.json");
    std::fs::write(&workflow_path, serde_json::to_vec_pretty(&graph)?)?;
    let response = client.post(format!("{base}/prompt")).json(&json!({"prompt":graph, "client_id":client_id})).send().await?;
    let status = response.status();
    let submitted: Value = response.json().await?;
    anyhow::ensure!(status.is_success(), "Qwen workflow rejected: {submitted}");
    let id = submitted["prompt_id"].as_str().ok_or_else(|| anyhow::anyhow!("Qwen returned no prompt id"))?.to_string();
    std::fs::write(out.with_file_name("inference.json"), serde_json::to_vec_pretty(&json!({
        "promptId":id, "runtime":"comfy-ui", "modelId":model.manifest.id,
        "weights":weight_paths(model)?, "workflow":workflow_path,
    }))?)?;
    let mut pending = Pending { client: client.clone(), base: base.clone(), id: Some(id.clone()) };
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30 * 60);
    let mut poll = tokio::time::interval(std::time::Duration::from_millis(500));
    loop {
        anyhow::ensure!(tokio::time::Instant::now() < deadline, "local Qwen generation timed out after 30 minutes");
        tokio::select! {
            _ = poll.tick() => {},
            message = async { socket.as_mut().unwrap().next().await }, if socket.is_some() => {
                match message {
                    Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                        if let Ok(event) = serde_json::from_str::<Value>(&text) {
                            if let Some((stage, steps)) = progress_event(&event, &id) {
                                crate::harness::jobs::progress(app, req.task_id.as_deref(), stage, steps);
                            }
                        }
                    }
                    None | Some(Err(_)) | Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_))) => {
                        socket = None;
                        crate::harness::jobs::progress(app, req.task_id.as_deref(), "generating", None);
                    }
                    _ => {},
                }
                continue;
            }
        }
        let history: Value = client.get(format!("{base}/history/{id}")).send().await?.error_for_status()?.json().await?;
        if let Some(entry) = history.get(&id) {
            if entry["status"]["status_str"] == "error" {
                anyhow::bail!("Qwen inference failed: {}", entry["status"]["messages"]);
            }
            if let Some(img) = entry["outputs"]["10"]["images"].get(0) {
                let filename = img["filename"].as_str().context("Qwen output has no filename")?;
                let bytes = client.get(format!("{base}/view")).query(&[
                    ("filename", filename), ("subfolder", img["subfolder"].as_str().unwrap_or("")),
                    ("type", "output"),
                ]).send().await?.error_for_status()?.bytes().await?;
                image::load_from_memory(&bytes).context("Qwen returned an invalid image")?;
                std::fs::write(out, bytes)?;
                pending.id = None;
                return Ok(ImageOutput { path: out.clone(), provider: provider.name.clone(), model: model.manifest.name.clone(), prompt: req.prompt.clone() });
            }
            anyhow::ensure!(entry["status"]["completed"] != true, "Qwen completed without an output image");
        }
    }
}

fn progress_event<'a>(event: &Value, id: &str) -> Option<(&'a str, Option<(u32, u32)>)> {
    let data = &event["data"];
    if data["prompt_id"].as_str() != Some(id) { return None; }
    match event["type"].as_str()? {
        "progress" if data["node"].as_str() == Some("8") => {
            let max = u32::try_from(data["max"].as_u64()?).ok()?;
            let value = u32::try_from(data["value"].as_u64()?).ok()?.min(max);
            (max > 0).then_some(("sampling", Some((value, max))))
        }
        "executing" => match data["node"].as_str()? {
            "6" => Some(("encoding", None)),
            "8" => Some(("sampling", Some((0, 20)))),
            "9" => Some(("decoding", None)),
            "10" => Some(("saving", None)),
            _ => Some(("loading", None)),
        },
        _ => None,
    }
}
