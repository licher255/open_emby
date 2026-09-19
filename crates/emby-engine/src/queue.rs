//! PromptQueue：对应 ComfyUI execution.py 的 PromptQueue。
//! FIFO 队列 + 单 worker 串行执行 + 中断旗标 + 运行/排队快照。

use serde_json::Value as Json;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Clone)]
pub struct QueueItem {
    pub number: u64,
    pub prompt_id: String,
    pub prompt: Json,
    /// 预留：多客户端区分（ComfyUI 协议字段），当前单客户端暂不消费
    #[allow(dead_code)]
    pub client_id: Option<String>,
}

pub struct PromptQueue {
    pub pending: Mutex<VecDeque<QueueItem>>,
    pub running: Mutex<Option<QueueItem>>,
    pub interrupt: Arc<AtomicBool>,
    counter: AtomicU64,
    notify: mpsc::UnboundedSender<()>,
    pub rx: Mutex<Option<mpsc::UnboundedReceiver<()>>>,
}

impl PromptQueue {
    pub fn new() -> Self {
        let (notify, rx) = mpsc::unbounded_channel();
        Self {
            pending: Mutex::new(VecDeque::new()),
            running: Mutex::new(None),
            interrupt: Arc::new(AtomicBool::new(false)),
            counter: AtomicU64::new(1),
            notify,
            rx: Mutex::new(Some(rx)),
        }
    }

    pub fn enqueue(&self, prompt: Json, client_id: Option<String>) -> (u64, String) {
        let number = self.counter.fetch_add(1, Ordering::Relaxed);
        let prompt_id = uuid::Uuid::new_v4().to_string();
        let item = QueueItem { number, prompt_id: prompt_id.clone(), prompt, client_id };
        self.pending.lock().unwrap().push_back(item);
        let _ = self.notify.send(());
        (number, prompt_id)
    }

    pub fn pop_next(&self) -> Option<QueueItem> {
        let item = self.pending.lock().unwrap().pop_front();
        *self.running.lock().unwrap() = item.clone();
        item
    }

    pub fn finish_current(&self) {
        *self.running.lock().unwrap() = None;
    }

    pub fn tasks_remaining(&self) -> usize {
        let n = self.pending.lock().unwrap().len();
        n + if self.running.lock().unwrap().is_some() { 1 } else { 0 }
    }

    /// ComfyUI /queue 响应格式：五元组 [number, prompt_id, prompt, extra_data, outputs]
    pub fn snapshot(&self) -> Json {
        fn tuple(it: &QueueItem) -> Json {
            serde_json::json!([it.number, it.prompt_id, it.prompt, {}, []])
        }
        let running: Vec<Json> = self.running.lock().unwrap().iter().map(tuple).collect();
        let pending: Vec<Json> = self.pending.lock().unwrap().iter().map(tuple).collect();
        serde_json::json!({ "queue_running": running, "queue_pending": pending })
    }
}
