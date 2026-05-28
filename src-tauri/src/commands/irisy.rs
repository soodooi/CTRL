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
    /// Pi default-brain probe (ADR-001 amendment 2026-05-25, H-2026-05-25-001).
    /// `reachable` = the @ctrl/pi-plugin MCP server is responding on its
    /// `/healthz` endpoint. PWA reads this to decide whether `irisy_chat_stream`
    /// will succeed; degraded UI prompts the user to start the subprocess
    /// (until the kernel supervisor for pi-plugin lands).
    pub pi: PiStatus,
    /// Active brain keycap id (read from `~/.ctrl/active-brain`; defaults to
    /// "pi" when the file is absent / empty). PWA shows this in the Settings
    /// → Brain section so the user can swap brains by editing the file.
    pub active_brain: String,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PiStatus {
    /// MCP endpoint the brain router dispatches to. v1.0 hardcoded
    /// `http://127.0.0.1:17874/mcp` for brain id "pi"; future supervisor
    /// reports the actual ephemeral port through this field.
    pub mcp_url: String,
    /// `true` when /healthz returned 200 within the probe timeout. `false`
    /// covers both "Pi plugin not running" and "Pi binary missing" — PWA
    /// surfaces a single "start pi-plugin" hint either way.
    pub reachable: bool,
    /// Pi binary version reported by the plugin's /healthz (`pi.version`
    /// field). `None` when the plugin is running but Pi itself is missing,
    /// or when the probe didn't complete in time.
    pub version: Option<String>,
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
    let pi = probe_pi().await;
    let active_brain = read_active_brain();

    tracing::info!(
        app_version = %app_version,
        adapter = ?kernel_llm.adapter,
        hermes_path = ?hermes.binary_path,
        plugin_enabled = hermes.plugin_enabled,
        brain_configured = hermes.brain_configured,
        pi_reachable = pi.reachable,
        pi_version = ?pi.version,
        active_brain = %active_brain,
        "irisy_init ok"
    );

    Ok(IrisyStatus {
        app_version,
        kernel_llm,
        hermes,
        mcp_bridge,
        pi,
        active_brain,
    })
}

const PI_HEALTHZ_URL: &str = "http://127.0.0.1:17874/healthz";
const PI_PROBE_TIMEOUT_MS: u64 = 1500;

async fn probe_pi() -> PiStatus {
    let unreachable = PiStatus {
        mcp_url: "http://127.0.0.1:17874/mcp".to_string(),
        reachable: false,
        version: None,
    };

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(PI_PROBE_TIMEOUT_MS))
        .build()
    {
        Ok(c) => c,
        Err(_) => return unreachable,
    };

    let resp = match client.get(PI_HEALTHZ_URL).send().await {
        Ok(r) if r.status().is_success() => r,
        _ => return unreachable,
    };

    let body: serde_json::Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => {
            return PiStatus {
                reachable: true,
                ..unreachable
            };
        }
    };

    let version = body
        .get("pi")
        .and_then(|p| p.get("version"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    PiStatus {
        mcp_url: "http://127.0.0.1:17874/mcp".to_string(),
        reachable: true,
        version,
    }
}

fn read_active_brain() -> String {
    crate::kernel::brain_config::active_brain_id()
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
