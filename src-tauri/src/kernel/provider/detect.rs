// CLI provider detection — ADR-002 substrate § provider v2 §3.6.
//
// Scans the augmented PATH for the 5 CLI binaries v2 supports (claude,
// codex, gemini, aider, ollama). Results are cached at the process
// level via `OnceLock<Mutex<...>>` because installed binaries don't
// appear / disappear mid-session; repeated `provider_detect` calls
// otherwise re-stat the same dirs each time the Settings page mounts.
//
// Inspired by VMark `ai_provider/detection.rs` (ISC). This is NOT a
// verbatim port — VMark's version spawns the user's login shell to
// resolve a fuller PATH (`-lic` + start/end markers) and binds a
// Windows PowerShell profile path lookup. CTRL's `path_resolver.rs`
// covers the equivalent surface for Unix without subprocess spawn;
// Windows support is deferred to the platform-specific follow-up.

use std::sync::Mutex;

use serde::Serialize;

use super::path_resolver::resolve_binary_path;

/// One scanned CLI provider. Mirrors VMark's `CliProviderEntry`
/// shape so the Settings UI can render the same Available / Not-found
/// pattern without an extra wire-shape adapter.
#[derive(Debug, Clone, Serialize)]
pub struct CliProviderEntry {
    /// Short id, e.g. `claude` / `codex` / `gemini` / `aider` / `ollama`.
    pub provider_type: String,
    /// Display label.
    pub name: String,
    /// Binary name as it appears on PATH.
    pub command: String,
    /// True iff `resolve_binary_path` found an executable file.
    pub available: bool,
    /// Absolute path when available, None otherwise.
    pub path: Option<String>,
}

/// Static table of CLIs we know how to detect. Mirrors ADR-002
/// substrate § provider v2 §3.6. Order is the first-boot priority
/// when picking a default `irisy.primary` (claude first wins).
const CLI_PROVIDERS: &[(&str, &str, &str)] = &[
    ("claude", "Claude", "claude"),
    ("codex", "Codex", "codex"),
    ("gemini", "Gemini", "gemini"),
    ("aider", "Aider", "aider"),
    ("ollama", "Ollama", "ollama"),
];

/// Session-stable cache. First call scans PATH; subsequent calls
/// reuse the result so the Settings page can mount repeatedly without
/// re-statting the dirs. The cache is invalidated via
/// `invalidate_cache()` if a future feature needs to force a re-scan.
static DETECTION_CACHE: Mutex<Option<Vec<CliProviderEntry>>> = Mutex::new(None);

/// Scan the augmented PATH for every CLI in [`CLI_PROVIDERS`].
/// Cached after the first call.
pub fn detect_cli_providers() -> Vec<CliProviderEntry> {
    if let Some(cached) = DETECTION_CACHE.lock().unwrap_or_else(|p| p.into_inner()).clone() {
        return cached;
    }
    let detected = scan_now();
    *DETECTION_CACHE.lock().unwrap_or_else(|p| p.into_inner()) = Some(detected.clone());
    detected
}

/// Invalidate the session cache so the next `detect_cli_providers()`
/// re-scans PATH. Today wired only for tests; the upstream "refresh"
/// button in Settings can opt into this when it lands.
#[allow(dead_code)]
pub fn invalidate_cache() {
    *DETECTION_CACHE.lock().unwrap_or_else(|p| p.into_inner()) = None;
}

fn scan_now() -> Vec<CliProviderEntry> {
    CLI_PROVIDERS
        .iter()
        .map(|(typ, name, cmd)| {
            let path = resolve_binary_path(cmd);
            CliProviderEntry {
                provider_type: (*typ).to_string(),
                name: (*name).to_string(),
                command: (*cmd).to_string(),
                available: path.is_some(),
                path: path.map(|p| p.to_string_lossy().into_owned()),
            }
        })
        .collect()
}

/// BYOK REST manifest order for first-boot `irisy.primary` selection.
/// ADR-002 substrate § provider v3 amendment 2026-06-04 (bao directive:
/// claude cli is unreliable, switch to BYOK REST API as primary, move
/// the CLI providers to fallback). First-boot scans keychain for the
/// first REST adapter with a usable credential and binds it as primary;
/// bypasses Claude OAuth token-expiry circus (Issue #36489) and the
/// broader CLI-process reliability surface (stderr drain, goose-style
/// NDJSON aborts, etc.) for users who already have a paid API key.
const BYOK_REST_MANIFEST_ORDER: &[(&str, &str)] = &[
    // (manifest_id, keychain_account). Account names match the
    // `legacy_account_aliases` resolver in registry.rs so an entry
    // stored under a legacy alias still wins.
    ("anthropic-api", "anthropic"),
    ("openai-api", "openai"),
    ("volc-byok", "volc-byok"),
    ("kimi", "kimi"),
    ("deepseek", "deepseek"),
    ("google", "gemini"),
];

/// CLI fallback order for first-boot `irisy.primary` when no BYOK REST
/// credential exists. Same priority as the legacy v2 behavior; surfaced
/// here so the registry's route_chain fallbacks list can reuse the same
/// constant. ADR-002 § provider v3 §3.6.
pub const CLI_FALLBACK_MANIFEST_ORDER: &[&str] = &[
    "claude-oauth",
    // Future: "codex", "aider"
];

/// Pick the highest-priority provider for first-boot `irisy.primary`
/// auto-adoption. ADR-002 substrate § provider v3 amendment 2026-06-04:
/// BYOK REST keychain scan first; CLI fallback only when no REST key
/// is configured. Returns the manifest id to bind.
pub fn first_boot_primary_choice() -> Option<&'static str> {
    // 1) BYOK REST first — bypass CLI auth instability.
    for (manifest_id, account) in BYOK_REST_MANIFEST_ORDER {
        if has_keychain_secret(account) {
            return Some(*manifest_id);
        }
    }
    // 2) CLI fallback — same priority as v2, claude-oauth top.
    let detected = detect_cli_providers();
    for manifest_id in CLI_FALLBACK_MANIFEST_ORDER {
        let cli_id = manifest_id_to_cli(manifest_id);
        if let Some(entry) = detected.iter().find(|e| e.provider_type == cli_id) {
            if entry.available {
                return Some(*manifest_id);
            }
        }
    }
    None
}

/// True iff `account` has a non-empty keychain entry under either the
/// primary or legacy service. Mirrors the registry's
/// `keychain_read_with_aliases` shape but only checks existence (no
/// secret materialization) so the first-boot scan stays cheap.
fn has_keychain_secret(account: &str) -> bool {
    for service in ["app.ctrl", "app.ctrl.spike"] {
        if let Ok(entry) = keyring::Entry::new(service, account) {
            if let Ok(s) = entry.get_password() {
                if !s.is_empty() {
                    return true;
                }
            }
        }
    }
    false
}

/// Map a CLI manifest id back to its `provider_type` string used in
/// `CLI_PROVIDERS`. Centralized so adding a new CLI builtin updates one
/// table only.
fn manifest_id_to_cli(manifest_id: &str) -> &'static str {
    match manifest_id {
        "claude-oauth" => "claude",
        // Future: "codex" => "codex", "aider" => "aider"
        _ => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_returns_entries_for_all_known_clis() {
        invalidate_cache();
        let entries = detect_cli_providers();
        assert_eq!(entries.len(), CLI_PROVIDERS.len());
        let ids: Vec<&str> = entries.iter().map(|e| e.provider_type.as_str()).collect();
        assert!(ids.contains(&"claude"));
        assert!(ids.contains(&"codex"));
        assert!(ids.contains(&"gemini"));
        assert!(ids.contains(&"aider"));
        assert!(ids.contains(&"ollama"));
    }

    #[test]
    fn cache_returns_same_results_on_repeat() {
        invalidate_cache();
        let first = detect_cli_providers();
        let second = detect_cli_providers();
        assert_eq!(first.len(), second.len());
    }
}
