//! CTRL ↔ hermes-agent integration surface (v1).
//!
//! Three things on first PWA → Tauri `irisy_init` call:
//!   1. probe the kernel's LLM port — is a brain adapter (Volc/BYOK) wired?
//!   2. detect the user's local hermes binary (pipx / brew / cargo path)
//!      and enable the bundled `~/.hermes/plugins/ctrl/` plugin (idempotent)
//!   3. write `~/.ctrl/state/kernel-handshake.json` so the plugin's
//!      mcp_client can reach the kernel MCP server (ADR-013) with a Bearer
//!      token; v1 writes a placeholder until the kernel MCP server lands
//!
//! What v1 does NOT do (intentional):
//!   • spawn `hermes gateway` — gateway is messaging-platform mgmt
//!     (Telegram / Discord / WhatsApp / Weixin), not a chat HTTP API
//!   • spawn `hermes proxy start` — broken in v0.14.0 (ModuleNotFoundError)
//!   • call into hermes chat for the user's first conversation — that
//!     requires a brain provider configured inside `~/.hermes/auth.json`,
//!     which we DO NOT auto-fill. PWA Irisy chat goes through the existing
//!     `chat_stream` command (kernel llm_port → Volc) until the user wires
//!     a hermes brain themselves via `hermes auth add` or `hermes model`

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;
use tauri::State;

use crate::shell::KernelHandle;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct IrisyStatus {
    /// Irisy companion version = CTRL app version. Single source of truth
    /// = `src-tauri/tauri.conf.json` (read via Tauri `package_info()` at
    /// runtime). No standalone Irisy semver — Irisy ships in lockstep with
    /// the host shell, so the user-visible version stays one number.
    pub app_version: String,
    pub kernel_llm: KernelLlmStatus,
    pub hermes: HermesStatus,
    pub mcp_bridge: McpBridgeStatus,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KernelLlmStatus {
    pub adapter: Option<String>,
    pub ready: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HermesStatus {
    pub binary_path: Option<String>,
    /// Version reported by the locally-installed `hermes` binary (raw output
    /// of `hermes --version`, e.g. "hermes-agent 0.14.0" or "0.14.0"). PWA
    /// gets the raw string; CTRL only parses internally to compare against
    /// `latest_version`.
    pub version: Option<String>,
    /// Latest stable version published to PyPI for `hermes-agent`. `None`
    /// when the PWA is offline / PyPI is unreachable / the call timed out.
    /// Best-effort: irisy_init never blocks on this.
    pub latest_version: Option<String>,
    /// `true` when both `version` and `latest_version` parse as semver and
    /// `latest_version > version`. Stays `false` on parse failure so we
    /// never falsely advertise an update.
    pub update_available: bool,
    pub plugin_enabled: bool,
    pub brain_configured: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct McpBridgeStatus {
    pub handshake_written: bool,
    pub handshake_path: String,
}

#[tauri::command]
pub async fn irisy_init(
    app: tauri::AppHandle,
    kernel: State<'_, KernelHandle>,
) -> Result<IrisyStatus, String> {
    let app_version = app.package_info().version.to_string();
    let kernel_llm = probe_kernel_llm(&kernel);
    let hermes = probe_hermes().await;
    let mcp_bridge = write_handshake_file()?;

    tracing::info!(
        app_version = %app_version,
        adapter = ?kernel_llm.adapter,
        hermes_path = ?hermes.binary_path,
        plugin_enabled = hermes.plugin_enabled,
        brain_configured = hermes.brain_configured,
        "irisy_init ok"
    );

    Ok(IrisyStatus { app_version, kernel_llm, hermes, mcp_bridge })
}

fn probe_kernel_llm(kernel: &State<'_, KernelHandle>) -> KernelLlmStatus {
    let adapter = kernel
        .runtime
        .llm_port
        .primary_adapter()
        .map(|a| a.name().to_string());
    KernelLlmStatus {
        ready: adapter.is_some(),
        adapter,
    }
}

async fn probe_hermes() -> HermesStatus {
    let binary = match locate_hermes_binary() {
        Some(p) => p,
        None => {
            return HermesStatus {
                binary_path: None,
                version: None,
                latest_version: None,
                update_available: false,
                plugin_enabled: false,
                brain_configured: false,
            };
        }
    };

    let version = read_version(&binary);
    let plugin_enabled = enable_ctrl_plugin(&binary);
    // Side-effect: if CTRL has Volc credentials but hermes has no brain,
    // auto-wire Volc into hermes custom_providers (idempotent, no-op if
    // already wired with the same key).
    let _ = wire_hermes_brain_from_kernel();
    let brain_configured = read_brain_configured();

    let latest_version = fetch_pypi_latest_hermes().await;
    let update_available = match (&version, &latest_version) {
        (Some(local), Some(latest)) => is_newer(latest, local),
        _ => false,
    };

    HermesStatus {
        binary_path: Some(binary.display().to_string()),
        version,
        latest_version,
        update_available,
        plugin_enabled,
        brain_configured,
    }
}

/// Best-effort lookup of `hermes-agent` latest published version on PyPI.
///
/// 2-second timeout — if the host is offline / PyPI is slow, irisy_init
/// returns without an update indicator rather than blocking the UI. PyPI's
/// JSON metadata endpoint is anonymous and CDN-fronted; CORS isn't an
/// issue here because the call originates from the Tauri Rust side, not
/// the WebView.
///
/// Results are cached for 1 hour per kernel process (both successful
/// versions and outright failures, so PyPI isn't hammered when offline).
/// Restarting CTRL forces a refresh. The cache is intentionally
/// per-process — a kernel restart already happens often enough during
/// active development, and a kernel that's been up for >1h is a steady
/// state where a single extra HTTP GET costs nothing.
async fn fetch_pypi_latest_hermes() -> Option<String> {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};
    static PYPI_LATEST_CACHE: std::sync::OnceLock<Mutex<Option<(Instant, Option<String>)>>> =
        std::sync::OnceLock::new();
    const PYPI_CACHE_TTL: Duration = Duration::from_secs(3600);

    let cell = PYPI_LATEST_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cell.lock() {
        if let Some((stored_at, cached)) = guard.as_ref() {
            if stored_at.elapsed() < PYPI_CACHE_TTL {
                return cached.clone();
            }
        }
    }

    let fetched = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .user_agent("ctrl-irisy/0 (https://github.com/soodooi/CTRL)")
        .build()
    {
        Ok(client) => match client
            .get("https://pypi.org/pypi/hermes-agent/json")
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => resp
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|json| {
                    json.get("info")
                        .and_then(|i| i.get("version"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                }),
            _ => None,
        },
        Err(_) => None,
    };

    if let Ok(mut guard) = cell.lock() {
        *guard = Some((Instant::now(), fetched.clone()));
    }
    fetched
}

/// Extract a (major, minor, patch) tuple from a `--version` style string
/// like "hermes-agent 0.14.0", "0.14.0", or "hermes, version 0.14.0a1".
/// Pre-release suffix is dropped — for the "update available?" check we
/// compare stable cores only.
fn parse_semver_core(s: &str) -> Option<(u32, u32, u32)> {
    let token = s.split_whitespace().find(|t| {
        let core = t.split(['a', 'b', 'r']).next().unwrap_or("");
        let parts: Vec<&str> = core.split('.').collect();
        parts.len() == 3 && parts.iter().all(|p| p.chars().all(|c| c.is_ascii_digit()))
    })?;
    let core = token.split(['a', 'b', 'r']).next().unwrap_or("");
    let mut parts = core.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    Some((parts.next()?, parts.next()?, parts.next()?))
}

fn is_newer(candidate: &str, baseline: &str) -> bool {
    match (parse_semver_core(candidate), parse_semver_core(baseline)) {
        (Some(a), Some(b)) => a > b,
        _ => false,
    }
}

fn locate_hermes_binary() -> Option<PathBuf> {
    if let Ok(out) = Command::new("which").arg("hermes").output() {
        if out.status.success() {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !s.is_empty() {
                let p = PathBuf::from(s);
                if p.exists() {
                    return Some(p);
                }
            }
        }
    }
    let home = std::env::var("HOME").ok()?;
    for cand in [".local/bin/hermes", ".cargo/bin/hermes"] {
        let p = PathBuf::from(&home).join(cand);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn read_version(hermes: &PathBuf) -> Option<String> {
    let out = Command::new(hermes).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let raw = String::from_utf8_lossy(&out.stdout).to_string();
    raw.lines().next().map(|l| l.trim().to_string())
}

fn enable_ctrl_plugin(hermes: &PathBuf) -> bool {
    let result = Command::new(hermes)
        .args(["plugins", "enable", "ctrl"])
        .output();
    matches!(result, Ok(o) if o.status.success())
}

/// True when hermes has any way to invoke a brain — either via
/// `~/.hermes/auth.json` providers (OAuth + bundled API keys) OR via
/// `~/.hermes/config.yaml` `custom_providers:` entries (OpenAI-compatible
/// direct, which is what CTRL auto-wires for Volc).
fn read_brain_configured() -> bool {
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return false,
    };

    let auth_path = PathBuf::from(&home).join(".hermes").join("auth.json");
    let auth_ok = std::fs::read(&auth_path)
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|json| json.get("providers").cloned())
        .and_then(|v| v.as_object().map(|m| !m.is_empty()))
        .unwrap_or(false);
    if auth_ok {
        return true;
    }

    let config_path = PathBuf::from(&home).join(".hermes").join("config.yaml");
    let yaml = std::fs::read_to_string(&config_path).unwrap_or_default();
    // Cheap string check is enough: yaml may not parse without a YAML dep,
    // and the wire path always emits "  - name: ctrl-volc".
    yaml.contains("custom_providers:") && yaml.contains("name: ctrl-volc")
}

/// Idempotent: if CTRL has Volc credentials and hermes config.yaml is
/// missing the `ctrl-volc` custom provider entry, write one. Re-runs
/// rewrite the file when the key or model changes, so an updated CTRL
/// Volc credential propagates on next CTRL boot.
///
/// Returns Ok(true) on wired, Ok(false) on "nothing to do", Err on
/// filesystem or JSON failure.
fn wire_hermes_brain_from_kernel() -> Result<bool, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env not set".to_string())?;
    let volc_creds_path = PathBuf::from(&home)
        .join(".ctrl")
        .join("state")
        .join("volc-credentials.json");
    let hermes_config_path = PathBuf::from(&home).join(".hermes").join("config.yaml");

    let creds_bytes = match std::fs::read(&volc_creds_path) {
        Ok(b) => b,
        Err(_) => return Ok(false),
    };
    let creds: serde_json::Value = serde_json::from_slice(&creds_bytes)
        .map_err(|e| format!("parse volc-credentials.json: {e}"))?;

    let api_key = creds.get("api_key").and_then(|v| v.as_str()).unwrap_or("");
    let base_url = creds
        .get("base_url")
        .and_then(|v| v.as_str())
        .unwrap_or("https://ark.cn-beijing.volces.com/api/v3");
    let model = creds
        .get("models")
        .and_then(|v| v.get("text.chat"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if api_key.is_empty() || model.is_empty() {
        return Ok(false);
    }

    let existing = std::fs::read_to_string(&hermes_config_path).unwrap_or_default();
    if existing.contains("name: ctrl-volc") && existing.contains(api_key) {
        return Ok(true);
    }

    let yaml = format!(
        "# Auto-wired by CTRL — Volc (Volcano Ark) via hermes custom_providers list.\n\
         # Volc API is OpenAI-shape; hermes routes its OpenAI client to base_url.\n\
         # api_key + model come from CTRL kernel's ~/.ctrl/state/volc-credentials.json.\n\
         # Re-runs of irisy_init re-sync this file when the key or model changes.\n\
         #\n\
         # If you edit this file manually, CTRL will overwrite the ctrl-volc block on\n\
         # next boot. Use the hermes setup wizard for non-CTRL providers — they live\n\
         # in ~/.hermes/.env (API keys) or `hermes auth add <provider>` (OAuth).\n\
         \n\
         custom_providers:\n\
         \x20\x20- name: ctrl-volc\n\
         \x20\x20\x20\x20base_url: {base_url}\n\
         \x20\x20\x20\x20api_key: {api_key}\n\
         \x20\x20\x20\x20model: {model}\n\
         \n\
         # Top-level `model:` is a plain model id (NOT prefixed with `ctrl-volc/`).\n\
         # hermes routes to ctrl-volc when --provider ctrl-volc is passed or when\n\
         # the picker resolves it from the single custom provider entry above.\n\
         model: {model}\n",
        base_url = base_url,
        api_key = api_key,
        model = model,
    );

    if let Some(parent) = hermes_config_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir {parent:?}: {e}"))?;
    }
    std::fs::write(&hermes_config_path, yaml.as_bytes())
        .map_err(|e| format!("write {hermes_config_path:?}: {e}"))?;
    tracing::info!(?hermes_config_path, "wire_hermes_brain_from_kernel: wrote ctrl-volc");
    Ok(true)
}

#[derive(Debug, Deserialize)]
pub struct IrisyChatHermesArgs {
    pub prompt: String,
    /// Optional previous hermes session id — passed to `--continue` so
    /// multi-turn conversations resume context. PWA persists this between
    /// turns; empty / missing starts a fresh session.
    pub session_id: Option<String>,
    /// Cap agent loop iterations. Default 10 matches hermes' interactive
    /// median; raise via PWA for long research turns.
    pub max_turns: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct IrisyChatHermesResult {
    pub session_id: String,
    pub content: String,
    pub elapsed_ms: u64,
}

/// Spawn `hermes chat -q "<prompt>" -Q --provider ctrl-volc ...` as a
/// one-shot subprocess and return the structured result. Blocking
/// (no token streaming) for v1 — hermes' agent loop handles tool calls
/// internally via the bundled ctrl plugin, so PWA sees a single final
/// response. Streaming via hermes SSE lands once the proxy module is
/// fixed upstream.
#[tauri::command]
pub async fn irisy_chat_hermes(
    args: IrisyChatHermesArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<IrisyChatHermesResult, String> {
    let hermes = locate_hermes_binary()
        .ok_or_else(|| "hermes binary not found — install via `pipx install hermes-agent`".to_string())?;

    let max_turns = args.max_turns.unwrap_or(10).clamp(1, 90);
    let session_id_opt = args.session_id.clone().filter(|s| !s.is_empty());
    let prompt = args.prompt.clone();

    let started = std::time::Instant::now();
    let output = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&hermes);
        cmd.arg("chat")
            .arg("-q")
            .arg(&prompt)
            .arg("-Q")
            .arg("--provider")
            .arg("ctrl-volc")
            .arg("--max-turns")
            .arg(max_turns.to_string())
            .arg("--pass-session-id");
        if let Some(sid) = &session_id_opt {
            cmd.arg("--resume").arg(sid);
        }
        cmd.output()
    })
    .await
    .map_err(|e| format!("subprocess join error: {e}"))?
    .map_err(|e| format!("hermes spawn error: {e}"))?;

    let elapsed_ms = started.elapsed().as_millis() as u64;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "hermes chat exit {}\nstderr: {}\nstdout: {}",
            output.status, stderr, stdout
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let mut session_id = args.session_id.clone().unwrap_or_default();
    let mut content_lines: Vec<&str> = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("session_id:") {
            session_id = rest.trim().to_string();
        } else {
            content_lines.push(line);
        }
    }
    let content = content_lines.join("\n").trim().to_string();

    tracing::info!(
        elapsed_ms,
        session_id = %session_id,
        content_chars = content.len(),
        "irisy_chat_hermes ok"
    );

    Ok(IrisyChatHermesResult {
        session_id,
        content,
        elapsed_ms,
    })
}

#[derive(Debug, Serialize)]
pub struct UpgradeHermesResult {
    pub success: bool,
    pub method: String,
    pub new_version: Option<String>,
    pub stdout: String,
    pub stderr: String,
    pub elapsed_ms: u64,
}

/// One-shot upgrade of the user's locally-installed `hermes-agent`.
///
/// Prefers `pipx upgrade hermes-agent` (Hermes's recommended install path)
/// and falls back to `pip install --upgrade hermes-agent` when pipx isn't
/// on PATH. Both run as blocking subprocesses on a Tokio blocking thread,
/// so the JS bridge gets a single final result without polling. Stdout +
/// stderr are returned verbatim so the PWA can show the upgrade log if
/// the user wants details on failure.
#[tauri::command]
pub async fn irisy_upgrade_hermes() -> Result<UpgradeHermesResult, String> {
    let started = std::time::Instant::now();

    let pipx_available = Command::new("pipx")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    let method: &'static str = if pipx_available { "pipx" } else { "pip" };

    let output = tokio::task::spawn_blocking(move || {
        if pipx_available {
            Command::new("pipx")
                .args(["upgrade", "hermes-agent"])
                .output()
        } else {
            Command::new("pip")
                .args(["install", "--upgrade", "hermes-agent"])
                .output()
        }
    })
    .await
    .map_err(|e| format!("subprocess join error: {e}"))?
    .map_err(|e| format!("spawn {method}: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let success = output.status.success();

    // Even when pipx exits 0 ("hermes-agent is already at the latest
    // version"), re-read the binary version so the PWA sees the truth.
    let new_version = if success {
        locate_hermes_binary().and_then(|p| read_version(&p))
    } else {
        None
    };

    tracing::info!(
        method,
        success,
        elapsed_ms,
        new_version = ?new_version,
        "irisy_upgrade_hermes done"
    );

    Ok(UpgradeHermesResult {
        success,
        method: method.to_string(),
        new_version,
        stdout,
        stderr,
        elapsed_ms,
    })
}

fn write_handshake_file() -> Result<McpBridgeStatus, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env not set".to_string())?;
    let dir = PathBuf::from(&home).join(".ctrl").join("state");
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {dir:?}: {e}"))?;
    let path = dir.join("kernel-handshake.json");

    let token = std::env::var("CTRL_KERNEL_TOKEN").unwrap_or_else(|_| "dev-placeholder".into());
    let body = serde_json::json!({
        "url": "http://127.0.0.1:17873/mcp",
        "token": token,
        "written_at_ms": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    });
    std::fs::write(
        &path,
        serde_json::to_vec_pretty(&body).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write {path:?}: {e}"))?;

    Ok(McpBridgeStatus {
        handshake_written: true,
        handshake_path: path.display().to_string(),
    })
}

// ─────────────────────────────────────────────────────────────────────
// Legacy bootstrap commands (HEAD branch) — system_check + install_irisy.
// Used by the PWA welcome wizard for first-run host capability checks
// and the internal pipx-based Irisy install (hermes-agent + plugin copy).
// Kept alongside the v1 hermes-integration surface above (irisy_init /
// irisy_chat_hermes / irisy_upgrade_hermes).
// ─────────────────────────────────────────────────────────────────────
use std::process::Stdio;
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
    if let Err(e) = app.emit("irisy-install-progress", payload) {
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
