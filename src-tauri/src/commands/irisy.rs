// Irisy bootstrap — system check + install Irisy (internally hermes-agent
// + ctrl-hermes-plugin). User-facing UX: PWA shows "Installing Irisy…",
// never the word "hermes". Internal commands talk to pipx + hermes CLI;
// the names live here, not in the UI.
//
// Per bao 2026-05-23 framing:
//   1. User downloads CTRL.app
//   2. CTRL self-checks host capabilities
//   3. CTRL installs Irisy automatically (pipx + plugin copy + enable)
//   4. Irisy ready
//
// Per ADR-019 (with install-path correction discovered via spike):
// real plugin discovery path is `~/.hermes/plugins/<name>/` (directory
// copy + `hermes plugins enable`), NOT pip entry-point. The bundled
// plugin source is copied from the app's resource dir at install time.

use serde::Serialize;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

/// Result of `system_check` — read-only host capability snapshot used
/// by the PWA welcome wizard to decide whether install can proceed.
#[derive(Debug, Clone, Serialize)]
pub struct SystemCheck {
    pub os: String,
    pub os_version: String,
    pub python_version: Option<String>,
    pub pipx_available: bool,
    pub hermes_already_installed: bool,
    pub plugin_already_installed: bool,
    /// All required prerequisites present — PWA can offer "Install Irisy".
    pub ready_to_install: bool,
}

#[tauri::command]
pub async fn system_check() -> Result<SystemCheck, String> {
    let os = std::env::consts::OS.to_string();
    let os_version = sysctl_os_version();
    let python_version = run_cmd_first_line("python3", &["--version"]);
    let pipx_available = run_cmd_first_line("pipx", &["--version"]).is_some();
    let hermes_already_installed = run_cmd_first_line("hermes", &["--version"]).is_some();
    let plugin_dir = home_dir()
        .map(|h| h.join(".hermes").join("plugins").join("ctrl"))
        .map(|p| p.is_dir())
        .unwrap_or(false);

    let python_ok = python_version
        .as_deref()
        .map(parse_python_meets_311)
        .unwrap_or(false);
    let ready_to_install = python_ok && pipx_available;

    Ok(SystemCheck {
        os,
        os_version,
        python_version,
        pipx_available,
        hermes_already_installed,
        plugin_already_installed: plugin_dir,
        ready_to_install,
    })
}

/// Event payload emitted as Irisy installation progresses. The PWA
/// `useInstallIrisy` hook subscribes to `irisy.install.progress` and
/// renders the latest message + stream of log lines.
#[derive(Debug, Clone, Serialize)]
struct InstallProgress {
    /// One of: "checking" | "installing_runtime" | "installing_companion"
    /// | "enabling" | "complete" | "failed"
    stage: &'static str,
    /// Human-readable, English UI string. "Installing personal companion…",
    /// never references "hermes" or "pipx" — those stay in the log lines.
    message: String,
    /// Verbatim stdout/stderr line from underlying process. PWA shows
    /// this in a collapsible debug pane; hidden by default.
    log: Option<String>,
}

/// `install_irisy` — the user-facing one-button install flow.
///
/// Internally: ensures pipx hermes-agent install, copies the bundled
/// plugin to `~/.hermes/plugins/ctrl/`, and enables it via `hermes
/// plugins enable ctrl`. Streams progress to PWA via the
/// `irisy.install.progress` event channel so the wizard can render a
/// live log.
#[tauri::command]
pub async fn install_irisy(app: AppHandle) -> Result<(), String> {
    emit(&app, "checking", "Checking your machine…", None);

    // 1. Verify prereqs (Python 3.11+ and pipx). Short-circuit with an
    //    actionable error if either is missing.
    let python = run_cmd_first_line("python3", &["--version"])
        .ok_or_else(|| "Python 3 not found. Install Python 3.11+ via Homebrew first.".to_string())?;
    if !parse_python_meets_311(&python) {
        return Err(format!(
            "Python 3.11+ required (found {python}). Update via Homebrew: brew install python@3.13"
        ));
    }
    if run_cmd_first_line("pipx", &["--version"]).is_none() {
        return Err("pipx not found. Install via Homebrew: brew install pipx && pipx ensurepath".to_string());
    }

    // 2. Install Hermes runtime (idempotent — pipx exits 0 if already
    //    installed; we surface that fact but don't fail).
    emit(&app, "installing_runtime", "Installing Irisy runtime…", None);
    let runtime_ok = run_streaming(&app, "pipx", &["install", "hermes-agent"]).await?;
    if !runtime_ok {
        // `pipx install` returns non-zero if already installed; that's a
        // benign condition. Verify by probing `hermes --version` instead.
        if run_cmd_first_line("hermes", &["--version"]).is_none() {
            return Err("Irisy runtime install failed; see the log above for details.".into());
        }
    }

    // 3. Copy the bundled plugin to ~/.hermes/plugins/ctrl/. Source path
    //    is the CTRL.app bundled resource dir (production builds) OR
    //    the repo's packages/ctrl-hermes-plugin (dev builds).
    emit(&app, "installing_companion", "Installing personal companion…", None);
    let plugin_src = resolve_plugin_source(&app)
        .ok_or_else(|| "Bundled companion plugin not found in app resources.".to_string())?;
    let plugin_dst = home_dir()
        .ok_or_else(|| "HOME unset".to_string())?
        .join(".hermes")
        .join("plugins")
        .join("ctrl");
    std::fs::create_dir_all(&plugin_dst).map_err(|e| format!("create plugin dir: {e}"))?;
    copy_dir_recursive(&plugin_src, &plugin_dst).map_err(|e| format!("copy plugin: {e}"))?;
    emit(
        &app,
        "installing_companion",
        "Copied companion bundle to local plugin store.",
        Some(format!("dst: {}", plugin_dst.display())),
    );

    // 4. Enable the plugin so hermes loads it on next session.
    emit(&app, "enabling", "Enabling personal companion…", None);
    let enabled = run_streaming(&app, "hermes", &["plugins", "enable", "ctrl"]).await?;
    if !enabled {
        return Err(
            "Failed to enable companion. Run `hermes plugins enable ctrl` manually and report the error."
                .into(),
        );
    }

    emit(
        &app,
        "complete",
        "Irisy ready — your personal AI companion is live.",
        None,
    );
    Ok(())
}

// ─── Helpers ────────────────────────────────────────────────────────

fn home_dir() -> Option<std::path::PathBuf> {
    std::env::var("HOME").ok().map(std::path::PathBuf::from)
}

fn sysctl_os_version() -> String {
    // macOS: `sw_vers -productVersion`; fall back to uname on other OS.
    #[cfg(target_os = "macos")]
    {
        run_cmd_first_line("sw_vers", &["-productVersion"]).unwrap_or_else(|| "unknown".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        run_cmd_first_line("uname", &["-r"]).unwrap_or_else(|| "unknown".into())
    }
}

fn run_cmd_first_line(bin: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .next()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Parse "Python 3.11.5" or "Python 3.14.4" against the >= 3.11 floor.
/// Returns false for unparseable input rather than panicking — install
/// pre-check fails closed.
fn parse_python_meets_311(s: &str) -> bool {
    let rest = match s.strip_prefix("Python ") {
        Some(r) => r,
        None => return false,
    };
    let mut parts = rest.split('.');
    let major: u32 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let minor: u32 = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    major > 3 || (major == 3 && minor >= 11)
}

fn emit(app: &AppHandle, stage: &'static str, message: &str, log: Option<String>) {
    let payload = InstallProgress {
        stage,
        message: message.to_string(),
        log,
    };
    if let Err(e) = app.emit("irisy.install.progress", payload) {
        tracing::warn!(error = %e, "failed to emit irisy.install.progress");
    }
}

/// Spawn a command, stream stdout+stderr line-by-line as install-progress
/// events. Returns Ok(true) if the process exited 0, Ok(false) otherwise.
async fn run_streaming(app: &AppHandle, bin: &str, args: &[&str]) -> Result<bool, String> {
    use std::io::{BufRead, BufReader};
    let mut child = Command::new(bin)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn {bin}: {e}"))?;
    let stdout = child.stdout.take().ok_or_else(|| "no stdout pipe".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "no stderr pipe".to_string())?;

    let app_for_out = app.clone();
    let out_handle = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            emit(&app_for_out, "installing_runtime", "stdout", Some(line));
        }
    });
    let app_for_err = app.clone();
    let err_handle = std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            emit(&app_for_err, "installing_runtime", "stderr", Some(line));
        }
    });

    let status = child.wait().map_err(|e| format!("wait {bin}: {e}"))?;
    let _ = out_handle.join();
    let _ = err_handle.join();
    Ok(status.success())
}

/// Locate the bundled plugin directory. In a Tauri prod build the plugin
/// is shipped under the app's resource dir; in dev we fall back to the
/// repo's `packages/ctrl-hermes-plugin/`.
fn resolve_plugin_source(app: &AppHandle) -> Option<std::path::PathBuf> {
    // Production: Tauri resource dir.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("ctrl-hermes-plugin");
        if candidate.is_dir() {
            return Some(candidate);
        }
    }
    // Dev fallback: walk up from CWD looking for the workspace plugin.
    let mut cwd = std::env::current_dir().ok()?;
    for _ in 0..6 {
        let candidate = cwd.join("packages").join("ctrl-hermes-plugin");
        if candidate.is_dir() {
            return Some(candidate);
        }
        if !cwd.pop() {
            break;
        }
    }
    None
}

fn copy_dir_recursive(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    if !src.is_dir() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("not a dir: {}", src.display()),
        ));
    }
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        // Skip Python build artefacts so the plugin install stays clean.
        let name_str = name.to_string_lossy();
        if name_str == "build"
            || name_str == "__pycache__"
            || name_str.ends_with(".egg-info")
        {
            continue;
        }
        let from = entry.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            std::fs::copy(&from, &to)?;
        }
    }
    Ok(())
}
