//! Resolve one capability before executing a harness. The bound provider is an
//! immutable snapshot, so edits to Settings cannot switch an in-flight request.
use super::{local, Provider, ProviderKind};
use crate::{models::{self, ModelRuntime}, state::AppState};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Capability { Image, Chat }

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteMetadata {
    pub capability: Capability,
    pub provider_id: String,
    pub provider_kind: ProviderKind,
    pub model_id: String,
    pub reason: String,
}

pub struct PreparedRoute {
    pub metadata: RouteMetadata,
    pub(super) provider: Provider,
}

pub fn prepare(app: &AppState, capability: Capability, provider_id: Option<&str>, model_id: Option<&str>) -> anyhow::Result<PreparedRoute> {
    let providers = app.providers.lock().unwrap().clone();
    select(&providers, capability, provider_id, model_id, |provider, requested| {
        let configured = match capability { Capability::Image => &provider.image_model, Capability::Chat => &provider.chat_model };
        let wanted = requested.filter(|id| !id.trim().is_empty())
            .or_else(|| (!configured.trim().is_empty()).then_some(configured.as_str()));
        match provider.kind {
            ProviderKind::Builtin => {
                if capability == Capability::Chat || wanted.is_some_and(|id| id != "lab-kmeans") {
                    anyhow::bail!("built-in provider cannot serve this capability/model");
                }
                Ok("lab-kmeans".into())
            }
            ProviderKind::OpenAi => {
                if provider.base_url.trim().is_empty() { anyhow::bail!("cloud Base URL is empty"); }
                Ok(wanted.ok_or_else(|| anyhow::anyhow!("no model configured"))?.to_string())
            }
            ProviderKind::Local => {
                if capability == Capability::Image {
                    return Ok(local::resolve_image(&app.data_root, wanted)?.manifest.id);
                }
                let (runtime, binary) = match capability {
                    Capability::Image => (ModelRuntime::SdCpp, local::sd_server_bin(&app.data_root).or_else(|| local::sd_bin(&app.data_root))),
                    Capability::Chat => (ModelRuntime::LlamaCpp, local::llama_bin(&app.data_root)),
                };
                if binary.is_none() { anyhow::bail!("local runtime binary is unavailable"); }
                let model = models::resolve_local(&app.data_root, wanted, runtime)
                    .ok_or_else(|| anyhow::anyhow!("no ready model matches the requested capability"))?;
                Ok(model.manifest.id)
            }
        }
    })
}

fn select(
    providers: &[Provider], capability: Capability, provider_id: Option<&str>, model_id: Option<&str>,
    resolve: impl Fn(&Provider, Option<&str>) -> anyhow::Result<String>,
) -> anyhow::Result<PreparedRoute> {
    let mut candidates: Vec<_> = providers.iter().filter(|p| p.enabled && provider_id.is_none_or(|id| p.id == id)).collect();
    candidates.sort_by_key(|p| match (capability, p.kind) {
        (Capability::Image, ProviderKind::Local) | (Capability::Chat, ProviderKind::OpenAi) => 0,
        (_, ProviderKind::Builtin) => 2,
        _ => 1,
    });
    let mut unavailable = Vec::new();
    for provider in candidates {
        match resolve(provider, model_id) {
            Ok(model) => return Ok(PreparedRoute {
                provider: provider.clone(),
                metadata: RouteMetadata {
                    capability, provider_id: provider.id.clone(), provider_kind: provider.kind, model_id: model,
                    reason: if provider_id.is_some() { "explicit provider".into() }
                        else if unavailable.is_empty() { "capability preference".into() }
                        else { format!("capability preference; skipped {}", unavailable.join(", ")) },
                },
            }),
            Err(error) if capability == Capability::Image && provider.kind == ProviderKind::Local && !provider.image_model.trim().is_empty() => {
                anyhow::bail!("Configured local image baseline {} is unavailable: {error}. Restore the model/runtime; automatic fallback is disabled.", provider.image_model);
            }
            Err(error) => unavailable.push(format!("{}: {error}", provider.id)),
        }
    }
    anyhow::bail!("no {:?} route available for provider {:?}, model {:?}: {}", capability, provider_id, model_id, unavailable.join("; "))
}
