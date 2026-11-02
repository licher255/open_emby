//! Harness: prompt + pipeline + validation, packaged as a reproducible step.
//!
//! - stylize: source image -> prompt -> any provider -> quantize to the target
//!   palette -> artifacts + recipe
//! - stitch: region plan -> routing expert (LLM) or deterministic nearest
//!   neighbour -> stitch order
//!
//! Harnesses depend only on ai::generate_image / ai::generate_text, so cloud and
//! local providers share one code path.
use crate::ai::{self, ImageRequest, routing::PreparedRoute};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub mod prompts;
pub mod stitch;
pub mod jobs;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StylizeInput {
    pub image_path: String,
    #[serde(default)]
    pub request_id: Option<String>,
    #[serde(default, skip_serializing)]
    pub retry: bool,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default = "default_colors")]
    pub max_colors: usize,
    #[serde(default)]
    pub style: String,
    #[serde(default)]
    pub intent: String,
    #[serde(default)]
    pub seed: i64,
    #[serde(default)]
    pub width_mm: Option<f32>,
}

fn default_colors() -> usize { 8 }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StylizeResult {
    pub path: String,
    pub raw_path: String,
    pub palette: Vec<String>,
    pub provider: String,
    pub model: String,
    pub prompt: String,
    pub seed: i64,
    pub recipe_path: String,
    pub backend: String,
}

pub async fn stylize(app: &AppState, input: StylizeInput, route: PreparedRoute, task_id: &str, attempt: u32) -> anyhow::Result<StylizeResult> {
    let source = PathBuf::from(&input.image_path);
    if !source.is_file() {
        anyhow::bail!("source image not found: {}", source.display());
    }
    let max_colors = input.max_colors.clamp(2, 16);
    let prompt = prompts::stylize_prompt(max_colors, input.style.as_str(), input.intent.as_str());
    let seed = if input.seed >= 0 { input.seed } else { chrono_seed() };

    // One directory per task: artifacts and recipe stay together for later review.
    let out_dir = app.data_root.join("engine").join("drafts").join(task_id).join(format!("attempt-{attempt}"));
    std::fs::create_dir_all(&out_dir)?;

    let source_bytes = std::fs::read(&source)?;
    let image = image::load_from_memory(&source_bytes)?;
    // The provider reads a private snapshot even if the original is edited during inference.
    let snapshot = out_dir.join("source.png");
    image.save(&snapshot)?;
    use sha2::{Digest, Sha256};
    let source_hash = hex::encode(Sha256::digest(&source_bytes));
    let (width, height) = generation_size(image.width(), image.height(), 768);

    let provider_is_builtin = route.metadata.provider_kind == ai::ProviderKind::Builtin;

    let raw_path = out_dir.join("raw.png");
    let recipe_path = out_dir.join("recipe.json");
    let mut recipe = serde_json::json!({
        "version": "harness-stylize-v2", "taskId": task_id, "attempt": attempt,
        "input": input.image_path, "sourceHash": source_hash, "sourceSnapshot": snapshot,
        "route": route.metadata, "seed": seed, "prompt": prompt,
        "style": input.style, "maxColors": max_colors, "widthMm": input.width_mm,
        "quantizer": "lab-kmeans++-seed42-v1",
        "generation": { "width": width, "height": height, "strength": 0.55, "steps": 24, "cfgScale": 7.0,
            "seedApplied": route.metadata.provider_kind == ai::ProviderKind::Local }
    });
    jobs::write_json(&recipe_path, &recipe)?;
    let generated = ai::generate_image_with_route(app, &route, ImageRequest {
        prompt: prompt.clone(),
        negative: String::new(),
        source_image: Some(snapshot),
        strength: 0.55,
        width,
        height,
        seed,
        steps: 24,
        cfg_scale: 7.0,
        model: input.model_id.clone(),
        out_path: Some(if provider_is_builtin { out_dir.join("stylize.png") } else { raw_path.clone() }),
        palette_size: max_colors,
    }).await?;

    // Whatever the model returns, run the digitizing quantization once: controlled
    // colour count and stitchable boundaries are prerequisites for later steps.
    let (final_path, palette) = if provider_is_builtin {
        (generated.path.clone(), dominant_palette(&generated.path, max_colors)?)
    } else {
        let raw = image::open(&generated.path)?.to_rgb8();
        let (blocks, palette) = crate::nodes::stylize_blocks(&raw, max_colors, 2)?;
        let path = out_dir.join("stylize.png");
        blocks.save(&path)?;
        (path, palette)
    };

    recipe["provider"] = serde_json::json!(generated.provider);
    recipe["prompt"] = serde_json::json!(generated.prompt);
    recipe["model"] = serde_json::json!(generated.model);
    recipe["palette"] = serde_json::json!(palette);
    recipe["outputs"] = serde_json::json!({ "raw": generated.path, "final": final_path });
    jobs::write_json(&recipe_path, &recipe)?;

    Ok(StylizeResult {
        path: final_path.to_string_lossy().to_string(),
        raw_path: generated.path.to_string_lossy().to_string(),
        palette,
        provider: generated.provider,
        model: generated.model,
        prompt,
        seed,
        recipe_path: recipe_path.to_string_lossy().to_string(),
        backend: if provider_is_builtin { "builtin".into() } else { "model".into() },
    })
}

fn chrono_seed() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    (SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0) % 4_294_967_295) as i64
}

/// Keep aspect ratio while scaling to the target long edge; oversized img2img
/// inputs make local inference unnecessarily slow.
fn generation_size(width: u32, height: u32, longest: u32) -> (u32, u32) {
    if width == 0 || height == 0 {
        return (longest, longest);
    }
    let scale = (longest as f32 / width.max(height) as f32).min(1.0);
    let w = ((width as f32 * scale) / 8.0).round().max(1.0) * 8.0;
    let h = ((height as f32 * scale) / 8.0).round().max(1.0) * 8.0;
    (w as u32, h as u32)
}

/// Recompute the palette from the final pixels so it always matches what will be
/// stitched, instead of trusting colours the model claims to have used.
fn dominant_palette(path: &std::path::Path, max_colors: usize) -> anyhow::Result<Vec<String>> {
    let img = image::open(path)?.to_rgb8();
    let (_, palette) = crate::nodes::stylize_blocks(&img, max_colors, 0)?;
    Ok(palette)
}
