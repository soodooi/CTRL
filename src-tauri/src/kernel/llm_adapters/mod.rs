// LLM adapters — concrete implementations of the LlmAdapter trait for
// the providers CTRL ships with.
//
// v1 launch posture (ADR-005 / -011):
//   - volc      → Volcano Ark / Doubao (default, OpenAI-shape REST)
//   - anthropic → BYOK Anthropic (not implemented yet; placeholder)
//   - ollama    → local dev (not implemented yet; placeholder)
//
// Keys live in the OS keychain under service "app.ctrl" (per
// bin/setup_llm_key.rs). At boot we try to read each known profile and
// register an adapter only if a key was found — a fresh install has no
// keys, so the router falls through with no adapters registered until
// the user runs setup_llm_key (or Settings UI BYOK).

pub mod local_config;
pub mod openai_shape;

use crate::kernel::llm_port::LlmPortRouter;

/// Keychain service name. Must match bin/setup_llm_key.rs.
const KEYCHAIN_SERVICE: &str = "app.ctrl";
/// Legacy service name used during the spike. Kept as a one-time fallback
/// so dev keys set with the pre-rename bin don't silently break.
const KEYCHAIN_SERVICE_LEGACY: &str = "app.ctrl.spike";

/// Read an API key from the keychain. Tries each service × account
/// combination in turn and returns the first non-empty hit. The
/// account variants are aliases for the same provider — e.g. a user
/// who ran `setup_llm_key ark <k>` and a user who ran
/// `setup_llm_key volc <k>` both get picked up here.
fn read_keychain_key_aliased(account_aliases: &[&str]) -> Option<String> {
    for service in [KEYCHAIN_SERVICE, KEYCHAIN_SERVICE_LEGACY] {
        for account in account_aliases {
            match keyring::Entry::new(service, account) {
                Ok(entry) => {
                    if let Ok(key) = entry.get_password() {
                        if !key.is_empty() {
                            tracing::info!(
                                "llm_adapter: key resolved via service={service} account={account}"
                            );
                            return Some(key);
                        }
                    }
                }
                Err(_) => continue,
            }
        }
    }
    None
}

/// Volcano Ark account name aliases. The CLI helper accepts whichever
/// name the user typed; the adapter loader treats all three as the
/// same provider.
const VOLC_ACCOUNT_ALIASES: &[&str] = &["volc", "ark", "doubao"];
const OPENAI_ACCOUNT_ALIASES: &[&str] = &["openai", "gpt"];

/// Register the default-shipping adapters on a freshly-constructed
/// LlmPortRouter. Called from KernelRuntime::boot. Adapters whose
/// secrets are missing skip registration silently — the router will
/// fall through to the next entry in the fallback chain.
pub fn register_default_adapters(router: &mut LlmPortRouter) {
    // Source of truth #1: $HOME/.ctrl/config.toml. The user edits one
    // file to enable/disable providers, change keys, swap models, point
    // at private gateways. See ctrl.config.toml.example for the schema.
    let local_cfg = local_config::default_config_path()
        .and_then(|p| local_config::load_from(&p))
        .unwrap_or_default();

    // ── Volcano Ark / Doubao ────────────────────────────────────────────
    let volc_from_config = local_cfg
        .providers
        .volc
        .as_ref()
        .filter(|e| e.is_usable())
        .cloned();
    let volc_key = volc_from_config
        .as_ref()
        .map(|e| e.api_key.clone())
        .or_else(|| read_keychain_key_aliased(VOLC_ACCOUNT_ALIASES));
    if let Some(key) = volc_key {
        let base_url = volc_from_config
            .as_ref()
            .map(|e| e.base_url.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://ark.cn-beijing.volces.com/api/v3".to_string());
        let default_model = volc_from_config
            .as_ref()
            .map(|e| e.default_model.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "doubao-1-5-pro-32k-250115".to_string());
        let adapter = openai_shape::OpenAIShapeAdapter::new("volc", base_url, key, default_model);
        router.register(std::sync::Arc::new(adapter));
        tracing::info!(
            "llm_adapter: volc (Volcano Ark) registered via {}",
            if volc_from_config.is_some() {
                "~/.ctrl/config.toml"
            } else {
                "keychain"
            }
        );
    } else {
        tracing::info!(
            "llm_adapter: volc not configured. Edit ~/.ctrl/config.toml [providers.volc] \
             or run setup_llm_key volc <key>."
        );
    }

    // ── OpenAI (BYOK) ──────────────────────────────────────────────────
    let openai_from_config = local_cfg
        .providers
        .openai
        .as_ref()
        .filter(|e| e.is_usable())
        .cloned();
    let openai_key = openai_from_config
        .as_ref()
        .map(|e| e.api_key.clone())
        .or_else(|| read_keychain_key_aliased(OPENAI_ACCOUNT_ALIASES));
    if let Some(key) = openai_key {
        let base_url = openai_from_config
            .as_ref()
            .map(|e| e.base_url.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
        let default_model = openai_from_config
            .as_ref()
            .map(|e| e.default_model.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "gpt-4o-mini".to_string());
        let adapter =
            openai_shape::OpenAIShapeAdapter::new("openai", base_url, key, default_model);
        router.register(std::sync::Arc::new(adapter));
        tracing::info!(
            "llm_adapter: openai registered via {}",
            if openai_from_config.is_some() {
                "~/.ctrl/config.toml"
            } else {
                "keychain"
            }
        );
    }

    // Anthropic + ollama land in follow-up commits — they need a different
    // wire shape (Anthropic Messages) / no auth (Ollama) respectively.
}
