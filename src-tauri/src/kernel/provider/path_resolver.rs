// PATH resolution helpers — ADR-002 substrate § provider v2 §3.3.
//
// Tauri-spawned processes inherit a minimal PATH like
// `/usr/bin:/bin:/usr/sbin:/sbin`. Real-world CLI providers (claude,
// codex, gemini, aider, ollama) live in user package-manager dirs that
// the sparse PATH excludes:
//   - /opt/homebrew/bin             — macOS Apple Silicon brew
//   - /usr/local/bin                — macOS Intel brew, generic Linux installs
//   - ~/.npm-global/bin             — npm prefix override
//   - ~/.local/bin                  — pipx / cargo install --root local
//   - ~/.cargo/bin                  — rustup-installed cargo binaries
//   - ~/.bun/bin                    — bun-installed CLIs
//   - ~/.deno/bin                   — deno-installed CLIs
//   - ~/.volta/bin / ~/.fnm/aliases — node version managers
//
// `augmented_path()` prepends these dirs so spawned child processes
// reach their shims (the existing `kernel::subprocess_actor` already
// does this for mcp processes; this module exposes the same logic
// to the provider sub-system so new CLI / REST adapters share one
// resolver instead of each rolling their own).
//
// `resolve_binary_path(name)` scans the augmented PATH for the named
// binary and returns the first absolute path it finds (or None when the
// binary is genuinely missing). Detection results are intentionally
// uncached here — `detect::detect_cli_providers` adds the session-stable
// cache layer.

use std::path::PathBuf;

/// Directories prepended to a child process's `PATH` when CTRL spawns
/// a CLI provider. Order matters: earlier entries win on name collision,
/// matching the user-shell convention.
const KNOWN_BIN_DIRS: &[&str] = &[
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
];

/// Directories under `$HOME` that may contain a binary. Skipped if HOME
/// is unavailable (CI / sandbox) or the dir doesn't exist.
const HOME_BIN_SUFFIXES: &[&str] = &[
    // CTRL bootstraps its own uv/uvx/node here (agent_installer::ensure_uvx) —
    // needed so a portable pack manifest with a bare `uv` command resolves
    // (ADR-002 substrate § composition §7.4 self-contained packs).
    ".ctrl/bin",
    ".npm-global/bin",
    ".local/bin",
    ".cargo/bin",
    ".bun/bin",
    ".deno/bin",
    ".volta/bin",
];

/// Build a `PATH`-shaped string that prepends [`KNOWN_BIN_DIRS`] and
/// the HOME-relative dirs to the process's inherited PATH. Idempotent:
/// repeated calls return new strings each time (the cost is one
/// allocation per spawn site, which is the right trade given the
/// memory cost of caching a String with lifetime hooks).
pub fn augmented_path() -> String {
    augment(std::env::var("PATH").ok())
}

/// Pure core of [`augmented_path`] per ADR-002 substrate § provider v2
/// §3.3 (2026-05-31): takes the inherited PATH as a parameter so tests
/// can exercise the merge logic without mutating process-global state
/// (a leaked `set_var("PATH", ...)` breaks every later PTY-spawn test
/// in the same process).
fn augment(inherited: Option<String>) -> String {
    let mut parts: Vec<String> = Vec::new();
    for d in KNOWN_BIN_DIRS {
        parts.push((*d).to_string());
    }
    if let Some(home) = home_dir() {
        for suffix in HOME_BIN_SUFFIXES {
            let mut p = home.clone();
            for seg in suffix.split('/') {
                p.push(seg);
            }
            parts.push(p.to_string_lossy().into_owned());
        }
    }
    if let Some(inherited) = inherited {
        // Preserve the inherited PATH at the end so user-set entries
        // remain reachable, while our augmentations win on conflict.
        parts.push(inherited);
    }
    parts.join(":")
}

/// Return the first absolute path to `name` found in the augmented
/// PATH, or None when no candidate exists / is executable. Bin names
/// are looked up verbatim — no `.exe` suffixing today (Tauri 2 binds
/// the same code path for Windows; that platform's PATH lookup goes
/// through `where.exe` separately and is not yet wired here).
pub fn resolve_binary_path(name: &str) -> Option<PathBuf> {
    for dir_str in path_search_dirs() {
        let candidate = PathBuf::from(&dir_str).join(name);
        if is_executable_file(&candidate) {
            return Some(candidate);
        }
    }
    None
}

/// Iterator-friendly view of the augmented PATH split into individual
/// search dirs. Centralises the PATH parsing so detection and resolution
/// agree on what counts as "on PATH".
fn path_search_dirs() -> Vec<String> {
    augmented_path().split(':').map(str::to_string).collect()
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME").ok().map(PathBuf::from)
}

#[cfg(unix)]
fn is_executable_file(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    // Any execute bit (user / group / other) qualifies — mirrors the
    // shell's behaviour when resolving binaries off PATH.
    meta.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable_file(path: &std::path::Path) -> bool {
    std::fs::metadata(path).map(|m| m.is_file()).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn augmented_path_includes_known_bin_dirs() {
        let p = augmented_path();
        assert!(p.contains("/opt/homebrew/bin"));
        assert!(p.contains("/usr/local/bin"));
    }

    #[test]
    fn augmented_path_preserves_inherited_when_present() {
        // Exercise the merge logic via the pure core — never set the
        // process-global PATH from a test: cargo test runs every test in
        // one process, so a leaked set_var breaks later PTY-spawn tests.
        let p = augment(Some("/tmp/ctrl-augmented-test".into()));
        assert!(p.contains("/tmp/ctrl-augmented-test"));
        assert!(
            p.ends_with("/tmp/ctrl-augmented-test"),
            "inherited PATH must come last so augmentations win: {p}"
        );
    }

    #[test]
    fn resolve_binary_path_finds_sh() {
        // `/bin/sh` is present on every supported Unix host.
        let p = resolve_binary_path("sh");
        assert!(p.is_some(), "expected to resolve /bin/sh on a Unix host");
    }

    #[test]
    fn resolve_binary_path_returns_none_for_unknown() {
        let p = resolve_binary_path("ctrl-totally-fake-binary-name-xyz");
        assert!(p.is_none());
    }
}
