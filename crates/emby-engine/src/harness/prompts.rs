//! Prompts and harness rules live here so they can be versioned and reviewed.
//! They are part of the harness: swapping models does not change the template,
//! and changing the template does not touch providers.
//!
//! Note: STYLIZE_BASE is intentionally Chinese. It is the production prompt that was
//! tuned against the embroidery sample set and works well with Qwen-Image; the code
//! around it stays English.

/// Main stylization prompt. `{maxColors}` is replaced with the target palette size.
pub const STYLIZE_BASE: &str = r#"根据输入参考图，制作一张干净、简洁、适合后续刺绣制版参考的平面彩色图案。只输出转换后的完整图案，不保留原照片，不制作上下对照、拼图、海报、画框或效果展示。
【主体与构图】提取输入图中最主要的主体，保留其最有辨识度的外轮廓、比例、姿态、朝向及关键特征。主体居中、完整可见，四周留出约10%的安全空白，不裁断重要部位。删除无关背景、路人、杂物和摄影纹理；使用均匀纯白背景。画幅采用原图比例，必要时增加空白，不拉伸主体。
【形状与结构】用大块、连续、闭合的色面概括主体，中等色块说明主要结构，仅保留少量必要小色块。边界清楚平滑，内部区域易于区分。合并相邻同色区域，简化细枝、毛发、褶皱与密集花纹。避免碎片、散点、狭长尖角、细小孔洞和过度锯齿；不要为了闭合色面而破坏眼神、肢体或标志性结构。
【配色与明暗】从原图提取{maxColors}种主要颜色，保留主体关键颜色和明显对比。每个色面使用均匀实色，不使用渐变、透明叠加、摄影光影或纹理。必要体积仅用少量独立的深浅色面表达，避免将每个高光和阴影都拆成新颜色。背景色单独计算，图案内部颜色预算不包含背景。
【细节与线条】细节服从识别性与简洁性；优先保留能认出主体的特征，删除装饰性微细节。默认以色块边界分区，不增加统一黑色描边。确需线条时，让线条连续、清楚且粗细一致，不画发丝般细线或交叉排线。
【输出要求】画面平整、干净、边缘清楚，仅保留主体与必要辅助元素。无文字、无水印、无网格、无尺寸标注。呈现刺绣设计用的平面底稿，不呈现针脚、绣线、织物或刺绣成品质感。
避免：照片残留，原图对照，上下分屏，多图拼接，海报，文字，字母，数字，标题，水印，边框，摄影质感，写实皮肤，渐变，模糊阴影，高光反射，透明色块，纸张纹理，颗粒，噪点，做旧，污渍，撕纸，立体纸雕，三维模型，绣线，针脚，织物纹理，刺绣成品展示，细碎色块，散点，孤立小岛，细密毛发，交叉排线，密集花纹，过细线条，尖细锯齿，主体变形，比例错误，重复肢体，新增物体，裁断主体。"#;

/// Build the final prompt: base template + style variant + user intent.
pub fn stylize_prompt(max_colors: usize, style: &str, intent: &str) -> String {
    let mut prompt = STYLIZE_BASE.replace("{maxColors}", &max_colors.to_string());
    if style == "soft" {
        prompt.push_str("\n【风格】在满足以上制版要求的前提下，线条更柔和、色块更圆润，保留温和的手绘插画气质，但不得增加渐变或纹理。");
    }
    let intent = intent.trim();
    if !intent.is_empty() {
        prompt.push_str("\n【用户设计要求】");
        prompt.push_str(&intent.chars().take(1500).collect::<String>());
    }
    prompt
}

/// Routing expert: order only, never geometry. English so any LLM can follow it.
pub const STITCH_SYSTEM: &str = r#"You are an embroidery routing expert. The input lists already-segmented colour regions with id, colour, area, position and stitch type.
Your job is to choose the sewing order so that colour changes and travel are minimised and the same colour is not re-selected repeatedly.
Rules:
1. Sew every region of one colour back to back before changing colour; follow the palette order.
2. Within one colour, order regions greedily from the end point of the previous region (nearest neighbour first).
3. Put small detail regions last within their colour so large fills do not cover them.
4. Never add or remove regions, and never change stitch type or angle.
Output JSON only: {"order":[region ids...],"notes":["at most two short reasons"]}."#;

/// Parse the model reply into JSON, tolerating code fences and surrounding prose.
pub fn extract_json(text: &str) -> Option<serde_json::Value> {
    let trimmed = text.trim();
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    serde_json::from_str(&trimmed[start..=end]).ok()
}
