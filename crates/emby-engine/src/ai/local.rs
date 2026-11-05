//! Local runtimes: stable-diffusion.cpp for images, llama.cpp for the routing
//! expert / prompt rewriting.
//!
//! Binary resolution order: environment variable -> `<data-root>/runtime/bin/` -> PATH.
//! Models come from `<data-root>/models/runtime/<id>/`, installed from the Models tab.
use super::{ChatOutput, ChatRequest, ImageOutput, ImageRequest, Provider};
use crate::models::{self, ModelManifest, ModelRuntime};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use crate::state::AppState;
use std::path::{Path, PathBuf};

fn bin_candidates(data_root: &Path, env_key: &str, names: &[&str]) -> Option<PathBuf> {
    if let Ok(value) = std::env::var(env_key) {
        let path = PathBuf::from(value);
        if path.is_file() { return Some(path); }
    }
    let dir = data_root.join("runtime").join("bin");
    for name in names {
        let path = dir.join(name);
        if path.is_file() { return Some(path); }
    }
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let path = dir.join(name);
            if path.is_file() { return Some(path); }
        }
    }
    None
}

pub fn sd_bin(data_root: &Path) -> Option<PathBuf> {
    // Recent stable-diffusion.cpp releases split the CLI and the server.
    bin_candidates(data_root, "OPEN_EMBY_SD_BIN", &["sd-cli.exe", "sd-cli", "sd.exe", "sd"])
}

/// HTTP server binary shipped next to the CLI (sd-server.exe in recent builds).
pub fn sd_server_bin(data_root: &Path) -> Option<PathBuf> {
    bin_candidates(data_root, "OPEN_EMBY_SD_SERVER_BIN", &["sd-server.exe", "sd-server"])
}

pub fn llama_bin(data_root: &Path) -> Option<PathBuf> {
    bin_candidates(data_root, "OPEN_EMBY_LLAMA_BIN", &["llama-cli.exe", "llama-cli", "llama.exe", "llama"])
}

/// llama.cpp server binary (used by the managed runtime, not by one-shot calls).
pub fn llama_server_bin(data_root: &Path) -> Option<PathBuf> {
    bin_candidates(data_root, "OPEN_EMBY_LLAMA_SERVER_BIN", &["llama-server.exe", "llama-server"])
}

fn file_in(manifest: &ModelManifest, dir: &Path, needle: &str) -> Option<PathBuf> {
    let file = manifest.files.iter().find(|f| f.name.to_ascii_lowercase().contains(needle))?;
    let path = dir.join(&file.name);
    path.is_file().then_some(path)
}

/// Automatic stylization must choose a tested editor, never an arbitrary checkpoint
/// just because its filename sorts first. Explicit model selection stays strict.
pub fn resolve_image(data_root: &Path, wanted: Option<&str>) -> anyhow::Result<models::InstalledModel> {
    let mut candidates = models::installed(data_root);
    candidates.retain(|m| m.ready && matches!(m.manifest.runtime, ModelRuntime::SdCpp | ModelRuntime::ComfyUi));
    candidates.sort_by_key(|m| if m.manifest.family == "qwen-image-2.1" { 0 } else { 1 });
    let explicit = wanted.filter(|s| !s.trim().is_empty());
    for model in candidates {
        if let Some(id) = explicit {
            if model.manifest.id != id { continue; }
        } else if model.manifest.files.iter().any(|f| f.name.to_ascii_lowercase().contains("inpainting")) {
            continue;
        }
        let ready = match model.manifest.runtime {
            ModelRuntime::ComfyUi => super::comfy::validate(data_root, &model),
            ModelRuntime::SdCpp => {
                if sd_server_bin(data_root).or_else(|| sd_bin(data_root)).is_none() {
                    Err(anyhow::anyhow!("stable-diffusion.cpp binary is unavailable"))
                } else { model_args(&model.manifest, Path::new(&model.dir)).map(|_| ()) }
            }
            ModelRuntime::LlamaCpp => unreachable!(),
        };
        match ready {
            Ok(()) => return Ok(model),
            Err(error) if explicit.is_some() => return Err(error),
            Err(_) => continue,
        }
    }
    anyhow::bail!("no ready local image editor matches {:?}; register Qwen Image 2.1 with scripts/register-qwen-local.mjs", explicit)
}

/// Model arguments shared by one-shot CLI calls and the managed server.
pub fn model_args(manifest: &ModelManifest, dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut args: Vec<String> = Vec::new();
    match manifest.family.as_str() {
        "flux" => {
            let main = file_in(manifest, dir, "gguf").or_else(|| file_in(manifest, dir, "safetensors"))
                .ok_or_else(|| anyhow::anyhow!("FLUX weights are missing"))?;
            args.push("--diffusion-model".into()); args.push(main.to_string_lossy().into());
            if let Some(vae) = file_in(manifest, dir, "ae") { args.push("--vae".into()); args.push(vae.to_string_lossy().into()); }
            if let Some(clip) = file_in(manifest, dir, "clip_l") { args.push("--clip-l".into()); args.push(clip.to_string_lossy().into()); }
            if let Some(t5) = file_in(manifest, dir, "t5") { args.push("--t5xxl".into()); args.push(t5.to_string_lossy().into()); }
        }
        "qwen-image" => {
            let main = file_in(manifest, dir, "qwen-image").ok_or_else(|| anyhow::anyhow!("Qwen-Image weights are missing"))?;
            args.push("--diffusion-model".into()); args.push(main.to_string_lossy().into());
            if let Some(vae) = file_in(manifest, dir, "vae") { args.push("--vae".into()); args.push(vae.to_string_lossy().into()); }
            if let Some(encoder) = file_in(manifest, dir, "qwen2.5-vl").or_else(|| file_in(manifest, dir, "qwen2.5")).or_else(|| file_in(manifest, dir, "qwen_2.5_vl")) {
                args.push("--qwen2vl".into()); args.push(encoder.to_string_lossy().into());
            }
        }
        _ => {
            let main = manifest.primary_file().ok_or_else(|| anyhow::anyhow!("model file is missing"))?;
            args.push("-m".into()); args.push(dir.join(&main.name).to_string_lossy().into());
        }
    }
    Ok(args)
}

pub async fn image(app: &AppState, provider: &Provider, req: &ImageRequest) -> anyhow::Result<ImageOutput> {
    let wanted = req.model.clone().or_else(|| Some(provider.image_model.clone()).filter(|s| !s.trim().is_empty()));
    let model = resolve_image(&app.data_root, wanted.as_deref())?;
    if model.manifest.runtime == ModelRuntime::ComfyUi {
        return super::comfy::image(app, provider, &model, req).await;
    }
    let dir = PathBuf::from(&model.dir);
    let manifest = &model.manifest;

    let defaults = &manifest.defaults;
    let steps = if req.steps > 0 { req.steps } else { defaults.steps.max(1) };
    let cfg = if req.cfg_scale > 0.0 { req.cfg_scale } else { defaults.cfg_scale };
    let width = if req.width >= 64 { req.width } else { defaults.width.max(512) };
    let height = if req.height >= 64 { req.height } else { defaults.height.max(512) };
    let negative = if req.negative.trim().is_empty() { defaults.negative.clone() } else { req.negative.clone() };

    let out_path = req.out_path.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("emby-sd-{}.png", uuid::Uuid::new_v4()))
    });
    if let Some(parent) = out_path.parent() { std::fs::create_dir_all(parent)?; }

    // Prefer a warm managed server: no reload, no cold start. If the server binary
    // exists but nothing is running, start it once and reuse it from now on.
    if sd_server_bin(&app.data_root).is_some() {
        let spec = crate::runtime_spec::serve_spec(&app.data_root, &manifest.id)?;
        app.runtime.start(&manifest.id, spec).await?;
        let lease = app.runtime.acquire(&manifest.id).await?;
        return image_via_server(&lease.server, provider, manifest, req, &out_path, width, height, steps, cfg, &negative).await;
    }

    // Fallback: one-shot CLI (no managed server available).
    let bin = sd_bin(&app.data_root).ok_or_else(|| anyhow::anyhow!(
        "no managed server and stable-diffusion.cpp CLI not found: put sd-cli.exe / sd-server.exe in {}/runtime/bin/",
        app.data_root.display()
    ))?;
    let mut args = model_args(manifest, &dir)?;
    args.extend([
        "-p".into(), req.prompt.clone(),
        "-n".into(), negative,
        "-W".into(), width.to_string(),
        "-H".into(), height.to_string(),
        "--steps".into(), steps.to_string(),
        "--cfg-scale".into(), format!("{cfg:.2}"),
        "-s".into(), req.seed.max(0).to_string(),
    ]);
    if let Some(source) = req.source_image.as_ref().filter(|p| p.exists()) {
        // img_gen is the image mode; passing an init image turns it into img2img.
        args.extend([
            "-i".into(), source.to_string_lossy().into(),
            "--strength".into(), format!("{:.2}", req.strength.clamp(0.05, 0.95)),
        ]);
    }
    args.extend(["-o".into(), out_path.to_string_lossy().into(), "--v".into()]);

    let output = tokio::time::timeout(
        std::time::Duration::from_secs(30 * 60),
        tokio::process::Command::new(&bin).args(&args).kill_on_drop(true).output(),
    ).await.map_err(|_| anyhow::anyhow!("local image generation timed out after 30 minutes"))??;

    if !output.status.success() {
        let tail: String = String::from_utf8_lossy(&output.stderr).chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        anyhow::bail!("stable-diffusion.cpp failed: {tail}");
    }
    if !out_path.is_file() {
        anyhow::bail!("stable-diffusion.cpp produced no output file");
    }
    Ok(ImageOutput {
        path: out_path,
        provider: provider.name.clone(),
        model: manifest.name.clone(),
        prompt: req.prompt.clone(),
    })
}

#[allow(clippy::too_many_arguments)]
async fn image_via_server(
    server: &emby_runtime::ServerStatus,
    provider: &Provider,
    manifest: &ModelManifest,
    req: &ImageRequest,
    out_path: &Path,
    width: u32,
    height: u32,
    steps: u32,
    cfg: f32,
    negative: &str,
) -> anyhow::Result<ImageOutput> {
    let base = format!("http://127.0.0.1:{}", server.port);
    let mut body = serde_json::json!({
        "prompt": req.prompt,
        "negative_prompt": negative,
        "width": width,
        "height": height,
        "steps": steps,
        "cfg_scale": cfg,
        "seed": req.seed.max(0),
        "batch_size": 1,
        "n_iter": 1,
    });
    let endpoint = match req.source_image.as_ref().filter(|path| path.exists()) {
        Some(source) => {
            let bytes = std::fs::read(source)?;
            body["init_images"] = serde_json::json!([STANDARD.encode(bytes)]);
            body["denoising_strength"] = serde_json::json!(req.strength.clamp(0.05, 0.95));
            format!("{base}/sdapi/v1/img2img")
        }
        None => format!("{base}/sdapi/v1/txt2img"),
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30 * 60))
        .build()?;
    let response = client.post(&endpoint).json(&body).send().await?;
    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        anyhow::bail!("managed model server returned {status}: {}", text.chars().take(400).collect::<String>());
    }
    let value: serde_json::Value = response.json().await?;
    let encoded = value["images"].get(0).and_then(|item| item.as_str())
        .ok_or_else(|| anyhow::anyhow!("managed model server returned no image"))?;
    let bytes = STANDARD.decode(encoded.trim())?;
    std::fs::write(out_path, bytes)?;
    Ok(ImageOutput {
        path: out_path.to_path_buf(),
        provider: provider.name.clone(),
        model: manifest.name.clone(),
        prompt: req.prompt.clone(),
    })
}

pub async fn chat(app: &AppState, provider: &Provider, req: &ChatRequest) -> anyhow::Result<ChatOutput> {
    let bin = llama_bin(&app.data_root).ok_or_else(|| anyhow::anyhow!(
        "llama.cpp not found: put llama-cli.exe in {}/runtime/bin/ or set OPEN_EMBY_LLAMA_BIN",
        app.data_root.display()
    ))?;
    let wanted = req.model.clone().or_else(|| Some(provider.chat_model.clone()).filter(|s| !s.trim().is_empty()));
    let model = models::resolve_local(&app.data_root, wanted.as_deref(), ModelRuntime::LlamaCpp)
        .ok_or_else(|| anyhow::anyhow!("no local text model installed"))?;
    let path = PathBuf::from(&model.dir).join(&model.manifest.files[0].name);

    let prompt = if req.system.trim().is_empty() {
        req.prompt.clone()
    } else {
        format!("{}\n\n{}", req.system.trim(), req.prompt)
    };
    let args = [
        "-m".to_string(), path.to_string_lossy().into(),
        "-p".to_string(), prompt,
        "-n".to_string(), req.max_tokens.max(64).to_string(),
        "--temp".to_string(), "0.2".to_string(),
        "--no-display-prompt".to_string(),
    ];
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10 * 60),
        tokio::process::Command::new(&bin).args(&args).kill_on_drop(true).output(),
    ).await.map_err(|_| anyhow::anyhow!("local text model timed out after 10 minutes"))??;
    if !output.status.success() {
        let tail: String = String::from_utf8_lossy(&output.stderr).chars().take(600).collect();
        anyhow::bail!("llama.cpp failed: {tail}");
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        anyhow::bail!("llama.cpp produced no text");
    }
    Ok(ChatOutput { text, provider: provider.name.clone(), model: model.manifest.name })
}
