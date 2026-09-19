//! 针迹路径生成 —— 制版的核心：色块图 → 真实针迹序列。
//! 输出 mm 绝对坐标（y 向下，DST 编码器负责翻转为机器坐标）。
//! MVP 针法：扫描线填针（tatami 蛇形往返）+ 换色编排 + 背景识别跳针；
//! 缎面针/轮廓针与底针在后续迭代中按区域几何细分。

use crate::dst::{FLAG_COLOR, FLAG_JUMP, FLAG_STITCH};
use crate::img::{kmeans, lab_to_hex, rgb_to_lab};
use image::imageops::FilterType;
use napi_derive::napi;

#[napi(object)]
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
pub fn generate_stitches(image_path: String, max_colors: u32, width_mm: f64) -> napi::Result<StitchResult> {
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
    let (mut stitch_count, mut color_changes) = (0u32, 0u32);

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
                if flag == FLAG_STITCH {
                    stitch_count += 1;
                }

                // 行内按针步间隔补中间点
                let len = (ex - sx).abs();
                let n_mid = (len / STITCH_LEN_MM).floor() as usize;
                for i in 1..=n_mid {
                    let xm = sx + (ex - sx) * i as f64 / (n_mid as f64 + 1.0);
                    points.push(StitchPoint { x: xm, y: ym, flag: FLAG_STITCH, color: c as u32 });
                    stitch_count += 1;
                }
                points.push(StitchPoint { x: ex, y: ym, flag: FLAG_STITCH, color: c as u32 });
                stitch_count += 1;
                cx = ex;
                cy = ym;
            }
            ltr = !ltr;
            y += spacing_px;
        }
    }

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
