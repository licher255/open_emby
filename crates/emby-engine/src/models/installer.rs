//! Model installer: resumable download -> verify -> finalize -> write manifest.
use super::{model_dir, ModelManifest};
use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub job: String,
    pub model_id: String,
    /// downloading | verifying | done | error | cancelled
    pub phase: String,
    pub file: String,
    pub file_index: usize,
    pub file_count: usize,
    pub received: u64,
    pub total: u64,
    pub message: String,
}

pub async fn install(
    data_root: &Path,
    manifest: &ModelManifest,
    job: &str,
    cancel: Arc<AtomicBool>,
    on_progress: impl Fn(InstallProgress) + Send + Sync,
) -> anyhow::Result<()> {
    let dir = model_dir(data_root, &manifest.id);
    std::fs::create_dir_all(&dir)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .connect_timeout(std::time::Duration::from_secs(30))
        .user_agent("open_emby/0.1 model-installer")
        .build()?;

    let count = manifest.files.len();
    for (index, file) in manifest.files.iter().enumerate() {
        let final_path = dir.join(&file.name);
        if is_ready(&final_path, file.bytes, &file.sha256).await {
            emit(&on_progress, job, manifest, "downloading", file.name.clone(), index, count, 1, 1, "already present, skipped");
            continue;
        }
        download_one(&client, data_root, manifest, job, index, count, &dir, &file.name, &file.url, file.bytes, &file.sha256, &cancel, &on_progress).await?;
    }

    std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(manifest)?)?;
    emit(&on_progress, job, manifest, "done", String::new(), count, count, 1, 1, "installed");
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn download_one(
    client: &reqwest::Client,
    _data_root: &Path,
    manifest: &ModelManifest,
    job: &str,
    index: usize,
    count: usize,
    dir: &Path,
    name: &str,
    url: &str,
    expect_bytes: u64,
    sha256: &str,
    cancel: &Arc<AtomicBool>,
    on_progress: &(impl Fn(InstallProgress) + Send + Sync),
) -> anyhow::Result<()> {
    let final_path = dir.join(name);
    let part_path = PathBuf::from(format!("{}.part", final_path.display()));
    let mut have = std::fs::metadata(&part_path).map(|m| m.len()).unwrap_or(0);

    let mut request = client.get(url);
    if have > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let res = request.send().await?;
    let status = res.status();
    if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
        // The server says the file is already complete; move on to verification.
        return finalize(&part_path, &final_path, expect_bytes, sha256, job, manifest, name, index, count, on_progress).await;
    }
    if !status.is_success() {
        anyhow::bail!("download of {name} failed: HTTP {status} {url}");
    }
    let resuming = status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0;
    if !resuming {
        have = 0;
    }
    let total = res.content_length().map(|l| l + have).filter(|l| *l > 0).unwrap_or(expect_bytes);

    let mut file = tokio::fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(resuming)
        .truncate(!resuming)
        .open(&part_path)
        .await?;

    let mut received = have;
    let mut last_emit = std::time::Instant::now();
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            file.flush().await.ok();
            anyhow::bail!("cancelled");
        }
        let chunk = chunk.map_err(|e| anyhow::anyhow!("download interrupted: {e}"))?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if last_emit.elapsed() > std::time::Duration::from_millis(400) {
            emit(on_progress, job, manifest, "downloading", name.to_string(), index, count, received, total, "");
            last_emit = std::time::Instant::now();
        }
    }
    file.flush().await?;
    drop(file);
    emit(on_progress, job, manifest, "downloading", name.to_string(), index, count, received, total, "");

    finalize(&part_path, &final_path, expect_bytes, sha256, job, manifest, name, index, count, on_progress).await
}

#[allow(clippy::too_many_arguments)]
async fn finalize(
    part_path: &Path,
    final_path: &Path,
    expect_bytes: u64,
    sha256: &str,
    job: &str,
    manifest: &ModelManifest,
    name: &str,
    index: usize,
    count: usize,
    on_progress: &(impl Fn(InstallProgress) + Send + Sync),
) -> anyhow::Result<()> {
    let size = std::fs::metadata(part_path).map(|m| m.len()).unwrap_or(0);
    emit(on_progress, job, manifest, "verifying", name.to_string(), index, count, size, expect_bytes.max(size), "verifying");
    if !sha256.is_empty() {
        let expected = sha256.to_ascii_lowercase();
        let path = part_path.to_path_buf();
        let actual = tokio::task::spawn_blocking(move || hash_file(&path)).await??;
        if actual != expected {
            std::fs::remove_file(part_path).ok();
            anyhow::bail!("{name} checksum mismatch: expected {expected}, got {actual}");
        }
    }
    if std::fs::rename(part_path, final_path).is_err() {
        std::fs::copy(part_path, final_path)?;
        std::fs::remove_file(part_path).ok();
    }
    Ok(())
}

async fn is_ready(path: &Path, expect_bytes: u64, sha256: &str) -> bool {
    let Ok(meta) = tokio::fs::metadata(path).await else { return false };
    if !meta.is_file() || meta.len() == 0 { return false; }
    if expect_bytes > 0 && meta.len() != expect_bytes { return false; }
    if !sha256.is_empty() {
        let path = path.to_path_buf();
        let expected = sha256.to_ascii_lowercase();
        return matches!(tokio::task::spawn_blocking(move || hash_file(&path)).await, Ok(Ok(actual)) if actual == expected);
    }
    true
}

fn hash_file(path: &Path) -> anyhow::Result<String> {
    use std::io::Read;
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[allow(clippy::too_many_arguments)]
fn emit(
    on_progress: &(impl Fn(InstallProgress) + Send + Sync),
    job: &str,
    manifest: &ModelManifest,
    phase: &str,
    file: String,
    file_index: usize,
    file_count: usize,
    received: u64,
    total: u64,
    message: &str,
) {
    on_progress(InstallProgress {
        job: job.to_string(),
        model_id: manifest.id.clone(),
        phase: phase.to_string(),
        file,
        file_index,
        file_count,
        received,
        total,
        message: message.to_string(),
    });
}
