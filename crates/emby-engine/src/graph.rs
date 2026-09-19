//! Prompt 图解析与拓扑排序，对应 ComfyUI comfy_execution/graph.py 的
//! DynamicPrompt + TopologicalSort：只调度从输出节点反向可达的子图。

use crate::node::NodeDef;
use anyhow::{anyhow, bail};
use serde_json::Value as Json;
use std::collections::{BTreeMap, HashMap};

#[derive(Debug, Clone)]
pub enum InputRef {
    /// ["node_id", output_slot]
    Link { node: String, slot: usize },
    Literal(Json),
}

#[derive(Debug)]
pub struct PromptNode {
    pub id: String,
    pub class_type: String,
    pub inputs: BTreeMap<String, InputRef>,
}

pub struct Graph {
    pub nodes: HashMap<String, PromptNode>,
    /// 拓扑序（仅含从输出节点反向可达的节点）
    pub order: Vec<String>,
}

impl Graph {
    pub fn parse(prompt: &Json, registry: &BTreeMap<&'static str, NodeDef>) -> anyhow::Result<Graph> {
        let obj = prompt
            .as_object()
            .ok_or_else(|| anyhow!("prompt 必须是 节点id -> 节点定义 的对象"))?;
        let mut nodes: HashMap<String, PromptNode> = HashMap::new();
        let mut errors: Vec<String> = Vec::new();

        for (id, def) in obj {
            let class_type = def
                .get("class_type")
                .and_then(Json::as_str)
                .unwrap_or_default()
                .to_string();
            if !registry.contains_key(class_type.as_str()) {
                errors.push(format!("节点 {id}: 未知节点类型 '{class_type}'"));
                continue;
            }
            let mut inputs = BTreeMap::new();
            if let Some(inp) = def.get("inputs").and_then(Json::as_object) {
                for (name, v) in inp {
                    // ComfyUI 链接语法：[上游节点id, 输出槽位]
                    if let Some(arr) = v.as_array() {
                        if arr.len() == 2 && arr[0].is_string() && arr[1].is_number() {
                            inputs.insert(
                                name.clone(),
                                InputRef::Link {
                                    node: arr[0].as_str().unwrap().to_string(),
                                    slot: arr[1].as_u64().unwrap_or(0) as usize,
                                },
                            );
                            continue;
                        }
                    }
                    inputs.insert(name.clone(), InputRef::Literal(v.clone()));
                }
            }
            nodes.insert(id.clone(), PromptNode { id: id.clone(), class_type, inputs });
        }

        for node in nodes.values() {
            for (name, r) in &node.inputs {
                if let InputRef::Link { node: dep, .. } = r {
                    if !nodes.contains_key(dep) {
                        errors.push(format!("节点 {}: 输入 {name} 链接到不存在的节点 {dep}", node.id));
                    }
                }
            }
        }
        if !errors.is_empty() {
            bail!(errors.join("; "));
        }

        // 输出节点 = 注册表中标记 output_node 的节点（ComfyUI OUTPUT_NODE 语义）
        let mut order = Vec::new();
        let mut state: HashMap<&str, u8> = HashMap::new(); // 0=未访问 1=栈中 2=完成
        let mut stack: Vec<&str> = Vec::new();
        let outputs: Vec<&str> = nodes
            .values()
            .filter(|n| registry[n.class_type.as_str()].output_node)
            .map(|n| n.id.as_str())
            .collect();
        if outputs.is_empty() {
            bail!("工作流没有输出节点（如 SaveImage / PreviewImage）");
        }
        for out in outputs {
            visit(out, &nodes, &mut state, &mut order, &mut stack)?;
        }
        Ok(Graph { nodes, order })
    }

    /// 节点缓存键：class_type + 规范化输入（链接递归展开为上游键），对齐 ComfyUI classic cache
    pub fn cache_key(&self, id: &str) -> String {
        let node = &self.nodes[id];
        let mut parts = vec![node.class_type.clone()];
        for (name, r) in &node.inputs {
            let v = match r {
                InputRef::Literal(j) => format!("{name}=lit:{}", canonical_json(j)),
                InputRef::Link { node: dep, slot } => {
                    format!("{name}=link:{}#{}", self.cache_key(dep), slot)
                }
            };
            parts.push(v);
        }
        parts.join("|")
    }
}

fn visit<'a>(
    id: &'a str,
    nodes: &'a HashMap<String, PromptNode>,
    state: &mut HashMap<&'a str, u8>,
    order: &mut Vec<String>,
    stack: &mut Vec<&'a str>,
) -> anyhow::Result<()> {
    match state.get(id).copied().unwrap_or(0) {
        2 => return Ok(()),
        1 => {
            let cycle: Vec<&str> = stack.iter().skip_while(|s| **s != id).copied().collect();
            bail!("工作流存在依赖环: {} -> {}", cycle.join(" -> "), id);
        }
        _ => {}
    }
    state.insert(id, 1);
    stack.push(id);
    for r in nodes[id].inputs.values() {
        if let InputRef::Link { node: dep, .. } = r {
            visit(dep.as_str(), nodes, state, order, stack)?;
        }
    }
    stack.pop();
    state.insert(id, 2);
    order.push(id.to_string());
    Ok(())
}

fn canonical_json(v: &Json) -> String {
    match v {
        Json::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .iter()
                .map(|k| format!("\"{k}\":{}", canonical_json(&m[*k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        Json::Array(a) => format!(
            "[{}]",
            a.iter().map(canonical_json).collect::<Vec<_>>().join(",")
        ),
        other => other.to_string(),
    }
}
