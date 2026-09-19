//! 全局状态 —— 对应 ComfyUI PromptServer 持有的队列 / 历史 / 事件总线 / 缓存。

use crate::queue::PromptQueue;
use crate::value::Value;
use serde_json::{json, Value as Json};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::sync::broadcast;

pub struct HistoryEntry {
    pub number: u64,
    pub prompt_id: String,
    pub prompt: Json,
    pub outputs: Json, // {node_id: {"images": [...]}}
    pub status: &'static str, // "success" | "error"
    pub messages: Vec<Json>,
}

pub struct HistoryStore {
    pub entries: HashMap<String, HistoryEntry>,
    pub order: VecDeque<String>,
    pub cap: usize,
}

impl HistoryStore {
    fn new() -> Self {
        Self { entries: HashMap::new(), order: VecDeque::new(), cap: 64 }
    }

    pub fn push(&mut self, e: HistoryEntry) {
        let id = e.prompt_id.clone();
        self.entries.insert(id.clone(), e);
        self.order.push_back(id);
        while self.order.len() > self.cap {
            if let Some(old) = self.order.pop_front() {
                self.entries.remove(&old);
            }
        }
    }
}

pub struct AppState {
    pub input_dir: PathBuf,
    pub output_dir: PathBuf,
    pub temp_dir: PathBuf,
    /// WS 事件总线（status / executing / progress / executed / execution_*）
    pub events: broadcast::Sender<String>,
    pub queue: PromptQueue,
    pub history: Mutex<HistoryStore>,
    /// 跨 prompt 的节点输出缓存（ComfyUI classic cache）
    pub cache: Mutex<HashMap<String, Vec<Value>>>,
    pub save_counter: Arc<AtomicU64>,
}

impl AppState {
    pub fn new(base: PathBuf) -> std::io::Result<std::sync::Arc<Self>> {
        let input_dir = base.join("input");
        let output_dir = base.join("output");
        let temp_dir = base.join("temp");
        for d in [&input_dir, &output_dir, &temp_dir] {
            std::fs::create_dir_all(d)?;
        }
        let (events, _) = broadcast::channel(256);
        Ok(std::sync::Arc::new(Self {
            input_dir,
            output_dir,
            temp_dir,
            events,
            queue: PromptQueue::new(),
            history: Mutex::new(HistoryStore::new()),
            cache: Mutex::new(HashMap::new()),
            save_counter: Arc::new(AtomicU64::new(1)),
        }))
    }

    pub fn broadcast(&self, msg: Json) {
        // 没有 WS 订阅者时忽略发送错误
        let _ = self.events.send(msg.to_string());
    }

    /// ComfyUI "status" 事件
    pub fn broadcast_status(&self) {
        let remaining = self.queue.tasks_remaining();
        self.broadcast(json!({
            "type": "status",
            "data": { "status": { "exec_info": { "queue_remaining": remaining } } }
        }));
    }
}

static REGISTRY: OnceLock<std::collections::BTreeMap<&'static str, crate::node::NodeDef>> = OnceLock::new();

pub fn registry() -> &'static std::collections::BTreeMap<&'static str, crate::node::NodeDef> {
    REGISTRY.get_or_init(crate::nodes::build_registry)
}
