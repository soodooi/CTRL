// Hermes subprocess supervisor.
//
// H-2026-06-09-001 — opencode (coding) + Hermes (assistant) as peer agent processes.
//
// Hermes runs as an MCP server (hermes mcp serve). The supervisor spawns it,
// connects via stdio MCP, and maintains the child process. The PWA talks to
// Hermes via MCP (see commands/hermes_chat.rs).
//
// Unlike opencode, Hermes uses MCP (not HTTP). The kernel already has an
// MCP client implementation (mcp_host.rs) for outbound MCP connections,
// but that's for kernel-side mcps hosting other processes. For Hermes, we
// need a client that connects TO a process (stdio MCP), which is the opposite.
//
// Key differences from opencode_supervisor:
//   1. Hermes uses MCP (not HTTP)
//   2. Hermes connects via stdio (not HTTP)
//   3. Hermes credentials live in ~/.hermes/config.yaml (we read from Keychain)
//   4. Hermes doesn't need a port (stdio is used)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::credential_vault;

/// Wait between respawns after the child exits.
const RESTART_BACKOFF: Duration = Duration::from_secs(3);
/// How often the supervise loop polls the child for exit.
const POLL_INTERVAL: Duration = Duration::from_millis(300);
/// Total deadline for trial verify after spawn. hermes mcp serve should
/// print a handshake message within ~500ms; allow generous headroom.
const TRIAL_VERIFY_DEADLINE: Duration = Duration::from_secs(6);
/// Sleep between trial-verify polls.
const TRIAL_VERIFY_INTERVAL: Duration = Duration::from_millis(250);

static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static CHILD: OnceLock<Arc<Mutex<Option<std::process::Child>>>> = OnceLock::new();
static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn child_slot() -> Arc<Mutex<Option<std::process::Child>>> {
    CHILD.get_or_init(|| Arc::new(Mutex::new(None))).clone()
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

/// Last error the supervisor recorded, or `None` if Hermes is healthy.
pub fn last_error() -> Option<String> {
    error_slot().lock().ok().and_then(|g| g.clone())
}

/// Get Hermes child process for MCP communication.
/// Returns `None` if Hermes is not running.
pub fn get_hermes_child() -> Option<Arc<Mutex<Option<std::process::Child>>>> {
    CHILD.get().cloned()
}

/// Whether Hermes is currently spawned.
pub fn is_running() -> bool {
    child_slot()
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}

pub struct HermesSupervisor;

    impl HermesSupervisor {
    /// Spawn + supervise Hermes mcp serve on a background thread.
    /// Returns immediately; the supervise thread handles spawning + respawning.
    pub fn start(app: &AppHandle) {
        let hermes_binary = match find_hermes() {
            Some(p) => p,
            None => {
                let msg = "HermesSupervisor: `hermes` not found on disk; \
                           assistant brain stays down. Install with: \
                           npm install -g @hermes-ai/hermes"
                    .to_string();
                tracing::error!("{msg}");
                set_last_error(msg.clone());
                
                // Emit brain-down event to PWA
                if let Err(e) = app.emit("brain-down", serde_json::json!({
                    "brain": "hermes",
                    "reason": "binary not found"
                })) {
                    tracing::error!("Failed to emit brain-down event: {}", e);
                }
                
                return;
            }
        };

        tracing::info!(
            ?hermes_binary,
            "HermesSupervisor: starting Hermes supervision"
        );

        let _ = std::thread::Builder::new()
            .name("ctrl-hermes-supervisor".into())
            .spawn(move || supervise(hermes_binary));
    }

    /// Kill the Hermes child + stop respawning. Call on real app exit.
    pub fn shutdown() {
        SHUTDOWN.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = child_slot().lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        tracing::info!("HermesSupervisor: shut down");
    }
}

/// Find the hermes binary on PATH.
fn find_hermes() -> Option<std::path::PathBuf> {
    // Check PATH first
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let binary = std::path::PathBuf::from(dir).join("hermes");
            if binary.exists() {
                tracing::debug!("HermesSupervisor: found hermes at {:?}", binary);
                return Some(binary);
            }
        }
    }

    // Check common global install dirs
    let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let common_dirs = [
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/opt/homebrew/bin"),
        std::path::PathBuf::from(home).join(".npm-global/bin"),
    ];

    for dir in common_dirs {
        let binary = std::path::PathBuf::from(dir).join("hermes");
        if binary.exists() {
            tracing::debug!("HermesSupervisor: found hermes at {:?}", binary);
            return Some(binary);
        }
    }

    None
}

/// Supervision loop: spawn Hermes, wait for it to exit, respawn with backoff.
fn supervise(hermes_binary: std::path::PathBuf) {
    let mut backoff = RESTART_BACKOFF;

    while !SHUTDOWN.load(Ordering::SeqCst) {
        if spawn_and_verify(&hermes_binary).is_some() {
            clear_last_error();
            tracing::info!("HermesSupervisor: Hermes MCP server running");

            // Wait for child to exit
            if let Ok(mut guard) = child_slot().lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.wait();
                    tracing::info!("HermesSupervisor: Hermes exited");
                }
            }

            backoff = RESTART_BACKOFF;
        } else {
            backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
            tracing::warn!(
                "HermesSupervisor: spawn/verify failed, retrying in {:?}",
                backoff
            );
        }

        if SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }

        std::thread::sleep(backoff);
    }
}

/// Spawn hermes mcp serve and verify it's ready. Returns true if successful.
fn spawn_and_verify(hermes_binary: &std::path::PathBuf) -> Option<bool> {
    use std::io::BufRead;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    // Write Hermes credentials from keychain to config file before spawning
    if let Ok(api_key) = credential_vault::get_hermes_credential() {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let config_path: PathBuf = [home.as_str(), ".hermes", "config.yaml"]
            .iter()
            .collect();

        if let Some(parent) = config_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let config = format!("apiKey: {}\n", api_key);
        if let Err(e) = std::fs::write(&config_path, config) {
            tracing::error!("HermesSupervisor: failed to write config.yaml: {}", e);
        } else {
            tracing::debug!("HermesSupervisor: wrote config.yaml to {:?}", config_path);
        }
    }

    let mut child = Command::new(hermes_binary)
        .args(["mcp", "serve"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::piped())
        .spawn()
        .ok()?;

    let stderr = child.stderr.take()?;
    let stderr_reader = std::io::BufReader::new(stderr);
    let mut lines = stderr_reader.lines();

    // Try to verify MCP handshake from STDERR for up to TRIAL_VERIFY_DEADLINE
    let start = std::time::Instant::now();
    let mut found_handshake = false;

    while start.elapsed() < TRIAL_VERIFY_DEADLINE {
        match lines.next() {
            Some(Ok(line)) => {
                tracing::debug!("HermesSupervisor: stderr: {}", line);

                // Look for MCP handshake message
                if line.contains("MCP server listening") || line.contains("ready to accept connections") {
                    found_handshake = true;
                    break;
                }
            }
            Some(Err(e)) => {
                tracing::debug!("HermesSupervisor: stderr read error: {}", e);
            }
            None => {
                break;
            }
        }
        std::thread::sleep(TRIAL_VERIFY_INTERVAL);
    }

    if !found_handshake {
        return None;
    }

    // Store the child so we can wait for it later
    if let Ok(mut guard) = child_slot().lock() {
        *guard = Some(child);
    }

    Some(true)
}