//! Process + health adapters. Kept behind a trait so the manager is testable
//! without spawning real model servers.
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::ServeSpec;

#[async_trait]
pub trait Host: Send + Sync {
    async fn spawn(
        &self,
        spec: &ServeSpec,
        args: &[String],
        env: &[(String, String)],
        log: &Path,
    ) -> anyhow::Result<u32>;
    async fn kill(&self, pid: u32);
    async fn alive(&self, pid: u32) -> bool;
    async fn probe(&self, url: &str) -> bool;
}

/// Production host: tokio process + HTTP health probe.
pub struct LocalHost {
    children: Mutex<HashMap<u32, Child>>,
    client: reqwest::Client,
}

impl LocalHost {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            children: Mutex::new(HashMap::new()),
            client: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .build()
                .expect("http client"),
        })
    }
}

#[async_trait]
impl Host for LocalHost {
    async fn spawn(
        &self,
        spec: &ServeSpec,
        args: &[String],
        env: &[(String, String)],
        log: &Path,
    ) -> anyhow::Result<u32> {
        if let Some(parent) = log.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let out = std::fs::OpenOptions::new().create(true).append(true).open(log)?;
        let err = out.try_clone()?;
        let mut command = Command::new(&spec.program);
        command
            .args(args)
            .envs(env.iter().map(|(k, v)| (k, v)))
            .stdin(Stdio::null())
            .stdout(Stdio::from(out))
            .stderr(Stdio::from(err))
            .kill_on_drop(true);
        if let Some(cwd) = &spec.cwd {
            command.current_dir(cwd);
        }
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW: model servers must not flash a console window.
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_NO_WINDOW);
        }
        let child = command.spawn()?;
        let pid = child.id().unwrap_or(0);
        self.children.lock().await.insert(pid, child);
        Ok(pid)
    }

    async fn kill(&self, pid: u32) {
        if let Some(mut child) = self.children.lock().await.remove(&pid) {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    async fn alive(&self, pid: u32) -> bool {
        let mut children = self.children.lock().await;
        match children.get_mut(&pid) {
            Some(child) => match child.try_wait() {
                Ok(None) => true,
                _ => {
                    children.remove(&pid);
                    false
                }
            },
            None => false,
        }
    }

    async fn probe(&self, url: &str) -> bool {
        match self.client.get(url).send().await {
            Ok(response) => response.status().is_success(),
            Err(_) => false,
        }
    }
}
