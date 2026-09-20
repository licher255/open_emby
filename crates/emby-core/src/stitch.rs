//! 针迹路径生成 —— 制版的核心：色块图 → 真实针迹序列。
//! 输出 mm 绝对坐标（y 向下，DST 编码器负责翻转为机器坐标）。
//! MVP 针法：扫描线填针（tatami 蛇形往返）+ 换色编排 + 背景识别跳针；
//! 缎面针/轮廓针与底针在后续迭代中按区域几何细分。

use crate::dst::{FLAG_COLOR, FLAG_JUMP, FLAG_STITCH};
use crate::img::{kmeans, lab_to_hex, rgb_to_lab};
use image::imageops::FilterType;
use napi_derive::napi;

#[napi(object)]
#[derive(Clone, Copy, Debug)]
pub struct StitchPoint {
    /// mm，向右为正
    pub x: f64,
    /// mm，向下为正
    pub y: f64,
    /// 0=stitch 1=jump 2=color_change
    pub flag: u32,
    /// palette 索引
    pub color: u32,
}

#[napi(object)]
pub struct StitchResult {
    pub points: Vec<StitchPoint>,
    pub palette: Vec<String>,
    pub width_mm: f64,
    pub height_mm: f64,
    pub stitch_count: u32,
    pub color_changes: u32,
    /// 被识别为底布背景（跳过不绣）的 palette 索引，-1 表示无
    pub background_index: i32,
}

const PX_PER_MM: f64 = 4.0; // 工作分辨率 0.25mm/px
const ROW_SPACING_MM: f64 = 0.45; // 填针行距
const STITCH_LEN_MM: f64 = 1.2; // 针步间隔
const MIN_RUN_MM: f64 = 0.8; // 忽略短于此的碎段

#[napi]
pub fn generate_stitches(
    image_path: String,
    max_colors: u32,
    width_mm: f64,
    min_stitch_mm: f64,
    max_stitch_mm: f64,
    curve_tolerance_mm: f64,
) -> napi::Result<StitchResult> {
    let img = image::open(&image_path)
        .map_err(|e| napi::Error::from_reason(format!("无法读取图片 {image_path}: {e}")))?;
    let (ow, oh) = (img.width(), img.height());
    if ow == 0 || oh == 0 {
        return Err(napi::Error::from_reason("图片尺寸非法"));
    }
    let height_mm = width_mm * oh as f64 / ow as f64;
    let ww = (width_mm * PX_PER_MM).round().clamp(8.0, 1600.0) as u32;
    let wh = (height_mm * PX_PER_MM).round().clamp(8.0, 1600.0) as u32;
    let work = image::imageops::resize(&img.to_rgb8(), ww, wh, FilterType::Lanczos3);
    let (w, h) = (work.width() as usize, work.height() as usize);

    // 1) Lab KMeans 量化 + 一次多数滤波去碎点
    let lab: Vec<_> = work
        .as_raw()
        .chunks_exact(3)
        .map(|p| rgb_to_lab(p[0], p[1], p[2]))
        .collect();
    let k = (max_colors as usize).clamp(2, 12);
    let (labels0, centers) = kmeans(&lab, k, 20);
    let labels = majority_filter(&labels0, w, h, k);
    let palette: Vec<String> = centers.iter().map(|c| lab_to_hex(*c)).collect();

    // 2) 面积统计 + 背景识别：占据图像边缘像素最多的簇视为底布（默认不绣）
    let mut area = vec![0usize; k];
    for &l in &labels {
        area[l as usize] += 1;
    }
    let mut border = vec![0usize; k];
    for x in 0..w {
        border[labels[x] as usize] += 1;
        border[labels[(h - 1) * w + x] as usize] += 1;
    }
    for y in 0..h {
        border[labels[y * w] as usize] += 1;
        border[labels[y * w + w - 1] as usize] += 1;
    }
    let perimeter = (2 * w + 2 * h).max(1);
    let background_index = (0..k)
        .max_by_key(|&c| border[c])
        .filter(|&c| border[c] * 4 >= perimeter)
        .map(|c| c as i32)
        .unwrap_or(-1);

    // 3) 绣花顺序：非背景色按面积从大到小
    let mut order: Vec<usize> = (0..k).filter(|&c| c as i32 != background_index).collect();
    order.sort_by_key(|&c| std::cmp::Reverse(area[c]));

    let spacing_px = (ROW_SPACING_MM * PX_PER_MM).max(1.0) as usize;
    let min_run_px = (MIN_RUN_MM * PX_PER_MM).max(2.0) as usize;

    let mut points: Vec<StitchPoint> = Vec::new();
    let (mut cx, mut cy) = (0.0f64, 0.0f64); // 当前针位 mm
    let mut color_changes = 0u32;

    for (ci, &c) in order.iter().enumerate() {
        if ci > 0 {
            points.push(StitchPoint { x: cx, y: cy, flag: FLAG_COLOR, color: c as u32 });
            color_changes += 1;
        }

        let mut y = 0usize;
        let mut ltr = true; // 蛇形：偶数行左到右，奇数行右到左
        while y < h {
            // 本行内该色的连续段
            let mut intervals: Vec<(usize, usize)> = Vec::new();
            let mut x = 0usize;
            while x < w {
                if labels[y * w + x] as usize == c {
                    let s = x;
                    while x < w && labels[y * w + x] as usize == c {
                        x += 1;
                    }
                    if x - s >= min_run_px {
                        intervals.push((s, x - 1));
                    }
                } else {
                    x += 1;
                }
            }
            if !ltr {
                intervals.reverse();
            }

            for &(s, e) in &intervals {
                let (xs, xe) = if ltr { (s, e) } else { (e, s) };
                let sx = (xs as f64 + 0.5) / PX_PER_MM;
                let ex = (xe as f64 + 0.5) / PX_PER_MM;
                let ym = (y as f64 + 0.5) / PX_PER_MM;

                // 连接：距当前针位近（相邻行自然延续）则直针相连，否则跳针
                let dist = ((sx - cx).powi(2) + (ym - cy).powi(2)).sqrt();
                let flag = if dist <= ROW_SPACING_MM * 1.6 { FLAG_STITCH } else { FLAG_JUMP };
                points.push(StitchPoint { x: sx, y: ym, flag, color: c as u32 });

                // 行内按针步间隔补中间点
                let len = (ex - sx).abs();
                let n_mid = (len / STITCH_LEN_MM).floor() as usize;
                for i in 1..=n_mid {
                    let xm = sx + (ex - sx) * i as f64 / (n_mid as f64 + 1.0);
                    points.push(StitchPoint { x: xm, y: ym, flag: FLAG_STITCH, color: c as u32 });
                }
                points.push(StitchPoint { x: ex, y: ym, flag: FLAG_STITCH, color: c as u32 });
                cx = ex;
                cy = ym;
            }
            ltr = !ltr;
            y += spacing_px;
        }
    }

    // 4) 机器约束后处理：曲线折线化、去除过密针眼、限制单针最大跨度。
    let min_stitch_mm = min_stitch_mm.clamp(0.1, 5.0);
    let max_stitch_mm = max_stitch_mm.clamp(min_stitch_mm * 2.0, 12.0);
    let points = post_process_stitches(
        points,
        min_stitch_mm,
        max_stitch_mm,
        curve_tolerance_mm.clamp(0.01, 2.0),
    );
    let stitch_count = points.iter().filter(|p| p.flag == FLAG_STITCH).count() as u32;

    Ok(StitchResult {
        points,
        palette,
        width_mm: (width_mm * 10.0).round() / 10.0,
        height_mm: (height_mm * 10.0).round() / 10.0,
        stitch_count,
        color_changes,
        background_index,
    })
}

fn distance(a: StitchPoint, b: StitchPoint) -> f64 {
    ((a.x - b.x).powi(2) + (a.y - b.y).powi(2)).sqrt()
}

fn point_segment_distance(p: StitchPoint, a: StitchPoint, b: StitchPoint) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let len2 = dx * dx + dy * dy;
    if len2 <= f64::EPSILON {
        return distance(p, a);
    }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / len2).clamp(0.0, 1.0);
    ((p.x - (a.x + t * dx)).powi(2) + (p.y - (a.y + t * dy)).powi(2)).sqrt()
}

/// Ramer-Douglas-Peucker：把采样曲线变成误差受控的直线段。
fn simplify_polyline(points: &[StitchPoint], tolerance: f64) -> Vec<StitchPoint> {
    if points.len() <= 2 {
        return points.to_vec();
    }
    let mut keep = vec![false; points.len()];
    keep[0] = true;
    keep[points.len() - 1] = true;
    let mut stack = vec![(0usize, points.len() - 1)];
    while let Some((start, end)) = stack.pop() {
        let mut max_distance = 0.0;
        let mut split = start;
        for i in start + 1..end {
            let d = point_segment_distance(points[i], points[start], points[end]);
            if d > max_distance {
                max_distance = d;
                split = i;
            }
        }
        if max_distance > tolerance {
            keep[split] = true;
            stack.push((start, split));
            stack.push((split, end));
        }
    }
    points.iter().zip(keep).filter_map(|(&point, keep)| keep.then_some(point)).collect()
}

fn simplify_long_polyline(points: &[StitchPoint], tolerance: f64) -> Vec<StitchPoint> {
    const CHUNK_POINTS: usize = 512;
    if points.len() <= CHUNK_POINTS {
        return simplify_polyline(points, tolerance);
    }
    let mut out = vec![points[0]];
    let mut start = 0usize;
    while start < points.len() - 1 {
        let end = (start + CHUNK_POINTS - 1).min(points.len() - 1);
        out.extend(simplify_polyline(&points[start..=end], tolerance).into_iter().skip(1));
        start = end;
    }
    out
}

fn enforce_min_spacing(points: Vec<StitchPoint>, min_stitch_mm: f64) -> Vec<StitchPoint> {
    if points.len() <= 1 {
        return points;
    }
    let end = *points.last().unwrap();
    let mut kept = vec![points[0]];
    for &point in &points[1..points.len() - 1] {
        if distance(*kept.last().unwrap(), point) >= min_stitch_mm {
            kept.push(point);
        }
    }
    if distance(*kept.last().unwrap(), end) >= min_stitch_mm {
        kept.push(end);
    } else if kept.len() > 1 && distance(kept[kept.len() - 2], end) >= min_stitch_mm {
        *kept.last_mut().unwrap() = end;
    }
    kept
}

fn subdivide_long_segments(points: &[StitchPoint], max_stitch_mm: f64) -> Vec<StitchPoint> {
    if points.is_empty() {
        return Vec::new();
    }
    let mut out = vec![points[0]];
    for pair in points.windows(2) {
        let (a, b) = (pair[0], pair[1]);
        let segments = (distance(a, b) / max_stitch_mm).ceil().max(1.0) as usize;
        for i in 1..=segments {
            let t = i as f64 / segments as f64;
            out.push(StitchPoint {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                flag: FLAG_STITCH,
                color: b.color,
            });
        }
    }
    out
}

fn flush_stitch_run(
    out: &mut Vec<StitchPoint>,
    anchor: &mut StitchPoint,
    run: &mut Vec<StitchPoint>,
    min_stitch_mm: f64,
    max_stitch_mm: f64,
    curve_tolerance_mm: f64,
) {
    if run.is_empty() {
        return;
    }
    let mut path = Vec::with_capacity(run.len() + 1);
    path.push(*anchor);
    path.append(run);
    let path = simplify_long_polyline(&path, curve_tolerance_mm);
    let path = enforce_min_spacing(path, min_stitch_mm);
    let path = subdivide_long_segments(&path, max_stitch_mm);
    for &point in path.iter().skip(1) {
        out.push(point);
        *anchor = point;
    }
}

fn post_process_stitches(
    points: Vec<StitchPoint>,
    min_stitch_mm: f64,
    max_stitch_mm: f64,
    curve_tolerance_mm: f64,
) -> Vec<StitchPoint> {
    let mut out = Vec::with_capacity(points.len());
    let mut run = Vec::new();
    let mut anchor = StitchPoint { x: 0.0, y: 0.0, flag: FLAG_JUMP, color: 0 };
    for point in points {
        if point.flag == FLAG_STITCH {
            run.push(point);
            continue;
        }
        flush_stitch_run(&mut out, &mut anchor, &mut run, min_stitch_mm, max_stitch_mm, curve_tolerance_mm);
        if point.flag == FLAG_JUMP {
            anchor = point;
        }
        out.push(point);
    }
    flush_stitch_run(&mut out, &mut anchor, &mut run, min_stitch_mm, max_stitch_mm, curve_tolerance_mm);
    out
}

/// 3x3 多数滤波：标签图去碎点
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

#[cfg(test)]
mod tests {
    use super::*;

    fn stitch(x: f64, y: f64) -> StitchPoint {
        StitchPoint { x, y, flag: FLAG_STITCH, color: 0 }
    }

    #[test]
    fn post_process_enforces_machine_geometry() {
        let input = vec![
            stitch(0.2, 0.0),
            stitch(0.4, 0.01),
            stitch(1.2, 0.02),
            stitch(7.2, 0.0),
        ];
        let output = post_process_stitches(input, 0.6, 3.0, 0.1);
        let mut previous = StitchPoint { x: 0.0, y: 0.0, flag: FLAG_JUMP, color: 0 };
        assert!(output.len() >= 3);
        for point in output {
            let length = distance(previous, point);
            assert!(length >= 0.6 - 1e-9, "segment too short: {length}");
            assert!(length <= 3.0 + 1e-9, "segment too long: {length}");
            previous = point;
        }
    }

    #[test]
    fn post_process_keeps_a_real_corner() {
        let input = vec![stitch(2.0, 0.0), stitch(2.0, 2.0), stitch(4.0, 2.0)];
        let output = post_process_stitches(input, 0.6, 3.0, 0.1);
        assert!(output.iter().any(|point| (point.x - 2.0).abs() < 1e-9 && (point.y - 2.0).abs() < 1e-9));
    }
}
