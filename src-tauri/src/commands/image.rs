// ADR-002 substrate § capability-faces v19 §13.4 (2026-06-09, H-2026-06-09-002).
//
// Image-generation Tauri command surface. Bridges the PWA's `$imagegen`
// skill (`~/.ctrl/skills/imagegen/SKILL.md`) and the fal.ai adapter.
// Routes ONLY through fal.ai for now — the multi-provider router for
// image.generate lands when the second image provider is wired.

use serde::{Deserialize, Serialize};

use crate::kernel::provider::adapter::api::fal_ai;
use crate::shell::credential_vault;

#[derive(Debug, Deserialize)]
pub struct ImageGenerateArgs {
    pub prompt: String,
    /// fal.ai endpoint id, e.g. "fal-ai/flux-pro/v2". Defaults to FLUX 2 Pro
    /// when absent — matches the skill's `default_args.model` field.
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default)]
    pub num_images: Option<u32>,
    #[serde(default)]
    pub seed: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ImageGenerateReply {
    pub urls: Vec<String>,
    pub seed: Option<u64>,
}

const DEFAULT_MODEL: &str = "fal-ai/flux-pro/v2";

#[tauri::command]
pub async fn image_generate(args: ImageGenerateArgs) -> Result<ImageGenerateReply, String> {
    let api_key = credential_vault::get("fal-ai")
        .map_err(|e| format!("read fal.ai key: {}", e))?
        .ok_or_else(|| {
            "fal.ai API key not configured — add it in Settings -> Providers".to_string()
        })?;

    let req = fal_ai::ImageRequest {
        model: args.model.unwrap_or_else(|| DEFAULT_MODEL.to_string()),
        prompt: args.prompt,
        image_size: args.size,
        num_images: args.num_images,
        seed: args.seed,
    };

    let res = fal_ai::generate(&api_key, &req)
        .await
        .map_err(|e| format!("fal.ai generate: {}", e))?;

    Ok(ImageGenerateReply {
        urls: res.images.into_iter().map(|i| i.url).collect(),
        seed: res.seed,
    })
}
