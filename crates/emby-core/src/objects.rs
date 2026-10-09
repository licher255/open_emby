//! Editable raster objects. Segmentation is stored in the plan and reused verbatim by stitching.
use crate::dst::{FLAG_COLOR, FLAG_JUMP, FLAG_STITCH};
use crate::img::{dist2, kmeans, lab_to_hex, rgb_to_lab};
use crate::orientation::{DirectionField, DirectionGuide};
use crate::stitch::{StitchPoint, StitchResult};
use napi_derive::napi;
use std::collections::{BTreeMap, VecDeque};

#[napi(object)]
#[derive(Clone, Debug)]
pub struct EmbroideryRegion {
    pub id: String,
    pub label: u32,
    pub color: String,
    pub color_index: u32,
    pub stitch_type: String,
    pub density: f64,
    pub angle_deg: f64,
    pub underlay: bool,
    pub enabled: bool,
    pub area_mm2: f64,
    pub x_mm: f64,
    pub y_mm: f64,
    pub width_mm: f64,
    pub height_mm: f64,
}

#[napi(object)]
#[derive(Clone)]
pub struct ArtworkObjects {
    pub route_travel: Option<bool>,
    pub direction_field: Option<DirectionField>,
    pub direction_guides: Option<Vec<DirectionGuide>>,
    pub map_width: u32,
    pub map_height: u32,
    pub labels: Vec<u32>,
    pub palette: Vec<String>,
    pub regions: Vec<EmbroideryRegion>,
    pub width_mm: f64,
    pub height_mm: f64,
}

fn error(s: &str) -> napi::Error {
    napi::Error::from_reason(s)
}

#[napi]
pub fn analyze_artwork(
    path: String,
    max_colors: u32,
    width_mm: f64,
) -> napi::Result<ArtworkObjects> {
    if !width_mm.is_finite()
        || !(10.0..=400.0).contains(&width_mm)
        || !(2..=16).contains(&max_colors)
    {
        return Err(error("Width must be 10–400 mm; colors must be 2–16"));
    }
    let src = image::open(&path)
        .map_err(|e| error(&e.to_string()))?
        .to_rgb8();
    let height_mm = width_mm * src.height() as f64 / src.width() as f64;
    if !(10.0..=400.0).contains(&height_mm) {
        return Err(error("Artwork height must be 10–400 mm"));
    }
    let scale = (4.0_f64).min(800.0 / width_mm.max(height_mm));
    let w = (width_mm * scale).round() as usize;
    let h = (height_mm * scale).round() as usize;
    let img = image::imageops::resize(
        &src,
        w as u32,
        h as u32,
        image::imageops::FilterType::Nearest,
    );
    let pixels: Vec<[u8; 3]> = img.pixels().map(|p| p.0).collect();
    // Only edge-connected near-white pixels are cloth. White interior details stay editable.
    let mut background = vec![false; w * h];
    let mut queue = VecDeque::new();
    for i in 0..w * h {
        if (i < w || i >= w * (h - 1) || i % w == 0 || i % w == w - 1)
            && pixels[i].iter().all(|&v| v >= 245)
        {
            background[i] = true;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        for n in neighbors(i, w, h) {
            if !background[n] && pixels[n].iter().all(|&v| v >= 245) {
                background[n] = true;
                queue.push_back(n);
            }
        }
    }
    let mut unique = BTreeMap::new();
    for (i, p) in pixels.iter().enumerate() {
        if !background[i] {
            unique.entry(*p).or_insert(0u32);
        }
    }
    if unique.is_empty() {
        return Err(error(
            "No foreground found; choose artwork with a visible subject",
        ));
    }
    let mut palette = Vec::new();
    let mut color_labels = vec![u32::MAX; w * h];
    if unique.len() <= max_colors as usize {
        for (index, (p, label)) in unique.iter_mut().enumerate() {
            *label = index as u32;
            palette.push(format!("#{:02x}{:02x}{:02x}", p[0], p[1], p[2]));
        }
        for i in 0..w * h {
            if !background[i] {
                color_labels[i] = unique[&pixels[i]];
            }
        }
    } else {
        let foreground: Vec<_> = pixels
            .iter()
            .enumerate()
            .filter(|(i, _)| !background[*i])
            .map(|(_, p)| rgb_to_lab(p[0], p[1], p[2]))
            .collect();
        // Bounded sample for clustering; all pixels are assigned against the same palette.
        let stride = (foreground.len() / 12000).max(1);
        let sample: Vec<_> = foreground.iter().step_by(stride).copied().collect();
        let (_, centers) = kmeans(&sample, max_colors as usize, 20);
        palette = centers.iter().map(|&c| lab_to_hex(c)).collect();
        for i in 0..w * h {
            if !background[i] {
                let p = pixels[i];
                let lab = rgb_to_lab(p[0], p[1], p[2]);
                color_labels[i] = centers
                    .iter()
                    .enumerate()
                    .min_by(|(_, a), (_, b)| dist2(lab, **a).total_cmp(&dist2(lab, **b)))
                    .unwrap()
                    .0 as u32;
            }
        }
    }
    let sx = width_mm / w as f64;
    let sy = height_mm / h as f64;
    let mut labels = vec![0u32; w * h];
    let mut regions = Vec::new();
    for i in 0..w * h {
        if background[i] || labels[i] != 0 {
            continue;
        }
        let label = regions.len() as u32 + 1;
        let color = color_labels[i];
        queue.push_back(i);
        labels[i] = label;
        let mut coords = Vec::new();
        while let Some(j) = queue.pop_front() {
            coords.push((j % w, j / w));
            for n in neighbors(j, w, h) {
                if labels[n] == 0 && color_labels[n] == color {
                    labels[n] = label;
                    queue.push_back(n);
                }
            }
        }
        let count = coords.len() as f64;
        let mx = coords.iter().map(|p| p.0 as f64 * sx).sum::<f64>() / count;
        let my = coords.iter().map(|p| p.1 as f64 * sy).sum::<f64>() / count;
        let (mut xx, mut yy, mut xy) = (0.0, 0.0, 0.0);
        for &(x, y) in &coords {
            let dx = x as f64 * sx - mx;
            let dy = y as f64 * sy - my;
            xx += dx * dx;
            yy += dy * dy;
            xy += dx * dy;
        }
        let axis = 0.5 * (2.0 * xy).atan2(xx - yy);
        let min_x = coords.iter().map(|p| p.0).min().unwrap();
        let max_x = coords.iter().map(|p| p.0).max().unwrap();
        let min_y = coords.iter().map(|p| p.1).min().unwrap();
        let max_y = coords.iter().map(|p| p.1).max().unwrap();
        let bw = (max_x - min_x + 1) as f64 * sx;
        let bh = (max_y - min_y + 1) as f64 * sy;
        let area = count * sx * sy;
        // Region decisions remain visible and editable; no semantic face/eye inference here.
        let minor = ((xx + yy - ((xx - yy).powi(2) + 4.0 * xy * xy).sqrt()) / count / 2.0)
            .max(0.0)
            .sqrt()
            * 3.46;
        let kind = if minor < 0.7 {
            "run"
        } else if minor < 3.5 && bw.max(bh) > minor * 2.0 {
            "satin"
        } else {
            "curved"
        };
        regions.push(EmbroideryRegion {
            id: format!("r{label}"),
            label,
            color: palette[color as usize].clone(),
            color_index: color,
            stitch_type: kind.into(),
            density: 0.45,
            angle_deg: if kind == "satin" {
                (axis.to_degrees() + 90.0) % 180.0
            } else {
                axis.to_degrees()
            },
            underlay: area > 10.0 && kind != "run",
            enabled: area >= 0.35,
            area_mm2: area,
            x_mm: min_x as f64 * sx,
            y_mm: min_y as f64 * sy,
            width_mm: bw,
            height_mm: bh,
        });
        if regions.len() > 4000 {
            return Err(error(
                "Too many regions; simplify the artwork before planning",
            ));
        }
    }
    Ok(ArtworkObjects {
        route_travel: Some(true),
        direction_field: Some(crate::orientation::estimate(&src)),
        direction_guides: Some(Vec::new()),
        map_width: w as u32,
        map_height: h as u32,
        labels,
        palette,
        regions,
        width_mm,
        height_mm,
    })
}

fn neighbors(i: usize, w: usize, h: usize) -> impl Iterator<Item = usize> {
    [
        if i % w > 0 { Some(i - 1) } else { None },
        if i % w + 1 < w { Some(i + 1) } else { None },
        if i >= w { Some(i - w) } else { None },
        if i + w < w * h { Some(i + w) } else { None },
    ]
    .into_iter()
    .flatten()
}

/// Composite the generated pixels only inside the selected immutable object mask.
#[napi]
pub fn composite_region(
    original: String,
    edited: String,
    destination: String,
    plan: ArtworkObjects,
    label: u32,
) -> napi::Result<()> {
    if plan.map_width == 0
        || plan.map_height == 0
        || plan.labels.len() != plan.map_width as usize * plan.map_height as usize
        || !plan.regions.iter().any(|r| r.label == label)
    {
        return Err(error("Invalid repair mask"));
    }
    let mut base = image::open(&original)
        .map_err(|e| error(&e.to_string()))?
        .to_rgb8();
    let draft = image::open(&edited)
        .map_err(|e| error(&e.to_string()))?
        .to_rgb8();
    let draft = image::imageops::resize(
        &draft,
        base.width(),
        base.height(),
        image::imageops::FilterType::Lanczos3,
    );
    let (w, h) = (base.width(), base.height());
    for y in 0..h {
        for x in 0..w {
            let mx = x as usize * plan.map_width as usize / w as usize;
            let my = y as usize * plan.map_height as usize / h as usize;
            if plan.labels[my * plan.map_width as usize + mx] == label {
                base.put_pixel(x, y, *draft.get_pixel(x, y));
            }
        }
    }
    base.save(destination).map_err(|e| error(&e.to_string()))
}

type Pt = (f64, f64);
fn length(a: Pt, b: Pt) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}
fn inside(plan: &ArtworkObjects, label: u32, p: Pt) -> bool {
    if p.0 < 0.0 || p.1 < 0.0 || p.0 >= plan.width_mm || p.1 >= plan.height_mm {
        return false;
    }
    let x = (p.0 / plan.width_mm * plan.map_width as f64) as usize;
    let y = (p.1 / plan.height_mm * plan.map_height as f64) as usize;
    plan.labels[y * plan.map_width as usize + x] == label
}
fn segment_inside(plan: &ArtworkObjects, label: u32, a: Pt, b: Pt) -> bool {
    let step =
        (plan.width_mm / plan.map_width as f64).min(plan.height_mm / plan.map_height as f64) * 0.4;
    let n = (length(a, b) / step).ceil().max(1.0) as usize;
    (0..=n).all(|i| {
        let t = i as f64 / n as f64;
        inside(plan, label, (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t))
    })
}

/// Scan in a rotated, optionally gently curved coordinate system. Clip against each object's mask.
fn rows(
    plan: &ArtworkObjects,
    r: &EmbroideryRegion,
    angle: f64,
    spacing: f64,
    bend: bool,
    inset: f64,
) -> Vec<Vec<Pt>> {
    let a = angle.to_radians();
    let (s, c) = a.sin_cos();
    let center = (r.x_mm + r.width_mm / 2.0, r.y_mm + r.height_mm / 2.0);
    let half_u = (r.width_mm * c.abs() + r.height_mm * s.abs()) / 2.0 + 0.5;
    let half_v = (r.width_mm * s.abs() + r.height_mm * c.abs()) / 2.0 + 0.5;
    let amplitude = if bend {
        (r.width_mm.min(r.height_mm) * 0.10).min(1.2)
    } else {
        0.0
    };
    let sample =
        (plan.width_mm / plan.map_width as f64).min(plan.height_mm / plan.map_height as f64) * 0.45;
    let to_xy = |u: f64, v: f64| {
        let v = v + amplitude * (u / half_u * std::f64::consts::FRAC_PI_2).sin();
        (center.0 + u * c - v * s, center.1 + u * s + v * c)
    };
    let mut paths = Vec::new();
    let count = ((half_v + amplitude) * 2.0 / spacing).ceil() as usize;
    for row in 0..=count {
        let v = -half_v - amplitude + row as f64 * spacing;
        let mut spans = Vec::new();
        let mut path = Vec::new();
        let samples = (half_u * 2.0 / sample).ceil() as usize;
        for j in 0..=samples {
            let p = to_xy(-half_u + j as f64 * sample, v);
            let fits = inside(plan, r.label, p)
                && (inset == 0.0
                    || [(inset, 0.0), (-inset, 0.0), (0.0, inset), (0.0, -inset)]
                        .iter()
                        .all(|d| inside(plan, r.label, (p.0 + d.0, p.1 + d.1))));
            if fits {
                path.push(p)
            } else if !path.is_empty() {
                spans.push(std::mem::take(&mut path));
            }
        }
        if !path.is_empty() {
            spans.push(path);
        }
        if row % 2 == 1 {
            spans.reverse();
            for p in &mut spans {
                p.reverse();
            }
        }
        paths.extend(spans.into_iter().filter(|p| p.len() > 1));
    }
    paths
}

fn resample(path: &[Pt], step: f64, phase: f64) -> Vec<Pt> {
    if path.is_empty() {
        return Vec::new();
    }
    let mut out = vec![path[0]];
    let mut accumulated = 0.0;
    let mut next = step * (0.4 + phase * 0.6);
    for pair in path.windows(2) {
        let d = length(pair[0], pair[1]);
        while d > 0.0 && accumulated + d >= next {
            let t = (next - accumulated) / d;
            out.push((
                pair[0].0 + (pair[1].0 - pair[0].0) * t,
                pair[0].1 + (pair[1].1 - pair[0].1) * t,
            ));
            next += step;
        }
        accumulated += d;
    }
    let end = *path.last().unwrap();
    if length(*out.last().unwrap(), end) > 0.02 {
        out.push(end);
    }
    out
}

/// Integrate evenly separated streamlines through a continuous orientation field.
fn flow_paths(plan: &ArtworkObjects, r: &EmbroideryRegion) -> Vec<Vec<Pt>> {
    use std::collections::HashMap;
    let spacing = r.density;
    let step = (spacing * 0.4).min(0.18);
    let mut occupied: HashMap<(i32, i32), Vec<Pt>> = HashMap::new();
    let key = |p: Pt| {
        (
            (p.0 / spacing).floor() as i32,
            (p.1 / spacing).floor() as i32,
        )
    };
    let near = |p: Pt, map: &HashMap<(i32, i32), Vec<Pt>>, distance: f64| {
        let (x, y) = key(p);
        (-1..=1).any(|dy| {
            (-1..=1).any(|dx| {
                map.get(&(x + dx, y + dy))
                    .map(|list| list.iter().any(|&q| length(q, p) < distance))
                    .unwrap_or(false)
            })
        })
    };
    let direction = |p: Pt| {
        let v = if r.stitch_type == "radial" {
            let dx = (p.0 - r.x_mm - r.width_mm / 2.0) / (r.width_mm / 2.0).powi(2);
            let dy = (p.1 - r.y_mm - r.height_mm / 2.0) / (r.height_mm / 2.0).powi(2);
            let norm = dx.hypot(dy);
            if norm < 0.001 {
                (0.0, 0.0)
            } else {
                (dx / norm, dy / norm)
            }
        } else if let Some(field) = &plan.direction_field {
            crate::orientation::direction(
                field,
                plan.direction_guides.as_deref().unwrap_or(&[]),
                p.0,
                p.1,
                plan.width_mm,
                plan.height_mm,
            )
        } else {
            (0.0, 0.0)
        };
        let (s, c) = r.angle_deg.to_radians().sin_cos();
        (v.0 * c - v.1 * s, v.0 * s + v.1 * c)
    };
    let mut paths = Vec::new();
    let ny = (r.height_mm / spacing).ceil() as usize;
    let nx = (r.width_mm / spacing).ceil() as usize;
    for y in 0..=ny {
        for x in 0..=nx {
            let seed = (
                r.x_mm + (x as f64 + 0.5 + (y % 3) as f64 * 0.19) * spacing,
                r.y_mm + (y as f64 + 0.5) * spacing,
            );
            if !inside(plan, r.label, seed) || near(seed, &occupied, spacing * 0.85) {
                continue;
            }
            let initial = direction(seed);
            if initial.0.hypot(initial.1) < 0.5 {
                continue;
            }
            let trace = |sign: f64| {
                let mut path = vec![seed];
                let mut prev = (initial.0 * sign, initial.1 * sign);
                for _ in 0..1500 {
                    let p = *path.last().unwrap();
                    let mut v = direction(p);
                    if v.0 * prev.0 + v.1 * prev.1 < 0.0 {
                        v = (-v.0, -v.1);
                    }
                    let mid = (p.0 + v.0 * step / 2.0, p.1 + v.1 * step / 2.0);
                    let mut v = direction(mid);
                    if v.0 * prev.0 + v.1 * prev.1 < 0.0 {
                        v = (-v.0, -v.1);
                    }
                    if v.0 * prev.0 + v.1 * prev.1 < 0.8 {
                        break;
                    }
                    let next = (p.0 + v.0 * step, p.1 + v.1 * step);
                    if !segment_inside(plan, r.label, p, next)
                        || near(next, &occupied, spacing * 0.78)
                    {
                        break;
                    }
                    if path.len() > 30 && length(next, seed) < step * 2.0 {
                        break;
                    }
                    path.push(next);
                    prev = v;
                }
                path
            };
            let mut backward = trace(-1.0);
            let forward = trace(1.0);
            backward.reverse();
            backward.extend(forward.into_iter().skip(1));
            let arc = backward.windows(2).map(|p| length(p[0], p[1])).sum::<f64>();
            if arc < 0.7 {
                continue;
            }
            for &p in &backward {
                occupied.entry(key(p)).or_default().push(p);
            }
            paths.push(backward);
        }
    }
    paths
}

/// Follow the closest next clipped span instead of jumping between branches on every scan row.
fn route_rows(mut paths: Vec<Vec<Pt>>) -> Vec<Vec<Pt>> {
    if paths.is_empty() || paths.len() > 4000 {
        return paths;
    }
    // ponytail: quadratic endpoint search within one object; spatial indexing if very large objects need it.
    let mut ordered = Vec::with_capacity(paths.len());
    let first = paths.remove(0);
    let mut end = *first.last().unwrap();
    ordered.push(first);
    while !paths.is_empty() {
        let (mut best, mut reverse, mut cost) = (0, false, f64::INFINITY);
        for (i, p) in paths.iter().enumerate() {
            let front = length(end, p[0]);
            let back = length(end, *p.last().unwrap());
            if front < cost {
                best = i;
                reverse = false;
                cost = front;
            }
            if back < cost {
                best = i;
                reverse = true;
                cost = back;
            }
        }
        let mut p = paths.swap_remove(best);
        if reverse {
            p.reverse();
        }
        end = *p.last().unwrap();
        ordered.push(p);
    }
    ordered
}

fn append_path(
    out: &mut Vec<StitchPoint>,
    plan: &ArtworkObjects,
    r: &EmbroideryRegion,
    path: &[Pt],
    max: f64,
) {
    if path.len() < 2 {
        return;
    }
    let start = path[0];
    let connect = out
        .last()
        .filter(|p| p.color == r.color_index && p.flag != FLAG_COLOR)
        .map(|p| {
            let last = (p.x, p.y);
            // Flow lines must not acquire arbitrary diagonal connectors that destroy the direction field.
            let limit = if ["flow", "radial"].contains(&r.stitch_type.as_str()) {
                0.05
            } else {
                5.0
            };
            length(last, start) <= limit && segment_inside(plan, r.label, last, start)
        })
        .unwrap_or(false);
    if connect {
        let p = *out.last().unwrap();
        let a = (p.x, p.y);
        let n = (length(a, start) / max.min(1.5)).ceil().max(1.0) as usize;
        for j in 1..=n {
            let t = j as f64 / n as f64;
            let at = (a.0 + (start.0 - a.0) * t, a.1 + (start.1 - a.1) * t);
            if length((out.last().unwrap().x, out.last().unwrap().y), at) > 0.02 {
                out.push(StitchPoint {
                    x: at.0,
                    y: at.1,
                    flag: FLAG_STITCH,
                    color: r.color_index,
                });
            }
        }
    } else {
        out.push(StitchPoint {
            x: start.0,
            y: start.1,
            flag: FLAG_JUMP,
            color: r.color_index,
        });
    }
    for pair in path.windows(2) {
        if length(pair[0], pair[1]) < 0.02 {
            continue;
        }
        // Never sew straight across a hole or outside a curved object.
        if !segment_inside(plan, r.label, pair[0], pair[1]) {
            out.push(StitchPoint {
                x: pair[1].0,
                y: pair[1].1,
                flag: FLAG_JUMP,
                color: r.color_index,
            });
            continue;
        }
        let n = (length(pair[0], pair[1]) / max).ceil().max(1.0) as usize;
        for j in 1..=n {
            let t = j as f64 / n as f64;
            out.push(StitchPoint {
                x: pair[0].0 + (pair[1].0 - pair[0].0) * t,
                y: pair[0].1 + (pair[1].1 - pair[0].1) * t,
                flag: FLAG_STITCH,
                color: r.color_index,
            });
        }
    }
}

#[napi]
pub fn stitch_artwork(
    plan: ArtworkObjects,
    min_stitch_mm: f64,
    max_stitch_mm: f64,
) -> napi::Result<StitchResult> {
    if plan.map_width < 1
        || plan.map_height < 1
        || plan.map_width > 800
        || plan.map_height > 800
        || plan.labels.len() != plan.map_width as usize * plan.map_height as usize
        || !plan.width_mm.is_finite()
        || !plan.height_mm.is_finite()
        || !(10.0..=400.0).contains(&plan.width_mm)
        || !(10.0..=400.0).contains(&plan.height_mm)
        || plan.regions.len() > 4000
        || !min_stitch_mm.is_finite()
        || !max_stitch_mm.is_finite()
        || !(0.1..=2.0).contains(&min_stitch_mm)
        || !(1.0..=12.0).contains(&max_stitch_mm)
        || min_stitch_mm >= max_stitch_mm
    {
        return Err(error("Invalid object plan or stitch limits"));
    }
    let mut seen = std::collections::HashSet::new();
    for r in &plan.regions {
        if r.label == 0
            || !seen.insert(r.label)
            || r.color_index as usize >= plan.palette.len()
            || ![
                r.density,
                r.angle_deg,
                r.x_mm,
                r.y_mm,
                r.width_mm,
                r.height_mm,
            ]
            .iter()
            .all(|x| x.is_finite())
            || !(0.25..=1.5).contains(&r.density)
            || r.width_mm <= 0.0
            || r.height_mm <= 0.0
            || r.width_mm > 400.0
            || r.height_mm > 400.0
            || !["tatami", "curved", "satin", "run", "flow", "radial"]
                .contains(&r.stitch_type.as_str())
        {
            return Err(error("Invalid region settings; regenerate an old plan"));
        }
    }
    if plan.labels.iter().any(|v| *v != 0 && !seen.contains(v)) {
        return Err(error("Unknown object label"));
    }
    if let Some(field) = &plan.direction_field {
        let n = field.width as usize * field.height as usize;
        if field.width < 2
            || field.height < 2
            || field.width > 200
            || field.height > 200
            || field.cos2.len() != n
            || field.sin2.len() != n
            || field.confidence.len() != n
            || field
                .cos2
                .iter()
                .chain(&field.sin2)
                .chain(&field.confidence)
                .any(|v| !v.is_finite() || v.abs() > 1.001)
        {
            return Err(error("Invalid direction field"));
        }
    }
    if let Some(guides) = &plan.direction_guides {
        if guides.len() > 256
            || guides.iter().any(|g| {
                ![g.x_mm, g.y_mm, g.angle_deg, g.radius_mm]
                    .iter()
                    .all(|v| v.is_finite())
                    || !(1.0..=100.0).contains(&g.radius_mm)
            })
        {
            return Err(error("Invalid direction guides"));
        }
    }
    if plan.regions.iter().any(|r| r.stitch_type == "flow") && plan.direction_field.is_none() {
        return Err(error("Reanalyze artwork to estimate its direction field"));
    }
    let mut order: Vec<_> = plan.regions.iter().filter(|r| r.enabled).collect();
    // Stable color grouping, large areas first; user region settings survive unchanged.
    order.sort_by(|a, b| {
        a.color_index
            .cmp(&b.color_index)
            .then_with(|| b.area_mm2.total_cmp(&a.area_mm2))
    });
    let mut points: Vec<StitchPoint> = Vec::new();
    let mut color_changes = 0;
    let mut underlay_ranges = Vec::new();
    let mut region_blocks = Vec::new();
    for r in order {
        let mut region_points = Vec::new();
        if r.underlay && r.stitch_type != "run" {
            for p in route_rows(rows(
                &plan,
                r,
                r.angle_deg + 90.0,
                (r.density * 4.0).max(1.6),
                false,
                0.5,
            )) {
                let p = resample(&p, max_stitch_mm.min(2.5), 0.5);
                append_path(&mut region_points, &plan, r, &p, max_stitch_mm);
            }
        }
        let underlay_end = region_points.len();
        if ["flow", "radial"].contains(&r.stitch_type.as_str()) {
            for (row, path) in route_rows(flow_paths(&plan, r)).iter().enumerate() {
                let sampled = resample(path, max_stitch_mm.min(1.8), (row % 5) as f64 / 5.0);
                append_path(&mut region_points, &plan, r, &sampled, max_stitch_mm);
            }
        } else if r.stitch_type == "run" {
            // Center walk follows section midpoints along the object's principal axis.
            let slices = rows(&plan, r, r.angle_deg + 90.0, 0.4, false, 0.0);
            let mut chain = Vec::new();
            for p in slices {
                let mid = p[p.len() / 2];
                if chain
                    .last()
                    .map(|&last| {
                        length(last, mid) > 1.5 || !segment_inside(&plan, r.label, last, mid)
                    })
                    .unwrap_or(false)
                {
                    let sampled = resample(&chain, max_stitch_mm.min(1.5), 0.5);
                    append_path(&mut region_points, &plan, r, &sampled, max_stitch_mm);
                    chain.clear();
                }
                chain.push(mid);
            }
            let sampled = resample(&chain, max_stitch_mm.min(1.5), 0.5);
            append_path(&mut region_points, &plan, r, &sampled, max_stitch_mm);
        } else if r.stitch_type == "satin" {
            let mut chain = Vec::new();
            for (row, p) in rows(&plan, r, r.angle_deg, r.density / 2.0, false, 0.0)
                .into_iter()
                .enumerate()
            {
                // Rows alternate orientation; one penetration per row creates a true zigzag.
                let at = *p.last().unwrap();
                if chain
                    .last()
                    .map(|&last| !segment_inside(&plan, r.label, last, at))
                    .unwrap_or(false)
                {
                    append_path(&mut region_points, &plan, r, &chain, max_stitch_mm);
                    chain.clear();
                }
                if row == 0 {
                    chain.push(p[0]);
                }
                chain.push(at);
            }
            append_path(&mut region_points, &plan, r, &chain, max_stitch_mm);
        } else {
            for (row, p) in route_rows(rows(
                &plan,
                r,
                r.angle_deg,
                r.density,
                r.stitch_type == "curved",
                0.0,
            ))
            .into_iter()
            .enumerate()
            {
                if length(p[0], *p.last().unwrap()) < min_stitch_mm {
                    continue;
                }
                let sampled = resample(&p, max_stitch_mm.min(2.8), (row % 4) as f64 / 4.0);
                append_path(&mut region_points, &plan, r, &sampled, max_stitch_mm);
            }
        }
        if !region_points.iter().any(|p| p.flag == FLAG_STITCH) {
            continue;
        }
        if let Some(last) = points.last() {
            if last.color != r.color_index {
                points.push(StitchPoint {
                    x: last.x,
                    y: last.y,
                    flag: FLAG_COLOR,
                    color: r.color_index,
                });
                color_changes += 1;
            }
        }
        let block_start = points.len();
        if underlay_end > 0 {
            underlay_ranges.extend([points.len() as u32, (points.len() + underlay_end) as u32]);
        }
        points.extend(region_points);
        region_blocks.push((block_start, points.len(), underlay_end));
        if points.len() > 1_000_000 {
            return Err(error(
                "Design exceeds one million commands; reduce density or size",
            ));
        }
    }
    let (points, underlay_ranges, travel_ranges) = if plan.route_travel.unwrap_or(true) {
        // Objects have disjoint label masks. Reorder same-color objects, preserving each object's underlay/top order.
        let (points, underlay_ranges) = crate::travel::order_objects(points, &region_blocks);
        crate::travel::connect(&plan, points, &underlay_ranges, max_stitch_mm)
    } else {
        (points, underlay_ranges, Vec::new())
    };
    if points.len() > 1_000_000 {
        return Err(error(
            "Routed design exceeds one million commands; reduce density or size",
        ));
    }
    let stitch_count = points.iter().filter(|p| p.flag == FLAG_STITCH).count() as u32;
    if stitch_count == 0 {
        return Err(error(
            "No stitches generated; enable larger regions or choose a different stitch type",
        ));
    }
    // Keep designed penetration points. RDP would erase staggered texture and short satin turns.
    Ok(StitchResult {
        underlay_ranges: Some(underlay_ranges),
        travel_ranges: Some(travel_ranges),
        points,
        palette: plan.palette,
        width_mm: plan.width_mm,
        height_mm: plan.height_mm,
        stitch_count,
        color_changes,
        background_index: -1,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> ArtworkObjects {
        let mut labels = vec![0; 80 * 80];
        for y in 8..72 {
            for x in 8..72 {
                if !(30..50).contains(&x) || !(30..50).contains(&y) {
                    labels[y * 80 + x] = 1;
                }
            }
        }
        ArtworkObjects {
            route_travel: Some(false),
            direction_field: None,
            direction_guides: None,
            map_width: 80,
            map_height: 80,
            labels,
            palette: vec!["#aa4422".into()],
            width_mm: 20.0,
            height_mm: 20.0,
            regions: vec![EmbroideryRegion {
                id: "r1".into(),
                label: 1,
                color: "#aa4422".into(),
                color_index: 0,
                stitch_type: "curved".into(),
                density: 0.45,
                angle_deg: 35.0,
                underlay: true,
                enabled: true,
                area_mm2: 231.0,
                x_mm: 2.0,
                y_mm: 2.0,
                width_mm: 16.0,
                height_mm: 16.0,
            }],
        }
    }
    #[test]
    fn texture_respects_mask_limits_and_direction() {
        let plan = fixture();
        let a = stitch_artwork(plan.clone(), 0.3, 2.8).unwrap();
        let mut last = (0.0, 0.0);
        let mut diagonal = 0;
        for p in &a.points {
            let at = (p.x, p.y);
            if p.flag == FLAG_STITCH {
                assert!(length(last, at) <= 2.80001);
                assert!(segment_inside(&plan, 1, last, at));
                if (p.x - last.0).abs() > 0.2 && (p.y - last.1).abs() > 0.2 {
                    diagonal += 1;
                }
            }
            last = at;
        }
        assert!(diagonal > 100);
        let mut rotated = plan.clone();
        rotated.regions[0].angle_deg = 100.0;
        let b = stitch_artwork(rotated, 0.3, 2.8).unwrap();
        assert_ne!(a.points[1].x, b.points[1].x);
        let mut no_underlay = plan.clone();
        no_underlay.regions[0].underlay = false;
        assert!(stitch_artwork(no_underlay, 0.3, 2.8).unwrap().stitch_count < a.stitch_count);
        let mut disabled = plan;
        disabled.regions[0].enabled = false;
        assert!(stitch_artwork(disabled, 0.3, 2.8).is_err());
    }
    #[test]
    fn validation_and_stagger_survive() {
        let mut plan = fixture();
        plan.regions[0].density = 0.0;
        assert!(stitch_artwork(plan, 0.3, 3.0).is_err());
        let path = vec![(0.0, 0.0), (12.0, 0.0)];
        let a = resample(&path, 2.8, 0.0);
        let b = resample(&path, 2.8, 0.5);
        assert_ne!(a[1], b[1]);
        assert_eq!(a.last(), Some(&(12.0, 0.0)));
    }

    #[test]
    fn flow_and_normals_keep_direction_and_export_underlay() {
        let mut p = fixture();
        p.regions[0].stitch_type = "flow".into();
        p.regions[0].angle_deg = 0.0;
        p.regions[0].underlay = false;
        let stripes = image::RgbImage::from_fn(100, 100, |x, _| {
            if x % 10 < 5 {
                image::Rgb([20, 20, 20])
            } else {
                image::Rgb([200, 200, 200])
            }
        });
        p.direction_field = Some(crate::orientation::estimate(&stripes));
        let flow = stitch_artwork(p.clone(), 0.3, 3.0).unwrap();
        let mut last = (0.0, 0.0);
        for point in &flow.points {
            let at = (point.x, point.y);
            if point.flag == FLAG_STITCH {
                assert!((at.0 - last.0).abs() < 0.03);
                assert!(segment_inside(&p, 1, last, at));
            }
            last = at;
        }
        p.regions[0].stitch_type = "radial".into();
        let radial = stitch_artwork(p.clone(), 0.3, 3.0).unwrap();
        last = (0.0, 0.0);
        for point in &radial.points {
            let at = (point.x, point.y);
            if point.flag == FLAG_STITCH {
                let mid = ((at.0 + last.0) / 2.0 - 10.0, (at.1 + last.1) / 2.0 - 10.0);
                let d = (at.0 - last.0, at.1 - last.1);
                let cross = (mid.0 * d.1 - mid.1 * d.0).abs()
                    / (mid.0.hypot(mid.1) * d.0.hypot(d.1)).max(1e-8);
                assert!(cross < 0.03);
            }
            last = at;
        }
        p.regions[0].underlay = true;
        let result = stitch_artwork(p, 0.3, 3.0).unwrap();
        let ranges = result.underlay_ranges.unwrap();
        assert!(!ranges.is_empty());
        assert_eq!(ranges.len() % 2, 0);
        assert!(ranges
            .chunks(2)
            .all(|r| r[0] < r[1] && r[1] as usize <= result.points.len()));
        assert!(result.stitch_count > radial.stitch_count);
    }

    #[test]
    fn satin_and_run_follow_narrow_object() {
        let mut p = fixture();
        p.labels.fill(0);
        for y in 10..70 {
            for x in 36..44 {
                p.labels[y * 80 + x] = 1;
            }
        }
        let r = &mut p.regions[0];
        r.x_mm = 9.0;
        r.y_mm = 2.5;
        r.width_mm = 2.0;
        r.height_mm = 15.0;
        r.angle_deg = 0.0;
        r.stitch_type = "satin".into();
        r.underlay = false;
        let satin = stitch_artwork(p.clone(), 0.3, 3.0).unwrap();
        assert!(satin.stitch_count > 40);
        let mut last = (0.0, 0.0);
        for point in &satin.points {
            let at = (point.x, point.y);
            if point.flag == FLAG_STITCH {
                assert!(segment_inside(&p, 1, last, at));
            }
            last = at;
        }
        p.regions[0].stitch_type = "run".into();
        p.regions[0].angle_deg = 90.0;
        let run = stitch_artwork(p, 0.3, 3.0).unwrap();
        assert!(run.stitch_count > 5 && run.stitch_count < satin.stitch_count);
    }

    #[test]
    fn repair_preserves_every_unselected_pixel() {
        let plan = fixture();
        let dir = std::env::temp_dir().join(format!("emby-mask-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let original = dir.join("original.png");
        let edited = dir.join("edited.png");
        let target = dir.join("result.png");
        image::RgbImage::from_pixel(80, 80, image::Rgb([20, 40, 60]))
            .save(&original)
            .unwrap();
        image::RgbImage::from_pixel(80, 80, image::Rgb([180, 90, 30]))
            .save(&edited)
            .unwrap();
        composite_region(
            original.to_string_lossy().into(),
            edited.to_string_lossy().into(),
            target.to_string_lossy().into(),
            plan.clone(),
            1,
        )
        .unwrap();
        let result = image::open(&target).unwrap().to_rgb8();
        for (i, p) in result.pixels().enumerate() {
            assert_eq!(
                p.0,
                if plan.labels[i] == 1 {
                    [180, 90, 30]
                } else {
                    [20, 40, 60]
                }
            );
        }
        for path in [original, edited, target] {
            std::fs::remove_file(path).unwrap();
        }
        std::fs::remove_dir(dir).unwrap();
    }
}
