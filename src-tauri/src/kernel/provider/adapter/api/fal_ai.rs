// ADR-002 substrate § capability-faces v19 §13.4 (2026-06-09, H-2026-06-09-002).
//
// fal.ai BYOK adapter — flagship API-face implementation. 985 endpoints
// aggregated under one API surface (FLUX 2, Seedream 5.0, Recraft V3,
// Nano Banana Pro, Kling 3.0, Veo 3.1, Hunyuan Video, etc). Codex locks
// users to a single image model (gpt-image-2); CTRL routes through
// fal.ai to expose all 985 endpoints as a single BYOK provider — this
// is the tactical differentiator vs the 4 friend products surveyed in
// ADR-001 §4.2.
//
// Key from `shell::credential_vault::get("fal-ai")`. No plaintext on
// disk. Loads only when the user has activated a fal.ai provider in
// Settings -> Providers (ADR-006 cross-cutting § byok-aggregator v3 —
// aggregator endpoints are exempt from the single-brand SDK lock; the
// aggregator brokerage IS the value-add).

use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};

const FAL_BASE_URL: &str = "https://fal.run";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRequest {
    pub model: String,
    pub prompt: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_size: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub num_images: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageResponse {
    pub images: Vec<ImageRef>,
    pub timings: Option<serde_json::Value>,
    pub seed: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRef {
    pub url: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub content_type: Option<String>,
}

/// One-shot image generation against fal.ai. The model id is the full
/// fal.ai endpoint path (e.g. "fal-ai/flux-pro/v2"); CTRL does not
/// normalize — exposing the upstream id preserves the 985-endpoint
/// surface area for power users without shipping an endpoint catalogue
/// inside CTRL.
pub async fn generate(api_key: &str, req: &ImageRequest) -> Result<ImageResponse> {
    if api_key.trim().is_empty() {
        return Err(anyhow!("fal.ai API key empty"));
    }

    let url = format!("{}/{}", FAL_BASE_URL, req.model.trim_start_matches('/'));

    // Compose request body — keep only the fields the user provided so
    // fal.ai's per-endpoint defaults apply where we did not override.
    let mut body = serde_json::json!({ "prompt": req.prompt });
    if let Some(size) = &req.image_size {
        body["image_size"] = serde_json::json!(size);
    }
    if let Some(n) = req.num_images {
        body["num_images"] = serde_json::json!(n);
    }
    if let Some(seed) = req.seed {
        body["seed"] = serde_json::json!(seed);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .context("build fal.ai http client")?;

    let response = client
        .post(&url)
        .header("Authorization", format!("Key {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .context("POST fal.ai")?;

    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        return Err(anyhow!(
            "fal.ai POST {} returned HTTP {}: {}",
            url,
            status,
            text
        ));
    }

    let parsed: ImageResponse = response
        .json()
        .await
        .context("parse fal.ai response JSON")?;
    Ok(parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_key_rejects() {
        let req = ImageRequest {
            model: "fal-ai/flux-pro/v2".into(),
            prompt: "a cat".into(),
            image_size: None,
            num_images: None,
            seed: None,
        };
        let rt = tokio::runtime::Runtime::new().unwrap();
        let res = rt.block_on(generate("", &req));
        assert!(res.is_err());
    }
}
