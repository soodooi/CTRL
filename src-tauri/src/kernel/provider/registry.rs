// ProviderRegistry — load manifests, instantiate adapters, hold the
// per-role active state.
//
// ADR-002 substrate § provider v2 lock #3:
//   - `ProviderRegistry::load()` reads builtin/*.toml at startup +
//     scans `~/.ctrl/providers/`.
//   - `active_for_consumer(role) -> ProviderHandle` lookup is the hot
//     path the chat commands hit (replaces v1 `active_provider(capability)`).
//   - active state persists to `~/.ctrl/state/active-providers.json`
//     (role-keyed map under "roles" top-level key, v2 schema).
//
// v2 amendment (2026-05-31): switched from capability-keyed to role-keyed
// active map (Consumer enum). 2 roles only: irisy.primary (user CLI,
// 0 CTRL cost) + irisy.fallback (CTRL-managed paid `volc` by default).
// Boot seeds irisy.fallback = "volc" so a fresh install without any
// detected CLI still has a working AI path.
// Migration: v0 file `{"text.chat":"<id>"}` -> roles.irisy.primary = <id>;
// v1 file with `mcp.default` -> drop that key.
//
// Builtin TOMLs are embedded via `include_str!` so a packaged release
// always has them even if the user's `~/.ctrl/providers/` is empty.
// User-installed manifests (or builtins re-saved into the user dir
// with an edited `endpoint` / `models[]`) WIN — last loaded wins so a
// custom manifest can override a builtin without code change.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::SystemTime;

/// Cooldown window after a provider's chat_stream / first-chunk peek fails.
/// While inside the window, `http_endpoint` skips this provider as the
/// primary candidate IF there is at least one fallback available, so we
/// don't re-pay the failed primary's spawn/connect cost on every Pi turn.
/// 5 minutes balances "react fast when user fixes auth" vs "don't waste
/// 300 ms / 401 on every turn during a Claude OAuth outage". ADR-002
/// substrate § provider v2 §3.5 M2 amendment 2026-06-04.
const PROVIDER_COOLDOWN_SECS: u64 = 300;

use serde::{Deserialize, Serialize};

use super::adapter::{
    ClaudePersistentProvider, HttpApiProvider, OneShotCliProvider, RestAnthropicProvider,
    RestGoogleProvider, RestOllamaProvider, RestOpenaiProvider,
};
use super::manifest::{
    default_active_state_path, default_user_providers_dir, legacy_config_path, parse_file,
    parse_str, AuthSource, HttpShape, ProviderKind, ProviderManifest,
};
use super::r#trait::{Capability, Consumer, Provider, RouteChain};

/// Who pays for a provider's calls. Surfaced by `snapshot()` so the
/// Settings UI + brain_status response can mark CTRL-billed paths
/// distinctly from user-owned ones. ADR-002 substrate § provider v2 §3.7.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderManagedBy {
    /// CTRL pays — credential owned by CTRL secrets pipeline (today the
    /// `volc` builtin is the occupier).
    Ctrl,
    /// User pays — credential lives in the user keychain or the user
    /// already owns the CLI subscription (claude-oauth etc.).
    User,
}

/// Snapshot of a single provider's externally-relevant state. Used by
/// `commands/provider::brain_status` to compose the role status block
/// without exposing the internal `LoadedProvider` / `ProviderManifest`
/// types to the command layer. ADR-002 substrate § provider v2 §3.7.
#[derive(Debug, Clone, Serialize)]
pub struct ProviderSnapshot {
    pub id: String,
    pub label: String,
    pub kind: ProviderKind,
    pub endpoint: Option<String>,
    pub binary: Option<String>,
    /// True iff the credential resolved AND the adapter was instantiated.
    /// False = manifest known but not usable (user needs to set a key).
    pub ready: bool,
    pub managed_by: ProviderManagedBy,
}
use super::types::ProviderError;
use super::verify::trial_chat;

const KEYCHAIN_SERVICE_PRIMARY: &str = "app.ctrl";
const KEYCHAIN_SERVICE_LEGACY: &str = "app.ctrl.spike";

/// Manifest id used for the CTRL-managed fallback slot. ADR-002
/// substrate § provider v2 lock #3: irisy.fallback always seeds to this
/// at boot when no persisted state overrides it. Today the credential
/// path still reads the user keychain (account="volc"); a follow-up
/// will swap to a ctrl-cloud secrets pipeline.
const CTRL_FALLBACK_PROVIDER_ID: &str = "volc";

/// Manifest ids whose credential pipeline is owned by CTRL (CTRL pays
/// the bill). Used by `snapshot()` to set `managed_by`. ADR-002
/// substrate § provider v2 lock #3 + v2 §3.7: the `volc` builtin is the
/// occupier today; future ctrl-brand provider ids land here too.
const CTRL_MANAGED_PROVIDER_IDS: &[&str] = &["volc"];

/// Embedded builtin manifests — single source of truth for the 9
/// presets ADR-002 substrate § provider v2 §3.2 + lock #6 mandate.
/// v2 added `volc-byok` (separate slot from the CTRL-managed `volc`
/// fallback) plus `google` + `ollama` (verbatim VMark REST adapters).
// bao 2026-06-05 e: BYOK builtins (openai-api / volc-byok / kimi /
// deepseek / google) removed from BUILTIN_MANIFESTS. Hardcoded preset
// list was anti-pattern (industry default: user adds free-form custom
// providers via `~/.ctrl/providers/<slug>.toml`, no preset clutter).
// Only `ollama` (works without a key — local) stays builtin so a fresh
// install has at least one runnable substrate. `volc` (CTRL-managed
// fallback) also dropped — without a baked CTRL key it cannot chat,
// so listing it just creates a confusing "not ready" row.
// Users add providers via PWA AddModal -> config_set_provider_key
// (which writes a user-owned .toml + keychain entry).
const BUILTIN_MANIFESTS: &[(&str, &str)] = &[
    ("ollama", include_str!("builtin/ollama.toml")),
];

pub type ProviderHandle = Arc<dyn Provider>;

/// Where the manifest came from. PWA Settings groups rows by source
/// (Available auto-detected vs. user-added BYOK). bao 2026-06-06.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderSource {
    /// Shipped with CTRL (BUILTIN_MANIFESTS).
    Builtin,
    /// User-added at `~/.ctrl/providers/<id>.toml` via PWA AddModal.
    User,
}

/// One loaded entry — instantiated adapter + the source manifest +
/// whether the credential resolution succeeded at boot.
struct LoadedProvider {
    manifest: Arc<ProviderManifest>,
    provider: Option<ProviderHandle>,
    load_error: Option<String>,
    source: ProviderSource,
}

pub struct ProviderRegistry {
    /// All known manifests by id. `provider` is Some when the
    /// credential resolution + adapter construction succeeded; None
    /// when the manifest loaded but credentials were absent — UI can
    /// still list the manifest and prompt the user to set a key.
    providers: RwLock<BTreeMap<String, LoadedProvider>>,
    /// Currently active provider id per consumer role (v2: was per
    /// `Capability` in v1). Mirrors `~/.ctrl/state/active-providers.json`
    /// `"roles"` map on every mutation.
    active: RwLock<BTreeMap<Consumer, String>>,
    /// Path the active-state file is persisted to. None when HOME is
    /// unavailable (CI) — in-memory active map still works, just isn't
    /// saved across boots.
    active_state_path: Option<PathBuf>,
    /// Most recent failover transition observed by `http_endpoint`.
    /// `None` until the first auto-fallback fires. Surfaced via
    /// `brain_status()` so the PWA + Irisy prompt can acknowledge the
    /// transition without polling logs. ADR-002 substrate § provider
    /// v2 §3.5 + §3.7.
    last_failover: RwLock<Option<RecordedFailover>>,
    /// Transient routing override while the primary is in outage. Read by
    /// `commands::provider::get_active_providers` so the chip overlays the
    /// fallback label until primary recovers. Set/cleared from
    /// `http_endpoint` — kernel events surface to Tauri via
    /// `KernelHandle::app::emit`. ADR-002 substrate § provider v8 §3.5
    /// (2026-06-06).
    routing_override: RwLock<Option<RoutingOverride>>,
    /// Recent-failure cache, keyed by manifest id. Populated by
    /// `mark_failure` (called from the http_endpoint fallback loop) and
    /// consulted via `is_in_cooldown` so subsequent Pi turns skip a
    /// known-bad primary while the cooldown window holds. Cleared on
    /// observed success via `clear_failure`. ADR-002 substrate §
    /// provider v2 §3.5 M2 amendment 2026-06-04 — avoids re-paying the
    /// ~300 ms claude CLI spawn (or REST 401) every turn during a
    /// Claude OAuth outage.
    provider_health: RwLock<BTreeMap<String, HealthState>>,
}

/// One provider's last-known failure state. Reset entries also persist
/// the `reason` text so `brain_status` / logs can surface why the
/// cooldown was set without reading log scrollback.
#[derive(Debug, Clone)]
struct HealthState {
    last_failure_at: SystemTime,
    reason: String,
}

/// One failover transition: primary → fallback at a moment in time.
/// Reset to None never happens during a session — the latest event
/// wins. `at_unix_ms` is monotonic-ish (system time) and intentionally
/// not used for ordering elsewhere; the Settings UI just renders it
/// for the user to know how stale "Claude offline → switched" is.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecordedFailover {
    pub from: String,
    pub to: String,
    pub reason: String,
    pub at_unix_ms: i64,
}

/// Transient routing override during a primary outage. ADR-002 substrate §
/// provider v8 §3.5 (2026-06-06): when the primary chat_stream fails the
/// router routes the same request to fallback + sets this state + emits
/// `provider:routing-override` Tauri event. SSOT file (active-providers.json)
/// is NOT mutated — user intent is not stolen by transient failure. On the
/// next successful primary call the state clears + emits
/// `provider:routing-restored`. PWA chip + ctrl-pi-bridge runtimeTruthBlock
/// overlay this on top of `get_active_providers()` for the duration.
#[derive(Debug, Clone, Serialize)]
pub struct RoutingOverride {
    /// Canonical role id of the fallback that is currently servicing the
    /// primary's traffic, e.g. "irisy.fallback". Chip uses this to look
    /// up the displayed label.
    pub active: String,
    pub reason: String,
    pub at_unix_ms: i64,
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
            last_failover: RwLock::new(None),
            routing_override: RwLock::new(None),
            provider_health: RwLock::new(BTreeMap::new()),
        };

        // 1. Builtin presets (always present).
        for (id, src) in BUILTIN_MANIFESTS {
            match parse_str(src, &format!("builtin/{id}.toml")) {
                Ok(manifest) => registry.install_manifest(manifest, ProviderSource::Builtin),
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

        // 4. Restore active selections (with v0/v1 -> v2 schema migration).
        registry.restore_active_state();

        // 5. ADR-002 substrate § provider v2 lock #3: seed CTRL-managed
        //    fallback if user hasn't overridden. Guarantees a fresh install
        //    without any detected CLI still has a working AI path.
        registry.seed_default_fallback();

        // 6. ADR-002 substrate § provider v2 §3.6 first-boot auto-adopt:
        //    if IrisyPrimary is unset AND a known user CLI is on PATH,
        //    silently bind it. Persists immediately so subsequent boots
        //    skip the detection cost.
        registry.first_boot_auto_adopt();

        registry
    }

    /// Ensure `Consumer::IrisyFallback` is bound to the CTRL-managed
    /// provider when the persisted state did not specify one. Idempotent
    /// and never overwrites a user choice. Does NOT persist — the seeded
    /// default is recomputed at next boot unless the user explicitly
    /// `set_active` something else.
    fn seed_default_fallback(&self) {
        let mut active = self.active.write().unwrap();
        active
            .entry(Consumer::IrisyFallback)
            .or_insert_with(|| CTRL_FALLBACK_PROVIDER_ID.to_string());
    }

    /// First-boot single-CLI auto-adopt. ADR-002 substrate § provider
    /// v2 §3.6: when no `IrisyPrimary` is configured (fresh install OR
    /// explicit unset by user delete), if a known user CLI is detected
    /// on PATH we silently bind it as the primary so the user does not
    /// have to open Settings just to get their own Claude OAuth wired
    /// up. The CTRL-managed fallback (`volc`) seeded above already
    /// handles the no-CLI case.
    ///
    /// Only fires when the chosen manifest is actually `ready` — if
    /// `claude` is on PATH but `claude-oauth`'s adapter failed to
    /// instantiate (binary path lookup quirk etc.), we leave the slot
    /// unset and let the Settings UI surface the issue.
    fn first_boot_auto_adopt(&self) {
        {
            let active = self.active.read().unwrap();
            if active.contains_key(&Consumer::IrisyPrimary) {
                return;
            }
        }
        let Some(manifest_id) = super::detect::first_boot_primary_choice() else {
            return;
        };
        let providers = self.providers.read().unwrap();
        let Some(loaded) = providers.get(manifest_id) else {
            return;
        };
        if loaded.provider.is_none() {
            return;
        }
        drop(providers);
        {
            let mut active = self.active.write().unwrap();
            active.insert(Consumer::IrisyPrimary, manifest_id.to_string());
        }
        self.persist_active_state();
        tracing::info!(
            manifest = %manifest_id,
            "provider: first-boot auto-adopted IrisyPrimary from detected user CLI"
        );
    }

    /// Record a failover transition observed by `http_endpoint` when
    /// the primary provider failed and the request was routed through
    /// a fallback. The last transition wins; reads via
    /// `last_failover_event()`. ADR-002 substrate § provider v2 §3.5.
    pub fn record_failover(&self, from: &str, to: &str, reason: &str) {
        let event = RecordedFailover {
            from: from.to_string(),
            to: to.to_string(),
            reason: reason.to_string(),
            at_unix_ms: now_unix_ms(),
        };
        tracing::info!(
            from = %from,
            to = %to,
            reason = %reason,
            "provider: failover recorded"
        );
        let mut slot = self.last_failover.write().unwrap();
        *slot = Some(event);
    }

    /// Set transient routing override. ADR-002 substrate § provider v8
    /// §3.5 (2026-06-06): called from `http_endpoint` when the primary
    /// chat_stream fails and a fallback is now servicing the role. The
    /// SSOT file is NOT mutated (user intent is not stolen). Idempotent —
    /// re-setting with the same value is a no-op for callers.
    pub fn set_routing_override(&self, active_role: &str, reason: &str) {
        let next = RoutingOverride {
            active: active_role.to_string(),
            reason: reason.to_string(),
            at_unix_ms: now_unix_ms(),
        };
        let mut slot = self.routing_override.write().unwrap();
        *slot = Some(next);
    }

    /// Clear the transient routing override. ADR-002 substrate § provider
    /// v8 §3.5 (2026-06-06): called from `http_endpoint` when the primary
    /// successfully services a request again. Idempotent on already-empty.
    pub fn clear_routing_override(&self) {
        let mut slot = self.routing_override.write().unwrap();
        *slot = None;
    }

    /// Read the current routing override (if any). ADR-002 substrate §
    /// provider v8 §3.7 (2026-06-06): consumed by
    /// `commands::provider::get_active_providers` so the chip can overlay
    /// the fallback label until primary recovers.
    pub fn current_routing_override(&self) -> Option<RoutingOverride> {
        self.routing_override.read().unwrap().clone()
    }

    /// Convenience: lookup the first model id declared by a provider
    /// manifest, used by `get_active_providers` to render the default
    /// model the router would pass to that provider. None when the
    /// manifest has zero declared models (manifest authoring bug, surfaced
    /// to the user as "(no model)" rather than silently falling back).
    /// ADR-002 substrate § provider v8 §3.7 (2026-06-06).
    pub fn first_model_for(&self, id: &str) -> Option<String> {
        let providers = self.providers.read().unwrap();
        providers
            .get(id)
            .and_then(|p| p.manifest.models.first().cloned())
    }

    /// Read the most recent failover transition, or None when no
    /// transition has fired this session. Consumed by
    /// `commands::provider::brain_status`.
    pub fn last_failover_event(&self) -> Option<RecordedFailover> {
        self.last_failover.read().unwrap().clone()
    }

    /// Record that `provider_id` failed (either chat_stream() returned
    /// Err, or the first stream chunk was Err). Resets the cooldown
    /// clock. ADR-002 substrate § provider v2 §3.5 M2 2026-06-04.
    pub fn mark_failure(&self, provider_id: &str, reason: &str) {
        let mut map = self.provider_health.write().unwrap();
        map.insert(
            provider_id.to_string(),
            HealthState {
                last_failure_at: SystemTime::now(),
                reason: reason.to_string(),
            },
        );
        tracing::debug!(
            provider = %provider_id,
            reason = %reason,
            "provider: marked unhealthy (cooldown active)"
        );
    }

    /// Drop any cooldown entry for `provider_id`. Called from the
    /// http_endpoint success branch so the slot reopens immediately
    /// when the underlying issue clears (user runs `claude login`,
    /// network restored, etc.). Idempotent — missing entry is a no-op.
    pub fn clear_failure(&self, provider_id: &str) {
        let mut map = self.provider_health.write().unwrap();
        if map.remove(provider_id).is_some() {
            tracing::debug!(
                provider = %provider_id,
                "provider: cooldown cleared after observed success"
            );
        }
    }

    /// True iff `provider_id` failed within the last
    /// `PROVIDER_COOLDOWN_SECS` window. http_endpoint uses this to
    /// short-circuit a primary candidate when at least one fallback
    /// remains, saving the spawn / connect cost during an outage.
    pub fn is_in_cooldown(&self, provider_id: &str) -> bool {
        let map = self.provider_health.read().unwrap();
        let Some(state) = map.get(provider_id) else {
            return false;
        };
        SystemTime::now()
            .duration_since(state.last_failure_at)
            .map(|d| d.as_secs() < PROVIDER_COOLDOWN_SECS)
            .unwrap_or(false)
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
                endpoint: p.manifest.endpoint.clone(),
                models: p.manifest.models.clone(),
                description: p.manifest.description.clone(),
                ready: p.provider.is_some(),
                load_error: p.load_error.clone(),
                source: p.source,
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

    /// Lookup the active provider for a consumer role (v2).
    pub fn active_for_consumer(&self, consumer: &Consumer) -> Option<ProviderHandle> {
        let active = self.active.read().unwrap();
        let id = active.get(consumer)?.clone();
        drop(active);
        self.get(&id)
    }

    /// Lookup by id regardless of active state.
    pub fn get(&self, id: &str) -> Option<ProviderHandle> {
        let providers = self.providers.read().unwrap();
        providers.get(id).and_then(|p| p.provider.clone())
    }

    /// Snapshot one provider's manifest + load-state for the brain_status
    /// response. `managed_by` derives from a hardcoded ids allowlist
    /// (`CTRL_MANAGED_PROVIDER_IDS`) — when CTRL adds a ctrl-brand
    /// manifest, its id goes in that const and snapshot() reports it as
    /// `Ctrl` without touching the manifest schema.
    /// Re-scan `~/.ctrl/providers/*.toml` and merge any new manifests
    /// into the in-memory registry. bao 2026-06-06: PWA's
    /// config_set_provider_key writes new user TOMLs but the registry
    /// only scanned the dir once at boot, so newly added providers
    /// did not show up in `provider_list` until restart. Calling this
    /// before list() in the Tauri command makes saves visible
    /// instantly. Idempotent + non-destructive (re-parsing the same
    /// file replaces the manifest but keeps the loaded state shape).
    pub fn reload_user_dir(&self) {
        if let Some(dir) = default_user_providers_dir() {
            if dir.exists() {
                load_user_manifests(&dir, self);
            }
        }
    }

    /// Get the full parsed manifest for a provider id. Used by
    /// http_endpoint::run_get_active_provider_details to hand
    /// ctrl-pi-bridge the wire-shape + auth + models needed to
    /// `pi.registerProvider`. bao 2026-06-05 b.
    pub fn manifest_for(&self, id: &str) -> Option<Arc<super::manifest::ProviderManifest>> {
        let providers = self.providers.read().unwrap();
        providers.get(id).map(|lp| lp.manifest.clone())
    }

    pub fn snapshot(&self, id: &str) -> Option<ProviderSnapshot> {
        let providers = self.providers.read().unwrap();
        let loaded = providers.get(id)?;
        let m = &loaded.manifest;
        let managed_by = if CTRL_MANAGED_PROVIDER_IDS.contains(&m.id.as_str()) {
            ProviderManagedBy::Ctrl
        } else {
            ProviderManagedBy::User
        };
        Some(ProviderSnapshot {
            id: m.id.clone(),
            label: m.label.clone(),
            kind: m.kind.clone(),
            endpoint: m.endpoint.clone(),
            binary: m.binary.clone(),
            ready: loaded.provider.is_some(),
            managed_by,
        })
    }

    /// Per-role active map (for Settings UI badges + brain_status).
    /// Keys are canonical role ids ("irisy.primary" / "irisy.fallback").
    pub fn active_state(&self) -> BTreeMap<String, String> {
        let active = self.active.read().unwrap();
        active
            .iter()
            .map(|(c, id)| (c.id(), id.clone()))
            .collect()
    }

    /// Unified provider injection (ADR-002 §1.3): resolve the active
    /// `irisy.primary` provider into the standard env vars the external
    /// agents (opencode, hermes) honor, so all three faces share ONE
    /// BYOK config — configure once in CTRL, every face uses it.
    ///
    /// Maps the active provider's shape to the convention:
    ///   anthropic-shape -> ANTHROPIC_API_KEY (+ ANTHROPIC_BASE_URL)
    ///   openai-shape     -> OPENAI_API_KEY    (+ OPENAI_BASE_URL)
    /// (openai-compatible covers doubao / deepseek / kimi / qwen / etc.)
    /// Returns an empty map when no HTTP provider is active or the key is
    /// not resolvable — agents then fall back to their own config.
    pub fn agent_env_injection(&self) -> BTreeMap<String, String> {
        let mut env = BTreeMap::new();
        let id = {
            let active = self.active.read().unwrap();
            match active.get(&Consumer::IrisyPrimary) {
                Some(id) => id.clone(),
                None => return env,
            }
        };
        let providers = self.providers.read().unwrap();
        let Some(loaded) = providers.get(&id) else {
            return env;
        };
        let m = &loaded.manifest;
        if m.kind != ProviderKind::HttpApi {
            // CLI providers (claude-oauth) own their auth; don't inject.
            return env;
        }
        let key = match resolve_auth(m) {
            Ok(k) if !k.is_empty() => k,
            _ => return env,
        };
        // ADR-002 substrate §1.3 v19 (2026-06-11): opencode reads its
        // provider config from OPENCODE_CONFIG_CONTENT (the generic keys
        // below cover hermes, which reads ANTHROPIC_API_KEY/OPENAI_API_KEY
        // directly). Build the explicit provider+model so opencode works
        // with the user's actual CTRL provider, including openai-compatible
        // ones (doubao / deepseek / kimi / qwen).
        let model = m.models.first().cloned().unwrap_or_default();
        match m.shape {
            HttpShape::AnthropicMessages => {
                env.insert("ANTHROPIC_API_KEY".into(), key.clone());
                if let Some(ep) = &m.endpoint {
                    env.insert("ANTHROPIC_BASE_URL".into(), ep.clone());
                }
                let cfg = serde_json::json!({
                    "provider": { "anthropic": { "options": { "apiKey": key } } },
                    "model": format!("anthropic/{model}"),
                });
                env.insert("OPENCODE_CONFIG_CONTENT".into(), cfg.to_string());
            }
            HttpShape::OpenaiChatCompletions => {
                env.insert("OPENAI_API_KEY".into(), key.clone());
                let base = m.endpoint.clone().unwrap_or_default();
                if !base.is_empty() {
                    env.insert("OPENAI_BASE_URL".into(), base.clone());
                }
                let cfg = serde_json::json!({
                    "provider": {
                        "ctrl": {
                            "npm": "@ai-sdk/openai-compatible",
                            "name": m.label,
                            "options": { "baseURL": base, "apiKey": key },
                            "models": { model.clone(): {} },
                        }
                    },
                    "model": format!("ctrl/{model}"),
                });
                env.insert("OPENCODE_CONFIG_CONTENT".into(), cfg.to_string());
            }
        }
        env
    }

    /// Build the resolution chain for one consumer (primary + ordered
    /// fallbacks).
    ///
    /// ADR-002 substrate § provider v3 amendment 2026-06-04 (bao
    /// directive: claude cli is unreliable, switch to BYOK REST API as
    /// primary, move CLI providers to fallback):
    /// - IrisyPrimary: primary = user-configured id (default BYOK REST
    ///   if any key exists; else first detected CLI). Fallbacks =
    ///   [detected CLI manifests in priority order, then CTRL-managed
    ///   fallback]. CLI providers thus serve as backup, not as primary
    ///   default, so a Claude OAuth circuit-breaker (Issue #36489)
    ///   never blocks first-message latency.
    /// - IrisyFallback: primary = configured id (defaults "volc"), no
    ///   further fallback (fallback of the fallback would loop).
    /// - Custom(_): same shape as IrisyPrimary.
    pub fn route_chain(&self, consumer: &Consumer) -> RouteChain {
        let active = self.active.read().unwrap();
        let primary = active.get(consumer).cloned();
        let fallback_id = active
            .get(&Consumer::IrisyFallback)
            .cloned()
            .unwrap_or_else(|| CTRL_FALLBACK_PROVIDER_ID.to_string());
        drop(active);
        // ADR-002 substrate § brain v13 (2026-06-07, retracts v11 §3.11):
        // coding.primary slot removed. Pi owns its own provider via
        // ~/.pi/agent/models.json; no separate CTRL routing slot.
        let fallbacks = match consumer {
            Consumer::IrisyFallback => Vec::new(),
            _ => {
                let mut chain: Vec<String> = Vec::new();
                // 1) Detected CLI manifests as fallbacks (v3 amendment).
                //    Skip the one already bound as primary so we don't
                //    retry the same handle twice in a row.
                for cli_manifest_id in super::detect::CLI_FALLBACK_MANIFEST_ORDER {
                    let id = cli_manifest_id.to_string();
                    if Some(&id) == primary.as_ref() {
                        continue;
                    }
                    // Only push when the manifest is actually loaded
                    // (`provider.is_some()` proxied via `get`). An
                    // unloaded manifest would just consume a fallback
                    // slot with no chance of answering.
                    if self.get(&id).is_some() {
                        chain.push(id);
                    }
                }
                // 2) CTRL-managed fallback (volc today, future
                //    ctrl-cloud proxy). Dedupe in case a CLI fallback
                //    above shared the id (defensive forward-compat).
                if primary.as_deref() != Some(fallback_id.as_str())
                    && !chain.contains(&fallback_id)
                {
                    chain.push(fallback_id);
                }
                chain
            }
        };
        RouteChain { primary, fallbacks }
    }

    /// Set + persist the active provider for a consumer role, after a
    /// successful 1-token trial chat. Returns the trial chat reply
    /// text so the UI can display the verification proof. ADR-002
    /// substrate § provider v2 lock #4: trial verify is mandatory before
    /// commit; failure keeps the previous role binding intact.
    pub async fn set_active(
        &self,
        provider_id: &str,
        consumer: Consumer,
    ) -> Result<String, ProviderError> {
        let provider = self
            .get(provider_id)
            .ok_or_else(|| ProviderError::ProviderNotFound(provider_id.to_string()))?;
        // Both Irisy roles serve text.chat today; Custom(_) consumers skip
        // the check (they own their own capability contract).
        // ADR-002 substrate § brain v13 (2026-06-07, retracts CodingPrimary).
        let needs_text_chat = matches!(
            consumer,
            Consumer::IrisyPrimary | Consumer::IrisyFallback
        );
        if needs_text_chat && !provider.capabilities().contains(&Capability::TextChat) {
            return Err(ProviderError::ProviderError(format!(
                "provider {provider_id} does not advertise text.chat for role {}",
                consumer.id()
            )));
        }
        // 1-token trial — first chunk inside 5s → commit, else surface.
        let reply = trial_chat(provider.as_ref()).await?;
        {
            let mut active = self.active.write().unwrap();
            active.insert(consumer.clone(), provider_id.to_string());
        }
        // bao 2026-06-04: trial success ⇒ provider is healthy NOW. If a
        // prior turn marked it failed (cooldown still active for up to
        // PROVIDER_COOLDOWN_SECS), the next /text-chat would still skip
        // it. Clearing here lets a manual re-pick from Settings →
        // Providers immediately reactivate a previously-cooled-down
        // provider without waiting out the 5 min window.
        self.clear_failure(provider_id);
        self.persist_active_state();
        tracing::info!(
            provider = %provider_id,
            role = %consumer.id(),
            "provider: set_active committed after trial chat"
        );
        Ok(reply)
    }

    /// Backstop for chat commands (8 callsites). Resolves the
    /// IrisyPrimary handle first; on miss walks the IrisyPrimary
    /// `route_chain` fallbacks; on miss falls through to any ready
    /// provider that advertises text.chat. Lets a fresh install with
    /// no detected CLI still answer once the seeded fallback loads.
    pub fn primary_text_chat(&self) -> Option<ProviderHandle> {
        // 1. IrisyPrimary if configured + ready
        if let Some(p) = self.active_for_consumer(&Consumer::IrisyPrimary) {
            return Some(p);
        }
        // 2. Walk IrisyPrimary fallback chain
        for fallback_id in self.route_chain(&Consumer::IrisyPrimary).fallbacks {
            if let Some(p) = self.get(&fallback_id) {
                return Some(p);
            }
        }
        // 3. IrisyFallback direct (seeded to "volc" at boot)
        if let Some(p) = self.active_for_consumer(&Consumer::IrisyFallback) {
            return Some(p);
        }
        // 4. Last-resort scan — first ready provider with text.chat.
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
    fn install_manifest(&self, manifest: ProviderManifest, source: ProviderSource) {
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
                source,
            },
        );
    }

    /// Persist the role-keyed active map under the `"roles"` top-level
    /// key (v2 schema). ADR-002 substrate § provider v2 lock #3.
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
        let roles = self.active_state();
        let envelope = ActiveStateV2 { roles };
        match serde_json::to_vec_pretty(&envelope) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(path, bytes) {
                    tracing::warn!(?path, error = %e, "provider: write active-state failed");
                }
            }
            Err(e) => tracing::warn!(error = %e, "provider: serialize active-state failed"),
        }
    }

    /// Read persisted active selections. Accepts three on-disk formats
    /// for migration safety (ADR-002 substrate § provider v2 lock #3):
    ///
    /// - **v0** (pre-roles, capability-keyed flat): `{"text.chat": "<id>"}`
    ///   -> migrates to `roles.irisy.primary = <id>` (the lone bucket
    ///   becomes the new primary; IrisyFallback gets seeded separately).
    /// - **v1** (3-role): `{"roles": {"irisy.primary":..., "irisy.fallback":...,
    ///   "mcp.default":...}}` -> drops `mcp.default`, keeps the rest.
    /// - **v2** (2-role): `{"roles": {"irisy.primary":..., "irisy.fallback":...}}`
    ///   -> loaded as-is.
    ///
    /// After successful migration the in-memory state is the v2 shape;
    /// the next mutation (`set_active` or `seed_default_fallback`) will
    /// rewrite the file in v2 schema and the old shape disappears.
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
        // Try v2 / v1 envelope first; on failure fall through to v0 flat map.
        let mut roles: BTreeMap<String, String> = BTreeMap::new();
        let mut migrated_from: Option<&'static str> = None;
        if let Ok(envelope) = serde_json::from_str::<ActiveStateV2>(&raw) {
            roles = envelope.roles;
            // v1 -> v2: drop `mcp.default` if present.
            if roles.remove("mcp.default").is_some() {
                migrated_from = Some("v1 (3-role with mcp.default)");
            }
        } else if let Ok(flat) = serde_json::from_str::<BTreeMap<String, String>>(&raw) {
            // v0 single-bucket: `{"text.chat": "<id>"}` -> roles.irisy.primary
            if let Some(primary_id) = flat.get("text.chat") {
                roles.insert(Consumer::IrisyPrimary.id(), primary_id.clone());
                migrated_from = Some("v0 (single text.chat bucket)");
            } else {
                tracing::warn!(
                    ?path,
                    "provider: active-state file is flat map but lacks text.chat key — skipping"
                );
                return;
            }
        } else {
            tracing::warn!(?path, "provider: parse active-state failed — skipping");
            return;
        }
        let mut active = self.active.write().unwrap();
        for (role_id, provider_id) in &roles {
            active.insert(Consumer::from_id(role_id), provider_id.clone());
        }
        drop(active);
        if let Some(from) = migrated_from {
            tracing::info!(
                ?path,
                from = %from,
                "provider: active-state migrated to v2 schema; next persist will rewrite the file"
            );
            // Force-rewrite so the file matches the in-memory v2 shape.
            self.persist_active_state();
        }
    }
}

/// On-disk shape for `~/.ctrl/state/active-providers.json` v2 schema:
/// `{"roles": {"irisy.primary": "...", "irisy.fallback": "..."}}`.
#[derive(Debug, Serialize, Deserialize)]
struct ActiveStateV2 {
    #[serde(default)]
    roles: BTreeMap<String, String>,
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
        // ADR-002 substrate § provider v2 §3.2 — verbatim VMark REST kinds.
        ProviderKind::RestAnthropic => {
            let provider = RestAnthropicProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::RestOpenai => {
            let provider = RestOpenaiProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::RestGoogle => {
            let provider = RestGoogleProvider::from_manifest(manifest, auth_secret)?;
            Ok(Arc::new(provider))
        }
        ProviderKind::RestOllama => {
            // Ollama needs no credential; `resolve_auth` returns "" for
            // AuthSource::None, which we discard here.
            let _ = auth_secret;
            let provider = RestOllamaProvider::from_manifest(manifest)?;
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
    // bao 2026-06-06 e fix: shell out to `security` CLI here too. The
    // keyring crate apple-native path returns no entry from signed
    // CTRL.app even when the entry physically exists (verified via
    // standalone unsigned probe + via `security find-generic-password`).
    // Adapter construction silently failed for every user-added
    // provider because credential resolution always returned None.
    // bao 2026-06-06: read from encrypted file vault. Iterate the
    // primary slug + any aliases. The vault is account-keyed only
    // (no service namespace), so the two-loop over keychain services
    // collapses into a single account lookup.
    let candidates: Vec<&str> = std::iter::once(primary).chain(aliases.iter().copied()).collect();
    for account in &candidates {
        if let Ok(Some(secret)) = crate::shell::credential_vault::get(account) {
            if !secret.is_empty() {
                return Some(secret);
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
                registry.install_manifest(manifest, ProviderSource::User);
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
    /// HTTP endpoint URL (when `kind = HttpApi`). Surfaces the manifest
    /// `endpoint` so the PWA Edit modal can prefill the Base URL field
    /// — bao 2026-06-06: previously empty in Edit, forcing user to
    /// remember + retype, broken UX.
    pub endpoint: Option<String>,
    pub models: Vec<String>,
    pub description: String,
    /// True iff credentials resolved AND adapter constructed without
    /// error. False = manifest known but unusable (Settings UI shows
    /// "set api key").
    pub ready: bool,
    pub load_error: Option<String>,
    /// Where the manifest came from — drives Settings UI grouping
    /// (Available [system] vs. Your providers [user-added]).
    /// bao 2026-06-06.
    pub source: ProviderSource,
    pub capabilities: Vec<String>,
}

// Re-export the inner ManifestError type for the rest of the kernel.

/// Current Unix millis. Used as `RecordedFailover::at_unix_ms`. Returns
/// 0 if the system clock is somehow before Unix epoch (won't happen on
/// any supported target but the unwrap-free path keeps the code total).
fn now_unix_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

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
