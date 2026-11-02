//! Built-in provider: no model needed. Uses Lab k-means to produce an
//! embroidery-ready colour-block image, which also serves as the final
//! quantization step for every cloud/local result.
use super::{ImageOutput, ImageRequest};
use crate::nodes::stylize_blocks;
use crate::state::AppState;
use std::path::PathBuf;

pub fn image(_app: &AppState, req: &ImageRequest) -> anyhow::Result<ImageOutput> {
    let source = req.source_image.as_ref()
        .filter(|p| p.exists())
        .ok_or_else(|| anyhow::anyhow!("the built-in provider needs a source image"))?;
    let img = image::open(source)?.to_rgb8();
    let max_colors = if req.palette_size > 0 { req.palette_size } else { 8 }.clamp(2, 24);
    let (out, palette) = stylize_blocks(&img, max_colors, 2)?;
    let path = req.out_path.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("emby-builtin-{}.png", uuid::Uuid::new_v4()))
    });
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    out.save(&path)?;
    Ok(ImageOutput {
        path: PathBuf::from(path),
        provider: "Built-in".into(),
        model: format!("LabKMeans · {} colours", palette.len()),
        prompt: req.prompt.clone(),
    })
}
