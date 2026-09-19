//! 图像 IO 与变换节点：LoadImage / ImageScale / SaveImage / PreviewImage。
//! 行为对齐 ComfyUI 同名节点（输入目录、输出命名、ui.images 返回结构）。

use crate::node::{InputKind, InputSpec, NodeCtx, NodeDef, NodeRun};
use crate::value::Value;
use anyhow::{bail, Context};
use image::{DynamicImage, RgbImage};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// 输入解析：绝对路径直接用；相对名在 input 目录下找（ComfyUI /upload/image 语义）
fn resolve_input_path(input_dir: &Path, name: &str) -> anyhow::Result<PathBuf> {
    let p = Path::new(name);
    let candidate = if p.is_absolute() { p.to_path_buf() } else { input_dir.join(name) };
    if candidate.exists() {
        Ok(candidate)
    } else {
        bail!("找不到图片: {name}（已尝试 {}）", candidate.display())
    }
}

fn load_image(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let name = args[0].as_str()?;
    let path = resolve_input_path(&ctx.input_dir, name)?;
    let img = image::open(&path)
        .with_context(|| format!("无法解码图片 {}", path.display()))?
        .to_rgb8();
    Ok(NodeRun::values(vec![Value::Image(Arc::new(img))]))
}

fn image_scale(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let _ = ctx;
    let img = args[0].as_image()?;
    let w = args[1].as_int()?.clamp(1, 16384) as u32;
    let h = args[2].as_int()?.clamp(1, 16384) as u32;
    let filter = match args[3].as_str().unwrap_or("lanczos") {
        "nearest" => image::imageops::FilterType::Nearest,
        "bilinear" => image::imageops::FilterType::Triangle,
        _ => image::imageops::FilterType::Lanczos3,
    };
    let dyn_img = DynamicImage::ImageRgb8((*img).clone());
    let out = dyn_img.resize_exact(w, h, filter).to_rgb8();
    Ok(NodeRun::values(vec![Value::Image(Arc::new(out))]))
}

/// 保存单张图并组装 ComfyUI 风格的 ui.images 条目
fn save_one(
    img: &RgbImage,
    dir: &Path,
    prefix: &str,
    n: u64,
    kind: &str,
) -> anyhow::Result<serde_json::Value> {
    let safe_prefix: String = prefix
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    let filename = format!("{safe_prefix}_{n:05}_.png");
    let path = dir.join(&filename);
    img.save(&path).with_context(|| format!("无法写入 {}", path.display()))?;
    Ok(json!({ "filename": filename, "subfolder": "", "type": kind }))
}

fn save_image(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let prefix = args[1].as_str().unwrap_or("open_emby");
    let n = ctx.save_counter.fetch_add(1, Ordering::Relaxed);
    let entry = save_one(&img, &ctx.output_dir, prefix, n, "output")?;
    Ok(NodeRun {
        outputs: vec![Value::Image(img)],
        ui: json!({ "images": [entry] }),
    })
}

fn preview_image(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let n = ctx.save_counter.fetch_add(1, Ordering::Relaxed);
    let entry = save_one(&img, &ctx.temp_dir, "emby_preview", n, "temp")?;
    Ok(NodeRun {
        outputs: vec![Value::Image(img)],
        ui: json!({ "images": [entry] }),
    })
}

/// 输出图像的尺寸信息（UI 技术读数用）
fn image_size(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let _ = ctx;
    let img = args[0].as_image()?;
    let (w, h) = img.dimensions();
    Ok(NodeRun::values(vec![Value::Int(w as i64), Value::Int(h as i64)]))
}

const SCALE_METHODS: &[&str] = &["lanczos", "bilinear", "nearest"];

pub fn defs() -> Vec<NodeDef> {
    vec![
        NodeDef {
            class_type: "LoadImage",
            display_name: "Load Image",
            category: "image",
            description: "从 input 目录或绝对路径加载图片",
            inputs: vec![InputSpec::required("image", InputKind::Text { multiline: false, default: "" })],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: false,
            volatile: true, // 磁盘文件可变，不进缓存
            run: load_image,
        },
        NodeDef {
            class_type: "ImageScale",
            display_name: "Upscale/Scale Image",
            category: "image/upscaling",
            description: "缩放到指定尺寸",
            inputs: vec![
                InputSpec::required("image", InputKind::Image),
                InputSpec::required("width", InputKind::Int { min: 1, max: 16384, default: 1024 }),
                InputSpec::required("height", InputKind::Int { min: 1, max: 16384, default: 1024 }),
                InputSpec::required("method", InputKind::Combo(SCALE_METHODS)),
            ],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: false,
            volatile: false,
            run: image_scale,
        },
        NodeDef {
            class_type: "ImageSize",
            display_name: "Image Size",
            category: "image",
            description: "输出图像宽高（INT）",
            inputs: vec![InputSpec::required("image", InputKind::Image)],
            outputs: vec!["INT", "INT"],
            output_names: vec!["width", "height"],
            output_node: false,
            volatile: false,
            run: image_size,
        },
        NodeDef {
            class_type: "SaveImage",
            display_name: "Save Image",
            category: "image",
            description: "保存到 output 目录并回传 ui.images",
            inputs: vec![
                InputSpec::required("images", InputKind::Image),
                InputSpec::required("filename_prefix", InputKind::Text { multiline: false, default: "open_emby" }),
            ],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: true,
            volatile: true,
            run: save_image,
        },
        NodeDef {
            class_type: "PreviewImage",
            display_name: "Preview Image",
            category: "image",
            description: "保存到 temp 目录用于前端预览",
            inputs: vec![InputSpec::required("images", InputKind::Image)],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: true,
            volatile: true,
            run: preview_image,
        },
    ]
}
