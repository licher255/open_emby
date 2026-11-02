//! Stitch routing harness: decides the order in which regions are sewn.
//!
//! Both paths share one input/output contract:
//! - expert: call a text model (cloud or local), require JSON order, fall back on
//!   any validation failure;
//! - deterministic: same colour first, nearest neighbour, details last. Always available.
use crate::ai::{self, ChatRequest};
use crate::state::AppState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionInput {
    pub label: u32,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub color_index: Option<usize>,
    #[serde(default)]
    pub area_mm2: f64,
    #[serde(default)]
    pub x_mm: f64,
    #[serde(default)]
    pub y_mm: f64,
    #[serde(default)]
    pub width_mm: f64,
    #[serde(default)]
    pub height_mm: f64,
    #[serde(default)]
    pub stitch_type: String,
}

impl RegionInput {
    fn cx(&self) -> f64 { self.x_mm + self.width_mm / 2.0 }
    fn cy(&self) -> f64 { self.y_mm + self.height_mm / 2.0 }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteInput {
    pub regions: Vec<RegionInput>,
    #[serde(default)]
    pub palette: Vec<String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    /// false forces the deterministic strategy
    #[serde(default)]
    pub use_expert: Option<bool>,
    #[serde(default)]
    pub width_mm: f64,
    #[serde(default)]
    pub height_mm: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteEntry {
    pub label: u32,
    pub order: u32,
    pub color: String,
    pub stitch_type: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteOutput {
    pub strategy: String,
    pub provider: String,
    pub model: String,
    pub entries: Vec<RouteEntry>,
    pub notes: Vec<String>,
}

pub async fn route(app: &AppState, input: RouteInput) -> anyhow::Result<RouteOutput> {
    if input.regions.is_empty() {
        anyhow::bail!("no regions to route");
    }
    let labels: std::collections::HashSet<_> = input.regions.iter().map(|r| r.label).collect();
    if labels.len() != input.regions.len() { anyhow::bail!("region labels must be unique"); }
    let want_expert = input.use_expert.unwrap_or(true);
    if want_expert {
        match expert(app, &input).await {
            Ok(out) => return Ok(out),
            Err(error) => {
                let mut out = deterministic(&input);
                out.notes.push(format!("expert model unavailable, fell back to the deterministic strategy: {error}"));
                return Ok(out);
            }
        }
    }
    Ok(deterministic(&input))
}

async fn expert(app: &AppState, input: &RouteInput) -> anyhow::Result<RouteOutput> {
    let payload = serde_json::json!({
        "palette": input.palette,
        "sizeMm": { "width": input.width_mm, "height": input.height_mm },
        "regions": input.regions.iter().map(|r| serde_json::json!({
            "label": r.label,
            "color": r.color,
            "colorIndex": r.color_index,
            "stitchType": r.stitch_type,
            "areaMm2": (r.area_mm2 * 100.0).round() / 100.0,
            "centerMm": [ (r.cx() * 10.0).round() / 10.0, (r.cy() * 10.0).round() / 10.0 ]
        })).collect::<Vec<_>>()
    });
    let prompt = format!(
        "Order the regions below according to the rules. Output JSON only.\n{}",
        serde_json::to_string_pretty(&payload)?
    );
    let reply = ai::generate_text(app, ChatRequest {
        provider_id: input.provider_id.clone(),
        system: super::prompts::STITCH_SYSTEM.to_string(),
        prompt,
        max_tokens: 800,
        json: true,
        model: None,
    }).await?;

    let parsed = super::prompts::extract_json(&reply.text)
        .ok_or_else(|| anyhow::anyhow!("expert response is not JSON"))?;
    let order: Vec<u32> = parsed["order"].as_array()
        .ok_or_else(|| anyhow::anyhow!("expert response has no order field"))?
        .iter()
        .map(|v| v.as_u64().and_then(|n| u32::try_from(n).ok())
            .ok_or_else(|| anyhow::anyhow!("expert returned an invalid region label")))
        .collect::<anyhow::Result<_>>()?;
    let expected: Vec<u32> = input.regions.iter().map(|r| r.label).collect();
    let mut sorted = order.clone();
    sorted.sort_unstable();
    let mut expected_sorted = expected.clone();
    expected_sorted.sort_unstable();
    if sorted != expected_sorted {
        anyhow::bail!("expert returned a label set that does not match the input");
    }

    let notes = parsed["notes"].as_array()
        .map(|list| list.iter().filter_map(|n| n.as_str().map(String::from)).take(2).collect::<Vec<_>>())
        .unwrap_or_default();
    let entries = order.iter().enumerate().filter_map(|(index, label)| {
        let region = input.regions.iter().find(|r| r.label == *label)?;
        Some(RouteEntry {
            label: *label,
            order: index as u32 + 1,
            color: region.color.clone(),
            stitch_type: region.stitch_type.clone(),
            reason: "expert model order".to_string(),
        })
    }).collect();
    Ok(RouteOutput { strategy: "expert".into(), provider: reply.provider, model: reply.model, entries, notes })
}

/// Same colour first -> nearest neighbour -> details last. Stable without any model.
pub fn deterministic(input: &RouteInput) -> RouteOutput {
    let mut groups: Vec<(usize, String, Vec<&RegionInput>)> = Vec::new();
    for region in &input.regions {
        let color_key = region.color.to_ascii_lowercase();
        let index = region.color_index.unwrap_or_else(|| {
            input.palette.iter().position(|c| c.eq_ignore_ascii_case(&region.color)).unwrap_or(usize::MAX)
        });
        match groups.iter_mut().find(|(i, c, _)| *i == index && *c == color_key) {
            Some((_, _, list)) => list.push(region),
            None => groups.push((index, color_key, vec![region])),
        }
    }
    // Palette order first; unknown colours last.
    groups.sort_by_key(|(index, _, _)| *index);

    let mut entries = Vec::new();
    let mut cursor = (0.0f64, 0.0f64);
    let mut order = 0u32;
    for (index, color, mut regions) in groups {
        let max_area = regions.iter().map(|r| r.area_mm2).fold(0.0, f64::max);
        // Large areas first, details last, so details are not covered by big fills.
        regions.sort_by(|a, b| b.area_mm2.partial_cmp(&a.area_mm2).unwrap_or(std::cmp::Ordering::Equal));
        let (big, small): (Vec<_>, Vec<_>) = regions.into_iter().partition(|r| r.area_mm2 >= max_area * 0.15);
        for mut remaining in [big, small] {
            while !remaining.is_empty() {
                let pick = remaining.iter().enumerate()
                    .min_by(|(_, a), (_, b)| {
                        let da = (a.cx() - cursor.0).hypot(a.cy() - cursor.1);
                        let db = (b.cx() - cursor.0).hypot(b.cy() - cursor.1);
                        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                let region = remaining.remove(pick);
                cursor = (region.cx(), region.cy());
                order += 1;
                entries.push(RouteEntry {
                    label: region.label,
                    order,
                    color: region.color.clone(),
                    stitch_type: region.stitch_type.clone(),
                    reason: format!("same colour · palette #{}, nearest neighbour", index.saturating_add(1)),
                });
            }
        }
        let _ = color;
    }
    RouteOutput {
        strategy: "deterministic".into(),
        provider: "deterministic strategy".into(),
        model: String::new(),
        entries,
        notes: vec!["same colour first, nearest neighbour; expert model not used".to_string()],
    }
}
