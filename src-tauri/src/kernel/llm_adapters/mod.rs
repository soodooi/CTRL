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
    if let Some(key) = read_keychain_key_aliased(VOLC_ACCOUNT_ALIASES) {
        let adapter = openai_shape::OpenAIShapeAdapter::new(
            "volc",
            "https://ark.cn-beijing.volces.com/api/v3",
            key,
            "doubao-1-5-pro-32k-250115",
        );
        router.register(std::sync::Arc::new(adapter));
        tracing::info!("llm_adapter: volc (Volcano Ark) registered");
    } else {
        tracing::info!("llm_adapter: volc key not found in keychain; skipping registration");
    }

    if let Some(key) = read_keychain_key_aliased(OPENAI_ACCOUNT_ALIASES) {
        let adapter = openai_shape::OpenAIShapeAdapter::new(
            "openai",
            "https://api.openai.com/v1",
            key,
            "gpt-4o-mini",
        );
        router.register(std::sync::Arc::new(adapter));
        tracing::info!("llm_adapter: openai (BYOK) registered");
    }

    // Anthropic + ollama land in follow-up commits — they need a different
    // wire shape (Anthropic Messages) / no auth (Ollama) respectively.
}
