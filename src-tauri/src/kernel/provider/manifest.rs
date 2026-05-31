// Provider manifest — TOML schema deserialized into `ProviderManifest`.
//
// ADR-004 §9.1 lock #2. The 6 builtin presets live under
// `kernel/provider/builtin/*.toml` and ship inside the bundle; user-
// installed manifests land in `~/.ctrl/providers/<id>.toml`. The
// registry concatenates both sources at boot.
//
// Adding a provider = adding a TOML file (or a `[providers.foo]`
// override in `~/.ctrl/config.toml` — see `legacy_config` below for
// the bridge that imports the pre-PR config). No Rust change needed
// for a new OpenAI-shape / Anthropic-shape endpoint.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::r#trait::Capability;

/// Discriminates which adapter handles a manifest. Adapters are wired
/// in `registry::instantiate` — the registry refuses to load a manifest
/// whose `kind` it doesn't know.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    /// One-shot CLI subprocess (codex / gemini). Manifest-driven via
    /// `adapter::cli::one_shot`.
    CliOneShot,
    /// Persistent CLI subprocess (claude). Goose-style; bespoke at
    /// `adapter::cli::claude_persistent`.
    CliClaudePersistent,
    /// HTTP API — actual wire shape selected via `shape` field
    /// (`openai` or `anthropic`).
    HttpApi,
}

/// HTTP wire shape for `ProviderKind::HttpApi`. Selected by manifest
/// `shape` field; mismatched (or missing) shape on an `HttpApi` manifest
/// is a load-time error.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum HttpShape {
    #[default]
    OpenaiChatCompletions,
    AnthropicMessages,
}

/// Where the runtime should source a credential. `Keychain` reads via
/// `keyring` (service `app.ctrl`, account = `account`). `Env` reads
/// `std::env::var`. `ConfigKey` is the path-into-the-manifest fallback —
/// reads `manifest.config.<field>` (manifests can stash a plain api_key
/// when the user explicitly wants it in the file, e.g. dev configs).
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum AuthSource {
    Keychain { account: String },
    Env { var: String },
    ConfigKey { field: String },
    /// No credentials needed (e.g. ollama on localhost). The adapter
    /// passes through with empty auth.
    None,
}

/// One provider manifest. The TOML root deserializes directly into this
/// struct — no nested `[provider.xxx]` table, the file IS the provider.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderManifest {
    /// Stable id; matches the file stem under `~/.ctrl/providers/` and
    /// is what the registry's `active_provider` lookup keys on.
    pub id: String,
    /// Display label for the Settings UI.
    pub label: String,
    pub kind: ProviderKind,
    /// HTTP wire shape — required iff `kind = HttpApi`.
    #[serde(default)]
    pub shape: HttpShape,
    pub auth: AuthSource,

    // ── CLI path (kind = CliOneShot | CliClaudePersistent) ──────────
    /// Absolute path or PATH-resolvable name of the CLI binary.
    #[serde(default)]
    pub binary: Option<String>,
    /// Args template — interpreted by the cli adapter. `{model}` is the
    /// only template placeholder today; the adapter substitutes before
    /// spawning. Empty = use adapter defaults.
    #[serde(default)]
    pub args_template: Vec<String>,
    /// Env vars to strip before spawning (e.g. claude-oauth must strip
    /// `ANTHROPIC_API_KEY` so the CLI falls back to its OAuth token).
    #[serde(default)]
    pub env_strip: Vec<String>,
    /// Env vars to inject before spawning. Values may reference the
    /// resolved auth secret via `${auth}` — the adapter performs the
    /// substitution.
    #[serde(default)]
    pub env_inject: std::collections::BTreeMap<String, String>,

    // ── HTTP path (kind = HttpApi) ──────────────────────────────────
    /// Base URL, e.g. `https://api.openai.com/v1`. The adapter appends
    /// the per-shape path (`/chat/completions`, `/messages`).
    #[serde(default)]
    pub endpoint: Option<String>,
    /// Extra HTTP headers (e.g. `anthropic-version`). The adapter merges
    /// these on top of its built-in defaults.
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,

    // ── Shared optional ────────────────────────────────────────────────
    /// Capabilities this provider claims to satisfy.
    #[serde(default = "default_capabilities")]
    pub capabilities: Vec<Capability>,
    /// Models the provider supports. First entry = default; empty =
    /// adapter has its own default.
    #[serde(default)]
    pub models: Vec<String>,
    /// Free-text description for Settings UI.
    #[serde(default)]
    pub description: String,
    /// In-file config bag — readable via `AuthSource::ConfigKey`. Lets
    /// a developer test a manifest by pasting a key under
    /// `config = { api_key = "..." }` without touching keychain.
    #[serde(default)]
    pub config: std::collections::BTreeMap<String, String>,
}

fn default_capabilities() -> Vec<Capability> {
    vec![Capability::TextChat]
}

/// Read + parse one TOML manifest file. Returns `Err` with the full path
/// + parser message on failure so the registry can log it without losing
/// the user-facing context.
pub fn parse_file(path: &Path) -> Result<ProviderManifest, ManifestError> {
    let bytes = std::fs::read_to_string(path)
        .map_err(|e| ManifestError::Read(path.to_path_buf(), e.to_string()))?;
    let manifest: ProviderManifest = toml::from_str(&bytes)
        .map_err(|e| ManifestError::Parse(path.to_path_buf(), e.to_string()))?;
    if manifest.id.trim().is_empty() {
        return Err(ManifestError::Validation(
            path.to_path_buf(),
            "id is empty".into(),
        ));
    }
    Ok(manifest)
}

/// Parse a manifest from an in-memory string (used by the builtin
/// `include_str!`-loaded presets and by the unit tests).
pub fn parse_str(source: &str, label: &str) -> Result<ProviderManifest, ManifestError> {
    let manifest: ProviderManifest = toml::from_str(source)
        .map_err(|e| ManifestError::Parse(PathBuf::from(label), e.to_string()))?;
    Ok(manifest)
}

/// Default user-manifest dir: `$HOME/.ctrl/providers/`.
pub fn default_user_providers_dir() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("providers"))
}

/// Default per-capability active state file:
/// `$HOME/.ctrl/state/active-providers.json`. Single JSON map
/// `{ "text.chat": "claude-oauth" }`. Persisted by `set_active`.
pub fn default_active_state_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(
        PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("active-providers.json"),
    )
}

/// Pre-PR `~/.ctrl/config.toml` is still the source of truth for many
/// users — the registry bridges into it so the 0.x → 1.0 transition
/// doesn't drop existing credentials. See `registry::import_legacy_config`.
pub fn legacy_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("config.toml"))
}

#[derive(Debug, thiserror::Error)]
pub enum ManifestError {
    #[error("manifest read failed ({0}): {1}")]
    Read(PathBuf, String),
    #[error("manifest parse failed ({0}): {1}")]
    Parse(PathBuf, String),
    #[error("manifest validation failed ({0}): {1}")]
    Validation(PathBuf, String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_str_loads_minimal_http_manifest() {
        let src = r#"
            id = "openai-api"
            label = "OpenAI"
            kind = "http_api"
            shape = "openai_chat_completions"
            endpoint = "https://api.openai.com/v1"
            models = ["gpt-4o-mini"]

            [auth]
            source = "keychain"
            account = "openai"
        "#;
        let m = parse_str(src, "openai-api.toml").unwrap();
        assert_eq!(m.id, "openai-api");
        assert_eq!(m.kind, ProviderKind::HttpApi);
        assert_eq!(m.shape, HttpShape::OpenaiChatCompletions);
        assert_eq!(m.models, vec!["gpt-4o-mini"]);
        assert!(matches!(m.auth, AuthSource::Keychain { .. }));
        // Default capability list includes text.chat.
        assert!(m.capabilities.contains(&Capability::TextChat));
    }

    #[test]
    fn parse_str_loads_cli_persistent_manifest() {
        let src = r#"
            id = "claude-oauth"
            label = "Claude (OAuth)"
            kind = "cli_claude_persistent"
            binary = "claude"
            env_strip = ["ANTHROPIC_API_KEY"]
            models = ["sonnet"]

            [auth]
            source = "none"
        "#;
        let m = parse_str(src, "claude-oauth.toml").unwrap();
        assert_eq!(m.kind, ProviderKind::CliClaudePersistent);
        assert_eq!(m.binary.as_deref(), Some("claude"));
        assert_eq!(m.env_strip, vec!["ANTHROPIC_API_KEY".to_string()]);
        assert!(matches!(m.auth, AuthSource::None));
    }

    #[test]
    fn parse_str_rejects_missing_id() {
        // toml::from_str catches the missing required field directly; we
        // surface that as a Parse error not a Validation error, matching
        // the error from a malformed file.
        let src = r#"label = "x"
                     kind = "http_api"
                     [auth]
                     source = "none"
                  "#;
        let err = parse_str(src, "bad.toml").unwrap_err();
        assert!(matches!(err, ManifestError::Parse(_, _)));
    }

    #[test]
    fn capability_id_roundtrips() {
        for cap in [
            Capability::TextChat,
            Capability::TextEmbed,
            Capability::ImageGenerate,
            Capability::AudioTts,
            Capability::AudioTranscribe,
        ] {
            assert_eq!(Capability::from_id(cap.id()), Some(cap));
        }
        assert_eq!(Capability::from_id("unknown.capability"), None);
    }
}
