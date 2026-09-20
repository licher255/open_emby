//! Emby 原生生成节点（制版领域专用）。
//! EmbyColorBlockStylize：Lab KMeans 平涂色块化，刺绣制版第一步的纯 Rust 实现，
//! 替代原先走 ComfyUI img2img 的扩散工作流（毫秒级、可复现、限色精确）。

use crate::kmeans;
use crate::node::{InputKind, InputSpec, NodeCtx, NodeDef, NodeRun};
use crate::value::Value;
use image::{DynamicImage, RgbImage};
use serde_json::json;
use std::collections::VecDeque;
use std::sync::Arc;

/// 聚类工作分辨率上限；输出上限（长边）
const WORK: u32 = 512;
const OUT_MAX: u32 = 2048;

/// 从画布四角开始做边缘感知泛洪，只移除与边缘连通的背景。
/// 这比按单一颜色抠图更适合摄影棚渐变背景，也不会误删主体内部的白色区域。
fn remove_background(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let tolerance = args[1].as_int()?.clamp(4, 64) as i32;
    let src = if img.width().max(img.height()) > OUT_MAX {
        DynamicImage::ImageRgb8((*img).clone()).thumbnail(OUT_MAX, OUT_MAX).to_rgb8()
    } else {
        (*img).clone()
    };
    let mask = corner_background_mask(&src, tolerance);
    let mut out = src;
    for (index, background) in mask.into_iter().enumerate() {
        if background {
            out.put_pixel(
                (index % out.width() as usize) as u32,
                (index / out.width() as usize) as u32,
                image::Rgb([255, 255, 255]),
            );
        }
    }
    (ctx.progress)(1, 1);
    Ok(NodeRun::values(vec![Value::Image(Arc::new(out))]))
}

fn rgb_dist2(a: &[u8], b: &[u8]) -> i32 {
    (a[0] as i32 - b[0] as i32).pow(2)
        + (a[1] as i32 - b[1] as i32).pow(2)
        + (a[2] as i32 - b[2] as i32).pow(2)
}

fn background_color_compatible(pixel: &[u8], references: &[[u8; 3]], tolerance: i32) -> bool {
    let mean = (pixel[0] as i32 + pixel[1] as i32 + pixel[2] as i32) / 3;
    let chroma_tolerance = (tolerance / 3).max(3);
    references.iter().any(|reference| {
        let reference_mean = (reference[0] as i32 + reference[1] as i32 + reference[2] as i32) / 3;
        (mean - reference_mean).abs() <= tolerance * 4
            && (0..3).all(|channel| {
                ((pixel[channel] as i32 - mean) - (reference[channel] as i32 - reference_mean)).abs()
                    <= chroma_tolerance
            })
    })
}

fn corner_background_mask(img: &RgbImage, tolerance: i32) -> Vec<bool> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let raw = img.as_raw();
    if w == 0 || h == 0 { return vec![]; }
    let corners = [0, w - 1, (h - 1) * w, h * w - 1];
    let refs: Vec<[u8; 3]> = corners.iter().map(|&i| [raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]]).collect();
    let local_tolerance = (tolerance / 3).max(4);
    let local_limit = local_tolerance * local_tolerance * 3;
    let mut mask = vec![false; w * h];
    let mut queue = VecDeque::new();
    for &index in &corners {
        if !mask[index] { mask[index] = true; queue.push_back(index); }
    }

    while let Some(index) = queue.pop_front() {
        let x = index % w;
        let y = index / w;
        for next in [
            (x > 0).then(|| index - 1),
            (x + 1 < w).then(|| index + 1),
            (y > 0).then(|| index - w),
            (y + 1 < h).then(|| index + w),
        ].into_iter().flatten() {
            if mask[next] { continue; }
            let pixel = &raw[next * 3..next * 3 + 3];
            let previous = &raw[index * 3..index * 3 + 3];
            if background_color_compatible(pixel, &refs, tolerance)
                && rgb_dist2(pixel, previous) <= local_limit
            {
                mask[next] = true;
                queue.push_back(next);
            }
        }
    }
    mask
}

/// 识别前处理节点生成的纯白、且与画布边缘连通的背景。
fn white_background_mask(img: &RgbImage) -> Vec<bool> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let raw = img.as_raw();
    let mut mask = vec![false; w * h];
    let mut queue = VecDeque::new();
    let white = |index: usize| raw[index * 3..index * 3 + 3].iter().all(|&channel| channel >= 250);
    for x in 0..w {
        for index in [x, (h - 1) * w + x] {
            if white(index) && !mask[index] { mask[index] = true; queue.push_back(index); }
        }
    }
    for y in 0..h {
        for index in [y * w, y * w + w - 1] {
            if white(index) && !mask[index] { mask[index] = true; queue.push_back(index); }
        }
    }
    while let Some(index) = queue.pop_front() {
        let x = index % w;
        let y = index / w;
        for next in [
            (x > 0).then(|| index - 1),
            (x + 1 < w).then(|| index + 1),
            (y > 0).then(|| index - w),
            (y + 1 < h).then(|| index + w),
        ].into_iter().flatten() {
            if !mask[next] && white(next) { mask[next] = true; queue.push_back(next); }
        }
    }
    mask
}

fn color_block_stylize(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    color_block_stylize_impl(ctx, args, None)
}

fn color_block_stylize_guided(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let guide = args[1].as_image()?;
    color_block_stylize_impl(ctx, vec![args[0].clone(), args[2].clone(), args[3].clone()], Some(guide))
}

fn color_block_stylize_impl(ctx: &NodeCtx, args: Vec<Value>, line_guide: Option<Arc<RgbImage>>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let max_colors = args[1].as_int()?.clamp(2, 24) as usize;
    let smooth = args[2].as_int()?.clamp(0, 4) as u32;

    // 1) 先轻度模糊纹理，再降采样聚类；背景不参与配色，避免浪费线色。
    let src = if img.width().max(img.height()) > OUT_MAX {
        DynamicImage::ImageRgb8((*img).clone()).thumbnail(OUT_MAX, OUT_MAX).to_rgb8()
    } else {
        (*img).clone()
    };
    let background = white_background_mask(&src);
    let softened = image::imageops::blur(&src, 2.2);
    let work = DynamicImage::ImageRgb8(softened.clone()).thumbnail(WORK, WORK).to_rgb8();
    let (sw, sh) = (src.width() as usize, src.height() as usize);
    let (ww, wh) = (work.width() as usize, work.height() as usize);
    let mut points = Vec::with_capacity(ww * wh);
    for (index, px) in work.as_raw().chunks_exact(3).enumerate() {
        let x = index % ww;
        let y = index / ww;
        let source_index = (y * sh / wh).min(sh - 1) * sw + (x * sw / ww).min(sw - 1);
        if !background[source_index] {
            points.push(kmeans::rgb_to_lab(px[0], px[1], px[2]));
        }
    }
    if points.is_empty() {
        points.push(kmeans::rgb_to_lab(255, 255, 255));
    }

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

    // 3) 全分辨率重打标，背景保留为独立标签。
    let (w, h) = (src.width() as usize, src.height() as usize);
    let raw = softened.as_raw();
    let background_label = max_colors as u32;
    let mut label_map = vec![0u32; w * h];
    for (i, px) in raw.chunks_exact(3).enumerate() {
        label_map[i] = if background[i] {
            background_label
        } else {
            kmeans::nearest_center(kmeans::rgb_to_lab(px[0], px[1], px[2]), &centers) as u32
        };
    }

    // 4) 去碎点 + 小连通域并入邻区，得到更适合轮廓针的连续边界。
    for _ in 0..smooth {
        if ctx.interrupted() {
            anyhow::bail!("已中断");
        }
        label_map = majority_filter(&label_map, w, h, max_colors + 1);
    }
    let min_region_area = (w * h / 6_000).clamp(20, 500);
    label_map = merge_small_regions(&label_map, w, h, max_colors + 1, background_label, min_region_area);
    if let Some(guide) = line_guide {
        // 用户调整后的线稿是最终几何约束；之后不能再平滑，否则填色会偏离闭合线。
        label_map = apply_line_guide(&label_map, &guide, w, h, max_colors + 1);
    } else {
        // 初次生成时在标签层本身圆顺边界，色块与随后提取的线稿共用同一套几何。
        // 半径 3 消除短促凹凸，不像轮廓抽稀那样把曲线拉成少数长直线。
        label_map = majority_filter_radius(&label_map, w, h, max_colors + 1, 3);
        label_map = merge_small_regions(&label_map, w, h, max_colors + 1, background_label, min_region_area);
    }

    // 5) 用聚类中心颜色重建图像
    let center_rgb: Vec<(u8, u8, u8)> = centers.iter().map(|c| kmeans::lab_to_rgb(*c)).collect();
    let mut out = RgbImage::new(w as u32, h as u32);
    for (i, &lb) in label_map.iter().enumerate() {
        let (r, g, b) = if lb == background_label { (255, 255, 255) } else { center_rgb[lb as usize] };
        out.put_pixel((i % w) as u32, (i / w) as u32, image::Rgb([r, g, b]));
    }
    (ctx.progress)(iters as u64 + 1, iters as u64 + 1);

    // 调色板按簇像素占比排序（主色在前）
    let mut counts = vec![0usize; max_colors];
    for &lb in &label_map {
        if lb != background_label { counts[lb as usize] += 1; }
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

/// 线稿黑线作为不可跨越的区域边界；每个闭合区域统一成其原图占比最高的颜色簇。
fn apply_line_guide(labels: &[u32], guide: &RgbImage, w: usize, h: usize, k: usize) -> Vec<u32> {
    let guide = image::imageops::resize(guide, w as u32, h as u32, image::imageops::FilterType::Nearest);
    let barrier: Vec<bool> = guide
        .as_raw()
        .chunks_exact(3)
        .map(|pixel| (pixel[0] as u16 + pixel[1] as u16 + pixel[2] as u16) / 3 < 128)
        .collect();
    let mut out = labels.to_vec();
    let mut seen = vec![false; w * h];
    let mut queue = VecDeque::new();
    let mut region = Vec::new();
    let mut counts = vec![0usize; k];

    for start in 0..w * h {
        if barrier[start] || seen[start] {
            continue;
        }
        queue.push_back(start);
        seen[start] = true;
        region.clear();
        counts.fill(0);
        while let Some(index) = queue.pop_front() {
            region.push(index);
            counts[labels[index] as usize] += 1;
            let x = index % w;
            let y = index / w;
            if x > 0 { push_region_neighbor(index - 1, &barrier, &mut seen, &mut queue); }
            if x + 1 < w { push_region_neighbor(index + 1, &barrier, &mut seen, &mut queue); }
            if y > 0 { push_region_neighbor(index - w, &barrier, &mut seen, &mut queue); }
            if y + 1 < h { push_region_neighbor(index + w, &barrier, &mut seen, &mut queue); }
        }
        let dominant = counts.iter().enumerate().max_by_key(|(_, count)| **count).map(|(label, _)| label as u32).unwrap_or(0);
        for &index in &region {
            out[index] = dominant;
        }
    }

    // 色块层不保留黑线：边界像素继承相邻区域颜色。
    for index in 0..w * h {
        if !barrier[index] { continue; }
        let x = index % w;
        let y = index / w;
        let neighbor = [
            (x > 0).then(|| index - 1),
            (x + 1 < w).then(|| index + 1),
            (y > 0).then(|| index - w),
            (y + 1 < h).then(|| index + w),
        ].into_iter().flatten().find(|&next| !barrier[next]);
        if let Some(next) = neighbor { out[index] = out[next]; }
    }
    out
}

fn push_region_neighbor(index: usize, barrier: &[bool], seen: &mut [bool], queue: &mut VecDeque<usize>) {
    if !barrier[index] && !seen[index] {
        seen[index] = true;
        queue.push_back(index);
    }
}

/// 3x3 多数滤波：每个像素替换为邻域内出现次数最多的标签
fn majority_filter(labels: &[u32], w: usize, h: usize, k: usize) -> Vec<u32> {
    majority_filter_radius(labels, w, h, k, 1)
}

fn majority_filter_radius(labels: &[u32], w: usize, h: usize, k: usize, radius: isize) -> Vec<u32> {
    let mut out = labels.to_vec();
    let mut counts = vec![0u16; k];
    for y in 0..h {
        for x in 0..w {
            counts.iter_mut().for_each(|c| *c = 0);
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let (nx, ny) = (x as isize + dx, y as isize + dy);
                    if nx >= 0 && ny >= 0 && (nx as usize) < w && (ny as usize) < h {
                        counts[labels[ny as usize * w + nx as usize] as usize] += 1;
                    }
                }
            }
            let mut best = labels[y * w + x];
            let mut bn = counts[best as usize];
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

/// 将小碎片并入其最长接壤色域；背景本身不参与合并，避免主体轮廓被吃掉。
fn merge_small_regions(
    labels: &[u32],
    w: usize,
    h: usize,
    k: usize,
    background: u32,
    min_area: usize,
) -> Vec<u32> {
    let mut out = labels.to_vec();
    let mut seen = vec![false; labels.len()];
    let mut queue = VecDeque::new();
    let mut region = Vec::new();
    let mut neighbors = vec![0usize; k];
    for start in 0..labels.len() {
        let label = labels[start];
        if seen[start] || label == background { continue; }
        seen[start] = true;
        queue.push_back(start);
        region.clear();
        neighbors.fill(0);
        while let Some(index) = queue.pop_front() {
            region.push(index);
            let x = index % w;
            let y = index / w;
            for next in [
                (x > 0).then(|| index - 1),
                (x + 1 < w).then(|| index + 1),
                (y > 0).then(|| index - w),
                (y + 1 < h).then(|| index + w),
            ].into_iter().flatten() {
                if labels[next] == label {
                    if !seen[next] { seen[next] = true; queue.push_back(next); }
                } else {
                    neighbors[labels[next] as usize] += 1;
                }
            }
        }
        if region.len() >= min_area { continue; }
        let replacement = neighbors.iter().enumerate()
            .filter(|(candidate, count)| **count > 0 && *candidate as u32 != background)
            .max_by_key(|(_, count)| **count)
            .or_else(|| neighbors.iter().enumerate().max_by_key(|(_, count)| **count))
            .map(|(candidate, _)| candidate as u32)
            .unwrap_or(label);
        for &index in &region { out[index] = replacement; }
    }
    out
}

pub fn defs() -> Vec<NodeDef> {
    vec![
        NodeDef {
            class_type: "EmbyBackgroundRemove",
            display_name: "Emby 背景去除",
            category: "emby/preprocess",
            description: "从画布边缘识别并去除连通背景，保留主体内部同色细节",
            inputs: vec![
                InputSpec::required("image", InputKind::Image),
                InputSpec::required("tolerance", InputKind::Int { min: 4, max: 64, default: 24 }),
            ],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: false,
            volatile: false,
            run: remove_background,
        },
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
            class_type: "EmbyColorBlockFromLineArt",
            display_name: "Emby 线稿引导色块",
            category: "emby/stylize",
            description: "按调整后的线稿闭合区域重新生成平涂色块",
            inputs: vec![
                InputSpec::required("image", InputKind::Image),
                InputSpec::required("line_art", InputKind::Image),
                InputSpec::required("max_colors", InputKind::Int { min: 2, max: 24, default: 8 }),
                InputSpec::required("smooth", InputKind::Int { min: 0, max: 4, default: 1 }),
            ],
            outputs: vec!["IMAGE", "STRING"],
            output_names: vec!["IMAGE", "palette"],
            output_node: false,
            volatile: false,
            run: color_block_stylize_guided,
        },
        NodeDef {
            class_type: "EmbyLineArtExtract",
            display_name: "Emby 线稿提取",
            category: "emby/stylize",
            description: "从色块图提取色域边界线稿：白底黑线，轮廓即缎面/轮廓针的骨架",
            inputs: vec![
                InputSpec::required("image", InputKind::Image),
                InputSpec::required("thickness", InputKind::Int { min: 1, max: 3, default: 1 }),
                InputSpec::required("contrast", InputKind::Int { min: 1, max: 40, default: 1 }),
            ],
            outputs: vec!["IMAGE"],
            output_names: vec!["IMAGE"],
            output_node: false,
            volatile: false,
            run: line_art_extract,
        },
    ]
}

/// 从最终色块交界直接生成单线轮廓；不再单独移动线稿几何。
fn line_art_extract(ctx: &NodeCtx, args: Vec<Value>) -> anyhow::Result<NodeRun> {
    let img = args[0].as_image()?;
    let thickness = args[1].as_int()?.clamp(1, 3) as usize;
    let contrast2 = (args[2].as_int()?.clamp(1, 40) as f64).powi(2);
    let _ = ctx;

    let src = if img.width().max(img.height()) > OUT_MAX {
        DynamicImage::ImageRgb8((*img).clone())
            .thumbnail(OUT_MAX, OUT_MAX)
            .to_rgb8()
    } else {
        (*img).clone()
    };
    let (w, h) = (src.width() as usize, src.height() as usize);
    let colors: Vec<kmeans::Lab> = src.as_raw().chunks_exact(3)
        .map(|pixel| kmeans::rgb_to_lab(pixel[0], pixel[1], pixel[2]))
        .collect();
    let different = |a: usize, b: usize| {
        let (a, b) = (colors[a], colors[b]);
        (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2) + (a.2 - b.2).powi(2) >= contrast2
    };

    // 仅在交界的一侧落一个像素，避免旧实现的双线，同时严格贴合色块边缘。
    let mut boundary = vec![false; w * h];
    for y in 0..h {
        for x in 0..w {
            let index = y * w + x;
            let right = x + 1 < w && different(index, index + 1);
            let down = y + 1 < h && different(index, index + w);
            if right || down {
                boundary[index] = true;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_flood_follows_gradient_but_stops_at_subject_edge() {
        let mut image = RgbImage::new(7, 5);
        for y in 0..5 {
            for x in 0..7 {
                let shade = 20 + x * 3;
                image.put_pixel(x, y, image::Rgb([shade as u8; 3]));
            }
        }
        for y in 1..4 {
            for x in 2..5 { image.put_pixel(x, y, image::Rgb([220, 90, 30])); }
        }
        let mask = corner_background_mask(&image, 12);
        assert!(mask[0]);
        assert!(mask[3]);
        assert!(!mask[2 * 7 + 3]);
    }

    #[test]
    fn small_color_island_merges_into_neighbor() {
        let labels = vec![0, 0, 0, 0, 1, 0, 0, 0, 0];
        let output = merge_small_regions(&labels, 3, 3, 3, 2, 2);
        assert!(output.iter().all(|&label| label == 0));
    }

    #[test]
    fn label_smoothing_removes_short_boundary_spur() {
        let labels = vec![
            0, 0, 0, 0, 0,
            0, 0, 1, 0, 0,
            0, 0, 1, 0, 0,
            0, 0, 0, 0, 0,
            0, 0, 0, 0, 0,
        ];
        let output = majority_filter_radius(&labels, 5, 5, 2, 2);
        assert!(output.iter().all(|&label| label == 0));
    }

    #[test]
    fn line_guide_keeps_closed_regions_separate() {
        let labels = vec![0, 0, 0, 1, 1, 1];
        let mut guide = RgbImage::from_pixel(6, 1, image::Rgb([255, 255, 255]));
        guide.put_pixel(2, 0, image::Rgb([0, 0, 0]));
        let output = apply_line_guide(&labels, &guide, 6, 1, 2);
        assert_eq!(&output[..2], &[0, 0]);
        assert_eq!(&output[3..], &[1, 1, 1]);
    }
}
