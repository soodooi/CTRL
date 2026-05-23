// System status — PWA status bar's data source.
//
// Phase 1F per bao 2026-05-22: surface kernel-side health metrics so
// the JSON-manifest-rendered status bar can show real numbers (LLM
// adapter registered? how many MCP servers? vault size? uptime?).
//
// Returns a single KernelStatus struct serialized once per poll. PWA
// polls every few seconds; if real-time updates ever matter we move
// these onto the ST-SS bridge as Cell events.

use crate::kernel::vault::default_vault_root;
use crate::shell::KernelHandle;
use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use tauri::State;

/// Default loopback address of the Hermes Agent's local dashboard
/// daemon. Hermes 0.14+ binds here when `hermes dashboard` is running.
/// Kept loopback-only — never proxied / never exposed beyond the host.
const HERMES_DASHBOARD_ADDR: &str = "127.0.0.1:9119";
const HERMES_DASHBOARD_PROBE_TIMEOUT_MS: u64 = 200;

#[derive(Debug, Serialize)]
pub struct KernelStatus {
    /// Kernel uptime in milliseconds (monotonic, captured at boot).
    pub uptime_ms: u64,
    /// LLM adapters registered at boot. Empty = no provider configured.
    pub llm_adapters: Vec<String>,
    /// Name of the adapter chosen by `LlmPortRouter::primary_adapter`,
    /// or None when no adapter is registered.
    pub primary_adapter: Option<String>,
    /// Number of MCP server descriptors persisted to the registry. Not
    /// the same as connected — connections lazy-establish on first
    /// invoke.
    pub mcp_servers_installed: usize,
    /// Approximate vault file count (markdown files under vault root).
    /// `0` when HOME is unset / vault dir doesn't exist yet.
    pub vault_files: usize,
    /// ST-SS bridge listen address (loopback only, token-auth).
    pub stss_bridge_addr: String,
    /// URL of the local Hermes Agent dashboard daemon when it is
    /// reachable on its default port (127.0.0.1:9119). `None` when the
    /// dashboard isn't running (or hermes isn't installed). The PWA's
    /// Hermes Settings tab uses this to drive the iframe `src` — when
    /// `None`, the tab can show an install prompt instead of a black
    /// iframe. Probed via TCP connect on each poll (~200ms cap).
    pub hermes_dashboard_url: Option<String>,
    /// "ok" when everything boot-time-required is registered; warnings
    /// list each missing component (e.g. "no llm adapter").
    pub overall: &'static str,
    pub warnings: Vec<String>,
}

/// Build-time metadata for the user-visible version pill in the cockpit.
/// Three fields:
///   - `version`  cargo crate version (semver)
///   - `sha`      git HEAD short SHA at the time `cargo build` ran
///   - `built_at` RFC-3339 UTC timestamp of the build
/// `sha` + `built_at` come from `src-tauri/build.rs` via cargo:rustc-env;
/// they fall back to "unknown" when injection failed (rare — needs git
/// + date on the build host).
#[derive(Debug, Serialize)]
pub struct AppMeta {
    pub version: &'static str,
    pub sha: &'static str,
    pub built_at: &'static str,
}

#[tauri::command]
pub async fn app_meta() -> Result<AppMeta, String> {
    Ok(AppMeta {
        version: env!("CARGO_PKG_VERSION"),
        sha: option_env!("CTRL_BUILD_SHA").unwrap_or("unknown"),
        built_at: option_env!("CTRL_BUILD_TIME").unwrap_or("unknown"),
    })
}

/// Read the repo's CHANGELOG.md so the cockpit Settings → About panel
/// can show users what changed between builds. The file is bundled in
/// the Tauri resource dir (production) and walked-up to from CWD in
/// dev. Returns markdown content verbatim; PWA renders it.
#[tauri::command]
pub async fn app_changelog(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    // 1. Try the Tauri resource dir (production builds bundle CHANGELOG.md).
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("CHANGELOG.md");
        if let Ok(contents) = std::fs::read_to_string(&candidate) {
            return Ok(contents);
        }
    }
    // 2. Dev fallback — walk up from CWD looking for CHANGELOG.md at
    //    the repo root. Caps at 6 levels so we don't traverse the
    //    whole filesystem on a misconfigured run.
    if let Ok(mut cwd) = std::env::current_dir() {
        for _ in 0..6 {
            let candidate = cwd.join("CHANGELOG.md");
            if let Ok(contents) = std::fs::read_to_string(&candidate) {
                return Ok(contents);
            }
            if !cwd.pop() {
                break;
            }
        }
    }
    Err("CHANGELOG.md not found in app resources or workspace".to_string())
}

/// Update-check result returned to the PWA. `kind` discriminates the
/// outcome so the UI can render distinct messaging without parsing the
/// `message` string.
#[derive(Debug, Serialize)]
pub struct UpdateCheck {
    /// One of: "available" | "up_to_date" | "no_endpoint" | "error"
    pub kind: &'static str,
    /// Newer version when `kind = "available"`, else None.
    pub available_version: Option<String>,
    /// Human-readable single-line summary; safe to render directly.
    pub message: String,
}

/// Wraps `tauri-plugin-updater` so the cockpit "Check for Updates"
/// button has somewhere to call.
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateCheck, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return Ok(UpdateCheck {
                kind: "no_endpoint",
                available_version: None,
                message: format!("Updater not configured: {e}"),
            });
        }
    };
    match updater.check().await {
        Ok(Some(release)) => Ok(UpdateCheck {
            kind: "available",
            available_version: Some(release.version.clone()),
            message: format!("Update available: v{}", release.version),
        }),
        Ok(None) => Ok(UpdateCheck {
            kind: "up_to_date",
            available_version: None,
            message: "You're on the latest build.".to_string(),
        }),
        Err(e) => Ok(UpdateCheck {
            kind: "error",
            available_version: None,
            message: format!("Update check failed: {e}"),
        }),
    }
}

/// Outcome of an install attempt.
#[derive(Debug, Serialize)]
pub struct InstallOutcome {
    pub kind: &'static str, // "installed" | "no_update" | "error"
    pub message: String,
}

/// Download + install the latest update reported by `check_for_updates`.
/// Tauri's `download_and_install` replaces the running .app and the
/// caller is expected to relaunch — we call `app.restart()` on success
/// so the new build is live immediately. Streams download progress via
/// the `update.install.progress` event channel so the AboutPanel can
/// render a real progress bar.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<InstallOutcome, String> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    let updater = app
        .updater()
        .map_err(|e| format!("updater unavailable: {e}"))?;

    let release = match updater.check().await {
        Ok(Some(r)) => r,
        Ok(None) => {
            return Ok(InstallOutcome {
                kind: "no_update",
                message: "Already on the latest build.".to_string(),
            });
        }
        Err(e) => return Err(format!("update check failed: {e}")),
    };

    let release_version = release.version.clone();
    let app_for_progress = app.clone();
    let mut downloaded: u64 = 0;
    let download_result = release
        .download_and_install(
            move |chunk_len, content_length| {
                downloaded = downloaded.saturating_add(chunk_len as u64);
                let total = content_length.unwrap_or(0);
                let _ = app_for_progress.emit(
                    "update.install.progress",
                    serde_json::json!({
                        "downloaded": downloaded,
                        "total": total,
                        "version": release_version,
                    }),
                );
            },
            || {
                tracing::info!("update download complete, installing");
            },
        )
        .await;

    if let Err(e) = download_result {
        return Err(format!("download_and_install failed: {e}"));
    }

    let installed_version = release.version.clone();
    let app_for_restart = app.clone();
    // Give the PWA a brief moment to render the "Installed, restarting…"
    // state before the restart yanks the WebView out from under it.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        app_for_restart.restart();
    });
    Ok(InstallOutcome {
        kind: "installed",
        message: format!("Installed v{installed_version}, restarting…"),
    })
}

/// Probe the Hermes dashboard daemon. Returns `Some(url)` when a TCP
/// connection succeeds within `HERMES_DASHBOARD_PROBE_TIMEOUT_MS`, else
/// `None`. We don't speak HTTP here — a successful TCP accept on the
/// loopback port is good enough for the PWA to decide "show the iframe
/// vs. show the install prompt" because no other service binds 9119 on
/// loopback by convention. The PWA does its own HTTP-level health-check
/// on the iframe load event.
fn probe_hermes_dashboard() -> Option<String> {
    let addr: SocketAddr = HERMES_DASHBOARD_ADDR.parse().ok()?;
    let timeout = Duration::from_millis(HERMES_DASHBOARD_PROBE_TIMEOUT_MS);
    TcpStream::connect_timeout(&addr, timeout).ok()?;
    Some(format!("http://{HERMES_DASHBOARD_ADDR}"))
}

#[tauri::command]
pub async fn kernel_status(
    kernel: State<'_, KernelHandle>,
) -> Result<KernelStatus, String> {
    let runtime = &kernel.runtime;
    let uptime_ms = runtime.booted_at.elapsed().as_millis() as u64;

    let llm_adapters: Vec<String> = runtime
        .llm_port
        .fallback_chain()
        .iter()
        .filter(|name| runtime.llm_port.adapter_for(name).is_some())
        .cloned()
        .collect();
    let primary_adapter = runtime
        .llm_port
        .primary_adapter()
        .map(|a| a.name().to_string());

    let mcp_servers_installed = runtime.mcp_host.list_installed().await.len();

    let vault_files = match default_vault_root() {
        Some(root) => crate::kernel::vault::list(&root, None)
            .map(|v| v.len())
            .unwrap_or(0),
        None => 0,
    };

    let stss_bridge_addr = crate::kernel::STSS_LISTEN_ADDR.to_string();

    let mut warnings: Vec<String> = Vec::new();
    if primary_adapter.is_none() {
        warnings.push(
            "no LLM adapter registered — edit ~/.ctrl/config.toml or run setup_llm_key".into(),
        );
    }
    let overall = if warnings.is_empty() { "ok" } else { "degraded" };

    let hermes_dashboard_url = probe_hermes_dashboard();

    Ok(KernelStatus {
        uptime_ms,
        llm_adapters,
        primary_adapter,
        mcp_servers_installed,
        vault_files,
        stss_bridge_addr,
        hermes_dashboard_url,
        overall,
        warnings,
    })
}
