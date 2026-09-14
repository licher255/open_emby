//! 图像处理：Lab KMeans 颜色量化 + 连通域分析 + 感知哈希。
//! sharp/image 解码天然支持 Windows 中文路径。

use napi_derive::napi;

type Lab = (f64, f64, f64);

#[napi(object)]
#[derive(Clone)]
pub struct StitchRegion {
    pub id: String,
    pub color: String,
    pub stitch_type: String, // "satin" | "tatami" | "run" | "outline"
    pub density: f64,
    pub angle_deg: f64,
}

#[napi(object)]
pub struct AnalysisResult {
    pub palette: Vec<String>,
    pub regions: Vec<StitchRegion>,
    pub width_mm: f64,
    pub height_mm: f64,
}

fn srgb_to_linear(c: u8) -> f64 {
    let v = c as f64 / 255.0;
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

fn rgb_to_lab(r: u8, g: u8, b: u8) -> Lab {
    let (rl, gl, bl) = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b));
    let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
    let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
    let f = |t: f64| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (f(x / 0.95047), f(y), f(z / 1.08883));
    (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
}

fn lab_to_hex(l: Lab) -> String {
    let (lv, a, b) = l;
    let finv = |t: f64| if t > 0.206893 { t.powi(3) } else { (t - 16.0 / 116.0) / 7.787 };
    let fy = (lv + 16.0) / 116.0;
    let x = finv(fy + a / 500.0) * 0.95047;
    let y = finv(fy);
    let z = finv(fy - b / 200.0) * 1.08883;
    let to_srgb = |v: f64| -> u8 {
        let s = if v <= 0.0031308 { 12.92 * v } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 };
        (s * 255.0).round().clamp(0.0, 255.0) as u8
    };
    let r = to_srgb(x * 3.2406 + y * -1.5372 + z * -0.4986);
    let g = to_srgb(x * -0.9689 + y * 1.8758 + z * 0.0415);
    let b = to_srgb(x * 0.0557 + y * -0.204 + z * 1.057);
    format!("#{:02x}{:02x}{:02x}", r, g, b)
}

fn dist2(a: Lab, b: Lab) -> f64 {
    (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2) + (a.2 - b.2).powi(2)
}

/// KMeans（k-means++ 初始化）
fn kmeans(points: &[Lab], k: usize, iters: usize) -> (Vec<u32>, Vec<Lab>) {
    use rand::Rng;
    let mut rng = rand::rng();
    let n = points.len();
    let mut centers: Vec<Lab> = vec![points[rng.random_range(0..n)]];
    while centers.len() < k {
        let d2: Vec<f64> = points.iter().map(|p| centers.iter().map(|c| dist2(*p, *c)).fold(f64::INFINITY, f64::min)).collect();
        let sum: f64 = d2.iter().sum();
        let mut r = rng.random::<f64>() * sum;
        let mut idx = 0;
        while idx < n - 1 && r > d2[idx] { r -= d2[idx]; idx += 1; }
        centers.push(points[idx]);
    }
    let mut labels = vec![0u32; n];
    for _ in 0..iters {
        let mut moved = false;
        for i in 0..n {
            let mut best = 0u32;
            let mut bd = f64::INFINITY;
            for (c, ctr) in centers.iter().enumerate() {
                let d = dist2(points[i], *ctr);
                if d < bd { bd = d; best = c as u32; }
            }
            if labels[i] != best { labels[i] = best; moved = true; }
        }
        let mut acc = vec![(0f64, 0f64, 0f64, 0usize); k];
        for i in 0..n {
            let a = &mut acc[labels[i] as usize];
            a.0 += points[i].0; a.1 += points[i].1; a.2 += points[i].2; a.3 += 1;
        }
        for c in 0..k {
            if acc[c].3 > 0 {
                centers[c] = (acc[c].0 / acc[c].3 as f64, acc[c].1 / acc[c].3 as f64, acc[c].2 / acc[c].3 as f64);
            }
        }
        if !moved { break; }
    }
    (labels, centers)
}

struct UnionFind { parent: Vec<u32> }
impl UnionFind {
    fn new() -> Self { Self { parent: Vec::new() } }
    fn make(&mut self) -> u32 { self.parent.push(self.parent.len() as u32); self.parent.len() as u32 - 1 }
    fn find(&mut self, mut x: u32) -> u32 {
        while self.parent[x as usize] != x {
            self.parent[x as usize] = self.parent[self.parent[x as usize] as usize];
            x = self.parent[x as usize];
        }
        x
    }
    fn union(&mut self, a: u32, b: u32) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb { self.parent[ra as usize] = rb; }
    }
}

#[napi]
pub fn analyze_image(path: String, max_colors: u32, width_mm: f64) -> napi::Result<AnalysisResult> {
    const WORK: u32 = 256;
    let img = image::open(&path).map_err(|e| napi::Error::from_reason(format!("无法读取图片 {path}: {e}")))?;
    let img = img.thumbnail(WORK, WORK).to_rgb8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    let height_mm = width_mm * h as f64 / w as f64;

    let raw = img.as_raw();
    let mut points = Vec::with_capacity(w * h);
    for px in raw.chunks_exact(3) {
        points.push(rgb_to_lab(px[0], px[1], px[2]));
    }

    let k = max_colors.clamp(2, 12) as usize;
    let (labels, centers) = kmeans(&points, k, 20);
    let palette_hex: Vec<String> = centers.iter().map(|c| lab_to_hex(*c)).collect();

    // 连通域（两遍法）
    let mut uf = UnionFind::new();
    let mut cc = vec![u32::MAX; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let v = labels[i];
            let left = if x > 0 && labels[i - 1] == v { Some(cc[i - 1]) } else { None };
            let up = if y > 0 && labels[i - w] == v { Some(cc[i - w]) } else { None };
            cc[i] = match (left, up) {
                (None, None) => uf.make(),
                (Some(l), None) => l,
                (None, Some(u)) => u,
                (Some(l), Some(u)) => { uf.union(l, u); l }
            };
        }
    }

    // 聚合 (cluster, root) -> 统计
    use std::collections::HashMap;
    let mut groups: HashMap<(u32, u32), (usize, usize, usize, usize, usize)> = HashMap::new();
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let root = uf.find(cc[i]);
            let e = groups.entry((labels[i], root)).or_insert((0, x, y, x, y));
            e.0 += 1;
            e.1 = e.1.min(x); e.2 = e.2.min(y);
            e.3 = e.3.max(x); e.4 = e.4.max(y);
        }
    }

    let min_area = ((w * h) / 2000).max(16);
    let mut regions = Vec::new();
    let mut rid = 0usize;
    for ((cluster, _), (area, min_x, min_y, max_x, max_y)) in &groups {
        if *area < min_area { continue; }
        let bw = max_x - min_x;
        let bh = max_y - min_y;
        let aspect = bw.max(bh) as f64 / bw.min(bh).max(1) as f64;
        let fill = *area as f64 / ((bw * bh).max(1)) as f64;
        let stitch_type = if aspect > 4.0 && fill < 0.6 { "satin" }
            else if *area > (w * h) / 100 { "tatami" }
            else { "run" };
        regions.push(StitchRegion {
            id: format!("r{rid}"),
            color: palette_hex[*cluster as usize].clone(),
            stitch_type: stitch_type.to_string(),
            density: if stitch_type != "run" { 0.4 } else { 0.0 },
            angle_deg: 0.0,
        });
        rid += 1;
    }

    let mut palette: Vec<String> = palette_hex.into_iter().collect::<std::collections::HashSet<_>>().into_iter().collect();
    palette.sort();

    Ok(AnalysisResult {
        palette,
        regions,
        width_mm: (width_mm * 10.0).round() / 10.0,
        height_mm: (height_mm * 10.0).round() / 10.0,
    })
}

/// 训练集图片预处理：等比缩放到长边 size 并保存 PNG（中文路径安全）
#[napi]
pub fn save_resized_png(src: String, dst: String, size: u32) -> napi::Result<()> {
    let img = image::open(&src).map_err(|e| napi::Error::from_reason(format!("无法读取图片 {src}: {e}")))?;
    let out = img.resize(size, size, image::imageops::FilterType::Lanczos3);
    out.save(&dst).map_err(|e| napi::Error::from_reason(format!("无法写入 {dst}: {e}")))?;
    Ok(())
}

/// 感知哈希（16x16 均值哈希，hex 字符串）— 飞轮去重用
#[napi]
pub fn phash(path: String) -> napi::Result<String> {
    let img = image::open(&path).map_err(|e| napi::Error::from_reason(format!("无法读取图片 {path}: {e}")))?;
    let small = image::imageops::resize(&img.to_luma8(), 16, 16, image::imageops::FilterType::Triangle);
    let px = small.as_raw();
    let mean: f64 = px.iter().map(|v| *v as f64).sum::<f64>() / px.len() as f64;
    let mut bits = String::with_capacity(64);
    for chunk in px.chunks(4) {
        let mut nib = 0u8;
        for (i, v) in chunk.iter().enumerate() {
            if *v as f64 > mean { nib |= 1 << (3 - i); }
        }
        bits.push(char::from_digit(nib as u32, 16).unwrap());
    }
    Ok(bits)
}
