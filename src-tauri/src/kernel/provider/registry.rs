// ProviderRegistry — load manifests, instantiate adapters, hold the
// per-capability active state.
//
// ADR-004 §9.1 lock #3:
//   - `ProviderRegistry::load()` reads builtin/*.toml at startup +
//     scans `~/.ctrl/providers/`.
//   - `active_provider(capability) -> ProviderHandle` lookup is the hot
//     path the chat commands hit.
//   - active state persists to `~/.ctrl/state/active-providers.json`
//     (per-capability map).
//
// Builtin TOMLs are embedded via `include_str!` so a packaged release
// always has them even if the user's `~/.ctrl/providers/` is empty.
// User-installed manifests (or builtins re-saved into the user dir
// with an edited `endpoint` / `models[]`) WIN — last loaded wins so a
// custom manifest can override a builtin without code change.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use serde::{Deserialize, Serialize};

use super::adapter::{ClaudePersistentProvider, HttpApiProvider, OneShotCliProvider};
use super::manifest::{
    default_active_state_path, default_user_providers_dir, legacy_config_path, parse_file,
    parse_str, AuthSource, ManifestError, ProviderKind, ProviderManifest,
};
use super::r#trait::{Capability, Provider};
use super::types::ProviderError;
use super::verify::trial_chat;

const KEYCHAIN_SERVICE_PRIMARY: &str = "app.ctrl";
const KEYCHAIN_SERVICE_LEGACY: &str = "app.ctrl.spike";

/// Embedded builtin manifests — single source of truth for the 6
/// presets ADR-004 §9.1 lock #6 mandates.
const BUILTIN_MANIFESTS: &[(&str, &str)] = &[
    ("claude-oauth", include_str!("builtin/claude-oauth.toml")),
    ("anthropic-api", include_str!("builtin/anthropic-api.toml")),
    ("openai-api", include_str!("builtin/openai-api.toml")),
    ("volc", include_str!("builtin/volc.toml")),
    ("kimi", include_str!("builtin/kimi.toml")),
    ("deepseek", include_str!("builtin/deepseek.toml")),
];

pub type ProviderHandle = Arc<dyn Provider>;

/// One loaded entry — instantiated adapter + the source manifest +
/// whether the credential resolution succeeded at boot.
struct LoadedProvider {
    manifest: Arc<ProviderManifest>,
    provider: Option<ProviderHandle>,
    load_error: Option<String>,
}

pub struct ProviderRegistry {
    /// All known manifests by id. `provider` is Some when the
    /// credential resolution + adapter construction succeeded; None
    /// when the manifest loaded but credentials were absent — UI can
    /// still list the manifest and prompt the user to set a key.
    providers: RwLock<BTreeMap<String, LoadedProvider>>,
    /// Currently active provider id per capability. Mirrors
    /// `~/.ctrl/state/active-providers.json` on every mutation.
    active: RwLock<BTreeMap<Capability, String>>,
    /// Path the active-state file is persisted to. None when HOME is
    /// unavailable (CI) — in-memory active map still works, just isn't
    /// saved across boots.
    active_state_path: Option<PathBuf>,
}

impl ProviderRegistry {
    /// Build a registry from builtin TOMLs + `~/.ctrl/providers/*.toml`
    /// + legacy `~/.ctrl/config.toml` providers. Failures inside
    /// individual manifests are logged but don't kill registration —
    /// one bad TOML must not break the others.
    pub fn load() -> Self {
        let registry = Self {
            providers: RwLock::new(BTreeMap::new()),
            active: RwLock::new(BTreeMap::new()),
            active_state_path: default_active_state_path(),
        };

        // 1. Builtin presets (always present).
        for (id, src) in BUILTIN_MANIFESTS {
            match parse_str(src, &format!("builtin/{id}.toml")) {
                Ok(manifest) => registry.install_manifest(manifest),
                Err(e) => tracing::warn!(provider = %id, error = %e, "provider: builtin manifest parse failed"),
            }
        }

        // 2. User-installed manifests at ~/.ctrl/providers/*.toml
        //    override builtins (same id wins; useful for endpoint /
        //    model overrides without forking the codebase).
        if let Some(dir) = default_user_providers_dir() {
            if dir.exists() {
                load_user_manifests(&dir, &registry);
            } else {
                tracing::debug!(?dir, "provider: no user manifests directory");
            }
        }

        // 3. Legacy ~/.ctrl/config.toml bridge — keep pre-PR users'
        //    credentials wired even without a new manifest file. Maps
        //    each known [providers.<name>] table to the matching
        //    builtin manifest id (volc → "volc" etc.) and seeds the
        //    auth_secret resolver fallback chain.
        if let Some(path) = legacy_config_path() {
            if path.exists() {
                if let Some(legacy) = load_legacy_config(&path) {
                    apply_legacy_config(&registry, &legacy);
                }
            }
        }

        // 4. Restore active selections.
        registry.restore_active_state();

        registry
    }

    /// Snapshot of all manifests + their load status for the Settings
    /// UI. Sorted by manifest id for stable display order.
    pub fn list(&self) -> Vec<ProviderListEntry> {
        let providers = self.providers.read().unwrap();
        let mut out: Vec<_> = providers
            .values()
            .map(|p| ProviderListEntry {
                id: p.manifest.id.clone(),
                label: p.manifest.label.clone(),
                kind: p.manifest.kind.clone(),
                models: p.manifest.models.clone(),
                description: p.manifest.description.clone(),
                ready: p.provider.is_some(),
                load_error: p.load_error.clone(),
                capabilities: p
                    .manifest
                    .capabilities
                    .iter()
                    .map(|c| c.id().to_string())
                    .collect(),
            })
            .collect();
        out.sort_by(|a, b| a.id.cmp(&b.id));
        out
    }

    /// Lookup the active provider for a capability.
    pub fn active_provider(&self, capability: &Capability) -> Option<ProviderHandle> {
        let active = self.active.read().unwrap();
        let id = active.get(capability)?.clone();
        drop(active);
        self.get(&id)
    }

    /// Lookup by id regardless of active state.
    pub fn get(&self, id: &str) -> Option<ProviderHandle> {
        let providers = self.providers.read().unwrap();
        providers.get(id).and_then(|p| p.provider.clone())
    }

    /// Per-capability active map (for Settings UI badges).
    pub fn active_state(&self) -> BTreeMap<String, String> {
        let active = self.active.read().unwrap();
        active
            .iter()
            .map(|(c, id)| (c.id().to_string(), id.clone()))
            .collect()
    }

    /// Set + persist the active provider for a capability, after a
    /// successful 1-token trial chat. Returns the trial chat reply
    /// text so the UI can display the verification proof.
    pub async fn set_active(
        &self,
        provider_id: &str,
        capability: Capability,
    ) -> Result<String, ProviderError> {
        let provider = self
            .get(provider_id)
            .ok_or_else(|| ProviderError::ProviderNotFound(provider_id.to_string()))?;
        if !provider.capabilities().contains(&capability) {
            return Err(ProviderError::ProviderError(format!(
                "provider {provider_id} does not advertise capability {}",
                capability.id()
            )));
        }
        // 1-token trial — first chunk inside 5s → commit, else surface.
        let reply = trial_chat(provider.as_ref()).await?;
        {
            let mut active = self.active.write().unwrap();
            active.insert(capability, provider_id.to_string());
        }
        self.persist_active_state();
        tracing::info!(
            provider = %provider_id,
            "provider: set_active committed after trial chat"
        );
        Ok(reply)
    }

    /// Backstop for chat commands — return whichever provider is
    /// active for text.chat, else fall back to the first ready provider
    /// that advertises text.chat. Lets a fresh install (no active
    /// state yet) still answer a chat call once any provider has
    /// credentials.
    pub fn primary_text_chat(&self) -> Option<ProviderHandle> {
        if let Some(p) = self.active_provider(&Capability::TextChat) {
            return Some(p);
        }
        let providers = self.providers.read().unwrap();
        providers
            .values()
            .find(|p| {
                p.provider.is_some()
                    && p.manifest
                        .capabilities
                        .iter()
                        .any(|c| *c == Capability::TextChat)
            })
            .and_then(|p| p.provider.clone())
    }

    /// Install (or replace) one manifest. Resolves credentials, builds
    /// the matching adapter, stores both the live provider and the
    /// manifest itself for the Settings UI.
    fn install_manifest(&self, manifest: ProviderManifest) {
        let id = manifest.id.clone();
        let arc = Arc::new(manifest);
        let (provider, load_error) = match instantiate(arc.clone()) {
            Ok(p) => (Some(p), None),
            Err(e) => {
                tracing::debug!(provider = %id, error = %e, "provider: manifest loaded but adapter not ready (credentials?)");
                (None, Some(e.to_string()))
            }
        };
        let mut providers = self.providers.write().unwrap();
        providers.insert(
            id,
            LoadedProvider {
                manifest: arc,
                provider,
                load_error,
            },
        );
    }

    fn persist_active_state(&self) {
        let Some(path) = self.active_state_path.as_ref() else {
            return;
        };
        if let Some(parent) = path.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                tracing::warn!(?parent, error = %e, "provider: mkdir active-state failed");
                return;
            }
        }
        let serializable = self.active_state();
        match serde_json::to_vec_pretty(&serializable) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(path, bytes) {
                    tracing::warn!(?path, error = %e, "provider: write active-state failed");
                }
            }
            Err(e) => tracing::warn!(error = %e, "provider: serialize active-state failed"),
        }
    }

    fn restore_active_state(&self) {
        let Some(path) = self.active_state_path.as_ref() else {
            return;
        };
        let raw = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                if e.kind() != std::io::ErrorKind::NotFound {
                    tracing::warn!(?path, error = %e, "provider: read active-state failed");
                }
                return;
            }
        };
        let parsed: BTreeMap<String, String> = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(?path, error = %e, "provider: parse active-state failed");
                return;
            }
        };
        let mut active = self.active.write().unwrap();
        for (cap_id, provider_id) in parsed {
            if let Some(cap) = Capability::from_id(&cap_id) {
                active.insert(cap, provider_id);
            }
        }
    }
}

/// Construct the adapter for a manifest. Looks up credentials per
/// `AuthSource`. Returns Err with a typed `ProviderError::NotConfigured`
/// when the manifest is well-formed but credentials are absent — the
/// registry keeps the manifest entry so the Settings UI can prompt the
/// user to fill in a key.
fn instantiate(manifest: Arc<ProviderManifest>) -> Result<ProviderHandle, ProviderError> {
    let auth_secret = resolve_auth(&manifest)?;
    match manifest.kind {
        ProviderKind::HttpApi => {
            let provider = HttpApiProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::CliOneShot => {
            let provider = OneShotCliProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::CliClaudePersistent => {
            let provider = ClaudePersistentProvider::from_manifest(manifest)?;
            Ok(Arc::new(provider))
        }
    }
}

fn resolve_auth(manifest: &ProviderManifest) -> Result<String, ProviderError> {
    match &manifest.auth {
        AuthSource::None => Ok(String::new()),
        AuthSource::Env { var } => std::env::var(var).map_err(|_| {
            ProviderError::NotConfigured(format!(
                "{}: env {var} not set",
                manifest.id
            ))
        }),
        AuthSource::ConfigKey { field } => manifest
            .config
            .get(field)
            .cloned()
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| {
                ProviderError::NotConfigured(format!(
                    "{}: config.{field} not set",
                    manifest.id
                ))
            }),
        AuthSource::Keychain { account } => {
            keychain_read_with_aliases(account, &legacy_account_aliases(account)).ok_or_else(|| {
                ProviderError::NotConfigured(format!(
                    "{}: keychain account {account:?} not set",
                    manifest.id
                ))
            })
        }
    }
}

/// Backwards-compatible aliases for legacy keychain accounts the old
/// `setup_llm_key` binary used. Lets a user who set up "ark" / "doubao"
/// before the rename keep working without re-running setup.
fn legacy_account_aliases(account: &str) -> Vec<&'static str> {
    match account {
        "volc" => vec!["volc", "ark", "doubao"],
        "openai" => vec!["openai", "gpt"],
        "anthropic" => vec!["anthropic", "claude"],
        "gemini" => vec!["gemini", "google"],
        _ => Vec::new(),
    }
}

fn keychain_read_with_aliases(primary: &str, aliases: &[&str]) -> Option<String> {
    let candidates: Vec<&str> = std::iter::once(primary).chain(aliases.iter().copied()).collect();
    for service in [KEYCHAIN_SERVICE_PRIMARY, KEYCHAIN_SERVICE_LEGACY] {
        for account in &candidates {
            if let Ok(entry) = keyring::Entry::new(service, account) {
                if let Ok(secret) = entry.get_password() {
                    if !secret.is_empty() {
                        return Some(secret);
                    }
                }
            }
        }
    }
    None
}

/// Scan `~/.ctrl/providers/*.toml`. One bad file is logged + skipped;
/// good files override builtins with matching `id`.
fn load_user_manifests(dir: &Path, registry: &ProviderRegistry) {
    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => {
            tracing::warn!(?dir, error = %e, "provider: read user manifests dir failed");
            return;
        }
    };
    let mut count = 0usize;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("toml") {
            continue;
        }
        match parse_file(&path) {
            Ok(manifest) => {
                registry.install_manifest(manifest);
                count += 1;
            }
            Err(e) => tracing::warn!(?path, error = %e, "provider: user manifest parse failed"),
        }
    }
    if count > 0 {
        tracing::info!(count, ?dir, "provider: user manifests loaded");
    }
}

// ── Legacy ~/.ctrl/config.toml bridge ───────────────────────────────────

#[derive(Debug, Default, Deserialize)]
struct LegacyConfig {
    #[serde(default)]
    providers: LegacyProviders,
}

#[derive(Debug, Default, Deserialize)]
struct LegacyProviders {
    #[serde(default)]
    volc: Option<LegacyEntry>,
    #[serde(default)]
    openai: Option<LegacyEntry>,
    #[serde(default)]
    anthropic: Option<LegacyEntry>,
    #[serde(default)]
    deepseek: Option<LegacyEntry>,
    #[serde(default)]
    minimax: Option<LegacyEntry>,
    #[serde(default)]
    gemini: Option<LegacyEntry>,
    #[serde(default)]
    groq: Option<LegacyEntry>,
    #[serde(default, alias = "claude-code", alias = "claude_code")]
    claude_cli: Option<LegacyEntry>,
    #[serde(default)]
    ollama: Option<LegacyEntry>,
    #[serde(default, alias = "kimi-anthropic")]
    kimi: Option<LegacyEntry>,
}

#[derive(Debug, Clone, Deserialize)]
struct LegacyEntry {
    #[serde(default)]
    api_key: String,
    #[serde(default)]
    base_url: String,
    #[serde(default)]
    default_model: String,
}

impl LegacyEntry {
    fn has_key(&self) -> bool {
        !self.api_key.trim().is_empty()
    }
}

fn load_legacy_config(path: &Path) -> Option<LegacyConfig> {
    let raw = std::fs::read_to_string(path).ok()?;
    match toml::from_str(&raw) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(?path, error = %e, "provider: legacy config.toml parse failed");
            None
        }
    }
}

/// Merge legacy `[providers.*]` credentials into the registry. We DON'T
/// build new manifests from the legacy file — the builtin presets cover
/// the same provider ids; instead we override endpoint/model on the
/// matching builtin manifest + re-instantiate so the adapter picks up
/// the user's api_key without them needing to author a new TOML.
fn apply_legacy_config(registry: &ProviderRegistry, legacy: &LegacyConfig) {
    let mappings: &[(&str, Option<&LegacyEntry>)] = &[
        ("volc", legacy.providers.volc.as_ref()),
        ("openai-api", legacy.providers.openai.as_ref()),
        ("anthropic-api", legacy.providers.anthropic.as_ref()),
        ("deepseek", legacy.providers.deepseek.as_ref()),
        ("kimi", legacy.providers.kimi.as_ref()),
        ("claude-oauth", legacy.providers.claude_cli.as_ref()),
    ];
    for (manifest_id, legacy_entry) in mappings {
        let Some(entry) = legacy_entry else { continue };
        // claude-oauth doesn't need an api_key from the legacy entry —
        // the OAuth lives in the CLI's own keychain. Still apply the
        // override so the user's `default_model` is honored if set.
        if !entry.has_key() && *manifest_id != "claude-oauth" {
            continue;
        }
        let mut providers = registry.providers.write().unwrap();
        let Some(loaded) = providers.get_mut(*manifest_id) else { continue };
        let mut next_manifest = (*loaded.manifest).clone();
        if !entry.base_url.trim().is_empty() {
            next_manifest.endpoint = Some(entry.base_url.trim_end_matches('/').to_string());
        }
        if !entry.default_model.trim().is_empty() {
            // Make this the front model so it becomes the default.
            next_manifest.models.retain(|m| m != &entry.default_model);
            next_manifest.models.insert(0, entry.default_model.clone());
        }
        // For HTTP providers, stash the api_key in config + flip auth to
        // ConfigKey — registry's `resolve_auth` will then surface it.
        if matches!(next_manifest.kind, ProviderKind::HttpApi) && entry.has_key() {
            next_manifest.config.insert("api_key".to_string(), entry.api_key.clone());
            next_manifest.auth = AuthSource::ConfigKey {
                field: "api_key".to_string(),
            };
        }
        let next_arc = Arc::new(next_manifest);
        let (provider, load_error) = match instantiate(next_arc.clone()) {
            Ok(p) => (Some(p), None),
            Err(e) => {
                tracing::debug!(provider = %manifest_id, error = %e, "provider: legacy bridge re-instantiate failed");
                (None, Some(e.to_string()))
            }
        };
        loaded.manifest = next_arc;
        loaded.provider = provider;
        loaded.load_error = load_error;
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProviderListEntry {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub models: Vec<String>,
    pub description: String,
    /// True iff credentials resolved AND adapter constructed without
    /// error. False = manifest known but unusable (Settings UI shows
    /// "set api key").
    pub ready: bool,
    pub load_error: Option<String>,
    pub capabilities: Vec<String>,
}

// Re-export the inner ManifestError type for the rest of the kernel.
pub use super::manifest::ManifestError as ProviderManifestError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_account_aliases_covers_renamed_accounts() {
        assert!(legacy_account_aliases("volc").contains(&"ark"));
        assert!(legacy_account_aliases("openai").contains(&"gpt"));
        assert!(legacy_account_aliases("anthropic").contains(&"claude"));
        assert!(legacy_account_aliases("nope").is_empty());
    }

    #[test]
    fn builtin_manifests_all_parse() {
        for (id, src) in BUILTIN_MANIFESTS {
            let m = parse_str(src, &format!("builtin/{id}.toml"))
                .unwrap_or_else(|e| panic!("builtin {id} parse failed: {e}"));
            assert_eq!(&m.id, id);
        }
    }
}
