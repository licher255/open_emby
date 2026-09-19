//! 扩散模型节点：接口与 ComfyUI 同名节点完全对齐（class_type / 输入 / 输出类型），
//! 当前为占位实现，执行时报错并指引路线图。candle 推理后端落地后按同接口替换 run。
//! 这样工作流 JSON、前端 object_info、连线规则从现在起就是稳定的。

use crate::node::{InputKind, InputSpec, NodeCtx, NodeDef, NodeRun};
use crate::value::Value;
use anyhow::anyhow;

fn not_yet(class_type: &'static str) -> anyhow::Error {
    let msg = format!(
        "节点 {} 属于模型推理链路，candle 原生后端尚未启用（见 docs/ENGINE.html 路线图）。当前可用：LoadImage / EmbyColorBlockStylize / ImageScale / SaveImage / PreviewImage",
        class_type
    );
    anyhow!(msg)
}

macro_rules! stub_node {
    ($class:literal, $display:literal, $category:literal, $desc:literal, $inputs:expr, $outputs:expr, $names:expr) => {
        NodeDef {
            class_type: $class,
            display_name: $display,
            category: $category,
            description: $desc,
            inputs: $inputs,
            outputs: $outputs,
            output_names: $names,
            output_node: false,
            volatile: false,
            run: |_ctx: &NodeCtx, _args: Vec<Value>| -> anyhow::Result<NodeRun> { Err(not_yet($class)) },
        }
    };
}

const SAMPLERS: &[&str] = &["euler", "euler_ancestral", "heun", "dpm_2", "ddim", "uni_pc"];
const SCHEDULERS: &[&str] = &["normal", "karras", "exponential", "sgm_uniform"];

pub fn defs() -> Vec<NodeDef> {
    vec![
        stub_node!(
            "CheckpointLoaderSimple",
            "Load Checkpoint",
            "loaders",
            "加载 SD1.5/SDXL checkpoint（safetensors）",
            vec![InputSpec::required("ckpt_name", InputKind::Text { multiline: false, default: "" })],
            vec!["MODEL", "CLIP", "VAE"],
            vec!["MODEL", "CLIP", "VAE"]
        ),
        stub_node!(
            "VAELoader",
            "Load VAE",
            "loaders",
            "单独加载 VAE",
            vec![InputSpec::required("vae_name", InputKind::Text { multiline: false, default: "" })],
            vec!["VAE"],
            vec!["VAE"]
        ),
        stub_node!(
            "LoraLoader",
            "Load LoRA",
            "loaders",
            "挂载 LoRA 到 MODEL/CLIP（刺绣风格 LoRA 入口）",
            vec![
                InputSpec::required("model", InputKind::Handle("MODEL")),
                InputSpec::required("clip", InputKind::Handle("CLIP")),
                InputSpec::required("lora_name", InputKind::Text { multiline: false, default: "" }),
                InputSpec::required("strength_model", InputKind::Float { min: -10.0, max: 10.0, step: 0.01, default: 1.0 }),
                InputSpec::required("strength_clip", InputKind::Float { min: -10.0, max: 10.0, step: 0.01, default: 1.0 }),
            ],
            vec!["MODEL", "CLIP"],
            vec!["MODEL", "CLIP"]
        ),
        stub_node!(
            "CLIPTextEncode",
            "CLIP Text Encode (Prompt)",
            "conditioning",
            "文本编码为 conditioning",
            vec![
                InputSpec::required("text", InputKind::Text { multiline: true, default: "" }),
                InputSpec::required("clip", InputKind::Handle("CLIP")),
            ],
            vec!["CONDITIONING"],
            vec!["CONDITIONING"]
        ),
        stub_node!(
            "EmptyLatentImage",
            "Empty Latent Image",
            "latent",
            "创建空 latent",
            vec![
                InputSpec::required("width", InputKind::Int { min: 64, max: 8192, default: 512 }),
                InputSpec::required("height", InputKind::Int { min: 64, max: 8192, default: 512 }),
                InputSpec::required("batch_size", InputKind::Int { min: 1, max: 16, default: 1 }),
            ],
            vec!["LATENT"],
            vec!["LATENT"]
        ),
        stub_node!(
            "KSampler",
            "KSampler",
            "sampling",
            "扩散采样（seed/steps/cfg/sampler/scheduler/denoise 与 ComfyUI 一致）",
            vec![
                InputSpec::required("model", InputKind::Handle("MODEL")),
                InputSpec::required("positive", InputKind::Handle("CONDITIONING")),
                InputSpec::required("negative", InputKind::Handle("CONDITIONING")),
                InputSpec::required("latent_image", InputKind::Handle("LATENT")),
                InputSpec::required("seed", InputKind::Int { min: 0, max: i64::MAX, default: 0 }),
                InputSpec::required("steps", InputKind::Int { min: 1, max: 200, default: 20 }),
                InputSpec::required("cfg", InputKind::Float { min: 0.0, max: 100.0, step: 0.1, default: 7.0 }),
                InputSpec::required("sampler_name", InputKind::Combo(SAMPLERS)),
                InputSpec::required("scheduler", InputKind::Combo(SCHEDULERS)),
                InputSpec::required("denoise", InputKind::Float { min: 0.0, max: 1.0, step: 0.01, default: 1.0 }),
            ],
            vec!["LATENT"],
            vec!["LATENT"]
        ),
        stub_node!(
            "VAEDecode",
            "VAE Decode",
            "latent",
            "latent 解码为像素",
            vec![
                InputSpec::required("samples", InputKind::Handle("LATENT")),
                InputSpec::required("vae", InputKind::Handle("VAE")),
            ],
            vec!["IMAGE"],
            vec!["IMAGE"]
        ),
        stub_node!(
            "VAEEncode",
            "VAE Encode",
            "latent",
            "像素编码为 latent",
            vec![
                InputSpec::required("pixels", InputKind::Image),
                InputSpec::required("vae", InputKind::Handle("VAE")),
            ],
            vec!["LATENT"],
            vec!["LATENT"]
        ),
    ]
}
