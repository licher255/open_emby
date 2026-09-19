//! 节点定义与注册表 —— 对齐 ComfyUI 的 NODE_CLASS_MAPPINGS 模型：
//! 每个节点声明输入规格（类型 + widget 默认值）、输出类型列表、是否输出节点，
//! 并可通过 /object_info 被前端内省（ComfyUI 前端据此渲染节点，我们的 UI 同样消费它）。

use crate::value::Value;
use serde_json::{json, Value as Json};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Arc;

/// 节点执行上下文：目录、计数器、中断旗标、进度回调（对齐 ComfyUI 的 PromptServer 注入物）
pub struct NodeCtx {
    pub input_dir: PathBuf,
    pub output_dir: PathBuf,
    pub temp_dir: PathBuf,
    pub save_counter: Arc<AtomicU64>,
    pub interrupt: Arc<AtomicBool>,
    /// (value, max) -> broadcast "progress" WS 事件
    pub progress: Arc<dyn Fn(u64, u64) + Send + Sync>,
}

impl NodeCtx {
    pub fn interrupted(&self) -> bool {
        self.interrupt.load(std::sync::atomic::Ordering::Relaxed)
    }
}

#[derive(Clone)]
pub enum InputKind {
    /// IMAGE 链路输入
    Image,
    /// 模型类链路输入（MODEL/CLIP/VAE/LATENT/CONDITIONING...）
    Handle(&'static str),
    Int { min: i64, max: i64, default: i64 },
    Float { min: f64, max: f64, step: f64, default: f64 },
    Text { multiline: bool, default: &'static str },
    Combo(&'static [&'static str]),
}

impl InputKind {
    pub fn default_value(&self) -> Option<Value> {
        match self {
            InputKind::Int { default, .. } => Some(Value::Int(*default)),
            InputKind::Float { default, .. } => Some(Value::Float(*default)),
            InputKind::Text { default, .. } => Some(Value::Str((*default).to_string())),
            InputKind::Combo(opts) => opts.first().map(|s| Value::Str((*s).to_string())),
            _ => None,
        }
    }

    /// /object_info 中的输入声明，格式与 ComfyUI 完全一致
    pub fn object_info(&self) -> Json {
        match self {
            InputKind::Image => json!(["IMAGE"]),
            InputKind::Handle(k) => json!([k]),
            InputKind::Int { min, max, default } => json!(["INT", {"min": min, "max": max, "default": default}]),
            InputKind::Float { min, max, step, default } => {
                json!(["FLOAT", {"min": min, "max": max, "step": step, "default": default}])
            }
            InputKind::Text { multiline, default } => {
                json!(["STRING", {"multiline": multiline, "default": default}])
            }
            InputKind::Combo(opts) => json!([opts]),
        }
    }
}

pub struct InputSpec {
    pub name: &'static str,
    pub kind: InputKind,
    pub optional: bool,
}

impl InputSpec {
    pub const fn required(name: &'static str, kind: InputKind) -> Self {
        Self { name, kind, optional: false }
    }
}

/// 节点执行结果：输出值 + 输出节点附加的 UI 数据（ComfyUI 的 "ui" 返回键）
pub struct NodeRun {
    pub outputs: Vec<Value>,
    pub ui: Json,
}

impl NodeRun {
    pub fn values(outputs: Vec<Value>) -> Self {
        Self { outputs, ui: Json::Null }
    }
}

pub struct NodeDef {
    pub class_type: &'static str,
    pub display_name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub inputs: Vec<InputSpec>,
    pub outputs: Vec<&'static str>,
    pub output_names: Vec<&'static str>,
    /// ComfyUI OUTPUT_NODE：无下游也会被调度（SaveImage/PreviewImage）
    pub output_node: bool,
    /// 不进跨 prompt 缓存（如 LoadImage 依赖磁盘文件状态）
    pub volatile: bool,
    pub run: fn(&NodeCtx, Vec<Value>) -> anyhow::Result<NodeRun>,
}

impl NodeDef {
    pub fn object_info(&self) -> Json {
        let mut required = serde_json::Map::new();
        let mut optional = serde_json::Map::new();
        for spec in &self.inputs {
            let target = if spec.optional { &mut optional } else { &mut required };
            target.insert(spec.name.to_string(), spec.kind.object_info());
        }
        let mut input = serde_json::Map::new();
        input.insert("required".into(), Json::Object(required));
        if !optional.is_empty() {
            input.insert("optional".into(), Json::Object(optional));
        }
        json!({
            "input": input,
            "output": self.outputs.clone(),
            "output_is_list": self.outputs.iter().map(|_| false).collect::<Vec<_>>(),
            "output_name": self.output_names.clone(),
            "name": self.class_type,
            "display_name": self.display_name,
            "description": self.description,
            "category": self.category,
            "output_node": self.output_node,
        })
    }
}
