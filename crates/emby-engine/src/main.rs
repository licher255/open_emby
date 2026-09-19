//! emby-engine，open_emby 原生生成引擎。
//! 借鉴 ComfyUI 后端架构（PromptServer / PromptQueue / PromptExecutor / 节点注册表），
//! 纯 Rust 实现，由 Electron 主进程拉起，仅监听 127.0.0.1。

mod executor;
mod graph;
mod kmeans;
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

    // 目录布局对齐 ComfyUI：input / output / temp（挂在数据根下的 engine/ 子目录）
    let base = PathBuf::from(data_root).join("engine");
    let st = match state::AppState::new(base.clone()) {
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
        "[engine] emby-engine listening on http://{addr} (nodes: {}, base: {})",
        state::registry().len(),
        base.display()
    );
    if let Err(e) = axum::serve(listener, app).await {
        eprintln!("[engine] 服务退出: {e}");
        std::process::exit(1);
    }
}
