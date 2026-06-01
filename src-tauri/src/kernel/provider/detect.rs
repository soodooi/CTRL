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

/// Pick the highest-priority detected CLI for first-boot
/// `irisy.primary` auto-adoption. Returns the manifest id that should
/// be bound (not the CLI command name) so the registry can look it up
/// in the loaded builtins. ADR-002 substrate § provider v2 §3.6.
///
/// Today the only manifest with a corresponding CLI binary is
/// `claude-oauth` (binary = `claude`). Future CLI builtins (codex,
/// aider) extend this map.
pub fn first_boot_primary_choice() -> Option<&'static str> {
    const CLI_TO_MANIFEST: &[(&str, &str)] = &[
        ("claude", "claude-oauth"),
        // Future: ("codex", "codex"), ("aider", "aider")
    ];
    let detected = detect_cli_providers();
    for (cli_id, manifest_id) in CLI_TO_MANIFEST {
        if let Some(entry) = detected.iter().find(|e| e.provider_type == *cli_id) {
            if entry.available {
                return Some(*manifest_id);
            }
        }
    }
    None
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
