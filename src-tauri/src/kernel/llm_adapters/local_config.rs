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
}

#[derive(Debug, Deserialize, Clone)]
pub struct ProviderEntry {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub api_key: String,
    #[serde(default)]
    pub base_url: String,
    #[serde(default)]
    pub default_model: String,
}

impl ProviderEntry {
    /// True iff this entry is usable — enabled flag set AND api_key non-empty.
    /// A `[providers.volc]` block left at `enabled = false` (the template
    /// default) returns false here so the loader skips it cleanly.
    pub fn is_usable(&self) -> bool {
        self.enabled && !self.api_key.trim().is_empty()
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
            enabled = true
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
            enabled: true,
            api_key: "   ".into(),
            base_url: String::new(),
            default_model: String::new(),
        };
        assert!(!e.is_usable());
    }

    #[test]
    fn entry_disabled_is_not_usable_even_with_key() {
        let e = ProviderEntry {
            enabled: false,
            api_key: "real-key".into(),
            base_url: "https://x".into(),
            default_model: "m".into(),
        };
        assert!(!e.is_usable());
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
            enabled = true
            api_key = "k"
            future_field = "ignored"
        "#;
        let cfg: LocalConfig = toml::from_str(s).unwrap();
        assert!(cfg.providers.volc.unwrap().is_usable());
    }
}
