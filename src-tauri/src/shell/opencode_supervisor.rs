// Opencode subprocess supervisor.
//
// H-2026-06-09-001 — opencode (coding) + Hermes (assistant) as peer agent processes.
//
// Opencode runs as a headless HTTP server (opencode serve --hostname 127.0.0.1 --port 0).
// The supervisor spawns it, reads the random port from STDOUT, and maintains
// the child process. The PWA talks to opencode via HTTP API (see commands/opencode_chat.rs).
//
// Unlike Pi, opencode doesn't have a long-lived install probe — we assume
// the user has installed opencode globally (npm install -g @opencode-ai/opencode).
//
// Key differences from brain_supervisor (Pi):
//   1. opencode uses HTTP (not MCP)
//   2. opencode port is random (opencode serve --port 0)
//   3. opencode credentials live in ~/.local/share/opencode/auth.json (we read from Keychain)
//   4. opencode doesn't need CTRL_PROVIDER_PORT env (it manages its own provider)

use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::credential_vault;

/// Wait between respawns after the child exits.
const RESTART_BACKOFF: Duration = Duration::from_secs(3);
/// How often the supervise loop polls the child for exit.
const POLL_INTERVAL: Duration = Duration::from_millis(300);
/// Total deadline for trial verify after spawn. opencode serve --port 0
/// should print the listening URL within ~500ms; allow generous headroom.
const TRIAL_VERIFY_DEADLINE: Duration = Duration::from_secs(6);
/// Sleep between trial-verify polls.
const TRIAL_VERIFY_INTERVAL: Duration = Duration::from_millis(250);

static SHUTDOWN: AtomicBool = AtomicBool::new(false);
static LISTEN_PORT: AtomicU16 = AtomicU16::new(0);
static CHILD: OnceLock<Mutex<Option<std::process::Child>>> = OnceLock::new();
static LAST_ERROR: OnceLock<Mutex<Option<String>>> = OnceLock::new();

fn child_slot() -> &'static Mutex<Option<std::process::Child>> {
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

/// Last error the supervisor recorded, or `None` if opencode is healthy.
pub fn last_error() -> Option<String> {
    error_slot().lock().ok().and_then(|g| g.clone())
}

/// Whether opencode is currently spawned.
pub fn is_running() -> bool {
    child_slot()
        .lock()
        .map(|g| g.is_some())
        .unwrap_or(false)
}

/// Port opencode is listening on (0 if not running).
pub fn listen_port() -> u16 {
    LISTEN_PORT.load(Ordering::SeqCst)
}

pub struct OpencodeSupervisor;

    impl OpencodeSupervisor {
    /// Spawn + supervise opencode serve on a background thread.
    /// Returns immediately; the supervise thread handles spawning + respawning.
    pub fn start(app: &AppHandle) {
        let opencode_binary = match find_opencode() {
            Some(p) => p,
            None => {
                let msg = "OpencodeSupervisor: `opencode` not found on disk; \
                           coding brain stays down. Install with: \
                           npm install -g @opencode-ai/opencode"
                    .to_string();
                tracing::error!("{msg}");
                set_last_error(msg.clone());
                
                // Emit brain-down event to PWA
                if let Err(e) = app.emit("brain-down", serde_json::json!({
                    "brain": "opencode",
                    "reason": "binary not found"
                })) {
                    tracing::error!("Failed to emit brain-down event: {}", e);
                }
                
                return;
            }
        };

        tracing::info!(
            ?opencode_binary,
            "OpencodeSupervisor: starting opencode supervision"
        );

        let _ = std::thread::Builder::new()
            .name("ctrl-opencode-supervisor".into())
            .spawn(move || supervise(opencode_binary));
    }

    /// Kill the opencode child + stop respawning. Call on real app exit.
    pub fn shutdown() {
        SHUTDOWN.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = child_slot().lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
        tracing::info!("OpencodeSupervisor: shut down");
    }
}

/// Find the opencode binary on PATH.
fn find_opencode() -> Option<std::path::PathBuf> {
    // Check PATH first
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(':') {
            let binary = std::path::PathBuf::from(dir).join("opencode");
            if binary.exists() {
                tracing::debug!("OpencodeSupervisor: found opencode at {:?}", binary);
                return Some(binary);
            }
        }
    }

    // Check common global install dirs
    let common_dirs = [
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/opt/homebrew/bin"),
        std::env::var("HOME")
            .map(|h| std::path::PathBuf::from(h).join(".npm-global/bin"))
            .unwrap_or_else(|_| std::path::PathBuf::from(".")),
    ];

    for dir in common_dirs {
        let binary = std::path::PathBuf::from(dir).join("opencode");
        if binary.exists() {
            tracing::debug!("OpencodeSupervisor: found opencode at {:?}", binary);
            return Some(binary);
        }
    }

    None
}

/// Supervision loop: spawn opencode, wait for it to exit, respawn with backoff.
fn supervise(opencode_binary: std::path::PathBuf) {
    let mut backoff = RESTART_BACKOFF;

    while !SHUTDOWN.load(Ordering::SeqCst) {
        if let Some(port) = spawn_and_verify(&opencode_binary) {
            LISTEN_PORT.store(port, Ordering::SeqCst);
            clear_last_error();
            tracing::info!("OpencodeSupervisor: opencode listening on http://127.0.0.1:{}", port);

            // Wait for child to exit
            if let Ok(mut guard) = child_slot().lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.wait();
                    tracing::info!("OpencodeSupervisor: opencode exited");
                }
            }

            LISTEN_PORT.store(0, Ordering::SeqCst);
            backoff = RESTART_BACKOFF;
        } else {
            backoff = std::cmp::min(backoff * 2, Duration::from_secs(30));
            tracing::warn!(
                "OpencodeSupervisor: spawn/verify failed, retrying in {:?}",
                backoff
            );
        }

        if SHUTDOWN.load(Ordering::SeqCst) {
            break;
        }

        std::thread::sleep(backoff);
    }
}

/// Spawn opencode serve and verify it's listening. Returns the port if successful.
fn spawn_and_verify(opencode_binary: &std::path::PathBuf) -> Option<u16> {
    use std::io::{BufRead, BufReader};
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    // Write opencode credentials from keychain to config file before spawning
    if let Ok(api_key) = credential_vault::get_opencode_credential() {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let auth_path: PathBuf = [home.as_str(), ".local", "share", "opencode", "auth.json"]
            .iter()
            .collect();

        if let Some(parent) = auth_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        let auth_config = serde_json::json!({ "apiKey": api_key });
        if let Err(e) = std::fs::write(&auth_path, auth_config.to_string()) {
            tracing::error!("OpencodeSupervisor: failed to write auth.json: {}", e);
        } else {
            tracing::debug!("OpencodeSupervisor: wrote auth.json to {:?}", auth_path);
        }
    }

    let mut child = Command::new(opencode_binary)
        .args(["serve", "--hostname", "127.0.0.1", "--port", "0"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .ok()?;

    let stdout = child.stdout.take()?;
    let stderr = child.stderr.take()?;

    // Read STDOUT to find the port (opencode prints: "Server started on http://127.0.0.1:XXXXX")
    let stdout_reader = BufReader::new(stdout);
    let mut stdout_lines = stdout_reader.lines();

    let mut port: Option<u16> = None;

    // Try to parse port from STDOUT for up to TRIAL_VERIFY_DEADLINE
    let start = std::time::Instant::now();
    while start.elapsed() < TRIAL_VERIFY_DEADLINE {
        match stdout_lines.next() {
            Some(Ok(line)) => {
                tracing::debug!("OpencodeSupervisor: stdout: {}", line);

                // Parse "Server started on http://127.0.0.1:XXXXX"
                if let Some(port_str) = line.strip_prefix("Server started on http://127.0.0.1:") {
                    if let Ok(p) = port_str.parse::<u16>() {
                        port = Some(p);
                        break;
                    }
                }
            }
            Some(Err(e)) => {
                tracing::debug!("OpencodeSupervisor: stdout read error: {}", e);
            }
            None => {
                break;
            }
        }
        std::thread::sleep(TRIAL_VERIFY_INTERVAL);
    }

    let port = port?;

    // Verify HTTP server is actually listening
    let health_url = format!("http://127.0.0.1:{}/health", port);
    let health_start = std::time::Instant::now();
    let mut healthy = false;
    while health_start.elapsed() < Duration::from_secs(3) {
        match ureq::get(&health_url).call() {
            Ok(resp) if resp.status() == 200 => {
                healthy = true;
                break;
            }
            Ok(_) | Err(_) => {
                std::thread::sleep(Duration::from_millis(200));
            }
        }
    }

    if !healthy {
        tracing::error!("OpencodeSupervisor: HTTP health check failed at {}", health_url);
        return None;
    }

    // Store the child so we can wait for it later
    if let Ok(mut guard) = child_slot().lock() {
        *guard = Some(child);
    }

    Some(port)
}