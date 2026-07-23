// provider_templates — bundled defaults + cloud refresh + user override.
//
// Layering (low → high precedence):
//   1. bundled defaults (include_str! of provider-templates.json)
//   2. cloud catalog cache (~/.ctrl/cache/provider-catalog.json) — written
//      by `refresh_provider_catalog` from `CTRL_CATALOG_URL` or config.
//      Disabled / absent cache = layer is a no-op.
//   3. user override (~/.ctrl/provider-templates.json) — community-
//      contributable, highest precedence, no rebuild required.
//
// Merge rule: same-`id` entries from a higher layer replace lower ones;
// new ids extend the list at the end. Empty/missing layers are fine.
//
// bao 2026-06-06: provider preset list is data, not code.
// bao 2026-06-19 (decision 0007): catalog moves to cloud-sourced so new
// model ids (glm-5.2 / gpt-5 / claude-sonnet-5) arrive without a CTRL
// release.

use serde::{Deserialize, Serialize};

const BUNDLED_TEMPLATES: &str =
    include_str!("../kernel/provider/provider-templates.json");

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ProviderTemplate {
    pub id: String,
    pub label: String,
    #[serde(rename = "defaultName")]
    pub default_name: String,
    pub protocol: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(rename = "defaultModel")]
    pub default_model: String,
    #[serde(rename = "keyHint")]
    pub key_hint: String,
    /// Recommended model ids for this provider (decision 0007
    /// §per-provider-models, 2026-06-19). Surfaced as a <datalist>
    /// fallback in the model <input> when the user hasn't typed a key
    /// yet (live `/models` fetch needs auth). Empty array = old
    /// behavior, free-text input only.
    #[serde(default)]
    pub models: Vec<String>,
}

#[tauri::command]
pub fn list_provider_templates() -> Result<Vec<ProviderTemplate>, String> {
    // Layer 1: bundled defaults.
    let mut merged: Vec<ProviderTemplate> = serde_json::from_str(BUNDLED_TEMPLATES)
        .map_err(|e| format!("parse bundled provider-templates.json: {e}"))?;

    // Layer 2: cloud catalog cache. Stale-but-present beats bundled —
    // worst case the user sees yesterday's catalog, never release-stale.
    if let Some(cloud) = super::cloud_catalog::load_cache() {
        merge_in_place(&mut merged, cloud);
    }

    // Layer 3: user override at ~/.ctrl/provider-templates.json.
    if let Some(home) = std::env::var_os("HOME") {
        let path = std::path::PathBuf::from(home).join(".ctrl").join("provider-templates.json");
        if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(text) => match serde_json::from_str::<Vec<ProviderTemplate>>(&text) {
                    Ok(user) => merge_in_place(&mut merged, user),
                    Err(e) => {
                        tracing::warn!(?path, error = %e, "provider-templates: user file parse failed; ignoring");
                    }
                },
                Err(e) => {
                    tracing::warn!(?path, error = %e, "provider-templates: user file read failed; ignoring");
                }
            }
        }
    }
    Ok(merged)
}

/// Trigger a cloud catalog refresh. Fire-and-forget on boot; the PWA
/// may also call this from Settings → Providers (Refresh button).
///
/// Returns the number of templates fetched, or 0 when cloud is disabled.
/// Errors are returned but the existing cache (if any) is preserved.
#[tauri::command]
pub async fn refresh_provider_catalog() -> Result<usize, String> {
    let url = super::cloud_catalog::resolve_url(None);
    match super::cloud_catalog::fetch(&url).await {
        Ok(Some(templates)) => {
            let n = templates.len();
            if let Err(e) = super::cloud_catalog::save_cache(templates) {
                tracing::warn!(error = %e, "provider-templates: cloud cache write failed");
            }
            tracing::info!(count = n, url = %url, "provider-templates: cloud catalog refreshed");
            Ok(n)
        }
        Ok(None) => {
            tracing::debug!("provider-templates: cloud catalog disabled (URL unset)");
            Ok(0)
        }
        Err(e) => {
            tracing::warn!(error = %e, url = %url, "provider-templates: cloud catalog fetch failed; keeping existing cache");
            Err(e)
        }
    }
}

fn merge_in_place(base: &mut Vec<ProviderTemplate>, incoming: Vec<ProviderTemplate>) {
    for u in incoming {
        if let Some(existing) = base.iter_mut().find(|b| b.id == u.id) {
            *existing = u;
        } else {
            base.push(u);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tpl(id: &str, model: &str) -> ProviderTemplate {
        ProviderTemplate {
            id: id.into(),
            label: id.into(),
            default_name: id.into(),
            protocol: "openai".into(),
            base_url: "https://example.test".into(),
            default_model: model.into(),
            key_hint: "".into(),
            models: vec![],
        }
    }

    #[test]
    fn merge_replaces_same_id_keeps_new_ids() {
        let mut base = vec![tpl("a", "old-a"), tpl("b", "b")];
        let incoming = vec![tpl("a", "new-a"), tpl("c", "c")];
        merge_in_place(&mut base, incoming);
        assert_eq!(base.len(), 3);
        let a = base.iter().find(|t| t.id == "a").unwrap();
        assert_eq!(a.default_model, "new-a");
        assert!(base.iter().any(|t| t.id == "c"));
    }

    #[test]
    fn merge_empty_incoming_is_noop() {
        let mut base = vec![tpl("a", "a")];
        merge_in_place(&mut base, vec![]);
        assert_eq!(base.len(), 1);
    }

    #[test]
    fn bundled_catalog_keeps_z_ai_general_and_coding_plan_distinct() {
        // Coding Plan keys and endpoints are not interchangeable with the
        // general Z.AI API. Keep separate template identities so higher-layer
        // catalog overrides cannot collapse their credentials or routing.
        // (ADR-002 substrate §3.10 v66)
        let templates: Vec<ProviderTemplate> = serde_json::from_str(BUNDLED_TEMPLATES).unwrap();
        let general = templates.iter().find(|t| t.id == "zhipu").unwrap();
        let coding = templates
            .iter()
            .find(|t| t.id == "zai-coding-plan")
            .unwrap();

        assert_eq!(general.label, "Z.AI");
        assert_eq!(coding.label, "Z.AI Coding Plan");
        assert_eq!(general.base_url, "https://api.z.ai/api/paas/v4");
        assert_eq!(coding.base_url, "https://api.z.ai/api/coding/paas/v4");
        assert_ne!(general.id, coding.id);
        assert_ne!(general.base_url, coding.base_url);
    }
}
