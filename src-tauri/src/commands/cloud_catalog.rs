// Cloud-sourced provider catalog refresh layer (decision 0007, 2026-06-19).
//
// The bundled `provider-templates.json` is a static snapshot — new model
// ids (glm-5.2 / gpt-5 / claude-sonnet-5) ship only on CTRL release. To
// let the catalog stay current between releases, the runtime also reads
// a cloud-sourced catalog and merges it between bundled and user layers.
//
// Layering (low → high precedence, see `provider_templates::list`):
//   bundled (include_str!)  →  cloud-cache  →  user (~/.ctrl/provider-templates.json)
//
// URL resolution (first non-empty wins):
//   1. env var CTRL_CATALOG_URL  (power-user / dev override)
//   2. ~/.ctrl/config.toml [catalog] url  (per-install, when wired)
//   3. const DEFAULT_CATALOG_URL = ""  (disabled — fetch is a no-op)
//
// When the resolved URL is empty the entire layer is inert: no network
// call, no cache file written. `list_provider_templates` returns the
// same result as before this feature shipped.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::provider_templates::ProviderTemplate;

/// Power-user / dev override. Takes precedence over config + default.
const ENV_CATALOG_URL: &str = "CTRL_CATALOG_URL";

/// Disabled by default. bao wires a real URL when ctrl-cloud ships
/// `GET /catalog/providers`; users can override earlier via env / config.
const DEFAULT_CATALOG_URL: &str = "";

/// Network timeout for the cloud fetch. Conservative so a slow CDN does
/// not hold up boot.
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedCatalog {
    /// Stamp of the successful fetch. Informational — used only for
    /// diagnostics; the runtime does not expire caches on age (refresh
    /// is fire-and-forget on boot, not lazy on read).
    pub fetched_at: String,
    pub templates: Vec<ProviderTemplate>,
}

/// Resolve the cloud URL per the precedence chain. Empty = disabled.
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

/// Cache path: `~/.ctrl/cache/provider-catalog.json`. None when HOME
/// unset (CI sandbox without HOME).
pub fn cache_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("cache")
            .join("provider-catalog.json"),
    )
}

/// Read cached catalog from disk (any age — staleness is not enforced).
/// Used by `list_provider_templates` so a stale-but-present cache still
/// beats bundled defaults when the network is down at boot.
pub fn load_cache() -> Option<Vec<ProviderTemplate>> {
    let path = cache_path()?;
    let text = std::fs::read_to_string(&path).ok()?;
    let cached: CachedCatalog = serde_json::from_str(&text).ok()?;
    Some(cached.templates)
}

/// Fetch the cloud catalog. Returns `Ok(None)` when the resolved URL is
/// empty (disabled). Returns `Err` on any network / parse failure; the
/// caller logs and keeps the existing cache.
pub async fn fetch(url: &str) -> Result<Option<Vec<ProviderTemplate>>, String> {
    if url.trim().is_empty() {
        return Ok(None);
    }
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
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
    // Accept two wire shapes:
    //   A. bare array         →  back-compat with bundled JSON
    //   B. { fetched_at, templates }  →  server-stamped freshness
    let text = resp
        .text()
        .await
        .map_err(|e| format!("catalog body read: {e}"))?;
    let templates = if text.trim_start().starts_with('[') {
        serde_json::from_str::<Vec<ProviderTemplate>>(&text)
            .map_err(|e| format!("catalog parse (array): {e}"))?
    } else {
        let cached: CachedCatalog =
            serde_json::from_str(&text).map_err(|e| format!("catalog parse (object): {e}"))?;
        cached.templates
    };
    Ok(Some(templates))
}

/// Persist a freshly fetched catalog. Atomic: write to `.tmp` then rename.
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

/// Best-effort freshness stamp. Avoids pulling a date crate by encoding
/// epoch seconds with a `epoch:` prefix; the prefix keeps the field
/// self-describing when read by humans or future tooling.
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

    #[test]
    fn resolve_url_empty_when_nothing_set() {
        std::env::remove_var(ENV_CATALOG_URL);
        assert_eq!(resolve_url(None), "");
        assert_eq!(resolve_url(Some("")), "");
        assert_eq!(resolve_url(Some("   ")), "");
    }

    #[test]
    fn resolve_url_env_beats_config_and_default() {
        std::env::set_var(ENV_CATALOG_URL, "https://env.example/catalog");
        assert_eq!(
            resolve_url(Some("https://cfg.example/catalog")),
            "https://env.example/catalog"
        );
        std::env::remove_var(ENV_CATALOG_URL);
    }

    #[test]
    fn resolve_url_config_beats_default() {
        std::env::remove_var(ENV_CATALOG_URL);
        assert_eq!(
            resolve_url(Some("https://cfg.example/catalog")),
            "https://cfg.example/catalog"
        );
    }

    #[test]
    fn save_and_load_cache_roundtrip() {
        // SAFETY: this writes under /tmp via HOME override. We restore
        // HOME afterwards so other tests aren't poisoned.
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
        save_cache(sample.clone()).expect("save");
        let loaded = load_cache().expect("load");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "test");
        assert_eq!(loaded[0].default_model, "test-model");

        // Restore.
        match saved_home {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
    }

    #[test]
    fn fetch_returns_none_when_url_empty() {
        // No network touched — early return path.
        let rt = tokio::runtime::Runtime::new().expect("rt");
        let out = rt.block_on(fetch("")).expect("empty url ok");
        assert!(out.is_none());
        let out = rt.block_on(fetch("   ")).expect("blank url ok");
        assert!(out.is_none());
    }
}
