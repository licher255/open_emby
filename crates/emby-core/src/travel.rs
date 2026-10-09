//! Internal travel planned independently of surface stitches.
//! Inspired by the fill/travel graph separation in Ink/Stitch; this is an independent raster A* implementation.
use crate::dst::{FLAG_COLOR, FLAG_JUMP, FLAG_STITCH};
use crate::objects::ArtworkObjects;
use crate::stitch::StitchPoint;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

pub fn order_objects(
    input: Vec<StitchPoint>,
    blocks: &[(usize, usize, usize)],
) -> (Vec<StitchPoint>, Vec<u32>) {
    let mut pending = blocks.to_vec();
    let mut out: Vec<StitchPoint> = Vec::with_capacity(input.len());
    let mut underlay = Vec::new();
    let mut previous = (0.0, 0.0);
    let mut color = None;
    while !pending.is_empty() {
        let next_color = pending.iter().map(|r| input[r.0].color).min().unwrap();
        let i = pending
            .iter()
            .enumerate()
            .filter(|(_, r)| input[r.0].color == next_color)
            .min_by(|(_, a), (_, b)| {
                dist(previous, (input[a.0].x, input[a.0].y))
                    .total_cmp(&dist(previous, (input[b.0].x, input[b.0].y)))
            })
            .unwrap()
            .0;
        let (start, end, bottom) = pending.remove(i);
        if color.is_some() && color != Some(next_color) {
            out.push(StitchPoint {
                x: previous.0,
                y: previous.1,
                flag: FLAG_COLOR,
                color: next_color,
            });
        }
        color = Some(next_color);
        if bottom > 0 {
            underlay.extend([out.len() as u32, (out.len() + bottom) as u32]);
        }
        out.extend_from_slice(&input[start..end]);
        let last = out.last().unwrap();
        previous = (last.x, last.y);
    }
    (out, underlay)
}

fn dist(a: (f64, f64), b: (f64, f64)) -> f64 {
    (a.0 - b.0).hypot(a.1 - b.1)
}
fn cell(plan: &ArtworkObjects, p: (f64, f64)) -> Option<usize> {
    if p.0 < 0.0 || p.1 < 0.0 || p.0 >= plan.width_mm || p.1 >= plan.height_mm {
        return None;
    }
    Some(
        (p.1 / plan.height_mm * plan.map_height as f64) as usize * plan.map_width as usize
            + (p.0 / plan.width_mm * plan.map_width as f64) as usize,
    )
}
fn center(plan: &ArtworkObjects, i: usize) -> (f64, f64) {
    (
        ((i % plan.map_width as usize) as f64 + 0.5) * plan.width_mm / plan.map_width as f64,
        ((i / plan.map_width as usize) as f64 + 0.5) * plan.height_mm / plan.map_height as f64,
    )
}
fn segment_cells(plan: &ArtworkObjects, a: (f64, f64), b: (f64, f64)) -> Vec<usize> {
    // Exact raster crossings: uniform samples can miss a narrow corner of a hole.
    let mut cuts = vec![0.0, 1.0];
    for (start, end, size) in [
        (a.0, b.0, plan.width_mm / plan.map_width as f64),
        (a.1, b.1, plan.height_mm / plan.map_height as f64),
    ] {
        if (end - start).abs() < 1e-12 {
            continue;
        }
        let lo = (start.min(end) / size).floor() as i32;
        let hi = (start.max(end) / size).ceil() as i32;
        for k in lo..=hi {
            let t = (k as f64 * size - start) / (end - start);
            if t > 0.0 && t < 1.0 {
                cuts.push(t);
            }
        }
    }
    cuts.sort_by(f64::total_cmp);
    cuts.dedup_by(|a, b| (*a - *b).abs() < 1e-12);
    let at = |t: f64| cell(plan, (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
    let mut cells: Vec<_> = cuts
        .windows(2)
        .filter_map(|v| at((v[0] + v[1]) / 2.0))
        .chain([at(0.0), at(1.0)].into_iter().flatten())
        .collect();
    for &t in &cuts {
        let x = a.0 + (b.0 - a.0) * t;
        let y = a.1 + (b.1 - a.1) * t;
        // Reject ambiguous corner grazing rather than rely on opposite floating-point roundings.
        for dx in [-1e-8, 0.0, 1e-8] {
            for dy in [-1e-8, 0.0, 1e-8] {
                if let Some(i) = cell(plan, (x + dx, y + dy)) {
                    cells.push(i);
                }
            }
        }
    }
    cells.sort_unstable();
    cells.dedup();
    cells
}

fn coverage(plan: &ArtworkObjects, a: (f64, f64), b: (f64, f64)) -> Vec<usize> {
    let Some(label) = cell(plan, ((a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0)).map(|i| plan.labels[i])
    else {
        return Vec::new();
    };
    if label == 0 {
        return Vec::new();
    }
    let (sx, sy) = (
        plan.width_mm / plan.map_width as f64,
        plan.height_mm / plan.map_height as f64,
    );
    // This is an estimated future cover envelope, NOT a fabric/thread simulation.
    let radius = 0.35;
    let (rx, ry) = ((radius / sx).ceil() as i32, (radius / sy).ceil() as i32);
    let w = plan.map_width as i32;
    let h = plan.map_height as i32;
    let mut result = Vec::new();
    for i in segment_cells(plan, a, b) {
        let (x, y) = (i as i32 % w, i as i32 / w);
        for dy in -ry..=ry {
            for dx in -rx..=rx {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= w || ny >= h {
                    continue;
                }
                let j = (ny * w + nx) as usize;
                if plan.labels[j] != label {
                    continue;
                }
                let p = center(plan, j);
                let ab = (b.0 - a.0, b.1 - a.1);
                let l2 = ab.0 * ab.0 + ab.1 * ab.1;
                let t = if l2 > 0.0 {
                    ((p.0 - a.0) * ab.0 + (p.1 - a.1) * ab.1) / l2
                } else {
                    0.0
                };
                let t = t.clamp(0.0, 1.0);
                if dist(p, (a.0 + ab.0 * t, a.1 + ab.1 * t)) <= radius {
                    result.push(j);
                }
            }
        }
    }
    result.sort_unstable();
    result.dedup();
    result
}

fn route(
    plan: &ArtworkObjects,
    a: (f64, f64),
    b: (f64, f64),
    future: &[u16],
    traffic: &[u8],
) -> Option<Vec<(f64, f64)>> {
    if dist(a, b) < 0.02 {
        return None;
    }
    let start = cell(plan, a)?;
    let goal = cell(plan, b)?;
    let label = plan.labels[start];
    if label == 0 || plan.labels[goal] != label || future[goal] == 0 || dist(a, b) > 8.0 {
        return None;
    }
    let (w, h) = (plan.map_width as usize, plan.map_height as usize);
    let allowed = |i: usize| {
        plan.labels[i] == label && traffic[i] < 3 && (future[i] > 0 || i == start || i == goal)
    };
    if !allowed(start) || !allowed(goal) {
        return None;
    }
    let mut g = vec![u64::MAX; plan.labels.len()];
    let mut parent = vec![usize::MAX; plan.labels.len()];
    let heuristic = |i: usize| (dist(center(plan, i), center(plan, goal)) * 1000.0) as u64;
    let mut heap = BinaryHeap::new();
    g[start] = 0;
    heap.push((Reverse(heuristic(start)), start));
    let mut count = 0;
    while let Some((Reverse(score), i)) = heap.pop() {
        if score > g[i].saturating_add(heuristic(i)) {
            continue;
        }
        if i == goal {
            break;
        }
        count += 1;
        if count > 8000 {
            return None;
        }
        let (x, y) = (i % w, i / w);
        for (dx, dy) in [
            (-1, 0),
            (1, 0),
            (0, -1),
            (0, 1),
            (-1, -1),
            (-1, 1),
            (1, -1),
            (1, 1),
        ] {
            let (nx, ny) = (x as i32 + dx, y as i32 + dy);
            if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                continue;
            }
            let n = ny as usize * w + nx as usize;
            if !allowed(n) {
                continue;
            }
            if dx != 0
                && dy != 0
                && (!allowed(y * w + nx as usize) || !allowed(ny as usize * w + x))
            {
                continue;
            }
            let near_boundary = nx == 0
                || ny == 0
                || nx as usize == w - 1
                || ny as usize == h - 1
                || [n - 1, n + 1, n - w, n + w]
                    .iter()
                    .any(|&j| plan.labels[j] != label);
            let cost = (dist(center(plan, i), center(plan, n))
                * 1000.0
                * (1.0 + if near_boundary { 3.0 } else { 0.0 } + traffic[n] as f64 * 2.0))
                as u64;
            let candidate = g[i].saturating_add(cost);
            if candidate < g[n] {
                g[n] = candidate;
                parent[n] = i;
                heap.push((Reverse(candidate + heuristic(n)), n));
            }
        }
    }
    if g[goal] == u64::MAX {
        return None;
    }
    let mut ids = vec![goal];
    let mut i = goal;
    while i != start {
        i = parent[i];
        if i == usize::MAX {
            return None;
        }
        ids.push(i);
    }
    ids.reverse();
    let mut path = vec![a];
    path.extend(ids.into_iter().map(|i| center(plan, i)));
    path.push(b);
    let length: f64 = path.windows(2).map(|p| dist(p[0], p[1])).sum();
    if length > 12.0 || length > dist(a, b) * 3.0 + 1.0 {
        return None;
    }
    // Simplify only when the entire shortcut stays in the admissible interior.
    let mut clean = vec![a];
    let mut from = 0;
    while from + 1 < path.len() {
        let mut to = (from + 1..path.len())
            .take_while(|&j| dist(path[from], path[j]) <= 1.5)
            .last()
            .unwrap_or(from + 1);
        while to > from + 1
            && !segment_cells(plan, path[from], path[to])
                .iter()
                .all(|&j| allowed(j))
        {
            to -= 1;
        }
        if !segment_cells(plan, path[from], path[to])
            .iter()
            .all(|&j| allowed(j))
        {
            return None;
        }
        if dist(*clean.last().unwrap(), path[to]) > 0.02 {
            clean.push(path[to]);
        }
        from = to;
    }
    if dist(*clean.last().unwrap(), b) > 1e-8 {
        clean.push(b);
    }
    Some(clean)
}

/// Returns new commands and remapped underlay/travel half-open ranges. Surface needle positions are untouched.
pub fn connect(
    plan: &ArtworkObjects,
    input: Vec<StitchPoint>,
    underlay: &[u32],
    max_length: f64,
) -> (Vec<StitchPoint>, Vec<u32>, Vec<u32>) {
    let mut bottom = vec![false; input.len()];
    for r in underlay.chunks_exact(2) {
        bottom[r[0] as usize..r[1] as usize].fill(true);
    }
    let mut cover = vec![Vec::new(); input.len()];
    let mut future = vec![0u16; plan.labels.len()];
    let mut previous = (0.0, 0.0);
    for (i, p) in input.iter().enumerate() {
        if p.flag == FLAG_COLOR {
            continue;
        }
        let at = (p.x, p.y);
        if p.flag == FLAG_STITCH && !bottom[i] {
            cover[i] = coverage(plan, previous, at);
            for &cell in &cover[i] {
                future[cell] = future[cell].saturating_add(1);
            }
        }
        previous = at;
    }
    let mut traffic = vec![0u8; plan.labels.len()];
    let mut out: Vec<StitchPoint> = Vec::with_capacity(input.len());
    let mut ranges = Vec::new();
    let mut mapping = vec![0u32; input.len() + 1];
    for (i, p) in input.into_iter().enumerate() {
        mapping[i] = out.len() as u32;
        let candidate = if p.flag == FLAG_JUMP {
            out.last()
                .filter(|last| last.color == p.color && last.flag != FLAG_COLOR)
                .and_then(|last| route(plan, (last.x, last.y), (p.x, p.y), &future, &traffic))
        } else {
            None
        };
        if let Some(path) = candidate {
            let start = out.len() as u32;
            let mut visited = Vec::new();
            for pair in path.windows(2) {
                let n = (dist(pair[0], pair[1]) / max_length.min(1.5))
                    .ceil()
                    .max(1.0) as usize;
                for j in 1..=n {
                    let t = j as f64 / n as f64;
                    out.push(StitchPoint {
                        x: pair[0].0 + (pair[1].0 - pair[0].0) * t,
                        y: pair[0].1 + (pair[1].1 - pair[0].1) * t,
                        flag: FLAG_STITCH,
                        color: p.color,
                    });
                }
                visited.extend(segment_cells(plan, pair[0], pair[1]));
            }
            visited.sort_unstable();
            visited.dedup();
            for cell in visited {
                traffic[cell] += 1;
            }
            ranges.extend([start, out.len() as u32]);
        } else {
            out.push(p);
        }
        for &cell in &cover[i] {
            future[cell] -= 1;
        }
    }
    mapping[cover.len()] = out.len() as u32;
    let mapped = underlay.iter().map(|&i| mapping[i as usize]).collect();
    (out, mapped, ranges)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn plan() -> ArtworkObjects {
        let mut labels = vec![1u32; 80 * 80];
        for y in 32..48 {
            for x in 34..46 {
                labels[y * 80 + x] = 0;
            }
        }
        ArtworkObjects {
            route_travel: Some(true),
            direction_field: None,
            direction_guides: None,
            map_width: 80,
            map_height: 80,
            labels,
            palette: vec!["#555555".into()],
            regions: Vec::new(),
            width_mm: 20.0,
            height_mm: 20.0,
        }
    }
    #[test]
    fn routes_around_holes_and_requires_future_cover() {
        let p = plan();
        let mut future = vec![1u16; p.labels.len()];
        let mut traffic = vec![0u8; p.labels.len()];
        let route = route(&p, (7.0, 10.0), (13.0, 10.0), &future, &traffic).unwrap();
        for pair in route.windows(2) {
            assert!(segment_cells(&p, pair[0], pair[1])
                .iter()
                .all(|&i| p.labels[i] == 1));
        }
        future.fill(0);
        assert!(super::route(&p, (7.0, 10.0), (13.0, 10.0), &future, &traffic).is_none());
        future.fill(1);
        traffic.fill(3);
        assert!(super::route(&p, (7.0, 10.0), (13.0, 10.0), &future, &traffic).is_none());
    }
    #[test]
    fn exact_crossings_include_corner_grazing_cells() {
        let p = plan();
        let touched = segment_cells(&p, (8.4, 7.9), (8.6, 8.1));
        assert!(touched.iter().any(|&i| p.labels[i] == 0));
    }
}
