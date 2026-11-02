//! OpenAI-compatible cloud capabilities: /images/generations, /images/edits,
//! /chat/completions. Any vendor speaking this protocol (OpenAI, gateways,
//! SiliconFlow, self-hosted vLLM) can be plugged in without code changes.
use super::{ChatOutput, ChatRequest, ImageOutput, ImageRequest, Provider};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value as Json};
use std::path::PathBuf;

fn client(timeout_secs: u64) -> anyhow::Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout_secs))
        .build()?)
}

fn endpoint(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

fn auth(request: reqwest::RequestBuilder, provider: &Provider) -> reqwest::RequestBuilder {
    if provider.api_key.trim().is_empty() {
        request
    } else {
        request.bearer_auth(provider.api_key.trim())
    }
}

async fn read_error(res: reqwest::Response) -> String {
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    format!("{status}: {}", body.chars().take(600).collect::<String>())
}

fn output_path(req: &ImageRequest) -> PathBuf {
    req.out_path.clone().unwrap_or_else(|| {
        std::env::temp_dir().join(format!("emby-ai-{}.png", uuid::Uuid::new_v4()))
    })
}

/// Text-to-image or image-to-image. b64_json is preferred; URL-only vendors work too.
pub async fn image(provider: &Provider, req: &ImageRequest) -> anyhow::Result<ImageOutput> {
    let model = req.model.clone().unwrap_or_else(|| provider.image_model.clone());
    if model.trim().is_empty() {
        anyhow::bail!("cloud provider \"{}\" has no image model configured", provider.name);
    }
    let size = format!("{}x{}", req.width.max(64), req.height.max(64));
    let client = client(300)?;
    let payload = json!({
        "model": model,
        "prompt": req.prompt,
        "n": 1,
        "size": size,
        "response_format": "b64_json"
    });

    let res = match req.source_image.as_ref().filter(|p| p.exists()) {
        Some(source) => {
            let bytes = std::fs::read(source)?;
            let filename = source.file_name().map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "input.png".to_string());
            let part = reqwest::multipart::Part::bytes(bytes)
                .file_name(filename)
                .mime_str("image/png")?;
            let form = reqwest::multipart::Form::new()
                .part("image", part)
                .text("model", model.clone())
                .text("prompt", req.prompt.clone())
                .text("size", size)
                .text("n", "1")
                .text("response_format", "b64_json");
            auth(client.post(endpoint(&provider.base_url, "/images/edits")), provider)
                .multipart(form)
                .send()
                .await?
        }
        None => auth(client.post(endpoint(&provider.base_url, "/images/generations")), provider)
            .json(&payload)
            .send()
            .await?,
    };

    if !res.status().is_success() {
        anyhow::bail!("cloud image request failed ({}): {}", provider.name, read_error(res).await);
    }
    let body: Json = res.json().await?;
    let first = body["data"].get(0).ok_or_else(|| {
        anyhow::anyhow!("cloud response has no image data: {}", body.to_string().chars().take(300).collect::<String>())
    })?;

    let bytes = if let Some(b64) = first["b64_json"].as_str() {
        STANDARD.decode(b64.trim())?
    } else if let Some(url) = first["url"].as_str() {
        let res = client.get(url).send().await?;
        if !res.status().is_success() {
            anyhow::bail!("failed to download the generated image: {}", read_error(res).await);
        }
        res.bytes().await?.to_vec()
    } else {
        anyhow::bail!("cloud response contains neither b64_json nor url");
    };

    let path = output_path(req);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, bytes)?;
    Ok(ImageOutput { path, provider: provider.name.clone(), model, prompt: req.prompt.clone() })
}

pub async fn chat(provider: &Provider, req: &ChatRequest) -> anyhow::Result<ChatOutput> {
    let model = req.model.clone().unwrap_or_else(|| provider.chat_model.clone());
    if model.trim().is_empty() {
        anyhow::bail!("cloud provider \"{}\" has no text model configured", provider.name);
    }
    let mut messages: Vec<Json> = Vec::new();
    if !req.system.trim().is_empty() {
        messages.push(json!({ "role": "system", "content": req.system }));
    }
    messages.push(json!({ "role": "user", "content": req.prompt }));
    let mut payload = json!({
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": req.max_tokens.max(64)
    });
    if req.json {
        payload["response_format"] = json!({ "type": "json_object" });
    }

    let res = auth(client(120)?.post(endpoint(&provider.base_url, "/chat/completions")), provider)
        .json(&payload)
        .send()
        .await?;
    if !res.status().is_success() {
        anyhow::bail!("cloud chat request failed ({}): {}", provider.name, read_error(res).await);
    }
    let body: Json = res.json().await?;
    let text = body["choices"].get(0)
        .and_then(|c| c["message"]["content"].as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| anyhow::anyhow!("cloud response has no text: {}", body.to_string().chars().take(300).collect::<String>()))?;
    Ok(ChatOutput { text, provider: provider.name.clone(), model })
}
