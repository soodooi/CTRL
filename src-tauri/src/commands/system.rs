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
    /// Brain engine label. Always "pi" (Pi is the sole brain per
    /// ADR-003). Kept as a string field for forward-compat with PWA
    /// consumers; the value never changes at runtime.
    pub active_brain: &'static str,
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
        .provider_registry
        .list()
        .into_iter()
        .filter(|e| e.load_error.is_none())
        .map(|e| e.id)
        .collect();
    let primary_adapter = runtime
        .provider_registry
        .primary_text_chat()
        .map(|p| p.id().to_string());

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

    // ADR-003: Pi is the sole brain (singleton). No registry, no
    // ~/.ctrl/active-brain file. Value is constant.
    let active_brain = "pi";

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

/// Position the main window centered in the right half of the primary
/// monitor. bao 2026-05-30: don't sit flush against the right edge —
/// put it in the middle of the right half so there's breathing room on
/// both sides.
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
    let monitor_h_logical = monitor.size().height as f64 / scale;
    let win_outer = win.outer_size().map_err(|e| e.to_string())?;
    let win_w_logical = win_outer.width as f64 / scale;
    let win_h_logical = win_outer.height as f64 / scale;
    let monitor_pos = monitor.position();
    let monitor_x_logical = monitor_pos.x as f64 / scale;
    let monitor_y_logical = monitor_pos.y as f64 / scale;
    // x: center of the right half of the screen = monitor_w * 0.75
    let x = monitor_x_logical + monitor_w_logical * 0.75 - win_w_logical / 2.0;
    // y: vertical center of the screen (input window will tuck below
    // this; the clamp inside position_input_under_main handles Dock)
    let y = monitor_y_logical + (monitor_h_logical - win_h_logical) / 2.0;
    let y = y.max(monitor_y_logical + 24.0); // never above the menu bar
    win.set_position(LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Close any persisted input-companion window. bao 2026-05-31 retired
/// the separate Tauri "input" window — composer now lives inside the
/// Irisy chat column (see IrisyChat.tsx). This command is called from
/// `useCompanionWindow` on app mount so an instance from a previous
/// launch is destroyed; new launches never spawn one. Safe to call
/// when no input window exists (returns Ok).
#[tauri::command]
pub fn destroy_input_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window("input") {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Workspace expansion (main window self-expand, bao 2026-05-30 final) ──
//
// bao 钦定 (clarification 5th round): "左侧打开的意思，不是浮窗".
// "独立窗口" = independent AREA (panel within main), NOT independent
// NSWindow / floating window. The main window itself slides its left
// edge outward — 430 → 1600 — to reveal the workspace area. No OS-level
// second window. CSS @media in app.module.css drives layout switch.

const WORKSPACE_COMPANION_WIDTH: f64 = 430.0;
const WORKSPACE_EXPANDED_WIDTH: f64 = 1600.0;
const WORKSPACE_EXPANSION_THRESHOLD: f64 = 960.0;

/// Toggle the main window between companion (430 px) and expanded
/// (1600 px). The window's RIGHT EDGE is locked to the monitor's right
/// edge (the right-edge anchor bao asked for, ADR-002 §7 "L1 和 Irisy
/// 位置不变"). When expanding, the LEFT edge slides leftward to make
/// room for the workspace; when collapsing, the left edge slides
/// rightward. L1 + Irisy columns stay at their fixed pixel positions
/// inside the shell relative to the right edge, so they never move
/// on-screen across the toggle.
///
/// bao 2026-05-31: previous version anchored `right_edge` to wherever
/// the window currently sat. If the user (or a startup race with
/// `position_window_top_right`) left the window pinned at x=0, the
/// `if target_x < monitor_x { target_x = monitor_x }` clamp caused
/// the expansion to grow RIGHTWARD instead — visible as "向右打开".
/// Fixed by always pinning the right edge to monitor right minus a
/// small inset, regardless of current position.
///
/// Returns the new visible expansion state (`true` = expanded).
#[tauri::command]
pub fn toggle_workspace_window(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::{LogicalPosition, LogicalSize, Manager};

    /// Right-edge inset from the monitor edge in logical pixels. Gives the
    /// window a small visual breathing margin from the screen edge.
    const RIGHT_EDGE_INSET: f64 = 0.0;

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
    let monitor_pos = monitor.position();
    let monitor_x = monitor_pos.x as f64 / scale;
    let monitor_w = monitor.size().width as f64 / scale;
    let monitor_right_edge = monitor_x + monitor_w;

    let current_w = main_size.width as f64 / scale;
    let current_h = main_size.height as f64 / scale;
    let is_expanded = current_w >= WORKSPACE_EXPANSION_THRESHOLD;

    let target_w = if is_expanded {
        WORKSPACE_COMPANION_WIDTH
    } else {
        WORKSPACE_EXPANDED_WIDTH.min(monitor_w - 40.0)
    };

    // Always anchor the right edge to the monitor's right edge. This
    // guarantees expansion grows LEFTWARD (workspace appears to the
    // left of the Irisy column) and that L1 + Irisy stay at fixed
    // on-screen positions across the toggle.
    let target_x = monitor_right_edge - target_w - RIGHT_EDGE_INSET;

    main.set_size(LogicalSize::new(target_w, current_h))
        .map_err(|e| e.to_string())?;
    main.set_position(LogicalPosition::new(target_x, main_pos.y as f64 / scale))
        .map_err(|e| e.to_string())?;

    Ok(!is_expanded)
}

// ── Pi (sole brain) status + upgrade — ADR-003 §4 ───────────────────────
//
// Replaces the retired `brain_list / brain_detect / brain_set_active`
// triple. There is one brain (Pi); the Settings → Brain pane reads
// `pi_status` for version + upgrade state, and binds the "Upgrade now"
// button to `pi_upgrade_now`.

#[derive(Debug, serde::Serialize)]
pub struct PiStatusView {
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub upgrade_available: bool,
    pub major_update_blocked: bool,
    pub last_upgrade_error: Option<String>,
    pub last_probe_ms: u64,
    pub pi_bin: Option<String>,
    pub install_root: Option<String>,
    /// True when the supervisor has a live Pi child (set by spawn_pi,
    /// cleared on exit). False = Pi crashed / not yet spawned / install
    /// failed.
    pub running: bool,
    /// Most recent supervisor error (install failure / spawn failure /
    /// exit status). None = healthy.
    pub last_error: Option<String>,
    /// Kernel provider port the bridge POSTs to. Surfaced so the
    /// Settings UI can show the wire endpoint when debugging.
    pub provider_port: u16,
}

#[tauri::command]
pub fn pi_status() -> Result<PiStatusView, String> {
    let install = crate::shell::pi_install::current_status();
    Ok(PiStatusView {
        installed_version: install.installed_version,
        latest_version: install.latest_version,
        upgrade_available: install.upgrade_available,
        major_update_blocked: install.major_update_blocked,
        last_upgrade_error: install.last_upgrade_error,
        last_probe_ms: install.last_probe_ms,
        pi_bin: install.pi_bin,
        install_root: install.install_root,
        running: crate::shell::brain_supervisor::is_running(),
        last_error: crate::shell::brain_supervisor::last_error(),
        provider_port: crate::shell::brain_supervisor::provider_port(),
    })
}

#[tauri::command]
pub fn pi_upgrade_now() -> Result<PiStatusView, String> {
    crate::shell::BrainSupervisor::force_upgrade_and_restart()?;
    pi_status()
}
