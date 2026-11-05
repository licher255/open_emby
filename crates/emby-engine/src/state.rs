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

/// Live state of one model installation (polled from /api/models/install/{job}).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatus {
    pub job: String,
    pub model_id: String,
    pub phase: String,
    pub file: String,
    pub file_index: usize,
    pub file_count: usize,
    pub received: u64,
    pub total: u64,
    pub message: String,
    pub done: bool,
    pub error: String,
}

pub struct AppState {
    pub input_dir: PathBuf,
    pub output_dir: PathBuf,
    pub temp_dir: PathBuf,
    /// Data root: models, harness artifacts and AI provider config live under it.
    pub data_root: PathBuf,
    /// WS 事件总线（status / executing / progress / executed / execution_*）
    pub events: broadcast::Sender<String>,
    pub queue: PromptQueue,
    pub history: Mutex<HistoryStore>,
    /// 跨 prompt 的节点输出缓存（ComfyUI classic cache）
    pub cache: Mutex<HashMap<String, Vec<Value>>>,
    pub save_counter: Arc<AtomicU64>,
    /// AI providers (cloud API / local runtime / built-in).
    pub providers: Mutex<Vec<crate::ai::Provider>>,
    /// Running and recently finished model installation jobs.
    pub installs: Mutex<HashMap<String, InstallStatus>>,
    /// Model server launcher: lifecycle, health and idle eviction.
    pub runtime: std::sync::Arc<emby_runtime::ServerManager>,
    pub harness_slots: tokio::sync::Semaphore,
    pub harness_cancels: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
    pub harness_failures: Mutex<HashMap<String, crate::harness::jobs::Job>>,
    pub harness_progress: Mutex<HashMap<String, crate::harness::jobs::JobProgress>>,
}

impl AppState {
    pub fn new(data_root: PathBuf) -> std::io::Result<std::sync::Arc<Self>> {
        let base = data_root.join("engine");
        let input_dir = base.join("input");
        let output_dir = base.join("output");
        let temp_dir = base.join("temp");
        for d in [&input_dir, &output_dir, &temp_dir] {
            std::fs::create_dir_all(d)?;
        }
        crate::models::ensure_dirs(&data_root)?;
        crate::harness::jobs::recover(&data_root).map_err(std::io::Error::other)?;
        let providers = crate::ai::load_providers(&data_root);
        let (events, _) = broadcast::channel(256);
        Ok(std::sync::Arc::new(Self {
            input_dir,
            output_dir,
            temp_dir,
            data_root,
            events,
            queue: PromptQueue::new(),
            history: Mutex::new(HistoryStore::new()),
            cache: Mutex::new(HashMap::new()),
            save_counter: Arc::new(AtomicU64::new(1)),
            providers: Mutex::new(providers),
            installs: Mutex::new(HashMap::new()),
            harness_slots: tokio::sync::Semaphore::new(1),
            harness_cancels: Mutex::new(HashMap::new()),
            harness_failures: Mutex::new(HashMap::new()),
            harness_progress: Mutex::new(HashMap::new()),
            runtime: emby_runtime::ServerManager::new(
                emby_runtime::LocalHost::new(),
                emby_runtime::ManagerConfig::default(),
                base.join("runtime"),
            ),
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
