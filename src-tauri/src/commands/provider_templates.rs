// provider_templates — bundled defaults + user override.
//
// bao 2026-06-06: provider preset list is data, not code. CTRL ships a
// bundled default list (include_str!) plus the user can drop a
// `~/.ctrl/provider-templates.json` to add or override entries
// (community-contributable, no rebuild required).
//
// Merge rule: user file entries with matching `id` override the
// bundled default; new ids extend the list at the end. Empty/missing
// user file is fine — bundled defaults stand alone.

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
}

#[tauri::command]
pub fn list_provider_templates() -> Result<Vec<ProviderTemplate>, String> {
    let mut merged: Vec<ProviderTemplate> = serde_json::from_str(BUNDLED_TEMPLATES)
        .map_err(|e| format!("parse bundled provider-templates.json: {e}"))?;
    // User override at ~/.ctrl/provider-templates.json (optional).
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

fn merge_in_place(base: &mut Vec<ProviderTemplate>, user: Vec<ProviderTemplate>) {
    for u in user {
        if let Some(existing) = base.iter_mut().find(|b| b.id == u.id) {
            *existing = u;
        } else {
            base.push(u);
        }
    }
}
