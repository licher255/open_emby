//! Build a `ServeSpec` for an installed model.
//!
//! This is the only place that knows how each runtime is launched; the
//! supervisor in `emby-runtime` stays backend-agnostic.
use crate::ai::local;
use crate::models::{self, ModelRuntime};
use emby_runtime::ServeSpec;
use std::path::Path;

pub fn serve_spec(data_root: &Path, model_id: &str) -> anyhow::Result<ServeSpec> {
    let model = models::installed(data_root)
        .into_iter()
        .find(|m| m.manifest.id == model_id)
        .ok_or_else(|| anyhow::anyhow!("model {model_id} is not installed"))?;
    if !model.ready {
        anyhow::bail!("model {model_id} is incomplete; finish the install first");
    }
    let dir = std::path::PathBuf::from(&model.dir);

    match model.manifest.runtime {
        ModelRuntime::SdCpp => {
            let bin = local::sd_server_bin(data_root).ok_or_else(|| anyhow::anyhow!(
                "stable-diffusion.cpp server not found: put sd-server.exe in {}/runtime/bin/ or set OPEN_EMBY_SD_SERVER_BIN",
                data_root.display()
            ))?;
            let mut args: Vec<String> = vec![
                "--listen-ip".into(),
                "127.0.0.1".into(),
                "--listen-port".into(),
                "{port}".into(),
                "--log-level".into(),
                "info".into(),
            ];
            args.extend(local::model_args(&model.manifest, &dir)?);
            Ok(ServeSpec {
                program: bin.to_string_lossy().to_string(),
                args,
                env: Vec::new(),
                cwd: Some(dir.to_string_lossy().to_string()),
                health_url: "http://127.0.0.1:{port}/sdapi/v1/options".into(),
                ready_timeout_secs: 240,
                idle_timeout_secs: 900,
                port: 0,
            })
        }
        ModelRuntime::LlamaCpp => {
            let bin = local::llama_server_bin(data_root).ok_or_else(|| anyhow::anyhow!(
                "llama.cpp server not found: put llama-server.exe in {}/runtime/bin/",
                data_root.display()
            ))?;
            let weights = dir.join(&model.manifest.files[0].name);
            Ok(ServeSpec {
                program: bin.to_string_lossy().to_string(),
                args: vec![
                    "-m".into(), weights.to_string_lossy().to_string(),
                    "--host".into(), "127.0.0.1".into(),
                    "--port".into(), "{port}".into(),
                ],
                env: Vec::new(),
                cwd: Some(dir.to_string_lossy().to_string()),
                health_url: "http://127.0.0.1:{port}/health".into(),
                ready_timeout_secs: 120,
                idle_timeout_secs: 900,
                port: 0,
            })
        }
    }
}
