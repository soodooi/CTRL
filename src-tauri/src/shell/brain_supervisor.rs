// Brain (Pi) subprocess supervisor.
//
// ADR-003 lifts Pi to the sole brain. CTRL keeps two pieces of process
// state for it:
//
//   1. The Pi runtime (`@mariozechner/pi-coding-agent`) installed at
//      `~/.ctrl/pi/`. The supervisor `ensure_installed()`s it lazily
//      on first boot, then a background thread runs an upgrade probe
//      every 24 h (see `shell/pi_install.rs`).
//
//   2. The `@ctrl/pi-plugin` MCP server (`ctrl-pi-mcp` on
//      `127.0.0.1:17874`). The MCP server is the wire that PWA Irisy +
//      keycaps talk to (`tools/call text.chat`). It spawns Pi as a
//      `pi rpc` subprocess; we inject `CTRL_PI_BRIDGE_EXTENSION` (path
//      to the bundled `@ctrl/pi-bridge`) + `CTRL_PROVIDER_PORT` env so
//      Pi's LLM calls route into the kernel provider sub-system
//      (ADR-004 §9.1 lock #7) instead of Pi's own ~/.pi/config.
//
// The MCP server is restarted on exit with capped backoff. The kernel
// provider sub-system the bridge POSTs to is owned by the kernel lane;
// the env we set tells the bridge where it lives.

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use super::pi_install;

/// Plugin-relative entry the Pi MCP server starts from.
const PI_MCP_ENTRY: &str = "bin/ctrl-pi-mcp.ts";
/// Wait between respawns after the child exits.
const RESTART_BACKOFF: Duration = Duration::from_secs(3);
/// How often the supervise loop polls the child for exit.
const POLL_INTERVAL: Duration = Duration::from_millis(300);
/// Default port the kernel provider HTTP endpoint listens on. The kernel
/// lane owns the actual server; we read this port from the shared
/// constant so the env we inject matches what the bridge will hit.
const DEFAULT_PROVIDER_PORT: u16 = 17878;

static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static PROVIDER_PORT: AtomicU16 = AtomicU16::new(DEFAULT_PROVIDER_PORT);
static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn child_slot() -> &'static Mutex<Option<Child>> {
    CHILD.get_or_init(|| Mutex::new(None))
}

fn error_slot() -> &'static Mutex<Option<String>> {
    LAST_ERROR.get_or_init(|| Mutex::new(None))
}

fn set_last_error(msg: impl Into<String>) {
    if let Ok(mut g) = error_slot().lock() {
        *g = Some(msg.into());
    }
}

fn clear_last_error() {
    if let Ok(mut g) = error_slot().lock() {
        *g = None;
    }
}

/// Last error the supervisor recorded, or `None` if the brain is
/// healthy. Surfaced via `commands/irisy_chat.rs` so the user gets a
/// typed failure instead of an infinite spinner.
pub fn last_error() -> Option<String> {
    error_slot().lock().ok().and_then(|g| g.clone())
}

/// Whether the brain MCP child is currently spawned.
pub fn is_running() -> bool {
    child_slot()
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}

/// Port the kernel `/text-chat` endpoint is reachable on. Read by
/// `commands/system.rs::pi_status` for the Settings UI.
pub fn provider_port() -> u16 {
    PROVIDER_PORT.load(Ordering::SeqCst)
}

pub struct BrainSupervisor;

impl BrainSupervisor {
    /// Spawn + supervise the brain MCP server on a background thread.
    /// Returns immediately; install + the npm install for Pi runs in
    /// the supervise thread so boot is never blocked. The first chat
    /// turn waits on the MCP server being ready (irisy_chat surfaces a
    /// typed error if it isn't).
    pub fn start(app: &AppHandle) {
        // Pick the provider port. Configurable via CTRL_PROVIDER_PORT
        // so the kernel lane and we agree without a recompile.
        if let Ok(p) = std::env::var("CTRL_PROVIDER_PORT") {
            if let Ok(port) = p.parse::<u16>() {
                PROVIDER_PORT.store(port, Ordering::SeqCst);
            }
        }

        let Some(plugin_dir) = find_pi_plugin_dir() else {
            let msg = "BrainSupervisor: @ctrl/pi-plugin not found; brain stays \
                       down. Set CTRL_PI_PLUGIN_DIR to override."
                .to_string();
            tracing::error!("{msg}");
            set_last_error(msg);
            return;
        };
        let Some(node) = find_node() else {
            let msg = "BrainSupervisor: `node` not found on disk; brain stays \
                       down. Set CTRL_NODE to the node binary path to override."
                .to_string();
            tracing::error!("{msg}");
            set_last_error(msg);
            return;
        };
        let bridge_path = match resolve_bridge_path(app) {
            Some(p) => p,
            None => {
                let msg = "BrainSupervisor: @ctrl/pi-bridge not bundled; Pi LLM \
                           calls would bypass the kernel provider sub-system. \
                           Brain stays down."
                    .to_string();
                tracing::error!("{msg}");
                set_last_error(msg);
                return;
            }
        };

        tracing::info!(
            ?node,
            ?plugin_dir,
            bridge = %bridge_path.display(),
            port = provider_port(),
            "BrainSupervisor: starting Pi MCP supervision"
        );

        let _ = std::thread::Builder::new()
            .name("ctrl-brain-supervisor".into())
            .spawn(move || supervise(node, plugin_dir, bridge_path));

        // Background upgrade probe — 24 h cache, no-op on offline.
        pi_install::spawn_upgrade_probe();
    }

    /// Kill the brain child + stop respawning. Call on real app exit
    /// so the next launch doesn't collide on port 17874.
    pub fn shutdown() {
        SHUTDOWN.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = child_slot().lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        tracing::info!("BrainSupervisor: shut down");
    }

    /// Force a Pi upgrade attempt + restart the brain child to pick up
    /// the new version. Bound to the Settings → Brain "Upgrade now"
    /// button.
    pub fn force_upgrade_and_restart() -> Result<(), String> {
        pi_install::force_upgrade()?;
        // Kill the running child so the supervise loop picks up the
        // freshly-installed binary on its next iteration.
        if let Ok(mut guard) = child_slot().lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
        Ok(())
    }
}

fn supervise(node: PathBuf, plugin_dir: PathBuf, bridge_path: PathBuf) {
    while !SHUTDOWN.load(Ordering::SeqCst) {
        let pi_bin = match pi_install::ensure_installed() {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(error = %e, "BrainSupervisor: pi install failed");
                set_last_error(format!("Pi install failed: {e}"));
                std::thread::sleep(RESTART_BACKOFF);
                continue;
            }
        };

        match spawn_brain(&node, &plugin_dir, &bridge_path, &pi_bin) {
            Ok(child) => {
                clear_last_error();
                if let Ok(mut guard) = child_slot().lock() {
                    *guard = Some(child);
                }
                // Poll until the child exits or shutdown() takes it.
                loop {
                    if SHUTDOWN.load(Ordering::SeqCst) {
                        return;
                    }
                    let exited = match child_slot().lock() {
                        Ok(mut guard) => match guard.as_mut() {
                            Some(child) => match child.try_wait() {
                                Ok(Some(status)) => {
                                    tracing::warn!(?status, "BrainSupervisor: brain exited");
                                    set_last_error(format!(
                                        "Pi brain exited (status {status}); restarting"
                                    ));
                                    *guard = None;
                                    true
                                }
                                Ok(None) => false,
                                Err(e) => {
                                    tracing::error!(error = %e, "BrainSupervisor: try_wait failed");
                                    set_last_error(format!("Pi brain try_wait failed: {e}"));
                                    *guard = None;
                                    true
                                }
                            },
                            None => true, // shutdown() already took the child
                        },
                        Err(_) => true,
                    };
                    if exited {
                        break;
                    }
                    std::thread::sleep(POLL_INTERVAL);
                }
            }
            Err(e) => {
                tracing::error!(error = %e, "BrainSupervisor: spawn brain failed");
                set_last_error(format!("Pi brain spawn failed: {e}"));
            }
        }
        if SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(RESTART_BACKOFF);
    }
}

fn spawn_brain(
    node: &Path,
    plugin_dir: &Path,
    bridge_path: &Path,
    pi_bin: &Path,
) -> std::io::Result<Child> {
    let port = provider_port().to_string();
    tracing::info!(
        ?plugin_dir,
        bridge = %bridge_path.display(),
        pi_bin = %pi_bin.display(),
        port = %port,
        "BrainSupervisor: spawning ctrl-pi-mcp (Pi MCP server on :17874)"
    );
    let mut cmd = Command::new(node);
    cmd.arg("--experimental-strip-types")
        .arg(PI_MCP_ENTRY)
        .current_dir(plugin_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Tell pi-plugin where Pi lives — overrides its own PATH/npx lookup
    // so we always use the version we installed under ~/.ctrl/pi/.
    cmd.env("CTRL_PI_BIN", pi_bin);
    // Tell pi-plugin to spawn Pi with the ctrl-bridge extension. Path
    // is absolute (resolved from app bundle Resources/ in prod, repo in
    // dev). Pi reads it via --extension; the bridge then sees
    // CTRL_PROVIDER_PORT.
    cmd.env("CTRL_PI_BRIDGE_EXTENSION", bridge_path);
    cmd.env("CTRL_PROVIDER_PORT", &port);
    if let Ok(token) = std::env::var("CTRL_PROVIDER_TOKEN") {
        if !token.is_empty() {
            cmd.env("CTRL_PROVIDER_TOKEN", token);
        }
    }
    cmd.spawn()
}

/// Locate the `@ctrl/pi-plugin` directory containing `bin/ctrl-pi-mcp.ts`.
/// Priority: `CTRL_PI_PLUGIN_DIR` env → walk up from the executable / cwd
/// looking for `packages/ctrl-pi-plugin` (dev + run-in-repo).
fn find_pi_plugin_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CTRL_PI_PLUGIN_DIR") {
        let p = PathBuf::from(dir);
        if p.join(PI_MCP_ENTRY).is_file() {
            return Some(p);
        }
    }
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    for start in starts {
        let mut cur: &Path = start.as_path();
        loop {
            let candidate = cur.join("packages/ctrl-pi-plugin");
            if candidate.join(PI_MCP_ENTRY).is_file() {
                return Some(candidate);
            }
            match cur.parent() {
                Some(parent) => cur = parent,
                None => break,
            }
        }
    }
    None
}

/// Resolve the bundled `ctrl-pi-bridge` entrypoint. In production this
/// is `<resourceDir>/pi-bridge/index.ts`; in dev / run-in-repo mode we
/// walk up from the executable / cwd looking for
/// `packages/ctrl-pi-bridge/src/index.ts`.
fn resolve_bridge_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(over) = std::env::var("CTRL_PI_BRIDGE") {
        let p = PathBuf::from(over);
        if p.is_file() {
            return Some(p);
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("pi-bridge").join("index.ts");
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        starts.push(exe);
    }
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    for start in starts {
        let mut cur: &Path = start.as_path();
        loop {
            let candidate = cur
                .join("packages")
                .join("ctrl-pi-bridge")
                .join("src")
                .join("index.ts");
            if candidate.is_file() {
                return Some(candidate);
            }
            match cur.parent() {
                Some(parent) => cur = parent,
                None => break,
            }
        }
    }
    None
}

/// Resolve an absolute `node` binary. A Finder-launched .app has a
/// minimal PATH (no Homebrew / nvm), so check the common install
/// locations explicitly before falling back to PATH.
fn find_node() -> Option<PathBuf> {
    if let Ok(n) = std::env::var("CTRL_NODE") {
        let p = PathBuf::from(n);
        if p.is_file() {
            return Some(p);
        }
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    // nvm: ~/.nvm/versions/node/<ver>/bin/node — prefer the highest version.
    if let Some(home) = std::env::var_os("HOME") {
        let nvm = PathBuf::from(home).join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(&nvm) {
            let mut versions: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path().join("bin/node"))
                .filter(|p| p.is_file())
                .collect();
            versions.sort();
            if let Some(latest) = versions.pop() {
                candidates.push(latest);
            }
        }
    }
    candidates.push(PathBuf::from("/opt/homebrew/bin/node"));
    candidates.push(PathBuf::from("/usr/local/bin/node"));
    candidates.push(PathBuf::from("/usr/bin/node"));
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            candidates.push(dir.join("node"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}
