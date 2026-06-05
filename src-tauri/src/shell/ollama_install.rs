// Ollama install + default-model auto-pull.
//
// Pi-first refactor (bao 2026-06-05, ADR-009 §5): Pi connects directly
// to its native LLM provider via ~/.pi/agent/models.json, which defaults
// to `ollama-local` running Ollama OpenAI-compat at
// http://localhost:11434/v1 with hermes3:8b. That assumes the user
// already has Ollama installed AND has pulled hermes3:8b. This module
// closes both gaps:
//
//   1. Detect: is `ollama` on PATH? is the server reachable? is
//      hermes3:8b in the model list?
//   2. Auto-pull: if Ollama is reachable but hermes3:8b is missing,
//      spawn `ollama pull hermes3:8b` in the background and stream
//      progress to the PWA via a Tauri event.
//   3. Manual hint: if Ollama isn't installed at all, surface a status
//      hint the PWA can render — a button that opens
//      https://ollama.com/download. We don't try to brew/dmg install
//      ourselves; macOS app installs are a user gesture by design.
//
// Mirrors `pi_install.rs` pattern (status snapshot + Mutex slot +
// in-process probe). Stays Rust-only — no Tauri-app dependency leaks
// into the module so it can be unit-tested in isolation.

use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

/// The model Pi-first defaults to. Hermes 3 (Llama 3.1 8B fine-tune)
/// is specifically trained for OpenAI/Anthropic standard tool calling,
/// which pi-ai's `openai-completions` provider parses directly. Other
/// local models can still be used via the `PI_MODEL` env, but the
/// auto-pull only ensures this one.
pub const DEFAULT_MODEL: &str = "hermes3:8b";

/// Whether `ollama` was found and the server is reachable.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OllamaReachability {
    /// `ollama` binary not on PATH.
    NotInstalled,
    /// Binary present but `127.0.0.1:11434/api/tags` not responding.
    /// User needs to start the Ollama app (or `ollama serve`).
    Installed,
    /// Server alive, model list query succeeded.
    Running,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaInstallStatus {
    pub reachability: OllamaReachability,
    /// True when `DEFAULT_MODEL` appears in the Ollama model list.
    pub has_default_model: bool,
    /// Comma-joined list of installed model names — populated when
    /// reachability == Running. Empty otherwise. Useful for the PWA
    /// Settings panel without forcing a second round-trip.
    pub installed_models: Vec<String>,
    /// 0..=100 percent for the in-flight `ollama pull` of
    /// `DEFAULT_MODEL`. `None` when no pull is running.
    pub pull_pct: Option<u8>,
    /// One-line description of the currently-pulling layer, e.g.
    /// `"pulling 4f6b... 78% (4.7 GB)"`. `None` when no pull.
    pub pull_status_line: Option<String>,
    /// `Some(msg)` if the last pull attempt failed.
    pub last_pull_error: Option<String>,
    /// ms since epoch — last successful detect. 0 = never.
    pub last_probe_ms: u64,
}

impl Default for OllamaInstallStatus {
    fn default() -> Self {
        Self {
            reachability: OllamaReachability::NotInstalled,
            has_default_model: false,
            installed_models: Vec::new(),
            pull_pct: None,
            pull_status_line: None,
            last_pull_error: None,
            last_probe_ms: 0,
        }
    }
}

static STATUS: OnceLock<Mutex<OllamaInstallStatus>> = OnceLock::new();
static PULL_IN_FLIGHT: OnceLock<Mutex<bool>> = OnceLock::new();

fn status_slot() -> &'static Mutex<OllamaInstallStatus> {
    STATUS.get_or_init(|| Mutex::new(OllamaInstallStatus::default()))
}

fn pull_flag_slot() -> &'static Mutex<bool> {
    PULL_IN_FLIGHT.get_or_init(|| Mutex::new(false))
}

/// Cheap in-memory snapshot.
pub fn current_status() -> OllamaInstallStatus {
    status_slot()
        .lock()
        .map(|g| g.clone())
        .unwrap_or_default()
}

fn update_status<F: FnOnce(&mut OllamaInstallStatus)>(mutate: F) {
    if let Ok(mut g) = status_slot().lock() {
        mutate(&mut g);
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn ollama_binary_on_path() -> bool {
    // `which ollama` is portable enough; on Windows `where ollama` is
    // a separate concern (Pi-first on Windows is not yet supported as
    // a primary path — Ollama Windows ships a similar CLI but path
    // resolution differs). Defer Windows handling.
    Command::new("which")
        .arg("ollama")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Synchronous probe: `which ollama` + `ollama list`. Updates the
/// in-memory status and returns the snapshot. Safe to call from any
/// thread. Uses `ollama list` CLI rather than the `/api/tags` HTTP
/// endpoint so we don't pull in `reqwest::blocking` (not a current
/// dep feature) — same wire ground truth, one fewer feature flag.
pub fn probe_now() -> OllamaInstallStatus {
    if !ollama_binary_on_path() {
        update_status(|s| {
            s.reachability = OllamaReachability::NotInstalled;
            s.has_default_model = false;
            s.installed_models.clear();
            s.last_probe_ms = now_ms();
        });
        return current_status();
    }

    // `ollama list` exits 0 with a header + rows when the server is
    // reachable. When the server isn't running, recent CLIs print
    // "Error: connection refused" to stderr and exit non-zero — we
    // map that to `Installed` (binary on PATH but daemon down).
    let output = Command::new("ollama")
        .arg("list")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let models = parse_ollama_list(&stdout);
            let has_default = models.iter().any(|m| m == DEFAULT_MODEL);
            update_status(|s| {
                s.reachability = OllamaReachability::Running;
                s.has_default_model = has_default;
                s.installed_models = models;
                s.last_probe_ms = now_ms();
            });
        }
        _ => {
            update_status(|s| {
                s.reachability = OllamaReachability::Installed;
                s.has_default_model = false;
                s.installed_models.clear();
                s.last_probe_ms = now_ms();
            });
        }
    }
    current_status()
}

/// Parse `ollama list` stdout into model names (the first whitespace-
/// separated column). Skips the `NAME ...` header row.
fn parse_ollama_list(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .skip(1) // header `NAME    ID    SIZE    MODIFIED`
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                return None;
            }
            trimmed.split_whitespace().next().map(|s| s.to_string())
        })
        .collect()
}

/// Parse one line of `ollama pull` stdout into a (pct, descriptive)
/// pair. Returns None when the line isn't a progress line.
///
/// Sample stdout lines from `ollama pull hermes3:8b`:
///   "pulling manifest"
///   "pulling 4f6b83f30b62: 100% ▕███████████████████▏ 4.7 GB"
///   "pulling 5a0d6a7e9b3c:  47% ▕████████          ▏ 2.2 GB/4.7 GB"
///   "verifying sha256 digest"
///   "writing manifest"
///   "success"
fn parse_pull_progress(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim();
    if trimmed == "success" {
        return Some((100, "success".to_string()));
    }
    // Look for `NN%` token.
    for token in trimmed.split_whitespace() {
        if let Some(stripped) = token.strip_suffix('%') {
            if let Ok(pct) = stripped.parse::<u8>() {
                return Some((pct.min(100), trimmed.to_string()));
            }
        }
    }
    None
}

/// Spawn an `ollama pull <model>` subprocess. Returns immediately;
/// progress is reflected in the shared status (and optionally an
/// `on_progress` callback the supervisor can wire to a Tauri event
/// emitter). A second concurrent call is a no-op (returns Ok early).
///
/// The callback closure runs on the background thread that tails
/// `ollama pull` stdout. Keep it cheap — it fires for every progress
/// line (~1 line/second).
pub fn spawn_pull_default<F>(on_progress: F) -> Result<(), String>
where
    F: Fn(&OllamaInstallStatus) + Send + 'static,
{
    // Reject concurrent pulls.
    {
        let mut flag = pull_flag_slot().lock().map_err(|e| format!("lock: {e}"))?;
        if *flag {
            return Ok(());
        }
        *flag = true;
    }
    update_status(|s| {
        s.pull_pct = Some(0);
        s.pull_status_line = Some(format!("pulling {DEFAULT_MODEL}…"));
        s.last_pull_error = None;
    });

    let model = DEFAULT_MODEL.to_string();
    std::thread::spawn(move || {
        let result = run_pull_stream(&model, &on_progress);
        if let Err(err) = result {
            update_status(|s| {
                s.last_pull_error = Some(err.clone());
                s.pull_pct = None;
                s.pull_status_line = None;
            });
            tracing::warn!(
                model = %model,
                error = %err,
                "ollama_install: pull failed"
            );
        } else {
            update_status(|s| {
                s.has_default_model = true;
                s.pull_pct = Some(100);
                s.pull_status_line = Some("success".to_string());
            });
            tracing::info!(model = %model, "ollama_install: pull complete");
        }
        on_progress(&current_status());
        if let Ok(mut flag) = pull_flag_slot().lock() {
            *flag = false;
        }
    });
    Ok(())
}

fn run_pull_stream<F>(model: &str, on_progress: &F) -> Result<(), String>
where
    F: Fn(&OllamaInstallStatus),
{
    use std::io::{BufRead, BufReader};
    let mut child = Command::new("ollama")
        .arg("pull")
        .arg(model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn ollama pull: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "ollama pull: no stdout".to_string())?;
    let reader = BufReader::new(stdout);
    for line in reader.lines() {
        let line = line.map_err(|e| format!("read stdout: {e}"))?;
        if let Some((pct, status_line)) = parse_pull_progress(&line) {
            update_status(|s| {
                s.pull_pct = Some(pct);
                s.pull_status_line = Some(status_line);
            });
            on_progress(&current_status());
        }
    }
    let status = child.wait().map_err(|e| format!("wait: {e}"))?;
    if !status.success() {
        return Err(format!(
            "ollama pull exited with status {}",
            status.code().unwrap_or(-1)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pull_progress_handles_pct_line() {
        let (pct, line) =
            parse_pull_progress("pulling 4f6b: 47% ▕████          ▏ 2.2 GB/4.7 GB")
                .expect("expected progress");
        assert_eq!(pct, 47);
        assert!(line.contains("47%"));
    }

    #[test]
    fn parse_pull_progress_success() {
        let (pct, line) = parse_pull_progress("success").expect("expected success");
        assert_eq!(pct, 100);
        assert_eq!(line, "success");
    }

    #[test]
    fn parse_pull_progress_ignores_non_progress() {
        assert!(parse_pull_progress("pulling manifest").is_none());
        assert!(parse_pull_progress("verifying sha256 digest").is_none());
        assert!(parse_pull_progress("").is_none());
    }
}
