//! emby-engine，open_emby 原生生成引擎。
//! 借鉴 ComfyUI 后端架构（PromptServer / PromptQueue / PromptExecutor / 节点注册表），
//! 纯 Rust 实现，由 Electron 主进程拉起，仅监听 127.0.0.1。

mod ai;
mod api;
mod executor;
mod graph;
mod harness;
mod models;
mod kmeans;
mod runtime_spec;
mod node;
mod nodes;
mod queue;
mod server;
mod state;
mod value;

use std::path::PathBuf;

fn arg_value(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1))
        .cloned()
}

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = arg_value(&args, "--port")
        .or_else(|| std::env::var("OPEN_EMBY_ENGINE_PORT").ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(8189);
    let host = arg_value(&args, "--host").unwrap_or_else(|| "127.0.0.1".to_string());
    let data_root = arg_value(&args, "--data-root")
        .or_else(|| std::env::var("OPEN_EMBY_DATA_ROOT").ok())
        .unwrap_or_else(|| "E:\\Project-刺绣机".to_string());

    // engine/input, engine/output and engine/temp are the node-graph work dirs;
    // models/ and engine/ai/ belong to the model layer and the AI gateway.
    let root = PathBuf::from(&data_root);
    let base = root.join("engine");
    let st = match state::AppState::new(root) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[engine] 初始化目录失败 {}: {e}", base.display());
            std::process::exit(1);
        }
    };

    // prompt worker（单并发，对齐 ComfyUI 串行执行语义）
    {
        let st = st.clone();
        tokio::spawn(async move { executor::worker(st).await });
    }

    // Idle reaper: stop model servers that have not been used for a while so
    // their VRAM is released without a manual stop.
    {
        let st = st.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                for model in st.runtime.reap_idle(now).await {
                    st.broadcast(serde_json::json!({
                        "type": "runtime.server",
                        "data": { "modelId": model, "phase": "stopped" }
                    }));
                }
            }
        });
    }

    let app = server::router(st);
    let addr = format!("{host}:{port}");
    let listener = match tokio::net::TcpListener::bind(&addr).await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[engine] 绑定 {addr} 失败: {e}");
            std::process::exit(1);
        }
    };
    println!(
        "[engine] emby-engine listening on http://{addr} (nodes: {}, base: {}, ai: {})",
        state::registry().len(),
        base.display(),
        "providers+models"
    );
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[engine] 服务退出: {e}");
        std::process::exit(1);
    }
}
