//! 节点间传递的值。对齐 ComfyUI 的类型化链路（IMAGE / MODEL / CLIP / VAE / LATENT / CONDITIONING），
//! 当前版本图像在内存中以 Arc<RgbImage> 流转；模型句柄为 candle 推理后端预留的占位类型。

use image::RgbImage;
use std::sync::Arc;

#[derive(Clone)]
pub enum Value {
    Image(Arc<RgbImage>),
    Int(i64),
    Float(f64),
    Str(String),
    /// widget 布尔值透传（如 SaveImage 的选项），当前节点未消费
    #[allow(dead_code)]
    Bool(bool),
    /// 模型推理句柄占位（MODEL/CLIP/VAE/LATENT/CONDITIONING 等），candle 后端落地后承载真实权重
    #[allow(dead_code)]
    Handle(Arc<ModelHandle>),
}

/// candle 后端落地后由模型节点构造与消费；当前仅作为类型占位
#[allow(dead_code)]
#[derive(Debug)]
pub struct ModelHandle {
    pub kind: &'static str,
    pub desc: String,
}

impl Value {
    /// 从 ComfyUI prompt JSON 字面量构造（链接不在此解析）
    pub fn from_json(v: &serde_json::Value) -> Option<Value> {
        match v {
            serde_json::Value::Bool(b) => Some(Value::Bool(*b)),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Some(Value::Int(i))
                } else {
                    n.as_f64().map(Value::Float)
                }
            }
            serde_json::Value::String(s) => Some(Value::Str(s.clone())),
            _ => None,
        }
    }

    pub fn as_image(&self) -> anyhow::Result<Arc<RgbImage>> {
        match self {
            Value::Image(img) => Ok(img.clone()),
            _ => anyhow::bail!("期望 IMAGE 输入，实际为 {}", self.type_name()),
        }
    }

    pub fn as_int(&self) -> anyhow::Result<i64> {
        match self {
            Value::Int(i) => Ok(*i),
            Value::Float(f) => Ok(f.round() as i64),
            _ => anyhow::bail!("期望 INT 输入，实际为 {}", self.type_name()),
        }
    }

    /// KSampler 等模型节点落地后使用（cfg/denoise）
    #[allow(dead_code)]
    pub fn as_float(&self) -> anyhow::Result<f64> {
        match self {
            Value::Int(i) => Ok(*i as f64),
            Value::Float(f) => Ok(*f),
            _ => anyhow::bail!("期望 FLOAT 输入，实际为 {}", self.type_name()),
        }
    }

    pub fn as_str(&self) -> anyhow::Result<&str> {
        match self {
            Value::Str(s) => Ok(s),
            _ => anyhow::bail!("期望 STRING 输入，实际为 {}", self.type_name()),
        }
    }

    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Image(_) => "IMAGE",
            Value::Int(_) => "INT",
            Value::Float(_) => "FLOAT",
            Value::Str(_) => "STRING",
            Value::Bool(_) => "BOOL",
            Value::Handle(h) => h.kind,
        }
    }
}
