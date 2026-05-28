// Brain (Pi) subprocess supervisor.
//
// CTRL's sole brain is Pi — the `@ctrl/pi-plugin` MCP server (`ctrl-pi-mcp`)
// on 127.0.0.1:17874. The brain must always be connected: Irisy routes
// `text.chat` to it. This supervisor spawns the Pi MCP server on boot and
// restarts it if it exits, so the user never runs `npm start` by hand.
//
// Best-effort + graceful: if `node` or the plugin can't be located we log a
// warning and stay down — `irisy_chat_stream` then falls back to the Volc
// `chat_stream` path, so chat still works without the brain.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::AppHandle;

/// Plugin-relative entry the Pi MCP server starts from.
const PI_MCP_ENTRY: &str = "bin/ctrl-pi-mcp.ts";
/// Wait between respawns after the child exits.
const RESTART_BACKOFF: Duration = Duration::from_secs(3);
/// How often the supervise loop polls the child for exit.
const POLL_INTERVAL: Duration = Duration::from_millis(300);

static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static CHILD: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn child_slot() -> &'static Mutex<Option<Child>> {
    CHILD.get_or_init(|| Mutex::new(None))
}

pub struct BrainSupervisor;

impl BrainSupervisor {
    /// Spawn + supervise the Pi MCP server on a background thread. Returns
    /// immediately; never blocks boot. No-op-safe when the brain can't be
    /// located (Irisy falls back to the Volc chat path).
    pub fn start(_app: &AppHandle) {
        let Some(plugin_dir) = find_pi_plugin_dir() else {
            tracing::warn!(
                "BrainSupervisor: @ctrl/pi-plugin not found — Pi brain stays down, \
                 Irisy uses the Volc fallback. Set CTRL_PI_PLUGIN_DIR to override."
            );
            return;
        };
        let Some(node) = find_node() else {
            tracing::warn!(
                "BrainSupervisor: `node` not found on disk — Pi brain stays down. \
                 Set CTRL_NODE to the node binary path to override."
            );
            return;
        };

        tracing::info!(?node, ?plugin_dir, "BrainSupervisor: starting Pi MCP supervision");
        let _ = std::thread::Builder::new()
            .name("ctrl-brain-supervisor".into())
            .spawn(move || supervise(node, plugin_dir));
    }

    /// Kill the Pi child + stop respawning. Call on real app exit so the
    /// next launch doesn't collide on port 17874.
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
}

fn supervise(node: PathBuf, plugin_dir: PathBuf) {
    while !SHUTDOWN.load(Ordering::SeqCst) {
        match spawn_pi(&node, &plugin_dir) {
            Ok(child) => {
                if let Ok(mut guard) = child_slot().lock() {
                    *guard = Some(child);
                }
                // Poll until the child exits or shutdown() takes it. Holds the
                // lock only briefly each tick so shutdown() can kill mid-wait.
                loop {
                    if SHUTDOWN.load(Ordering::SeqCst) {
                        return;
                    }
                    let exited = match child_slot().lock() {
                        Ok(mut guard) => match guard.as_mut() {
                            Some(child) => match child.try_wait() {
                                Ok(Some(status)) => {
                                    tracing::warn!(?status, "BrainSupervisor: Pi MCP exited");
                                    *guard = None;
                                    true
                                }
                                Ok(None) => false,
                                Err(e) => {
                                    tracing::error!(error = %e, "BrainSupervisor: try_wait failed");
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
                tracing::error!(error = %e, "BrainSupervisor: spawn Pi MCP failed");
            }
        }
        if SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }
        std::thread::sleep(RESTART_BACKOFF);
    }
}

fn spawn_pi(node: &Path, plugin_dir: &Path) -> std::io::Result<Child> {
    tracing::info!(?plugin_dir, "BrainSupervisor: spawning Pi MCP (ctrl-pi-mcp on :17874)");
    Command::new(node)
        .arg("--experimental-strip-types")
        .arg(PI_MCP_ENTRY)
        .current_dir(plugin_dir)
        .spawn()
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

/// Resolve an absolute `node` binary. A Finder-launched .app has a minimal
/// PATH (no Homebrew / nvm), so check the common install locations
/// explicitly before falling back to PATH.
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
