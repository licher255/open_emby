//! Emby 原生生成节点（制版领域专用）。
//! EmbyColorBlockStylize：Lab KMeans 平涂色块化，刺绣制版第一步的纯 Rust 实现，
//! 替代原先走 ComfyUI img2img 的扩散工作流（毫秒级、可复现、限色精确）。

use crate::kmeans;
use crate::node::{InputKind, InputSpec, NodeCtx, NodeDef, NodeRun};
use crate::value::Value;
use image::{DynamicImage, RgbImage};
use serde_json::json;
use std::sync::Arc;

/// 聚类工作分辨率上限；输出上限（长边）
const WORK: u32 = 512;
const OUT_MAX: u32 = 2048;

fn color_block_stylize(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let max_colors = args[1].as_int()?.clamp(2, 24) as usize;
    let smooth = args[2].as_int()?.clamp(0, 4) as u32;

    // 1) 降采样聚类
    let dyn_img = DynamicImage::ImageRgb8((*img).clone());
    let work = dyn_img.thumbnail(WORK, WORK).to_rgb8();
    let points: Vec<kmeans::Lab> = work
        .as_raw()
        .chunks_exact(3)
        .map(|px| kmeans::rgb_to_lab(px[0], px[1], px[2]))
        .collect();

    // 2) KMeans（带 WS 进度 + 中断检查）
    let iters = 18usize;
    let interrupted = || ctx.interrupted();
    let (_labels, centers) = kmeans::kmeans(
        &points,
        max_colors,
        iters,
        |it| (ctx.progress)(it as u64, iters as u64 + 1),
        &interrupted,
    );
    if ctx.interrupted() {
        anyhow::bail!("已中断");
    }

    // 3) 全分辨率重打标（长边超限时先等比缩到 OUT_MAX）
    let src = if img.width().max(img.height()) > OUT_MAX {
        DynamicImage::ImageRgb8((*img).clone())
            .thumbnail(OUT_MAX, OUT_MAX)
            .to_rgb8()
    } else {
        (*img).clone()
    };
    let (w, h) = (src.width() as usize, src.height() as usize);
    let raw = src.as_raw();
    let mut label_map = vec![0u32; w * h];
    for (i, px) in raw.chunks_exact(3).enumerate() {
        label_map[i] = kmeans::nearest_center(kmeans::rgb_to_lab(px[0], px[1], px[2]), &centers) as u32;
    }

    // 4) 去碎点：标签图多数滤波（色块边缘干净，适合针迹转换）
    for _ in 0..smooth {
        if ctx.interrupted() {
            anyhow::bail!("已中断");
        }
        label_map = majority_filter(&label_map, w, h, max_colors);
    }

    // 5) 用聚类中心颜色重建图像
    let center_rgb: Vec<(u8, u8, u8)> = centers.iter().map(|c| kmeans::lab_to_rgb(*c)).collect();
    let mut out = RgbImage::new(w as u32, h as u32);
    for (i, &lb) in label_map.iter().enumerate() {
        let (r, g, b) = center_rgb[lb as usize];
        out.put_pixel((i % w) as u32, (i / w) as u32, image::Rgb([r, g, b]));
    }
    (ctx.progress)(iters as u64 + 1, iters as u64 + 1);

    // 调色板按簇像素占比排序（主色在前）
    let mut counts = vec![0usize; max_colors];
    for &lb in &label_map {
        counts[lb as usize] += 1;
    }
    let mut order: Vec<usize> = (0..max_colors).collect();
    order.sort_by_key(|&c| std::cmp::Reverse(counts[c]));
    let palette: Vec<String> = order
        .iter()
        .filter(|&&c| counts[c] > 0)
        .map(|&c| kmeans::lab_to_hex(centers[c]))
        .collect();

    let palette_json = json!(palette).to_string();
    Ok(NodeRun::values(vec![
        Value::Image(Arc::new(out)),
        Value::Str(palette_json),
    ]))
}

/// 3x3 多数滤波：每个像素替换为邻域内出现次数最多的标签
fn majority_filter(labels: &[u32], w: usize, h: usize, k: usize) -> Vec<u32> {
    let mut out = labels.to_vec();
    let mut counts = vec![0u16; k];
    for y in 0..h {
        for x in 0..w {
            counts.iter_mut().for_each(|c| *c = 0);
            for dy in [-1isize, 0, 1] {
                for dx in [-1isize, 0, 1] {
                    let (nx, ny) = (x as isize + dx, y as isize + dy);
                    if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                        counts[labels[ny as usize * w + nx as usize] as usize] += 1;
                    }
                }
            }
            let mut best = labels[y * w + x];
            let mut bn = 0u16;
            for (c, &n) in counts.iter().enumerate() {
                if n > bn {
                    bn = n;
                    best = c as u32;
                }
            }
            out[y * w + x] = best;
        }
    }
    out
}

pub fn defs() -> Vec<NodeDef> {
    vec![
        NodeDef {
            class_type: "EmbyColorBlockStylize",
            display_name: "Emby 平涂色块化",
            category: "emby/stylize",
            description: "Lab KMeans 限色平涂：刺绣制版第一步，毫秒级、限色精确、可复现",
            inputs: vec![
                InputSpec::required("image", InputKind::Image),
                InputSpec::required("max_colors", InputKind::Int { min: 2, max: 24, default: 8 }),
                InputSpec::required("smooth", InputKind::Int { min: 0, max: 4, default: 1 }),
            ],
            outputs: vec!["IMAGE", "STRING"],
            output_names: vec!["IMAGE", "palette"],
            output_node: false,
            volatile: false,
            run: color_block_stylize,
        },
        NodeDef {
            class_type: "EmbyLineArtExtract",
            display_name: "Emby 线稿提取",
            category: "emby/stylize",
            description: "从色块图提取色域边界线稿：白底黑线，轮廓即缎面/轮廓针的骨架",
            inputs: vec![
                InputSpec::required("image", InputKind::Image),
                InputSpec::required("thickness", InputKind::Int { min: 1, max: 3, default: 1 }),
            ],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: false,
            volatile: false,
            run: line_art_extract,
        },
    ]
}

/// 线稿提取：输入平坦色块图，边界 = 4 邻域颜色不同的像素；按 thickness 膨胀加粗。
/// 不做聚类——色块图已经是精确限色的，边界直接由像素差得到，线稿与色块严格对齐。
fn line_art_extract(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let thickness = args[1].as_int()?.clamp(1, 3) as usize;
    let _ = ctx;

    let src = if img.width().max(img.height()) > OUT_MAX {
        DynamicImage::ImageRgb8((*img).clone())
            .thumbnail(OUT_MAX, OUT_MAX)
            .to_rgb8()
    } else {
        (*img).clone()
    };
    let (w, h) = (src.width() as usize, src.height() as usize);
    let raw = src.as_raw();
    let px = |x: usize, y: usize| -> (u8, u8, u8) {
        let i = (y * w + x) * 3;
        (raw[i], raw[i + 1], raw[i + 2])
    };

    // 边界：右/下邻域颜色不同即边界（每个边界只标一次）
    let mut boundary = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let c = px(x, y);
            let right = x + 1 < w && px(x + 1, y) != c;
            let down = y + 1 < h && px(x, y + 1) != c;
            if right || down {
                boundary[y * w + x] = true;
                if right { boundary[y * w + x + 1] = true; }
                if down { boundary[(y + 1) * w + x] = true; }
            }
        }
    }
    // 膨胀加粗
    for _ in 1..thickness {
        let prev = boundary.clone();
        for y in 0..h {
            for x in 0..w {
                if !prev[y * w + x] {
                    continue;
                }
                for dy in [-1isize, 0, 1] {
                    for dx in [-1isize, 0, 1] {
                        let (nx, ny) = (x as isize + dx, y as isize + dy);
                        if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                            boundary[ny as usize * w + nx as usize] = true;
                        }
                    }
                }
            }
        }
    }

    let mut out = RgbImage::new(w as u32, h as u32);
    for (i, &b) in boundary.iter().enumerate() {
        out.put_pixel(
            (i % w) as u32,
            (i / w) as u32,
            if b { image::Rgb([29, 29, 31]) } else { image::Rgb([255, 255, 255]) }
        );
    }
    Ok(NodeRun::values(vec![Value::Image(Arc::new(out))]))
}
