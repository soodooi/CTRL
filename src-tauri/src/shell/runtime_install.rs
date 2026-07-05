// One-click container-runtime install (bao 2026-07-05 "auto-run install the
// runtime"), the auto-run half of the no-docker guided install. Mirrors
// `ollama_install.rs` (status slot + in-flight flag + background thread that
// tails stdout, streaming progress to the PWA via a Tauri event).
//
// Scope — auto-run ONLY where it is sudo-free and scriptable:
//   * macOS: `brew install colima docker docker-compose` (Homebrew is
//     user-owned, no sudo) + `colima start` (a CLI VM, no GUI gesture).
//   * Linux (`sudo apt …`, interactive/privileged) + Windows (GUI Docker
//     Desktop) stay GUIDE-ONLY — `install_commands()` is empty there, so the
//     card shows copy-pasteable commands but no "Install it for me" button.
//
// Trust boundary: this is reached only via the Tauri command
// `install_container_runtime` (desktop PWA = the human) — the brain's
// `:17873` gate cannot invoke Tauri commands. The commands are compile-time
// constants, never LLM/manifest input, so there is no injection surface.
//
// Rust-only (no Tauri-app dependency leaks in) so it unit-tests in isolation.

use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// Keep the streamed log bounded — brew/colima emit a lot; the card only needs
/// a live tail, and each progress event re-sends the whole status.
const LOG_TAIL_MAX: usize = 40;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInstallStatus {
    /// A command is currently running.
    pub running: bool,
    /// The command line currently executing (e.g. `colima start`), or None.
    pub current: Option<String>,
    /// The last ~40 output lines (stdout+stderr merged), oldest→newest.
    pub log_tail: Vec<String>,
    /// The whole sequence finished (success or failure).
    pub done: bool,
    /// True iff every command exited 0.
    pub ok: bool,
    /// Set when a command failed.
    pub error: Option<String>,
}

impl Default for RuntimeInstallStatus {
    fn default() -> Self {
        Self {
            running: false,
            current: None,
            log_tail: Vec::new(),
            done: false,
            ok: false,
            error: None,
        }
    }
}

static STATUS: OnceLock<Mutex<RuntimeInstallStatus>> = OnceLock::new();
static IN_FLIGHT: OnceLock<Mutex<bool>> = OnceLock::new();

fn status_slot() -> &'static Mutex<RuntimeInstallStatus> {
    STATUS.get_or_init(|| Mutex::new(RuntimeInstallStatus::default()))
}

fn flight_slot() -> &'static Mutex<bool> {
    IN_FLIGHT.get_or_init(|| Mutex::new(false))
}

/// Cheap in-memory snapshot.
pub fn current_status() -> RuntimeInstallStatus {
    status_slot().lock().map(|g| g.clone()).unwrap_or_default()
}

fn update_status<F: FnOnce(&mut RuntimeInstallStatus)>(mutate: F) {
    if let Ok(mut g) = status_slot().lock() {
        mutate(&mut g);
    }
}

fn push_log(line: String) {
    update_status(|s| {
        s.log_tail.push(line);
        let n = s.log_tail.len();
        if n > LOG_TAIL_MAX {
            s.log_tail.drain(0..n - LOG_TAIL_MAX);
        }
    });
}

/// Whether a program is on PATH (`which <prog>`).
fn on_path(prog: &str) -> bool {
    Command::new("which")
        .arg(prog)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// The auto-runnable install commands for THIS platform, in order. Empty when
/// auto-run isn't offered (Linux needs sudo, Windows is a GUI install) — the
/// card then stays guide-only.
pub fn install_commands() -> Vec<String> {
    #[cfg(target_os = "macos")]
    {
        vec![
            "brew install colima docker docker-compose".to_string(),
            "colima start".to_string(),
        ]
    }
    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

/// Whether the "Install it for me" button should be offered: there are commands
/// to run AND their prerequisite tool is present (on macOS, Homebrew — without
/// it `brew install` would just fail, so we keep the manual brew.sh guidance).
pub fn auto_installable() -> bool {
    if install_commands().is_empty() {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        on_path("brew")
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

/// Spawn the platform install sequence on a background thread. Returns
/// immediately; progress is reflected in the shared status and pushed through
/// `on_progress` (fired per output line + on each phase change). A second
/// concurrent call is a no-op (returns Ok early). Errors from an individual
/// command stop the sequence and land in `status.error`.
pub fn spawn_install<F>(on_progress: F) -> Result<(), String>
where
    F: Fn(&RuntimeInstallStatus) + Send + 'static,
{
    let cmds = install_commands();
    if cmds.is_empty() {
        return Err("auto-install is not available on this platform".into());
    }
    {
        let mut flag = flight_slot().lock().map_err(|e| format!("lock: {e}"))?;
        if *flag {
            return Ok(());
        }
        *flag = true;
    }
    update_status(|s| {
        *s = RuntimeInstallStatus::default();
        s.running = true;
    });
    on_progress(&current_status());

    std::thread::spawn(move || {
        let result = run_sequence(&cmds, &on_progress);
        match result {
            Ok(()) => update_status(|s| {
                s.running = false;
                s.current = None;
                s.done = true;
                s.ok = true;
            }),
            Err(err) => update_status(|s| {
                s.running = false;
                s.current = None;
                s.done = true;
                s.ok = false;
                s.error = Some(err);
            }),
        }
        on_progress(&current_status());
        if let Ok(mut flag) = flight_slot().lock() {
            *flag = false;
        }
    });
    Ok(())
}

fn run_sequence<F>(cmds: &[String], on_progress: &F) -> Result<(), String>
where
    F: Fn(&RuntimeInstallStatus),
{
    for cmd in cmds {
        update_status(|s| s.current = Some(cmd.clone()));
        push_log(format!("$ {cmd}"));
        on_progress(&current_status());
        run_streamed(cmd, on_progress)?;
    }
    Ok(())
}

fn run_streamed<F>(cmd: &str, on_progress: &F) -> Result<(), String>
where
    F: Fn(&RuntimeInstallStatus),
{
    use std::io::{BufRead, BufReader};
    // `sh -c "<cmd> 2>&1"` merges stderr (brew/colima write progress there) into
    // one stream we tail line by line. `cmd` is a compile-time constant.
    let mut child = Command::new("sh")
        .arg("-c")
        .arg(format!("{cmd} 2>&1"))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn `{cmd}`: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("`{cmd}`: no stdout"))?;
    for line in BufReader::new(stdout).lines() {
        let line = line.map_err(|e| format!("read stdout: {e}"))?;
        push_log(line);
        on_progress(&current_status());
    }
    let status = child.wait().map_err(|e| format!("wait `{cmd}`: {e}"))?;
    if !status.success() {
        return Err(format!(
            "`{cmd}` exited with status {}",
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_commands_are_platform_scoped() {
        let cmds = install_commands();
        if cfg!(target_os = "macos") {
            assert_eq!(cmds.len(), 2);
            assert!(cmds[0].starts_with("brew install colima"));
            assert_eq!(cmds[1], "colima start");
        } else {
            // Auto-run is guide-only off macOS (sudo/GUI installs).
            assert!(cmds.is_empty());
        }
    }

    #[test]
    fn auto_installable_requires_commands() {
        // Off macOS there are no commands, so auto-install is never offered.
        if !cfg!(target_os = "macos") {
            assert!(!auto_installable());
        }
    }

    #[test]
    fn log_tail_stays_bounded() {
        update_status(|s| *s = RuntimeInstallStatus::default());
        for i in 0..(LOG_TAIL_MAX + 20) {
            push_log(format!("line {i}"));
        }
        let s = current_status();
        assert_eq!(s.log_tail.len(), LOG_TAIL_MAX);
        // Oldest lines were dropped; the newest is retained.
        assert_eq!(s.log_tail.last().unwrap(), &format!("line {}", LOG_TAIL_MAX + 19));
    }
}
