//! AI capability gateway.
//!
//! Image generation, prompt rewriting and stitch routing are not bound to a single
//! implementation: each capability is provided by a Provider, which can be a cloud
//! OpenAI-compatible API, a local runtime (stable-diffusion.cpp / llama.cpp), or the
//! built-in deterministic algorithm. Harnesses only call the unified interface here,
//! so swapping models or vendors never touches pipeline code. Electron only manages
//! configuration and display.
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub mod builtin;
pub mod comfy;
pub mod local;
pub mod openai;
pub mod routing;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    /// OpenAI-compatible cloud API (/images/generations, /chat/completions)
    OpenAi,
    /// Local runtime (stable-diffusion.cpp / llama.cpp)
    Local,
    /// Built-in deterministic algorithm; works without any model
    Builtin,
}

impl ProviderKind {
    pub fn label(&self) -> &'static str {
        match self {
            ProviderKind::OpenAi => "Cloud API",
            ProviderKind::Local => "Local runtime",
            ProviderKind::Builtin => "Built-in",
        }
    }
    pub fn can_image(&self) -> bool { !matches!(self, ProviderKind::Builtin) }
}

/// A capability provider. api_key is written to disk only; any response returned
/// to the UI is masked.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub kind: ProviderKind,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    /// Image model name (cloud) or local model id (empty = auto)
    #[serde(default)]
    pub image_model: String,
    /// Text model name (cloud) or local model id (empty = auto)
    #[serde(default)]
    pub chat_model: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub note: String,
}

fn default_true() -> bool { true }

impl Provider {
    pub fn has_image(&self) -> bool {
        match self.kind {
            ProviderKind::OpenAi => !self.base_url.trim().is_empty() && !self.image_model.trim().is_empty(),
            ProviderKind::Local => true,
            ProviderKind::Builtin => true,
        }
    }
    pub fn has_chat(&self) -> bool {
        match self.kind {
            ProviderKind::OpenAi => !self.base_url.trim().is_empty() && !self.chat_model.trim().is_empty(),
            ProviderKind::Local => true,
            ProviderKind::Builtin => false,
        }
    }
    pub fn masked(&self) -> Provider {
        let mut copy = self.clone();
        copy.api_key = mask_key(&self.api_key);
        copy
    }
}

pub fn mask_key(key: &str) -> String {
    let key = key.trim();
    if key.is_empty() {
        String::new()
    } else if key.chars().count() <= 8 {
        "••••".to_string()
    } else {
        let tail: String = key.chars().rev().take(4).collect::<Vec<_>>().into_iter().rev().collect();
        format!("••••{tail}")
    }
}

/// Image request. The prompt is assembled by a harness; providers never rewrite it.
#[derive(Debug, Clone, Default)]
pub struct ImageRequest {
    pub task_id: Option<String>,
    pub prompt: String,
    pub negative: String,
    pub source_image: Option<PathBuf>,
    pub strength: f32,
    pub width: u32,
    pub height: u32,
    pub seed: i64,
    pub steps: u32,
    pub cfg_scale: f32,
    pub model: Option<String>,
    /// Output file. None lets the provider pick a temp path.
    pub out_path: Option<PathBuf>,
    /// Target palette size for the built-in algorithm.
    pub palette_size: usize,
}

#[derive(Debug, Clone)]
pub struct ImageOutput {
    pub path: PathBuf,
    pub provider: String,
    pub model: String,
    pub prompt: String,
}

#[derive(Debug, Clone, Default)]
pub struct ChatRequest {
    pub provider_id: Option<String>,
    pub system: String,
    pub prompt: String,
    pub max_tokens: u32,
    pub json: bool,
    pub model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ChatOutput {
    pub text: String,
    pub provider: String,
    pub model: String,
}

pub fn provider_store_path(data_root: &Path) -> PathBuf {
    data_root.join("engine").join("ai").join("providers.json")
}

/// Load providers. A missing file is seeded with built-in + local + a disabled
/// cloud template so the settings page is never empty.
pub fn load_providers(data_root: &Path) -> Vec<Provider> {
    let path = provider_store_path(data_root);
    if let Ok(bytes) = std::fs::read(&path) {
        if let Ok(list) = serde_json::from_slice::<Vec<Provider>>(&bytes) {
            return list;
        }
    }
    let seeded = seed_providers();
    let _ = save_providers(data_root, &seeded);
    seeded
}

pub fn save_providers(data_root: &Path, providers: &[Provider]) -> anyhow::Result<()> {
    let path = provider_store_path(data_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, serde_json::to_vec_pretty(providers)?)?;
    Ok(())
}

fn seed_providers() -> Vec<Provider> {
    vec![
        Provider {
            id: "builtin".into(),
            name: "Built-in digitizing".into(),
            kind: ProviderKind::Builtin,
            base_url: String::new(),
            api_key: String::new(),
            image_model: String::new(),
            chat_model: String::new(),
            enabled: true,
            note: "Lab k-means quantization; offline, no model required. Used as the fallback.".into(),
        },
        Provider {
            id: "local".into(),
            name: "Local runtime".into(),
            kind: ProviderKind::Local,
            base_url: String::new(),
            api_key: String::new(),
            image_model: String::new(),
            chat_model: String::new(),
            enabled: true,
            note: "stable-diffusion.cpp / llama.cpp. Install models on the Models tab.".into(),
        },
        Provider {
            id: "openai".into(),
            name: "Cloud · OpenAI-compatible".into(),
            kind: ProviderKind::OpenAi,
            base_url: "https://api.openai.com/v1".into(),
            api_key: String::new(),
            image_model: "gpt-image-1".into(),
            chat_model: "gpt-4o-mini".into(),
            enabled: false,
            note: "Fill in Base URL and API key, then enable. Supports /images/generations and /chat/completions.".into(),
        },
    ]
}

pub fn upsert_provider(data_root: &Path, incoming: Provider) -> anyhow::Result<Vec<Provider>> {
    let mut list = load_providers(data_root);
    let mut next = incoming;
    if let Some(existing) = list.iter().find(|p| p.id == next.id) {
        // The UI sends the masked key back; keep the stored secret in that case.
        if next.api_key.trim().is_empty() || next.api_key.contains('•') {
            next.api_key = existing.api_key.clone();
        }
    }
    match list.iter_mut().find(|p| p.id == next.id) {
        Some(slot) => *slot = next,
        None => list.push(next),
    }
    save_providers(data_root, &list)?;
    Ok(list)
}

pub fn remove_provider(data_root: &Path, id: &str) -> anyhow::Result<Vec<Provider>> {
    let mut list = load_providers(data_root);
    list.retain(|p| p.id != id);
    save_providers(data_root, &list)?;
    Ok(list)
}

/// Execute a request using an already bound provider/model snapshot.
pub async fn generate_image_with_route(app: &AppState, route: &routing::PreparedRoute, mut req: ImageRequest) -> anyhow::Result<ImageOutput> {
    req.model = Some(route.metadata.model_id.clone());
    let provider = &route.provider;
    match provider.kind {
        ProviderKind::OpenAi => openai::image(provider, &req).await,
        ProviderKind::Local => local::image(app, provider, &req).await,
        ProviderKind::Builtin => builtin::image(app, &req),
    }
}

pub async fn generate_text(app: &AppState, mut req: ChatRequest) -> anyhow::Result<ChatOutput> {
    let route = routing::prepare(app, routing::Capability::Chat, req.provider_id.as_deref(), req.model.as_deref())?;
    req.model = Some(route.metadata.model_id.clone());
    let provider = &route.provider;
    match provider.kind {
        ProviderKind::OpenAi => openai::chat(provider, &req).await,
        ProviderKind::Local => local::chat(app, provider, &req).await,
        ProviderKind::Builtin => anyhow::bail!("the built-in provider has no text model"),
    }
}
