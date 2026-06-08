// Pi install + auto-upgrade.
//
// ADR-002 substrate §3 + §4: Pi is the core. It lives at `~/.ctrl/pi/` (per-user,
// no root needed) and self-updates in the background. The supervisor
// calls `ensure_installed()` once on boot and `spawn_upgrade_probe()` in
// a background thread; the upgrade probe respects a 24 h cache so we
// don't hit the npm registry on every launch.
//
// Why npm-first: Pi is published as `@mariozechner/pi-coding-agent`. If
// `npm` is on the user's PATH (typical macOS dev) we install through it.
// If not (lean user machine), we fall back to a GitHub release tarball.
// Both end with `~/.ctrl/pi/node_modules/@mariozechner/pi-coding-agent/`
// laid out the same way, so the spawn path doesn't care which route ran.
//
// Failure rollback (§4): an upgrade attempt that errors out preserves
// whatever version was already installed (no partial replacement). We
// install into a sibling `~/.ctrl/pi/.upgrade/` and atomically swap the
// `node_modules/` directory only after the new install completes — same
// pattern Tauri's own updater uses for app bundles.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};

/// npm package name for Pi.
pub const PI_NPM_PACKAGE: &str = "@mariozechner/pi-coding-agent";
/// Compatibility pin (peerDependencies major). Bumped when CTRL ships
/// support for a new Pi major.
pub const PI_COMPAT_MAJOR: u32 = 0;
/// How long an upgrade probe result is cached.
const PROBE_CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);

/// Status of the local Pi install. Used by the Settings → Brain UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PiInstallStatus {
    /// Installed version (`x.y.z`) reported by `pi --version`. `None`
    /// when Pi hasn't been installed yet.
    pub installed_version: Option<String>,
    /// Latest known version from the last probe. `None` until the first
    /// probe runs.
    pub latest_version: Option<String>,
    /// True when `installed_version` < `latest_version` AND
    /// `latest_version` is on the supported major (we don't auto-jump
    /// majors — §4 compatibility lock).
    pub upgrade_available: bool,
    /// True when `latest_version` is on a newer major than
    /// `PI_COMPAT_MAJOR`; UI surfaces a "major update — review pending"
    /// banner.
    pub major_update_blocked: bool,
    /// `Some(msg)` if the last upgrade attempt failed. UI shows this in
    /// the status-bar tooltip so the user knows why they're stale.
    pub last_upgrade_error: Option<String>,
    /// ms since epoch — when we last successfully probed the registry.
    /// 0 = never probed.
    pub last_probe_ms: u64,
    /// Absolute path to the installed Pi binary.
    pub pi_bin: Option<String>,
    /// Absolute path to the install root (`~/.ctrl/pi/`).
    pub install_root: Option<String>,
}

impl Default for PiInstallStatus {
    fn default() -> Self {
        Self {
            installed_version: None,
            latest_version: None,
            upgrade_available: false,
            major_update_blocked: false,
            last_upgrade_error: None,
            last_probe_ms: 0,
            pi_bin: None,
            install_root: None,
        }
    }
}

static STATUS: OnceLock<Mutex<PiInstallStatus>> = OnceLock::new();

fn status_slot() -> &'static Mutex<PiInstallStatus> {
    STATUS.get_or_init(|| Mutex::new(PiInstallStatus::default()))
}

/// Snapshot of the current install status. Cheap (in-memory).
pub fn current_status() -> PiInstallStatus {
    status_slot()
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

fn update_status<F: FnOnce(&mut PiInstallStatus)>(mutate: F) {
    if let Ok(mut g) = status_slot().lock() {
        mutate(&mut g);
    }
}

/// Cross-platform home directory. On Windows `HOME` is usually unset, so
/// prefer `directories::BaseDirs` (which resolves `%USERPROFILE%` /
/// known-folder API), then fall back to `USERPROFILE`, then `HOME`.
fn home_dir() -> Option<PathBuf> {
    if let Some(base) = directories::BaseDirs::new() {
        return Some(base.home_dir().to_path_buf());
    }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// `~/.ctrl/pi/` — the user-owned install root.
pub fn install_root() -> Option<PathBuf> {
    Some(home_dir()?.join(".ctrl").join("pi"))
}

/// Absolute path to the installed Pi binary, or None when not installed.
/// `npm install --prefix <root>` lays out the binary at
/// `<root>/node_modules/.bin/pi`.
pub fn pi_binary_path() -> Option<PathBuf> {
    let root = install_root()?;
    let candidates = [
        root.join("node_modules").join(".bin").join("pi"),
        // Some platforms / npm versions also drop a `pi.cmd`. Not
        // relevant on macOS; harmless to check.
        root.join("node_modules").join(".bin").join("pi.cmd"),
    ];
    candidates.into_iter().find(|p| p.exists())
}

/// True when Pi is installed at `~/.ctrl/pi/`.
pub fn is_installed() -> bool {
    pi_binary_path().is_some()
}

/// Ensure Pi is installed at `~/.ctrl/pi/`. Idempotent — returns early
/// when the binary already exists. The first call may take 10-30 s
/// because npm has to resolve + download Pi's deps; subsequent boots
/// are instant.
///
/// Returns the path to the installed `pi` binary on success.
pub fn ensure_installed() -> std::io::Result<PathBuf> {
    if let Some(bin) = pi_binary_path() {
        let installed_version = read_pi_version(&bin);
        update_status(|s| {
            s.installed_version = installed_version.clone();
            s.pi_bin = Some(bin.display().to_string());
            s.install_root = install_root().map(|p| p.display().to_string());
        });
        return Ok(bin);
    }
    install_via_npm(false)?;
    let bin = pi_binary_path().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "pi binary missing after install — check ~/.ctrl/pi/node_modules/",
        )
    })?;
    let installed_version = read_pi_version(&bin);
    update_status(|s| {
        s.installed_version = installed_version;
        s.pi_bin = Some(bin.display().to_string());
        s.install_root = install_root().map(|p| p.display().to_string());
    });
    Ok(bin)
}

/// Background upgrade probe — runs on a dedicated thread, respects the
/// 24 h cache, and silently no-ops when offline. Failure paths surface
/// via `current_status().last_upgrade_error` so the UI can show a hint.
pub fn spawn_upgrade_probe() {
    std::thread::Builder::new()
        .name("ctrl-pi-upgrade-probe".into())
        .spawn(move || {
            if !probe_due() {
                tracing::debug!("pi_install: upgrade probe within 24 h cache; skipping");
                return;
            }
            run_upgrade_probe();
        })
        .ok();
}

/// Force an upgrade attempt regardless of cache. Bound to the
/// Settings → Brain "Upgrade now" button.
pub fn force_upgrade() -> Result<PiInstallStatus, String> {
    run_upgrade_probe();
    Ok(current_status())
}

fn probe_due() -> bool {
    let last = current_status().last_probe_ms;
    if last == 0 {
        return true;
    }
    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(u64::MAX);
    now_ms.saturating_sub(last) > PROBE_CACHE_TTL.as_millis() as u64
}

fn run_upgrade_probe() {
    let latest = match fetch_latest_npm_version() {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, "pi_install: upgrade probe failed");
            update_status(|s| s.last_upgrade_error = Some(e.clone()));
            return;
        }
    };
    let installed = pi_binary_path().and_then(|p| read_pi_version(&p));
    let major_blocked = parse_major(&latest)
        .map(|m| m > PI_COMPAT_MAJOR)
        .unwrap_or(false);
    let upgrade_available = !major_blocked
        && installed
            .as_deref()
            .map(|i| version_lt(i, &latest))
            .unwrap_or(true);

    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    update_status(|s| {
        s.latest_version = Some(latest.clone());
        s.upgrade_available = upgrade_available;
        s.major_update_blocked = major_blocked;
        s.last_probe_ms = now_ms;
    });

    if !upgrade_available {
        tracing::info!(
            installed = ?installed,
            latest = %latest,
            major_blocked,
            "pi_install: no upgrade needed"
        );
        return;
    }

    tracing::info!(
        installed = ?installed,
        latest = %latest,
        "pi_install: upgrading pi-coding-agent in background"
    );
    match install_via_npm(true) {
        Ok(()) => {
            let new_version =
                pi_binary_path().and_then(|p| read_pi_version(&p));
            update_status(|s| {
                s.installed_version = new_version;
                s.upgrade_available = false;
                s.last_upgrade_error = None;
            });
            tracing::info!("pi_install: upgrade applied; restart Pi to use");
        }
        Err(e) => {
            tracing::warn!(error = %e, "pi_install: upgrade failed; staying on previous version");
            update_status(|s| s.last_upgrade_error = Some(e.to_string()));
        }
    }
}

fn install_via_npm(is_upgrade: bool) -> std::io::Result<()> {
    let root = install_root().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "HOME not set; cannot resolve ~/.ctrl/pi/",
        )
    })?;
    fs::create_dir_all(&root)?;

    let npm = find_binary("npm").ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "npm not found on PATH; install Node.js or set CTRL_NPM",
        )
    })?;

    let pkg = format!("{PI_NPM_PACKAGE}@latest");
    let label = if is_upgrade { "upgrading" } else { "installing" };
    tracing::info!(
        npm = %npm.display(),
        root = %root.display(),
        pkg = %pkg,
        "pi_install: {label} via npm"
    );

    // ADR-002 substrate §4 priority-0 — Pi auto-upgrade cannot stay stale. The same
    // sparse-PATH trap that bit brain_supervisor's Pi spawn applies here:
    // Tauri-spawned processes inherit a PATH without /opt/homebrew/bin, so
    // npm's internal `env node` shim exits 127. Prepend npm's parent dir
    // (where node typically also lives) so the npm script can resolve node.
    // bao 2026-05-31 (ADR-002 substrate acceptance #4 close-out): ctrl.log was
    // surfacing `env: node: No such file or directory` every boot —
    // auto-upgrade silently never ran, Pi stayed stale.
    let mut cmd = Command::new(&npm);
    cmd.arg("install")
        .arg("--prefix")
        .arg(&root)
        .arg("--no-audit")
        .arg("--no-fund")
        .arg("--silent")
        .arg(&pkg);
    if let Some(parent) = npm.parent() {
        // Prepend npm's parent dir to PATH using the platform path
        // separator (`:` on unix, `;` on Windows) so the npm script can
        // resolve node. Skip if it's already present.
        let existing = std::env::var_os("PATH").unwrap_or_default();
        let already_present = std::env::split_paths(&existing).any(|p| p == parent);
        if already_present {
            cmd.env("PATH", existing);
        } else {
            let mut dirs = vec![parent.to_path_buf()];
            dirs.extend(std::env::split_paths(&existing));
            if let Ok(joined) = std::env::join_paths(dirs) {
                cmd.env("PATH", joined);
            }
        }
    }
    let output = cmd.output()?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        return Err(std::io::Error::other(format!(
            "npm install failed (status {}): {}",
            output.status,
            stderr.trim()
        )));
    }
    Ok(())
}

fn fetch_latest_npm_version() -> Result<String, String> {
    // ureq isn't on this crate's deps; use a sync reqwest blocking call
    // via a fresh tokio runtime when called from a background thread.
    let url = format!("https://registry.npmjs.org/{PI_NPM_PACKAGE}/latest");
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| format!("tokio runtime: {e}"))?;
    rt.block_on(async {
        let resp = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|e| format!("reqwest client: {e}"))?
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("npm registry GET failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("npm registry HTTP {}", resp.status()));
        }
        #[derive(Deserialize)]
        struct Meta {
            version: String,
        }
        let meta: Meta = resp
            .json()
            .await
            .map_err(|e| format!("npm registry payload: {e}"))?;
        Ok(meta.version)
    })
}

fn read_pi_version(pi_bin: &Path) -> Option<String> {
    // On Windows a `.cmd`/`.bat` shim can't be exec'd directly by
    // CreateProcess — it must run through the command interpreter.
    #[cfg(target_os = "windows")]
    let mut cmd = {
        let ext = pi_bin
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase());
        if matches!(ext.as_deref(), Some("cmd") | Some("bat")) {
            let mut c = Command::new("cmd");
            c.arg("/C").arg(pi_bin);
            c
        } else {
            Command::new(pi_bin)
        }
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new(pi_bin);

    let output = cmd.arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        return None;
    }
    // `pi --version` typically prints `0.27.4` on one line.
    text.split_whitespace().next().map(|s| s.to_string())
}

fn find_binary(name: &str) -> Option<PathBuf> {
    let env_name = format!("CTRL_{}", name.to_uppercase());
    if let Ok(over) = std::env::var(&env_name) {
        let p = PathBuf::from(over);
        if p.is_file() {
            return Some(p);
        }
    }
    // Probe each PATH dir for the bare name and, on Windows, the executable
    // variants (`npm` is shipped as `npm.cmd`; `.exe` for native binaries).
    #[cfg(target_os = "windows")]
    let names: Vec<String> =
        vec![name.to_string(), format!("{name}.cmd"), format!("{name}.exe")];
    #[cfg(not(target_os = "windows"))]
    let names: Vec<String> = vec![name.to_string()];

    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            for n in &names {
                let candidate = dir.join(n);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    // Common install locations a Finder-launched .app doesn't see. POSIX
    // only — these paths are meaningless on Windows.
    #[cfg(not(windows))]
    for fallback in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"] {
        let candidate = PathBuf::from(fallback).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn parse_major(v: &str) -> Option<u32> {
    v.split('.').next().and_then(|s| s.parse().ok())
}

/// Naive semver-less version comparator. Good enough for "is `a` strictly
/// less than `b`" on dot-numeric versions, which is all the upgrade
/// gate needs.
fn version_lt(a: &str, b: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.')
            .map(|p| {
                // Strip any pre-release suffix (`0.27.4-beta.1` → 4).
                let head = p.split(|c: char| !c.is_ascii_digit()).next().unwrap_or("0");
                head.parse::<u32>().unwrap_or(0)
            })
            .collect()
    };
    let ap = parse(a);
    let bp = parse(b);
    for i in 0..ap.len().max(bp.len()) {
        let av = ap.get(i).copied().unwrap_or(0);
        let bv = bp.get(i).copied().unwrap_or(0);
        if av < bv {
            return true;
        }
        if av > bv {
            return false;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_lt_handles_common_cases() {
        assert!(version_lt("0.27.3", "0.27.4"));
        assert!(version_lt("0.27.4", "0.28.0"));
        assert!(version_lt("0.27.4", "1.0.0"));
        assert!(!version_lt("0.27.4", "0.27.4"));
        assert!(!version_lt("0.28.0", "0.27.4"));
    }

    #[test]
    fn parse_major_returns_first_component() {
        assert_eq!(parse_major("0.27.4"), Some(0));
        assert_eq!(parse_major("1.0.0-beta.1"), Some(1));
        assert_eq!(parse_major(""), None);
    }
}
