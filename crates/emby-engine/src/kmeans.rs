//! Lab 色彩空间 KMeans 量化（移植自 crates/emby-core/src/img.rs，去掉 napi 绑定）。
//! 制版友好的"平涂色块化"生成节点依赖它。

pub type Lab = (f64, f64, f64);

fn srgb_to_linear(c: u8) -> f64 {
    let v = c as f64 / 255.0;
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> Lab {
    let (rl, gl, bl) = (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b));
    let x = rl * 0.4124 + gl * 0.3576 + bl * 0.1805;
    let y = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
    let z = rl * 0.0193 + gl * 0.1192 + bl * 0.9505;
    let f = |t: f64| if t > 0.008856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 };
    let (fx, fy, fz) = (f(x / 0.95047), f(y), f(z / 1.08883));
    (116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz))
}

pub fn lab_to_rgb(l: Lab) -> (u8, u8, u8) {
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
    (
        to_srgb(x * 3.2406 + y * -1.5372 + z * -0.4986),
        to_srgb(x * -0.9689 + y * 1.8758 + z * 0.0415),
        to_srgb(x * 0.0557 + y * -0.204 + z * 1.057),
    )
}

pub fn lab_to_hex(l: Lab) -> String {
    let (r, g, b) = lab_to_rgb(l);
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn dist2(a: Lab, b: Lab) -> f64 {
    (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2) + (a.2 - b.2).powi(2)
}

/// KMeans（k-means++ 初始化），on_iter 每次迭代回调（用于 WS 进度）
pub fn kmeans(
    points: &[Lab],
    k: usize,
    iters: usize,
    mut on_iter: impl FnMut(usize),
    interrupted: &dyn Fn() -> bool,
) -> (Vec<u32>, Vec<Lab>) {
    use rand::Rng;
    let mut rng = rand::rng();
    let n = points.len();
    let mut centers: Vec<Lab> = vec![points[rng.random_range(0..n)]];
    while centers.len() < k {
        let d2: Vec<f64> = points
            .iter()
            .map(|p| centers.iter().map(|c| dist2(*p, *c)).fold(f64::INFINITY, f64::min))
            .collect();
        let sum: f64 = d2.iter().sum();
        let mut r = rng.random::<f64>() * sum;
        let mut idx = 0;
        while idx < n - 1 && r > d2[idx] {
            r -= d2[idx];
            idx += 1;
        }
        centers.push(points[idx]);
    }
    let mut labels = vec![0u32; n];
    for it in 0..iters {
        if interrupted() {
            break;
        }
        let mut moved = false;
        for (i, p) in points.iter().enumerate() {
            let mut best = 0u32;
            let mut bd = f64::INFINITY;
            for (c, ctr) in centers.iter().enumerate() {
                let d = dist2(*p, *ctr);
                if d < bd {
                    bd = d;
                    best = c as u32;
                }
            }
            if labels[i] != best {
                labels[i] = best;
                moved = true;
            }
        }
        let mut acc = vec![(0f64, 0f64, 0f64, 0usize); k];
        for (i, p) in points.iter().enumerate() {
            let a = &mut acc[labels[i] as usize];
            a.0 += p.0;
            a.1 += p.1;
            a.2 += p.2;
            a.3 += 1;
        }
        for c in 0..k {
            if acc[c].3 > 0 {
                centers[c] = (
                    acc[c].0 / acc[c].3 as f64,
                    acc[c].1 / acc[c].3 as f64,
                    acc[c].2 / acc[c].3 as f64,
                );
            }
        }
        on_iter(it + 1);
        if !moved {
            break;
        }
    }
    (labels, centers)
}

pub fn nearest_center(p: Lab, centers: &[Lab]) -> usize {
    let mut best = 0usize;
    let mut bd = f64::INFINITY;
    for (i, c) in centers.iter().enumerate() {
        let d = dist2(p, *c);
        if d < bd {
            bd = d;
            best = i;
        }
    }
    best
}
