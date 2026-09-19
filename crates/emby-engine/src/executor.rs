//! PromptExecutor：对应 ComfyUI execution.py 的 PromptExecutor。
//! 按拓扑序执行节点：解析输入（链接/字面量/默认值）、classic 缓存命中检查、
//! spawn_blocking 运行节点、广播 executing/progress/executed、写入 history。

use crate::graph::{Graph, InputRef};
use crate::node::NodeCtx;
use crate::queue::QueueItem;
use crate::state::{registry, AppState, HistoryEntry};
use crate::value::Value;
use serde_json::{json, Map as JsonMap, Value as Json};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

/// worker 主循环：对应 ComfyUI 后台的 prompt_worker
pub async fn worker(st: Arc<AppState>) {
    let mut rx = st.queue.rx.lock().unwrap().take().expect("worker 只能启动一次");
    while rx.recv().await.is_some() {
        while let Some(item) = st.queue.pop_next() {
            st.queue.interrupt.store(false, Ordering::Relaxed);
            let entry = execute_prompt(&st, item).await;
            st.history.lock().unwrap().push(entry);
            st.queue.finish_current();
            st.broadcast_status();
        }
    }
}

fn fail_entry(st: &Arc<AppState>, item: &QueueItem, msg: String) -> HistoryEntry {
    st.broadcast(json!({
        "type": "execution_error",
        "data": { "prompt_id": item.prompt_id, "node_id": null, "exception_message": msg }
    }));
    HistoryEntry {
        number: item.number,
        prompt_id: item.prompt_id.clone(),
        prompt: item.prompt.clone(),
        outputs: json!({}),
        status: "error",
        messages: vec![json!(["execution_error", { "exception_message": msg }])],
    }
}

async fn execute_prompt(st: &Arc<AppState>, item: QueueItem) -> HistoryEntry {
    let prompt_id = item.prompt_id.clone();
    st.broadcast(json!({
        "type": "execution_start",
        "data": { "prompt_id": prompt_id }
    }));

    let graph = match Graph::parse(&item.prompt, registry()) {
        Ok(g) => g,
        Err(e) => return fail_entry(st, &item, e.to_string()),
    };

    // 本 run 的节点输出（node_id -> outputs）；缓存命中的也填进来供下游解析
    let mut run_outputs: HashMap<String, Vec<Value>> = HashMap::new();
    let mut ui_outputs = JsonMap::new();

    for node_id in &graph.order {
        if st.queue.interrupt.load(Ordering::Relaxed) {
            st.broadcast(json!({
                "type": "execution_interrupted",
                "data": { "prompt_id": prompt_id, "node_id": node_id }
            }));
            return HistoryEntry {
                number: item.number,
                prompt_id,
                prompt: item.prompt.clone(),
                outputs: Json::Object(ui_outputs),
                status: "error",
                messages: vec![json!(["execution_interrupted", { "node_id": node_id }])],
            };
        }

        let node = &graph.nodes[node_id];
        let def = &registry()[node.class_type.as_str()];
        st.broadcast(json!({
            "type": "executing",
            "data": { "node": node_id, "display_node": node_id, "prompt_id": prompt_id }
        }));

        // 缓存命中：跳过执行（ComfyUI 行为：命中缓存直接产出）
        let cache_key = graph.cache_key(node_id);
        if !def.volatile {
            let hit = st.cache.lock().unwrap().get(&cache_key).cloned();
            if let Some(outputs) = hit {
                run_outputs.insert(node_id.clone(), outputs);
                continue;
            }
        }

        // 解析输入：链接取上游输出槽位；字面量转 Value；缺失用 widget 默认值
        let mut args: Vec<Value> = Vec::with_capacity(def.inputs.len());
        let mut input_err: Option<String> = None;
        for spec in &def.inputs {
            let v = match node.inputs.get(spec.name) {
                Some(InputRef::Link { node: dep, slot }) => {
                    match run_outputs.get(dep).and_then(|o| o.get(*slot)) {
                        Some(v) => v.clone(),
                        None => {
                            input_err = Some(format!(
                                "节点 {}: 输入 {} 的上游 {dep}#{slot} 没有输出",
                                node.id, spec.name
                            ));
                            break;
                        }
                    }
                }
                Some(InputRef::Literal(j)) => match Value::from_json(j) {
                    Some(v) => v,
                    None => {
                        input_err = Some(format!("节点 {}: 输入 {} 的字面量类型不支持", node.id, spec.name));
                        break;
                    }
                },
                None => match spec.kind.default_value() {
                    Some(v) => v,
                    None => {
                        input_err = Some(format!("节点 {}: 缺少必填输入 {}", node.id, spec.name));
                        break;
                    }
                },
            };
            args.push(v);
        }
        if let Some(msg) = input_err {
            return fail_entry(st, &item, msg);
        }

        let ctx = NodeCtx {
            input_dir: st.input_dir.clone(),
            output_dir: st.output_dir.clone(),
            temp_dir: st.temp_dir.clone(),
            save_counter: st.save_counter.clone(),
            interrupt: st.queue.interrupt.clone(),
            progress: {
                let st = st.clone();
                let pid = prompt_id.clone();
                let nid = node_id.clone();
                Arc::new(move |value: u64, max: u64| {
                    st.broadcast(json!({
                        "type": "progress",
                        "data": { "value": value, "max": max, "prompt_id": pid, "node": nid }
                    }));
                })
            },
        };

        let run_fn = def.run;
        let result = tokio::task::spawn_blocking(move || run_fn(&ctx, args)).await;
        let node_run = match result {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => return fail_entry(st, &item, format!("节点 {node_id} ({}): {e:#}", node.class_type)),
            Err(e) => return fail_entry(st, &item, format!("节点 {node_id} 执行线程崩溃: {e}")),
        };

        // 输出节点的 ui 数据（SaveImage 的 images 列表）进入 history 与 executed 事件
        if !node_run.ui.is_null() {
            ui_outputs.insert(node_id.clone(), node_run.ui.clone());
            st.broadcast(json!({
                "type": "executed",
                "data": {
                    "node": node_id,
                    "display_node": node_id,
                    "output": node_run.ui,
                    "prompt_id": prompt_id
                }
            }));
        }

        run_outputs.insert(node_id.clone(), node_run.outputs.clone());
        if !def.volatile {
            st.cache.lock().unwrap().insert(cache_key, node_run.outputs);
        }
    }

    st.broadcast(json!({
        "type": "executing",
        "data": { "node": null, "prompt_id": prompt_id }
    }));
    st.broadcast(json!({
        "type": "execution_success",
        "data": { "prompt_id": prompt_id }
    }));
    HistoryEntry {
        number: item.number,
        prompt_id,
        prompt: item.prompt.clone(),
        outputs: Json::Object(ui_outputs),
        status: "success",
        messages: vec![],
    }
}
