// Local config loader for LLM providers.
//
// The single file `$HOME/.ctrl/config.toml` is the user-edited source of
// truth for which providers are active and what credentials they carry.
// On every startup, `register_default_adapters` reads this file first
// and registers providers from it; if the file is absent, missing a
// provider entry, or has `enabled = false`, the adapter loader falls
// back to the keychain (legacy path for users who ran `setup_llm_key`).
//
// File shape (see ctrl.config.toml.example for the canonical template):
//
//   [providers.volc]
//   enabled = true
//   api_key = "..."
//   base_url = "https://ark.cn-beijing.volces.com/api/v3"
//   default_model = "doubao-1-5-pro-32k-250115"
//
//   [providers.openai]
//   enabled = false
//   api_key = ""
//   base_url = "https://api.openai.com/v1"
//   default_model = "gpt-4o-mini"

use serde::Deserialize;
use std::path::PathBuf;

/// Default path: `$HOME/.ctrl/config.toml`. Returns None when HOME is
/// unset (CI env without keyring access — adapter falls through cleanly).
pub fn default_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("config.toml"))
}

#[derive(Debug, Deserialize, Default)]
pub struct LocalConfig {
    #[serde(default)]
    pub providers: ProvidersConfig,
}

#[derive(Debug, Deserialize, Default)]
pub struct ProvidersConfig {
    #[serde(default)]
    pub volc: Option<ProviderEntry>,
    #[serde(default)]
    pub openai: Option<ProviderEntry>,
    /// Local Ollama daemon (no API key needed when running on loopback).
    #[serde(default)]
    pub ollama: Option<ProviderEntry>,
    /// MiniMax cloud LLM (BYOK, OpenAI-shape compatible endpoint).
    #[serde(default)]
    pub minimax: Option<ProviderEntry>,
    /// Anthropic Messages API direct (BYOK API key). Native protocol,
    /// not OpenAI-shape — uses AnthropicHttpAdapter.
    #[serde(default)]
    pub anthropic: Option<ProviderEntry>,
    /// DeepSeek (OpenAI-compatible endpoint). `deepseek-chat` /
    /// `deepseek-reasoner`. Fastest TTFT for users in China.
    #[serde(default)]
    pub deepseek: Option<ProviderEntry>,
    /// Google Gemini via the OpenAI-compatibility endpoint. Native
    /// Gemini protocol is not used in v1 — the compat endpoint speaks
    /// chat.completions and lets the openai_shape adapter handle it.
    #[serde(default)]
    pub gemini: Option<ProviderEntry>,
    /// Groq (OpenAI-compatible). Llama-family models at very low TTFT
    /// (~50ms on Llama 3.3 70B).
    #[serde(default)]
    pub groq: Option<ProviderEntry>,
    // The `claude_cli` / `claude-code` subscription entry was removed —
    // a stale key in an old config.toml is silently ignored at parse
    // time (serde skips unknown fields). Claude subscription OAuth may
    // not back an LLM provider per Anthropic's usage policy (ADR-002
    // substrate § provider v61, 2026-07-11 + ADR-006 § byok-no-claude).
    // BYOK Anthropic lives under `anthropic` above.
}

#[derive(Debug, Deserialize, Clone)]
pub struct ProviderEntry {
    /// Deprecated — accepted for backward compatibility but ignored. The
    /// schema used to require enabled=true; users had to flip TWO knobs
    /// (set api_key AND set enabled=true) which was a foot-gun. Now a
    /// non-empty api_key is the single signal that an entry is active.
    /// Leave this field out, set true, set false — all treated the same.
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub default_model: String,
}

impl ProviderEntry {
    /// True iff `api_key` is non-empty (whitespace-only counts as empty).
    /// The historic `enabled` boolean is intentionally NOT consulted —
    /// see the field comment.
    pub fn is_usable(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

/// Read + parse the config file. Returns None when the file doesn't
/// exist OR can't be parsed; both cases are treated the same by callers
/// (fall through to keychain). Parse errors are logged so a user with a
/// typo doesn't silently get the wrong adapter.
pub fn load_from(path: &std::path::Path) -> Option<LocalConfig> {
    let bytes = match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(?path, error = %e, "ctrl.config: read failed");
            }
            return None;
        }
    };
    match toml::from_str::<LocalConfig>(&bytes) {
        Ok(cfg) => Some(cfg),
        Err(e) => {
            tracing::warn!(?path, error = %e, "ctrl.config: parse failed (check toml syntax)");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minimal_volc_only() {
        let s = r#"
            [providers.volc]
            api_key = "abc"
            base_url = "https://x.test"
            default_model = "m"
        "#;
        let cfg: LocalConfig = toml::from_str(s).unwrap();
        let v = cfg.providers.volc.unwrap();
        assert!(v.is_usable());
        assert_eq!(v.api_key, "abc");
        assert_eq!(v.default_model, "m");
        assert!(cfg.providers.openai.is_none());
    }

    #[test]
    fn entry_with_blank_key_is_not_usable() {
        let e = ProviderEntry {
            enabled: None,
            api_key: "   ".into(),
            base_url: String::new(),
            default_model: String::new(),
        };
        assert!(!e.is_usable());
    }

    #[test]
    fn entry_with_key_is_usable_regardless_of_enabled_field() {
        // The `enabled` field is deprecated. With api_key non-empty, all
        // three states (missing / true / explicit false) are treated as
        // usable so users don't have to flip two knobs.
        let base = ProviderEntry {
            enabled: None,
            api_key: "real-key".into(),
            base_url: "https://x".into(),
            default_model: "m".into(),
        };
        assert!(base.is_usable());
        assert!(ProviderEntry {
            enabled: Some(true),
            ..base.clone()
        }
        .is_usable());
        assert!(ProviderEntry {
            enabled: Some(false),
            ..base
        }
        .is_usable());
    }

    #[test]
    fn parse_handles_missing_providers_block() {
        let cfg: LocalConfig = toml::from_str("").unwrap();
        assert!(cfg.providers.volc.is_none());
        assert!(cfg.providers.openai.is_none());
    }

    #[test]
    fn parse_ignores_unknown_fields_gracefully() {
        // serde defaults to "deny unknown" only with explicit attr; we
        // didn't add it, so unknown fields are tolerated — a forward-
        // compat win when older builds read newer configs.
        let s = r#"
            [providers.volc]
            enabled = false
            api_key = "k"
            future_field = "ignored"
        "#;
        let cfg: LocalConfig = toml::from_str(s).unwrap();
        // Legacy `enabled = false` is parsed (no schema error) and
        // ignored at is_usable time — only the api_key matters.
        assert!(cfg.providers.volc.unwrap().is_usable());
    }
}
