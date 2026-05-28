// LLM adapters — concrete implementations of the LlmAdapter trait for
// the providers CTRL ships with.
//
// v1 launch posture (amended 2026-05-28, supersedes ADR-005's "Anthropic
// absent from runtime" framing — original lock only meant "no default
// CTRL-shipped Claude API key"; BYOK + CLI subprocess paths are first-
// class once the user opts in):
//
//   OpenAI-shape (HTTP `chat/completions`):
//     - volc      → Volcano Ark / Doubao (default launch provider)
//     - openai    → OpenAI cloud (BYOK)
//     - ollama    → local daemon, no API key
//     - minimax   → MiniMax cloud (BYOK)
//     - deepseek  → DeepSeek cloud (BYOK, fastest TTFT in China)
//     - gemini    → Google Gemini OpenAI-compat endpoint (BYOK)
//     - groq      → Groq (BYOK, lowest TTFT for Llama models)
//
//   Native protocols:
//     - anthropic  → Anthropic Messages API direct (BYOK API key)
//     - claude-cli → `claude` CLI subprocess (uses user's subscription
//                    OAuth token; only path to bill Pro/Max plans after
//                    Anthropic's 2026-04 third-party-tool ban)
//
// Keys live in EITHER `~/.ctrl/config.toml` [providers.*] entries (the
// user-edited source of truth) OR the OS keychain (legacy, set by
// bin/setup_llm_key.rs). Config.toml takes precedence; keychain is the
// fallback. Adapters whose secrets are missing skip registration
// silently — a fresh install has no keys, so the router falls through
// with nothing registered until the user runs setup_llm_key or fills
// in the Settings UI.

pub mod anthropic_http;
pub mod claude_cli;
pub mod local_config;
pub mod openai_shape;

use crate::kernel::llm_port::LlmPortRouter;
use local_config::ProviderEntry;
use std::sync::Arc;

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

/// Per-provider account-name aliases — same string the user types into
/// `setup_llm_key`, plus a few historical variants from earlier docs.
const VOLC_ACCOUNT_ALIASES: &[&str] = &["volc", "ark", "doubao"];
const OPENAI_ACCOUNT_ALIASES: &[&str] = &["openai", "gpt"];
const ANTHROPIC_ACCOUNT_ALIASES: &[&str] = &["anthropic", "claude"];
const OLLAMA_ACCOUNT_ALIASES: &[&str] = &["ollama"];
const MINIMAX_ACCOUNT_ALIASES: &[&str] = &["minimax"];
const DEEPSEEK_ACCOUNT_ALIASES: &[&str] = &["deepseek"];
const GEMINI_ACCOUNT_ALIASES: &[&str] = &["gemini", "google"];
const GROQ_ACCOUNT_ALIASES: &[&str] = &["groq"];

/// Default endpoint + model per provider. Used when the config.toml
/// entry omits `base_url` / `default_model` (or the entry is absent
/// entirely and we got the key from keychain).
struct ProviderDefaults {
    base_url: &'static str,
    model: &'static str,
}

const VOLC_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-1-5-pro-32k-250115",
};
const OPENAI_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
};
const OLLAMA_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "http://localhost:11434/v1",
    model: "qwen2.5",
};
const MINIMAX_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://api.minimax.chat/v1",
    model: "MiniMax-Text-01",
};
const DEEPSEEK_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
};
const GEMINI_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
};
const GROQ_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
};
const ANTHROPIC_DEFAULTS: ProviderDefaults = ProviderDefaults {
    base_url: "https://api.anthropic.com",
    model: "claude-sonnet-4-6-fast",
};
/// Used only for ClaudeCliAdapter default_model — base_url is N/A
/// (binary path resolved separately).
const CLAUDE_CLI_DEFAULT_MODEL: &str = "sonnet";

/// Register the default-shipping adapters on a freshly-constructed
/// LlmPortRouter. Called from KernelRuntime::boot.
pub fn register_default_adapters(router: &mut LlmPortRouter) {
    let local_cfg = local_config::default_config_path()
        .and_then(|p| local_config::load_from(&p))
        .unwrap_or_default();

    // OpenAI-shape providers — same adapter class, different endpoints.
    register_openai_shape(
        router,
        "volc",
        local_cfg.providers.volc.as_ref().filter(|e| e.is_usable()),
        VOLC_ACCOUNT_ALIASES,
        &VOLC_DEFAULTS,
    );
    register_openai_shape(
        router,
        "openai",
        local_cfg.providers.openai.as_ref().filter(|e| e.is_usable()),
        OPENAI_ACCOUNT_ALIASES,
        &OPENAI_DEFAULTS,
    );
    // Ollama runs on localhost without auth — the adapter accepts an
    // empty Bearer token. We treat the entry being present as the
    // single signal to register, ignoring is_usable's api_key check.
    if local_cfg.providers.ollama.is_some()
        || read_keychain_key_aliased(OLLAMA_ACCOUNT_ALIASES).is_some()
    {
        let entry = local_cfg.providers.ollama.as_ref();
        let base_url = entry
            .map(|e| e.base_url.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| OLLAMA_DEFAULTS.base_url.to_string());
        let default_model = entry
            .map(|e| e.default_model.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| OLLAMA_DEFAULTS.model.to_string());
        let adapter = openai_shape::OpenAIShapeAdapter::new(
            "ollama",
            base_url,
            String::new(),
            default_model,
        );
        router.register(Arc::new(adapter));
        tracing::info!("llm_adapter: ollama registered (localhost, no auth)");
    }
    register_openai_shape(
        router,
        "minimax",
        local_cfg.providers.minimax.as_ref().filter(|e| e.is_usable()),
        MINIMAX_ACCOUNT_ALIASES,
        &MINIMAX_DEFAULTS,
    );
    register_openai_shape(
        router,
        "deepseek",
        local_cfg.providers.deepseek.as_ref().filter(|e| e.is_usable()),
        DEEPSEEK_ACCOUNT_ALIASES,
        &DEEPSEEK_DEFAULTS,
    );
    register_openai_shape(
        router,
        "gemini",
        local_cfg.providers.gemini.as_ref().filter(|e| e.is_usable()),
        GEMINI_ACCOUNT_ALIASES,
        &GEMINI_DEFAULTS,
    );
    register_openai_shape(
        router,
        "groq",
        local_cfg.providers.groq.as_ref().filter(|e| e.is_usable()),
        GROQ_ACCOUNT_ALIASES,
        &GROQ_DEFAULTS,
    );

    // ── Anthropic native (BYOK) ────────────────────────────────────────
    let anthropic_from_cfg = local_cfg
        .providers
        .anthropic
        .as_ref()
        .filter(|e| e.is_usable())
        .cloned();
    let anthropic_key = anthropic_from_cfg
        .as_ref()
        .map(|e| e.api_key.clone())
        .or_else(|| read_keychain_key_aliased(ANTHROPIC_ACCOUNT_ALIASES));
    if let Some(key) = anthropic_key {
        let base_url = anthropic_from_cfg
            .as_ref()
            .map(|e| e.base_url.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| ANTHROPIC_DEFAULTS.base_url.to_string());
        let default_model = anthropic_from_cfg
            .as_ref()
            .map(|e| e.default_model.clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| ANTHROPIC_DEFAULTS.model.to_string());
        let adapter =
            anthropic_http::AnthropicHttpAdapter::new("anthropic", base_url, key, default_model);
        router.register(Arc::new(adapter));
        tracing::info!(
            "llm_adapter: anthropic registered via {}",
            if anthropic_from_cfg.is_some() {
                "~/.ctrl/config.toml"
            } else {
                "keychain"
            }
        );
    }

    // ── Claude CLI subprocess (subscription auth) ──────────────────────
    // Active iff (a) the user opted in via [providers.claude_cli] in
    // config.toml AND (b) the `claude` binary is reachable on PATH.
    // No api_key check — the CLI manages its own OAuth token; an
    // unauthenticated CLI will surface AuthFailed at call time.
    if local_cfg.providers.claude_cli.is_some() {
        if let Some(binary_path) = claude_cli::ClaudeCliAdapter::locate_binary() {
            let default_model = local_cfg
                .providers
                .claude_cli
                .as_ref()
                .map(|e| e.default_model.clone())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| CLAUDE_CLI_DEFAULT_MODEL.to_string());
            let adapter = claude_cli::ClaudeCliAdapter::new(
                "claude-cli",
                binary_path.clone(),
                default_model,
            );
            router.register(Arc::new(adapter));
            tracing::info!(
                "llm_adapter: claude-cli registered (binary={binary_path}, uses subscription OAuth)"
            );
        } else {
            tracing::warn!(
                "llm_adapter: claude-cli enabled in config but `claude` binary not on PATH — \
                 install Claude Code (https://claude.ai/code) and re-launch CTRL."
            );
        }
    }
}

/// DRY helper for registering an OpenAI-shape provider from
/// (config entry, keychain aliases, defaults). The 7 OpenAI-compat
/// providers all follow the same boilerplate; this collapses it so
/// adding the 8th doesn't grow mod.rs by another 30 lines.
fn register_openai_shape(
    router: &mut LlmPortRouter,
    name: &'static str,
    from_config: Option<&ProviderEntry>,
    keychain_aliases: &[&str],
    defaults: &ProviderDefaults,
) {
    let key = from_config
        .map(|e| e.api_key.clone())
        .or_else(|| read_keychain_key_aliased(keychain_aliases));
    let Some(key) = key else {
        return;
    };
    let base_url = from_config
        .map(|e| e.base_url.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| defaults.base_url.to_string());
    let default_model = from_config
        .map(|e| e.default_model.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| defaults.model.to_string());
    let adapter = openai_shape::OpenAIShapeAdapter::new(name, base_url, key, default_model);
    router.register(Arc::new(adapter));
    tracing::info!(
        "llm_adapter: {name} registered via {}",
        if from_config.is_some() {
            "~/.ctrl/config.toml"
        } else {
            "keychain"
        }
    );
}
