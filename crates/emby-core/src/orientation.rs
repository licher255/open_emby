//! Image structure-tensor orientation and user guide interpolation (unoriented, double-angle field).
use napi_derive::napi;

#[napi(object)]
#[derive(Clone)]
pub struct DirectionField {
    pub width: u32,
    pub height: u32,
    pub cos2: Vec<f64>,
    pub sin2: Vec<f64>,
    pub confidence: Vec<f64>,
}

#[napi(object)]
#[derive(Clone)]
pub struct DirectionGuide {
    pub kind: Option<String>,
    pub x_mm: f64,
    pub y_mm: f64,
    pub angle_deg: f64,
    pub radius_mm: f64,
}

pub fn estimate(image: &image::RgbImage) -> DirectionField {
    let w = 100usize;
    let h =
        ((image.height() as f64 / image.width() as f64 * 100.0).round() as usize).clamp(16, 200);
    let image = image::imageops::resize(
        image,
        w as u32,
        h as u32,
        image::imageops::FilterType::Triangle,
    );
    let image = image::imageops::blur(&image, 0.7);
    let mut tensor = vec![(0.0, 0.0, 0.0); w * h];
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let mut xx = 0.0;
            let mut yy = 0.0;
            let mut xy = 0.0;
            for k in 0..3 {
                let gx = (image.get_pixel(x as u32 + 1, y as u32)[k] as f64
                    - image.get_pixel(x as u32 - 1, y as u32)[k] as f64)
                    / 255.0;
                let gy = (image.get_pixel(x as u32, y as u32 + 1)[k] as f64
                    - image.get_pixel(x as u32, y as u32 - 1)[k] as f64)
                    / 255.0;
                xx += gx * gx;
                yy += gy * gy;
                xy += gx * gy;
            }
            tensor[y * w + x] = (xx, yy, xy);
        }
    }
    let mut raw = vec![(0.0, 0.0); w * h];
    let mut confidence = vec![0.0; w * h];
    for y in 0..h {
        for x in 0..w {
            let (mut xx, mut yy, mut xy) = (0.0, 0.0, 0.0);
            for ny in y.saturating_sub(3)..=(y + 3).min(h - 1) {
                for nx in x.saturating_sub(3)..=(x + 3).min(w - 1) {
                    let t = tensor[ny * w + nx];
                    xx += t.0;
                    yy += t.1;
                    xy += t.2;
                }
            }
            // Principal gradient normal rotated 90 degrees gives the image-line tangent.
            let magnitude = ((xx - yy).powi(2) + 4.0 * xy * xy).sqrt();
            let i = y * w + x;
            if magnitude > 1e-8 {
                raw[i] = (-(xx - yy) / magnitude, -2.0 * xy / magnitude);
            }
            confidence[i] = (magnitude / (xx + yy + 1e-8)) * ((xx + yy) / 0.3).min(1.0);
        }
    }
    // Fill low-information flat areas without resetting direction at color-region boundaries.
    let mut field = raw.clone();
    for _ in 0..45 {
        let mut next = field.clone();
        for y in 1..h - 1 {
            for x in 1..w - 1 {
                let i = y * w + x;
                let (mut cx, mut cy) = (0.0, 0.0);
                for j in [i - 1, i + 1, i - w, i + w] {
                    cx += field[j].0;
                    cy += field[j].1;
                }
                let weight = confidence[i] * 0.55;
                next[i] = (
                    raw[i].0 * weight + cx / 4.0 * (1.0 - weight),
                    raw[i].1 * weight + cy / 4.0 * (1.0 - weight),
                );
            }
        }
        field = next;
    }
    DirectionField {
        width: w as u32,
        height: h as u32,
        cos2: field.iter().map(|p| p.0).collect(),
        sin2: field.iter().map(|p| p.1).collect(),
        confidence,
    }
}

pub fn direction(
    field: &DirectionField,
    guides: &[DirectionGuide],
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> (f64, f64) {
    let gx = (x / width * (field.width - 1) as f64).clamp(0.0, (field.width - 1) as f64);
    let gy = (y / height * (field.height - 1) as f64).clamp(0.0, (field.height - 1) as f64);
    let (ix, iy) = (gx.floor() as usize, gy.floor() as usize);
    let (tx, ty) = (gx - ix as f64, gy - iy as f64);
    let (mut cx, mut cy) = (0.0, 0.0);
    for (xx, yy, weight) in [
        (ix, iy, (1.0 - tx) * (1.0 - ty)),
        ((ix + 1).min(field.width as usize - 1), iy, tx * (1.0 - ty)),
        (ix, (iy + 1).min(field.height as usize - 1), (1.0 - tx) * ty),
        (
            (ix + 1).min(field.width as usize - 1),
            (iy + 1).min(field.height as usize - 1),
            tx * ty,
        ),
    ] {
        let i = yy * field.width as usize + xx;
        cx += field.cos2[i] * weight;
        cy += field.sin2[i] * weight;
    }
    let mut guide_x = 0.0;
    let mut guide_y = 0.0;
    let mut weight_sum = 0.0;
    for guide in guides {
        if guide.kind.as_deref() == Some("radial") {
            continue;
        }
        let d2 = (x - guide.x_mm).powi(2) + (y - guide.y_mm).powi(2);
        let weight = (-d2 / (2.0 * guide.radius_mm.powi(2))).exp();
        let angle = 2.0 * guide.angle_deg.to_radians();
        guide_x += angle.cos() * weight;
        guide_y += angle.sin() * weight;
        weight_sum += weight;
    }
    let mix = (weight_sum * 1.4).min(1.0);
    if weight_sum > 1e-8 {
        cx = cx * (1.0 - mix) + guide_x / weight_sum * mix;
        cy = cy * (1.0 - mix) + guide_y / weight_sum * mix;
    }
    // A user-marked arc center is shared across color regions (e.g. all parts of an iris).
    for guide in guides
        .iter()
        .filter(|g| g.kind.as_deref() == Some("radial"))
    {
        let dx = x - guide.x_mm;
        let dy = y - guide.y_mm;
        let distance = dx.hypot(dy);
        if distance < 0.12 {
            return (0.0, 0.0);
        }
        let weight = ((1.15 - distance / guide.radius_mm) / 0.25).clamp(0.0, 1.0);
        let angle = 2.0 * dy.atan2(dx);
        cx = cx * (1.0 - weight) + angle.cos() * weight;
        cy = cy * (1.0 - weight) + angle.sin() * weight;
    }
    if cx.hypot(cy) < 0.02 {
        return (0.0, 0.0);
    }
    let angle = 0.5 * cy.atan2(cx);
    (angle.cos(), angle.sin())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tensor_tracks_stripes_and_wraps_unoriented_guides() {
        let img = image::RgbImage::from_fn(100, 100, |x, _| {
            if x % 10 < 5 {
                image::Rgb([40, 40, 40])
            } else {
                image::Rgb([210, 210, 210])
            }
        });
        let f = estimate(&img);
        let v = direction(&f, &[], 50.0, 50.0, 100.0, 100.0);
        assert!(v.1.abs() > 0.98);
        let g = vec![
            DirectionGuide {
                kind: None,
                x_mm: 40.0,
                y_mm: 50.0,
                angle_deg: 179.0,
                radius_mm: 20.0,
            },
            DirectionGuide {
                kind: None,
                x_mm: 60.0,
                y_mm: 50.0,
                angle_deg: 1.0,
                radius_mm: 20.0,
            },
        ];
        let v = direction(&f, &g, 50.0, 50.0, 100.0, 100.0);
        assert!(v.0.abs() > 0.98);
        let radial = vec![DirectionGuide {
            kind: Some("radial".into()),
            x_mm: 50.0,
            y_mm: 50.0,
            angle_deg: 0.0,
            radius_mm: 15.0,
        }];
        let v = direction(&f, &radial, 55.0, 55.0, 100.0, 100.0);
        assert!((v.0 - v.1).abs() < 0.01);
    }
}
