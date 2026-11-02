//! emby-runtime: the model service launcher.
//!
//! It owns the lifecycle of model servers (start, health, stop, idle eviction)
//! and nothing else. Tensor work belongs to a backend (native or external);
//! the launcher only guarantees that a model is reachable at a stable URL.
//!
//! Everything is behind the `Host` trait so lifecycle logic is unit-tested with
//! a mock instead of spawning real model binaries.
pub mod device;
pub mod host;

pub use host::{Host, LocalHost};

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// How to launch one model server. `{port}` is substituted in args, env values
/// and the health URL; model paths are baked in by the caller.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServeSpec {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    #[serde(default)]
    pub cwd: Option<String>,
    pub health_url: String,
    #[serde(default = "default_ready")]
    pub ready_timeout_secs: u64,
    #[serde(default = "default_idle")]
    pub idle_timeout_secs: u64,
    /// 0 lets the manager allocate a free port from its range.
    #[serde(default)]
    pub port: u16,
}

fn default_ready() -> u64 { 120 }
fn default_idle() -> u64 { 900 }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Starting,
    Ready,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub model_id: String,
    pub phase: Phase,
    pub pid: Option<u32>,
    pub port: u16,
    pub health_url: String,
    pub started_at: u64,
    pub last_used: u64,
    pub active_requests: usize,
    pub restarts: u32,
    pub error: Option<String>,
    pub log_path: String,
}

struct Entry {
    spec: ServeSpec,
    phase: Phase,
    pid: Option<u32>,
    port: u16,
    health_url: String,
    started_at: u64,
    usage: Arc<Usage>,
    restarts: u32,
    error: Option<String>,
    log_path: String,
}

#[derive(Default)]
struct Usage {
    active: AtomicUsize,
    last_used: AtomicU64,
}

/// Pins one server generation until the request finishes, fails or is cancelled.
pub struct RequestLease {
    pub server: ServerStatus,
    usage: Arc<Usage>,
}

impl Drop for RequestLease {
    fn drop(&mut self) {
        self.usage.last_used.store(now_secs(), Ordering::SeqCst);
        self.usage.active.fetch_sub(1, Ordering::SeqCst);
    }
}

impl Entry {
    fn status(&self, model_id: &str) -> ServerStatus {
        ServerStatus {
            model_id: model_id.to_string(),
            phase: self.phase,
            pid: self.pid,
            port: self.port,
            health_url: self.health_url.clone(),
            started_at: self.started_at,
            last_used: self.usage.last_used.load(Ordering::SeqCst),
            active_requests: self.usage.active.load(Ordering::SeqCst),
            restarts: self.restarts,
            error: self.error.clone(),
            log_path: self.log_path.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ManagerConfig {
    pub port_start: u16,
    pub port_end: u16,
    pub idle_timeout_secs: u64,
}

impl Default for ManagerConfig {
    fn default() -> Self {
        Self { port_start: 8200, port_end: 8299, idle_timeout_secs: 900 }
    }
}

pub struct ServerManager {
    host: Arc<dyn Host>,
    entries: Mutex<BTreeMap<String, Entry>>,
    config: ManagerConfig,
    log_dir: PathBuf,
}

fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn render(template: &str, port: u16) -> String {
    template.replace("{port}", &port.to_string())
}

impl ServerManager {
    pub fn new(host: Arc<dyn Host>, config: ManagerConfig, log_dir: PathBuf) -> Arc<Self> {
        Arc::new(Self { host, entries: Mutex::new(BTreeMap::new()), config, log_dir })
    }

    pub async fn list(&self) -> Vec<ServerStatus> {
        let entries = self.entries.lock().await;
        entries.iter().map(|(id, entry)| entry.status(id)).collect()
    }

    pub async fn get(&self, model_id: &str) -> Option<ServerStatus> {
        let entries = self.entries.lock().await;
        entries.get(model_id).map(|entry| entry.status(model_id))
    }

    /// Start a model server and wait until its health endpoint answers.
    /// Idempotent while a server is starting or ready.
    pub async fn start(self: &Arc<Self>, model_id: &str, spec: ServeSpec) -> anyhow::Result<ServerStatus> {
        // The supervisor owns startup even when the HTTP caller disconnects.
        let manager = self.clone();
        let model_id = model_id.to_string();
        tokio::spawn(async move { manager.start_inner(&model_id, spec).await }).await?
    }

    async fn start_inner(&self, model_id: &str, spec: ServeSpec) -> anyhow::Result<ServerStatus> {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.get(model_id) {
            if entry.phase == Phase::Ready && self.host.alive(entry.pid.unwrap_or(0)).await {
                return Ok(entry.status(model_id));
            }
            if entry.phase == Phase::Starting {
                let generation = entry.restarts;
                drop(entries);
                loop {
                    let status = self.get(model_id).await.expect("registered server");
                    if status.restarts != generation {
                        anyhow::bail!("model server was restarted during startup");
                    }
                    match status.phase {
                        Phase::Ready => return Ok(status),
                        Phase::Starting => tokio::time::sleep(Duration::from_millis(50)).await,
                        _ => anyhow::bail!("model server startup ended: {:?}: {:?}", status.phase, status.error),
                    }
                }
            }
        }

        let used: HashSet<u16> = entries
            .values()
            .filter(|entry| matches!(entry.phase, Phase::Starting | Phase::Ready))
            .map(|entry| entry.port)
            .collect();
        let port = if spec.port > 0 {
            spec.port
        } else {
            (self.config.port_start..=self.config.port_end)
                .find(|port| !used.contains(port) && port_free(*port))
                .ok_or_else(|| anyhow::anyhow!("no free port in {}..={}", self.config.port_start, self.config.port_end))?
        };

        let args: Vec<String> = spec.args.iter().map(|arg| render(arg, port)).collect();
        let env: Vec<(String, String)> = spec.env.iter().map(|(k, v)| (k.clone(), render(v, port))).collect();
        let health_url = render(&spec.health_url, port);
        let log_path = self.log_dir.join(format!("{}.log", model_id.replace(['/', '\\'], "-")));
        let restarts = entries.get(model_id).map(|entry| entry.restarts + 1).unwrap_or(0);

        let pid = self.host.spawn(&spec, &args, &env, &log_path).await?;
        let now = now_secs();
        entries.insert(model_id.to_string(), Entry {
            spec,
            phase: Phase::Starting,
            pid: Some(pid),
            port,
            health_url: health_url.clone(),
            started_at: now,
            usage: Arc::new(Usage { active: AtomicUsize::new(0), last_used: AtomicU64::new(now) }),
            restarts,
            error: None,
            log_path: log_path.to_string_lossy().to_string(),
        });
        let ready_timeout = status_ready_timeout(&entries, model_id, 120);
        drop(entries);

        let deadline = Instant::now() + Duration::from_secs(ready_timeout);
        loop {
            let healthy = self.host.probe(&health_url).await;
            {
                let mut entries = self.entries.lock().await;
                let entry = entries.get_mut(model_id).expect("registered server");
                if entry.restarts != restarts || entry.pid != Some(pid) || entry.phase != Phase::Starting {
                    anyhow::bail!("model server startup was stopped or superseded");
                }
                if healthy {
                    entry.phase = Phase::Ready;
                    entry.usage.last_used.store(now_secs(), Ordering::SeqCst);
                    return Ok(entry.status(model_id));
                }
            }
            if !self.host.alive(pid).await {
                self.fail(model_id, pid, restarts, "process exited during startup").await;
                anyhow::bail!("model server exited before becoming healthy; see {}", log_path.display());
            }
            if Instant::now() >= deadline {
                self.fail(model_id, pid, restarts, "health check timed out").await;
                anyhow::bail!("model server did not become healthy within {ready_timeout}s; see {}", log_path.display());
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    async fn fail(&self, model_id: &str, pid: u32, generation: u32, reason: &str) {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.get_mut(model_id) {
            if entry.restarts != generation || entry.pid != Some(pid) { return; }
            self.host.kill(pid).await;
            entry.phase = Phase::Failed;
            entry.pid = None;
            entry.error = Some(reason.to_string());
        }
    }

    pub async fn stop(&self, model_id: &str) -> anyhow::Result<ServerStatus> {
        let mut entries = self.entries.lock().await;
        let Some(entry) = entries.get_mut(model_id) else {
            anyhow::bail!("no server registered for {model_id}");
        };
        if let Some(pid) = entry.pid.take() {
            self.host.kill(pid).await;
        }
        entry.phase = Phase::Stopped;
        entry.usage.last_used.store(now_secs(), Ordering::SeqCst);
        Ok(entry.status(model_id))
    }

    pub async fn acquire(&self, model_id: &str) -> anyhow::Result<RequestLease> {
        let entries = self.entries.lock().await;
        let entry = entries.get(model_id).filter(|entry| entry.phase == Phase::Ready)
            .ok_or_else(|| anyhow::anyhow!("model server {model_id} is not ready"))?;
        entry.usage.active.fetch_add(1, Ordering::SeqCst);
        entry.usage.last_used.store(now_secs(), Ordering::SeqCst);
        Ok(RequestLease { server: entry.status(model_id), usage: entry.usage.clone() })
    }

    /// Refresh the last-used timestamp; called when a request is routed to the server.
    pub async fn touch(&self, model_id: &str) -> bool {
        let mut entries = self.entries.lock().await;
        match entries.get_mut(model_id) {
            Some(entry) if entry.phase == Phase::Ready => {
                entry.usage.last_used.store(now_secs(), Ordering::SeqCst);
                true
            }
            _ => false,
        }
    }

    /// Stop servers that have been idle longer than their configured timeout.
    pub async fn reap_idle(&self, now: u64) -> Vec<String> {
        // Check and stop under the same lock used by acquire/start/touch.
        let mut entries = self.entries.lock().await;
        let mut idle = Vec::new();
        for (id, entry) in entries.iter_mut() {
            let timeout = if entry.spec.idle_timeout_secs > 0 { entry.spec.idle_timeout_secs } else { self.config.idle_timeout_secs };
            if entry.phase != Phase::Ready || entry.usage.active.load(Ordering::SeqCst) > 0
                || now.saturating_sub(entry.usage.last_used.load(Ordering::SeqCst)) < timeout {
                continue;
            }
            if let Some(pid) = entry.pid.take() { self.host.kill(pid).await; }
            entry.phase = Phase::Stopped;
            idle.push(id.clone());
        }
        idle
    }
}

fn status_ready_timeout(entries: &BTreeMap<String, Entry>, model_id: &str, fallback: u64) -> u64 {
    entries.get(model_id)
        .map(|entry| if entry.spec.ready_timeout_secs > 0 { entry.spec.ready_timeout_secs } else { fallback })
        .unwrap_or(fallback)
}
