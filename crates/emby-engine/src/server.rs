//! HTTP + WebSocket 服务层，对应 ComfyUI server.py 的 PromptServer。
//! 路由与 ComfyUI API 对齐：/prompt /queue /history /view /upload/image /object_info /ws，
//! 既有 ComfyUI 生态工具与我们的 Electron 主进程可以零差别对接。

use crate::graph::Graph;
use crate::state::{registry, AppState};
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{DefaultBodyLimit, Multipart, Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value as JsonV};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;

pub fn router(st: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(root))
        .route("/health", get(health))
        .route("/system_stats", get(system_stats))
        .route("/object_info", get(object_info))
        .route("/object_info/{class_type}", get(object_info_one))
        .route("/prompt", post(post_prompt))
        .route("/queue", get(get_queue))
        .route("/interrupt", post(interrupt))
        .route("/history", get(history_all))
        .route("/history/{prompt_id}", get(history_one))
        .route("/view", get(view))
        .route("/upload/image", post(upload_image))
        .route("/ws", get(ws_handler))
        .layer(DefaultBodyLimit::max(128 * 1024 * 1024))
        .with_state(st)
}

async fn root() -> Json<JsonV> {
    Json(json!({
        "service": "emby-engine",
        "version": env!("CARGO_PKG_VERSION"),
        "architecture": "comfyui-compatible node graph executor (rust)",
        "nodes": registry().len(),
    }))
}

async fn health() -> Json<JsonV> {
    Json(json!({ "ok": true, "service": "emby-engine", "version": env!("CARGO_PKG_VERSION") }))
}

async fn system_stats() -> Json<JsonV> {
    Json(json!({
        "system": {
            "os": std::env::consts::OS,
            "runtime": "rust",
            "runtime_version": env!("CARGO_PKG_VERSION"),
            "engine": "emby-engine",
            "embedded_python": false,
        },
        "devices": [],
    }))
}

async fn object_info() -> Json<JsonV> {
    let map: serde_json::Map<String, JsonV> =
        registry().iter().map(|(k, v)| (k.to_string(), v.object_info())).collect();
    Json(JsonV::Object(map))
}

async fn object_info_one(Path(class_type): Path<String>) -> Response {
    match registry().get(class_type.as_str()) {
        Some(def) => Json(json!({ class_type: def.object_info() })).into_response(),
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": "unknown node" }))).into_response(),
    }
}

/// POST /prompt，兼容 ComfyUI：body 可以是 {"prompt": {...}, "client_id": "..."} 或裸节点图
async fn post_prompt(State(st): State<Arc<AppState>>, Json(body): Json<JsonV>) -> Response {
    let (prompt, client_id) = if body.get("prompt").is_some() {
        (
            body["prompt"].clone(),
            body.get("client_id").and_then(JsonV::as_str).map(String::from),
        )
    } else {
        (body, None)
    };
    // 提交前完整校验（ComfyUI 语义：node_errors 随响应返回）
    if let Err(e) = Graph::parse(&prompt, registry()) {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": { "type": "invalid_prompt", "message": e.to_string() },
                "node_errors": {},
            })),
        )
            .into_response();
    }
    let (number, prompt_id) = st.queue.enqueue(prompt, client_id);
    st.broadcast_status();
    Json(json!({ "prompt_id": prompt_id, "number": number, "node_errors": {} })).into_response()
}

async fn get_queue(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    Json(st.queue.snapshot())
}

async fn interrupt(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    st.queue.interrupt.store(true, Ordering::Relaxed);
    Json(json!({ "ok": true }))
}

fn history_entry_json(e: &crate::state::HistoryEntry) -> JsonV {
    json!({
        "prompt": [e.number, e.prompt_id, e.prompt, {}, []],
        "outputs": e.outputs,
        "status": {
            "status_str": e.status,
            "completed": e.status == "success",
            "messages": e.messages,
        },
    })
}

async fn history_all(State(st): State<Arc<AppState>>) -> Json<JsonV> {
    let h = st.history.lock().unwrap();
    let mut map = serde_json::Map::new();
    for id in &h.order {
        if let Some(e) = h.entries.get(id) {
            map.insert(id.clone(), history_entry_json(e));
        }
    }
    Json(JsonV::Object(map))
}

async fn history_one(State(st): State<Arc<AppState>>, Path(prompt_id): Path<String>) -> Json<JsonV> {
    let h = st.history.lock().unwrap();
    match h.entries.get(&prompt_id) {
        Some(e) => Json(json!({ prompt_id: history_entry_json(e) })),
        None => Json(json!({})),
    }
}

/// GET /view?filename=&subfolder=&type=output|input|temp，对齐 ComfyUI
async fn view(State(st): State<Arc<AppState>>, Query(q): Query<HashMap<String, String>>) -> Response {
    let filename = q.get("filename").cloned().unwrap_or_default();
    let subfolder = q.get("subfolder").cloned().unwrap_or_default();
    // 防目录穿越
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') || subfolder.contains("..") {
        return (StatusCode::BAD_REQUEST, "invalid path").into_response();
    }
    let base = match q.get("type").map(String::as_str) {
        Some("input") => &st.input_dir,
        Some("temp") => &st.temp_dir,
        _ => &st.output_dir,
    };
    let path = base.join(&subfolder).join(&filename);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "not found").into_response(),
    };
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        _ => "application/octet-stream",
    };
    ([(header::CONTENT_TYPE, mime)], bytes).into_response()
}

/// POST /upload/image，对齐 ComfyUI multipart 上传（字段 image，带 filename）
async fn upload_image(State(st): State<Arc<AppState>>, mut mp: Multipart) -> Response {
    while let Ok(Some(field)) = mp.next_field().await {
        let Some(file_name) = field.file_name().map(String::from) else { continue };
        let safe = match std::path::Path::new(&file_name).file_name() {
            Some(n) => n.to_string_lossy().to_string(),
            None => continue,
        };
        let Ok(bytes) = field.bytes().await else { continue };
        let dest = st.input_dir.join(&safe);
        match std::fs::write(&dest, &bytes) {
            Ok(()) => {
                return Json(json!({ "name": safe, "subfolder": "", "type": "input" })).into_response()
            }
            Err(e) => {
                return (StatusCode::INTERNAL_SERVER_ERROR, format!("写入失败: {e}")).into_response()
            }
        }
    }
    (StatusCode::BAD_REQUEST, "multipart 中未找到文件字段").into_response()
}

async fn ws_handler(State(st): State<Arc<AppState>>, ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(move |sock| ws_loop(sock, st))
}

async fn ws_loop(mut sock: WebSocket, st: Arc<AppState>) {
    let mut rx = st.events.subscribe();
    // 连接即推一次队列状态（ComfyUI 行为）
    let status = json!({
        "type": "status",
        "data": { "status": { "exec_info": { "queue_remaining": st.queue.tasks_remaining() } } }
    });
    if sock.send(Message::Text(status.to_string().into())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            ev = rx.recv() => {
                match ev {
                    Ok(text) => {
                        if sock.send(Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(_) => break,
                }
            }
            msg = sock.recv() => {
                match msg {
                    Some(Ok(_)) => {}
                    _ => break,
                }
            }
        }
    }
}
