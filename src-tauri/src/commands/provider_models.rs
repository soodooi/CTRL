// provider_models — opencode-style dynamic model list (decision 0007
// §per-provider-models, 2026-06-19).
//
// The catalog only knows one `defaultModel` per provider; the provider's
// own `/models` endpoint is the live source of truth. Two surfaces:
//
//   1. `provider_list_models(provider_id)` — for an already-configured
//      provider (in ~/.ctrl/providers/). Resolves manifest + keychain,
//      falls back to manifest.models on any failure.
//
//   2. `provider_query_models(endpoint, api_key)` — ad-hoc query with
//      raw credentials. Powers the +Add flow: user picks the Zhipu
//      template, types their key, model <input> immediately shows a
//      <datalist> of real ids (glm-5.2 / 4.5 / codegeex-4 …) before
//      anything is persisted.
//
// Standard: GET {baseUrl}/models with Bearer auth, OpenAI list response
// shape `{ object: "list", data: [{id, object, owned_by}, …] }`.

use std::time::Duration;

use serde::Deserialize;
use tauri::State;

use crate::kernel::provider::manifest::AuthSource;
use crate::shell::{KernelHandle, KeychainStore};

#[derive(Debug, Deserialize)]
struct OpenAiModelsResponse {
    #[serde(default)]
    data: Vec<OpenAiModel>,
}

#[derive(Debug, Deserialize)]
struct OpenAiModel {
    id: String,
}

/// Network timeout for the `/models` GET. Conservative — slow CDNs
/// shouldn't make the user think the UI froze.
const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

/// Shared core: GET `{base}/models` with optional Bearer auth.
///
/// Returns the sorted, deduped list of model ids. Errors propagate so
/// each caller can pick its own fallback (manifest.models for the
/// manifest-backed command; empty for the ad-hoc query).
async fn fetch_models(base_url: &str, api_key: Option<&str>) -> Result<Vec<String>, String> {
    let base = base_url.trim_end_matches('/');
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;
    let url = format!("{base}/models");
    let mut req = client.get(&url);
    if let Some(key) = api_key {
        let trimmed = key.trim();
        if !trimmed.is_empty() {
            req = req.bearer_auth(trimmed);
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| format!("/models fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("/models HTTP {}", resp.status()));
    }
    let parsed: OpenAiModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("/models parse failed: {e}"))?;
    let mut ids: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();
    // Dedup + sort for stable UI. Some providers (OpenAI) return 100+;
    // sort by id so glm-5.2 / gpt-5 cluster predictably.
    ids.sort();
    ids.dedup();
    Ok(ids)
}

/// Live model list from an already-configured provider's `/models`
/// endpoint. Falls back to the manifest's static `models` array on any
/// failure (provider unreachable, key missing, endpoint unsupported,
/// parse error) so the PWA always has something to render.
///
/// `provider_id` must match a loaded manifest (from `~/.ctrl/providers/`
/// or builtin).
#[tauri::command]
pub async fn provider_list_models(
    kernel: State<'_, KernelHandle>,
    provider_id: String,
) -> Result<Vec<String>, String> {
    let registry = &kernel.runtime.provider_registry;
    let manifest = registry
        .manifest_for(&provider_id)
        .ok_or_else(|| format!("provider {provider_id} not in registry"))?;
    let static_models = manifest.models.clone();

    let Some(endpoint) = manifest.endpoint.as_deref() else {
        // CLI-only providers (claude_persistent / one_shot) have no
        // HTTP endpoint — fall straight to static catalog.
        return Ok(static_models);
    };

    // Resolve auth per AuthSource. Empty / missing = proceed without
    // Bearer; most providers will 401, we then fall back to static.
    let api_key: Option<String> = match &manifest.auth {
        AuthSource::Keychain { account } => KeychainStore::get(account).ok().flatten(),
        AuthSource::ConfigKey { field } => manifest.config.get(field).cloned(),
        AuthSource::Env { var } => std::env::var(var).ok(),
        AuthSource::None => None,
    };

    match fetch_models(endpoint, api_key.as_deref()).await {
        Ok(ids) => Ok(ids),
        Err(e) => {
            tracing::debug!(
                error = %e,
                %provider_id,
                "provider_list_models: live fetch failed; using static catalog"
            );
            Ok(static_models)
        }
    }
}

/// Ad-hoc live model query for the +Add flow, before the provider is
/// saved. Takes raw `endpoint` (baseUrl) + `api_key` so the PWA can
/// preview the model list the moment the user finishes typing the key.
///
/// Returns an empty Vec (not Err) on any failure — the PWA keeps the
/// free-text model input working. Distinguished from
/// `provider_list_models` which has a manifest-shaped fallback.
#[tauri::command]
pub async fn provider_query_models(
    endpoint: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    if endpoint.trim().is_empty() {
        return Ok(Vec::new());
    }
    match fetch_models(&endpoint, Some(&api_key)).await {
        Ok(ids) => Ok(ids),
        Err(e) => {
            tracing::debug!(
                error = %e,
                endpoint = %endpoint,
                "provider_query_models: live fetch failed; returning empty list"
            );
            Ok(Vec::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dedup_and_sort_handles_repeats() {
        // Mirror the post-fetch normalization to keep the contract
        // honest: even if a provider returns dups, the UI sees unique.
        let mut ids: Vec<String> = vec![
            "glm-5.2".to_string(),
            "glm-4-plus".to_string(),
            "glm-5.2".to_string(),
        ];
        ids.sort();
        ids.dedup();
        assert_eq!(ids, vec!["glm-4-plus".to_string(), "glm-5.2".to_string()]);
    }
}
