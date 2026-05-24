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
#[derive(Debug, Clone, Serialize)]
pub struct UpdateCheck {
    /// One of: "available" | "up_to_date" | "no_endpoint" | "error"
    pub kind: &'static str,
    /// Newer version when `kind = "available"`, else None.
    pub available_version: Option<String>,
    /// Human-readable single-line summary; safe to render directly.
    pub message: String,
}

/// Tauri-managed background cache populated at boot + refreshed every
/// 15 min by `prewarm_update_cache_loop`. `check_for_updates` reads this
/// directly so the cockpit renders the "Upgrade" / "Up to date" pill the
/// moment the PWA mounts — no per-mount network round-trip. Per bao
/// 2026-05-23 "update 不应该打开窗口后才检查, 应该后台直接做完".
#[derive(Default)]
pub struct UpdateCache {
    inner: std::sync::Mutex<Option<UpdateCheck>>,
}

impl UpdateCache {
    pub fn read(&self) -> Option<UpdateCheck> {
        self.inner.lock().unwrap().clone()
    }
    pub fn write(&self, value: UpdateCheck) {
        *self.inner.lock().unwrap() = Some(value);
    }
}

/// Run the actual network check via `tauri-plugin-updater`. Slow path
/// (~1-3s, depends on GitHub round-trip). Used by:
///   • The boot prewarm task (background, before window opens)
///   • The 15-min refresh loop
///   • `force_check_for_updates` (user-clicked re-check)
///   • Cold-path fallback in `check_for_updates` if the cache is still
///     empty when the PWA mounts (only possible in the first ~second
///     after boot before prewarm finishes).
pub async fn run_real_update_check(app: &tauri::AppHandle) -> UpdateCheck {
    use tauri_plugin_updater::UpdaterExt;
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return UpdateCheck {
                kind: "no_endpoint",
                available_version: None,
                message: format!("Updater not configured: {e}"),
            };
        }
    };
    match updater.check().await {
        Ok(Some(release)) => UpdateCheck {
            kind: "available",
            available_version: Some(release.version.clone()),
            message: format!("Update available: v{}", release.version),
        },
        Ok(None) => UpdateCheck {
            kind: "up_to_date",
            available_version: None,
            message: "You're on the latest build.".to_string(),
        },
        Err(e) => UpdateCheck {
            kind: "error",
            available_version: None,
            message: format!("Update check failed: {e}"),
        },
    }
}

/// Background loop kicked off in `ShellLifecycle::boot` — runs an initial
/// check immediately (so the cache is populated by the time the user
/// opens the window) then refreshes every 15 minutes for the process
/// lifetime. Idempotent; safe to call once per boot.
pub fn spawn_update_prewarm(app: tauri::AppHandle) {
    use tauri::Manager;
    tauri::async_runtime::spawn(async move {
        // First pass — populate cache ASAP. If the PWA opens during this
        // ~1-3s window it falls back to the cold path inside
        // `check_for_updates` (still <3s, but no faster than today).
        let initial = run_real_update_check(&app).await;
        if let Some(cache) = app.try_state::<UpdateCache>() {
            cache.write(initial);
        }
        tracing::info!("update prewarm: initial check complete, cache populated");

        // Refresh loop. 15 min matches the PWA's prior poll interval.
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(15 * 60)).await;
            let next = run_real_update_check(&app).await;
            if let Some(cache) = app.try_state::<UpdateCache>() {
                cache.write(next);
            }
            tracing::info!("update prewarm: 15-min refresh complete");
        }
    });
}

/// Read the cached update status populated by the boot prewarm task.
/// Returns instantly (no network) when the cache is populated; falls
/// back to a real check only on the first PWA mount if it happens before
/// prewarm finishes (rare cold-start window, ~1-3s after boot).
#[tauri::command]
pub async fn check_for_updates(
    app: tauri::AppHandle,
    cache: tauri::State<'_, UpdateCache>,
) -> Result<UpdateCheck, String> {
    if let Some(cached) = cache.read() {
        return Ok(cached);
    }
    let result = run_real_update_check(&app).await;
    cache.write(result.clone());
    Ok(result)
}

/// User-triggered force re-check — bypasses cache, hits the network,
/// updates the cache. Wired to the cockpit's "↑ Check" button click so
/// the user can manually verify they're on the latest.
#[tauri::command]
pub async fn force_check_for_updates(
    app: tauri::AppHandle,
    cache: tauri::State<'_, UpdateCache>,
) -> Result<UpdateCheck, String> {
    let result = run_real_update_check(&app).await;
    cache.write(result.clone());
    Ok(result)
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
                    "update-install-progress",
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

/// Hide the main cockpit window. Backs the top-right Hide button so bao
/// always has a click fallback when the Ctrl hotkey state desyncs.
#[tauri::command]
pub async fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::shell::WindowController::hide(&app).map_err(|e| e.to_string())
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
