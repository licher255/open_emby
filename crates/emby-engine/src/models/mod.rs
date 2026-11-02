//! Model asset layer: catalog, installation (download / verify / write), lookup.
//!
//! Design rules:
//! - Model descriptions are data, not code. The built-in catalog ships with the app;
//!   users can override or extend it via `<data-root>/models/catalog.local.json`
//!   without touching the codebase.
//! - The install layout is independent of ComfyUI's checkpoints/loras folders:
//!   `<data-root>/models/runtime/<id>/`, each model carrying its own manifest.json.
//! - Downloads resume with HTTP Range and verify SHA-256 when provided; progress is
//!   broadcast on the event bus.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub mod installer;

pub const EMBEDDED_CATALOG: &str = include_str!("../../assets/model-catalog.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ModelRuntime {
    SdCpp,
    LlamaCpp,
}

impl ModelRuntime {
    pub fn label(&self) -> &'static str {
        match self {
            ModelRuntime::SdCpp => "stable-diffusion.cpp",
            ModelRuntime::LlamaCpp => "llama.cpp",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDefaults {
    #[serde(default)]
    pub steps: u32,
    #[serde(default)]
    pub cfg_scale: f32,
    #[serde(default)]
    pub width: u32,
    #[serde(default)]
    pub height: u32,
    #[serde(default)]
    pub negative: String,
}

impl Default for ModelDefaults {
    fn default() -> Self {
        Self { steps: 24, cfg_scale: 7.0, width: 768, height: 768, negative: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelManifest {
    pub id: String,
    pub name: String,
    pub family: String,
    pub runtime: ModelRuntime,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub approx_bytes: u64,
    #[serde(default)]
    pub tags: Vec<String>,
    pub files: Vec<ModelFile>,
    #[serde(default)]
    pub defaults: ModelDefaults,
}

impl ModelManifest {
    pub fn primary_file(&self) -> Option<&ModelFile> {
        self.files.iter().find(|f| {
            let lower = f.name.to_ascii_lowercase();
            !lower.contains("vae") && !lower.contains("clip") && !lower.contains("t5") && !lower.contains("text_encoder")
                || self.files.len() == 1
        }).or_else(|| self.files.first())
    }
    pub fn file(&self, needle: &str) -> Option<PathBuf> {
        self.files.iter().find(|f| f.name.to_ascii_lowercase().contains(needle)).map(|f| PathBuf::from(&f.name))
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFileState {
    pub name: String,
    pub bytes: u64,
    pub present: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledModel {
    pub manifest: ModelManifest,
    pub dir: String,
    pub bytes: u64,
    pub ready: bool,
    pub files: Vec<ModelFileState>,
}

pub fn models_root(data_root: &Path) -> PathBuf {
    data_root.join("models")
}

pub fn runtime_root(data_root: &Path) -> PathBuf {
    models_root(data_root).join("runtime")
}

pub fn model_dir(data_root: &Path, id: &str) -> PathBuf {
    runtime_root(data_root).join(id)
}

/// Built-in catalog plus the user override file. User entries replace built-in ones
/// by id, which keeps URL fixes and new models out of the source tree.
pub fn catalog(data_root: &Path) -> Vec<ModelManifest> {
    let mut list: Vec<ModelManifest> = serde_json::from_str(EMBEDDED_CATALOG).unwrap_or_default();
    let local = models_root(data_root).join("catalog.local.json");
    if let Ok(bytes) = std::fs::read(&local) {
        if let Ok(extra) = serde_json::from_slice::<Vec<ModelManifest>>(&bytes) {
            for item in extra {
                match list.iter_mut().find(|m| m.id == item.id) {
                    Some(slot) => *slot = item,
                    None => list.push(item),
                }
            }
        }
    }
    list
}

pub fn find(data_root: &Path, id: &str) -> Option<ModelManifest> {
    catalog(data_root).into_iter().find(|m| m.id == id)
}

pub fn installed(data_root: &Path) -> Vec<InstalledModel> {
    let root = runtime_root(data_root);
    let Ok(entries) = std::fs::read_dir(&root) else { return Vec::new() };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let dir = entry.path();
        let Ok(bytes) = std::fs::read(dir.join("manifest.json")) else { continue };
        let Ok(manifest) = serde_json::from_slice::<ModelManifest>(&bytes) else { continue };
        let mut total = 0u64;
        let mut ready = !manifest.files.is_empty();
        let mut files = Vec::new();
        for file in &manifest.files {
            let meta = std::fs::metadata(dir.join(&file.name));
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            total += size;
            if size == 0 { ready = false; }
            files.push(ModelFileState { name: file.name.clone(), bytes: size, present: size > 0 });
        }
        out.push(InstalledModel { manifest, dir: dir.to_string_lossy().to_string(), bytes: total, ready, files });
    }
    out.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    out
}

/// Resolve the model a local runtime should use: explicit id first, otherwise the
/// first ready model matching the runtime.
pub fn resolve_local(data_root: &Path, wanted: Option<&str>, runtime: ModelRuntime) -> Option<InstalledModel> {
    let list = installed(data_root);
    if let Some(id) = wanted.filter(|s| !s.trim().is_empty()) {
        return list.into_iter().find(|m| m.manifest.id == id && m.manifest.runtime == runtime && m.ready);
    }
    list.into_iter().find(|m| m.manifest.runtime == runtime && m.ready)
}

pub fn remove(data_root: &Path, id: &str) -> anyhow::Result<()> {
    let dir = model_dir(data_root, id);
    if !dir.exists() {
        anyhow::bail!("model {id} is not installed");
    }
    let safe = dir.starts_with(runtime_root(data_root));
    if !safe {
        anyhow::bail!("refusing to delete a path outside the models directory");
    }
    std::fs::remove_dir_all(&dir)?;
    Ok(())
}

pub fn ensure_dirs(data_root: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(runtime_root(data_root))
}
