// Provider catalogue refresh: bundled offline floor + Models.dev freshness.
//
// Models.dev is the public catalogue also used by OpenCode. CTRL consumes only
// entries representable by its API-key HTTP form (OpenAI-compatible or
// Anthropic Messages); OAuth/profile/local-runtime providers stay in OpenCode.
// The transformed result is cached locally, then user overrides win.
// (ADR-002 substrate §3.10 v67)

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::provider_templates::ProviderTemplate;

const ENV_CATALOG_URL: &str = "CTRL_CATALOG_URL";
const DEFAULT_CATALOG_URL: &str = "https://models.dev/api.json";
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);
const BUNDLED_TEMPLATES: &str = include_str!("../kernel/provider/provider-templates.json");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedCatalog {
    pub fetched_at: String,
    pub templates: Vec<ProviderTemplate>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevProvider {
    name: String,
    #[serde(default)]
    api: Option<String>,
    #[serde(default)]
    npm: String,
    #[serde(default)]
    env: Vec<String>,
    #[serde(default)]
    doc: Option<String>,
    #[serde(default)]
    models: BTreeMap<String, ModelsDevModel>,
}

#[derive(Debug, Deserialize)]
struct ModelsDevModel {
    #[serde(default)]
    release_date: String,
    #[serde(default)]
    last_updated: String,
}

pub fn resolve_url(config_url: Option<&str>) -> String {
    if let Ok(env) = std::env::var(ENV_CATALOG_URL) {
        let trimmed = env.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(cfg) = config_url {
        let trimmed = cfg.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    DEFAULT_CATALOG_URL.to_string()
}

pub fn cache_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("cache")
            .join("provider-catalog.json"),
    )
}

pub fn load_cache() -> Option<Vec<ProviderTemplate>> {
    let path = cache_path()?;
    let text = std::fs::read_to_string(&path).ok()?;
    let cached: CachedCatalog = serde_json::from_str(&text).ok()?;
    Some(cached.templates)
}

pub async fn fetch(url: &str) -> Result<Option<Vec<ProviderTemplate>>, String> {
    if url.trim().is_empty() {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent("CTRL provider-catalog")
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;
    let resp = client
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("catalog fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("catalog HTTP {}", resp.status()));
    }
    let text = resp
        .text()
        .await
        .map_err(|e| format!("catalog body read: {e}"))?;
    Ok(Some(parse_catalog(&text)?))
}

fn parse_catalog(text: &str) -> Result<Vec<ProviderTemplate>, String> {
    if text.trim_start().starts_with('[') {
        return serde_json::from_str(text).map_err(|e| format!("catalog parse (array): {e}"));
    }
    if let Ok(cached) = serde_json::from_str::<CachedCatalog>(text) {
        return Ok(cached.templates);
    }
    let providers: BTreeMap<String, ModelsDevProvider> =
        serde_json::from_str(text).map_err(|e| format!("catalog parse (Models.dev): {e}"))?;
    models_dev_templates(providers)
}

fn models_dev_templates(
    providers: BTreeMap<String, ModelsDevProvider>,
) -> Result<Vec<ProviderTemplate>, String> {
    let mut templates: Vec<ProviderTemplate> = serde_json::from_str(BUNDLED_TEMPLATES)
        .map_err(|e| format!("parse bundled provider templates: {e}"))?;

    for (source_id, provider) in providers {
        let id = ctrl_provider_id(&source_id);
        let representable = provider
            .api
            .as_deref()
            .map(|api| is_api_key_http_provider(&provider, api))
            .unwrap_or(false);
        if !representable {
            continue;
        }
        let existing = templates.iter_mut().find(|template| template.id == id);
        let mut models: Vec<(String, String)> = provider
            .models
            .into_iter()
            .map(|(id, metadata)| {
                let freshness = if metadata.last_updated.is_empty() {
                    metadata.release_date
                } else {
                    metadata.last_updated
                };
                (id, freshness)
            })
            .collect();
        models.sort_by(|(id_a, date_a), (id_b, date_b)| {
            date_b.cmp(date_a).then_with(|| id_a.cmp(id_b))
        });
        let model_ids: Vec<String> = models.into_iter().map(|(id, _)| id).collect();
        if model_ids.is_empty() {
            continue;
        }

        if let Some(template) = existing {
            template.models = model_ids;
            if !template.models.contains(&template.default_model) {
                template.default_model = template.models[0].clone();
            }
            continue;
        }

        let Some(api) = provider.api else { continue };
        let protocol = if provider.npm == "@ai-sdk/anthropic" {
            "anthropic"
        } else {
            "openai"
        };
        let key_name = provider
            .env
            .first()
            .map(String::as_str)
            .unwrap_or("API key");
        let docs = provider
            .doc
            .as_deref()
            .map(|url| format!("; see {url}"))
            .unwrap_or_default();
        templates.push(ProviderTemplate {
            id,
            label: provider.name.clone(),
            default_name: provider.name,
            protocol: protocol.to_string(),
            base_url: api.trim_end_matches('/').to_string(),
            default_model: model_ids[0].clone(),
            key_hint: format!("Use {key_name}{docs}"),
            models: model_ids,
        });
    }

    Ok(templates)
}

fn is_api_key_http_provider(provider: &ModelsDevProvider, api: &str) -> bool {
    matches!(
        provider.npm.as_str(),
        "@ai-sdk/openai-compatible" | "@ai-sdk/openai" | "@ai-sdk/anthropic"
    ) && !provider.env.is_empty()
        && api.starts_with("https://")
        && !api.contains("${")
        && !api.trim_end_matches('/').ends_with("/chat/completions")
}

fn ctrl_provider_id(models_dev_id: &str) -> String {
    match models_dev_id {
        // Preserve persisted CTRL ids while consuming upstream catalogue ids.
        "zai" => "zhipu",
        "moonshotai-cn" => "kimi",
        "togetherai" => "together",
        "fireworks-ai" => "fireworks",
        "cloudflare-workers-ai" => "cloudflare",
        "alibaba-cn" => "qwen",
        "google-vertex" => "vertex",
        "amazon-bedrock" => "bedrock",
        "azure" => "azure-openai",
        other => other,
    }
    .to_string()
}

pub fn save_cache(templates: Vec<ProviderTemplate>) -> Result<(), String> {
    let path = cache_path().ok_or_else(|| "no HOME (cache_path is None)".to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir cache: {e}"))?;
    }
    let cached = CachedCatalog {
        fetched_at: now_stamp(),
        templates,
    };
    let json =
        serde_json::to_string_pretty(&cached).map_err(|e| format!("serialize cache: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json).map_err(|e| format!("write tmp cache: {e}"))?;
    std::fs::rename(&tmp, &path).map_err(|e| format!("rename cache: {e}"))?;
    Ok(())
}

fn now_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("epoch:{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    #[test]
    fn resolve_url_uses_models_dev_by_default() {
        let _guard = env_lock().lock().unwrap();
        std::env::remove_var(ENV_CATALOG_URL);
        assert_eq!(resolve_url(None), DEFAULT_CATALOG_URL);
        assert_eq!(resolve_url(Some("")), DEFAULT_CATALOG_URL);
    }

    #[test]
    fn resolve_url_env_beats_config_and_default() {
        let _guard = env_lock().lock().unwrap();
        std::env::set_var(ENV_CATALOG_URL, "https://env.example/catalog");
        assert_eq!(
            resolve_url(Some("https://cfg.example/catalog")),
            "https://env.example/catalog"
        );
        std::env::remove_var(ENV_CATALOG_URL);
    }

    #[test]
    fn resolve_url_config_beats_default() {
        let _guard = env_lock().lock().unwrap();
        std::env::remove_var(ENV_CATALOG_URL);
        assert_eq!(
            resolve_url(Some("https://cfg.example/catalog")),
            "https://cfg.example/catalog"
        );
    }

    #[test]
    fn models_dev_enriches_zai_without_changing_stable_id() {
        let source = r#"{
          "zai": {
            "name": "Z.AI",
            "api": "https://api.z.ai/api/paas/v4",
            "npm": "@ai-sdk/openai-compatible",
            "env": ["ZHIPU_API_KEY"],
            "models": {
              "glm-5.2": {"release_date": "2026-06-30"},
              "glm-4.5v": {"release_date": "2025-08-11"}
            }
          }
        }"#;
        let templates = parse_catalog(source).expect("Models.dev fixture parses");
        let zai = templates
            .iter()
            .find(|template| template.id == "zhipu")
            .unwrap();
        assert_eq!(zai.default_model, "glm-5.2");
        assert_eq!(zai.models, vec!["glm-5.2", "glm-4.5v"]);
        assert!(templates.iter().all(|template| template.id != "zai"));
    }

    #[test]
    fn models_dev_does_not_enrich_existing_provider_with_unsupported_shape() {
        let source = r#"{
          "zai": {
            "name": "Z.AI OAuth",
            "api": "https://api.z.ai/api/paas/v4",
            "npm": "@ai-sdk/custom-oauth",
            "env": ["ZHIPU_API_KEY"],
            "models": {
              "unsupported-model": {"release_date": "2026-07-23"}
            }
          }
        }"#;
        let templates = parse_catalog(source).expect("Models.dev fixture parses");
        let zai = templates
            .iter()
            .find(|template| template.id == "zhipu")
            .unwrap();
        assert_eq!(zai.default_model, "glm-5.2");
        assert!(!zai.models.iter().any(|model| model == "unsupported-model"));
    }

    #[test]
    fn models_dev_adds_representable_api_key_provider() {
        let source = r#"{
          "example": {
            "name": "Example AI",
            "api": "https://api.example.test/v1",
            "npm": "@ai-sdk/openai-compatible",
            "env": ["EXAMPLE_API_KEY"],
            "doc": "https://example.test/docs",
            "models": {"example-2": {"release_date": "2026-01-02"}}
          }
        }"#;
        let templates = parse_catalog(source).expect("Models.dev fixture parses");
        let example = templates
            .iter()
            .find(|template| template.id == "example")
            .unwrap();
        assert_eq!(example.default_model, "example-2");
        assert_eq!(example.protocol, "openai");
    }

    #[test]
    fn save_and_load_cache_roundtrip() {
        let saved_home = std::env::var_os("HOME");
        let tmp = tempfile::tempdir().expect("tempdir");
        std::env::set_var("HOME", tmp.path());
        let sample = vec![ProviderTemplate {
            id: "test".into(),
            label: "Test".into(),
            default_name: "Test".into(),
            protocol: "openai".into(),
            base_url: "https://example.test".into(),
            default_model: "test-model".into(),
            key_hint: "test-hint".into(),
            models: vec!["test-model".into()],
        }];
        save_cache(sample).expect("save");
        assert_eq!(load_cache().unwrap()[0].id, "test");
        match saved_home {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }
    }

    #[test]
    fn fetch_returns_none_when_url_empty() {
        let rt = tokio::runtime::Runtime::new().expect("rt");
        assert!(rt.block_on(fetch("")).expect("empty url ok").is_none());
    }
}
