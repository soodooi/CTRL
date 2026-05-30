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
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FirstRunState {
    /// `~/.ctrl/keycaps/` doesn't exist yet. Kernel hasn't seeded builtin
    /// keycaps from the app bundle Resources/keycaps/. PWA should render
    /// a "Setting up CTRL…" empty state and avoid showing the keyboard.
    Copying,
    /// `~/.ctrl/keycaps/` exists. May be empty, may have keycaps. PWA
    /// renders the normal keyboard + Pool empty-state hint when zero
    /// keycaps installed.
    Ready,
}

#[derive(Debug, Serialize)]
pub struct KernelStatus {
    /// Kernel uptime in milliseconds (monotonic, captured at boot).
    pub uptime_ms: u64,
    /// First-run state — distinguishes "fresh install still seeding" from
    /// "set up, empty keyboard" so the PWA renders the right empty state.
    /// Per ADR-001 amendment 2026-05-25 (decision D6).
    pub first_run_state: FirstRunState,
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
    /// "ok" when everything boot-time-required is registered; warnings
    /// list each missing component (e.g. "no llm adapter").
    pub overall: &'static str,
    pub warnings: Vec<String>,
    /// Active brain keycap id (read from `~/.ctrl/active-brain`; falls back
    /// to "pi" when the file is absent / empty). Surfaced here so the
    /// StatusBar's top-left "engine" pill can render without a second
    /// round-trip to `irisy_init`. bao 2026-05-30: top-left = status zone,
    /// engine + MCP go here.
    pub active_brain: String,
}

fn detect_first_run_state() -> FirstRunState {
    let home = match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => h,
        _ => return FirstRunState::Copying,
    };
    let keycaps = PathBuf::from(home).join(".ctrl").join("keycaps");
    if keycaps.is_dir() {
        FirstRunState::Ready
    } else {
        FirstRunState::Copying
    }
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

    let active_brain = crate::kernel::brain_config::active_brain_id();

    Ok(KernelStatus {
        uptime_ms,
        first_run_state: detect_first_run_state(),
        llm_adapters,
        primary_adapter,
        mcp_servers_installed,
        vault_files,
        stss_bridge_addr,
        overall,
        warnings,
        active_brain,
    })
}

/// Hide the main cockpit window. Backs the top-right Hide (×) button so
/// bao always has a click fallback when the Ctrl hotkey state desyncs
/// (CGEventTap permission drop, FlagsChanged desync, AX revocation after
/// an upgrade that changed the bundle hash).
#[tauri::command]
pub async fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    crate::shell::WindowController::hide(&app).map_err(|e| e.to_string())
}

/// Set the main window's height in logical pixels. Width and top-left
/// position are preserved — the bottom edge moves to accommodate the new
/// height. Companion mode uses this to grow downward as chat content
/// arrives (bao 2026-05-30: "整个窗口往下流").
///
/// The window is clamped to the primary monitor's available height so it
/// can never grow past the bottom of the screen.
#[tauri::command]
pub fn set_window_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    use tauri::{LogicalSize, Manager};
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no current monitor".to_string())?;
    let scale = monitor.scale_factor();
    let max_logical = monitor.size().height as f64 / scale - 40.0; // leave room for menu bar
    let target = height.max(180.0).min(max_logical);
    let current_size = win.outer_size().map_err(|e| e.to_string())?;
    let current_w_logical = current_size.width as f64 / scale;
    win.set_size(LogicalSize::new(current_w_logical, target))
        .map_err(|e| e.to_string())
}

/// Position the main window at the top-right edge of the primary monitor.
/// Companion mode calls this on boot so the strip is anchored to the
/// upper-right corner regardless of where the user last placed it.
#[tauri::command]
pub fn position_window_top_right(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{LogicalPosition, Manager};
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no current monitor".to_string())?;
    let scale = monitor.scale_factor();
    let monitor_w_logical = monitor.size().width as f64 / scale;
    let win_outer = win.outer_size().map_err(|e| e.to_string())?;
    let win_w_logical = win_outer.width as f64 / scale;
    let monitor_pos = monitor.position();
    let monitor_x_logical = monitor_pos.x as f64 / scale;
    let monitor_y_logical = monitor_pos.y as f64 / scale;
    let x = monitor_x_logical + monitor_w_logical - win_w_logical;
    let y = monitor_y_logical + 24.0; // leave room for menu bar
    win.set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Spawn (or reveal) the input window — a separate Tauri window dedicated
/// to the composer (textarea + send). Positions it directly under the
/// main window, same width. bao 2026-05-30: 两个独立窗口,上 chat history,
/// 下 input,input 长高时这个窗口的底边外扩。
#[tauri::command]
pub fn spawn_input_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

    // Already exists? Just make sure it's visible and positioned.
    if let Some(existing) = app.get_webview_window("input") {
        position_input_under_main(&app, &existing)?;
        existing
            .show()
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let win = WebviewWindowBuilder::new(
        &app,
        "input",
        WebviewUrl::App("/?surface=input".into()),
    )
    .title("CTRL · Input")
    .inner_size(430.0, 44.0)
    .min_inner_size(430.0, 44.0)
    .decorations(false)
    .transparent(false)
    .shadow(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(true)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.set_size(LogicalSize::new(430.0, 44.0));
    position_input_under_main(&app, &win)?;
    Ok(())
}

/// Resize the input window (preserves position + width).
#[tauri::command]
pub fn set_input_window_height(app: tauri::AppHandle, height: f64) -> Result<(), String> {
    use tauri::{LogicalSize, Manager};
    let win = app
        .get_webview_window("input")
        .ok_or_else(|| "input window not found".to_string())?;
    let monitor = win
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no current monitor".to_string())?;
    let scale = monitor.scale_factor();
    let max_logical = monitor.size().height as f64 / scale - 40.0;
    let target = height.max(44.0).min(max_logical);
    win.set_size(LogicalSize::new(430.0, target))
        .map_err(|e| e.to_string())
}

/// Position the input window directly under the main window.
fn position_input_under_main(
    app: &tauri::AppHandle,
    input: &tauri::WebviewWindow,
) -> Result<(), String> {
    use tauri::{LogicalPosition, Manager};
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let monitor = main
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "no current monitor".to_string())?;
    let scale = monitor.scale_factor();
    let main_pos = main.outer_position().map_err(|e| e.to_string())?;
    let main_size = main.outer_size().map_err(|e| e.to_string())?;
    let x = main_pos.x as f64 / scale;
    let y = (main_pos.y as f64 + main_size.height as f64) / scale;
    input
        .set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
