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
    /// `~/.ctrl/mcps/` doesn't exist yet. Kernel hasn't seeded builtin
    /// mcps from the app bundle Resources/mcps/. PWA should render
    /// a "Setting up CTRL…" empty state and avoid showing the keyboard.
    Copying,
    /// `~/.ctrl/mcps/` exists. May be empty, may have mcps. PWA
    /// renders the normal keyboard + Pool empty-state hint when zero
    /// mcps installed.
    Ready,
}

#[derive(Debug, Serialize)]
pub struct KernelStatus {
    /// Kernel uptime in milliseconds (monotonic, captured at boot).
    pub uptime_ms: u64,
    /// First-run state — distinguishes "fresh install still seeding" from
    /// "set up, empty keyboard" so the PWA renders the right empty state.
    /// Per ADR-001 spine amendment 2026-05-25 (decision D6).
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
    /// Brain engine label. Surfaces the currently-active IrisyPrimary
    /// provider's display label (e.g. "Claude" when claude-oauth is
    /// active). Falls back to "pi" when no provider is configured —
    /// Pi is the agent runtime; the label here is the provider behind
    /// Pi's text-chat calls so the InfraBar ENGINE chip tells the user
    /// which LLM they're actually talking to.
    pub active_brain: String,
}

/// Compact form of a provider's display label for chips/status bars.
/// Strips a trailing parenthetical (` (...)`) — e.g.
/// `"Claude (OAuth subscription)"` → `"Claude"`. Leaves short labels
/// unchanged. Used by both `kernel_status` and `irisy_init` so the
/// InfraBar ENGINE chip and the irisy boot log surface the same brand.
pub fn short_label(label: &str) -> String {
    match label.find(" (") {
        Some(idx) => label[..idx].to_string(),
        None => label.to_string(),
    }
}

fn detect_first_run_state() -> FirstRunState {
    let home = match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => h,
        _ => return FirstRunState::Copying,
    };
    let mcps = PathBuf::from(home).join(".ctrl").join("mcps");
    if mcps.is_dir() {
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

    // Pi is the agent runtime; what the InfraBar ENGINE chip actually
    // wants to surface is the provider behind Pi's text-chat calls, so
    // the user can see "Claude" vs "Volc" vs whatever they've routed
    // IrisyPrimary to. ADR-002 substrate § provider v2 §3.6.
    let active_brain = runtime
        .provider_registry
        .route_chain(&crate::kernel::provider::Consumer::IrisyPrimary)
        .primary
        .as_ref()
        .and_then(|id| runtime.provider_registry.snapshot(id))
        .map(|snap| short_label(&snap.label))
        // "none" when no provider configured — Pi exited (ADR-002 § brain v19).
        .unwrap_or_else(|| "none".to_string());

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
/// arrives (bao 2026-05-30: "the whole window flows downward").
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

/// Position the main window anchored against the monitor's right edge.
/// bao 2026-05-31: must match the right-edge anchor toggle_workspace_window
/// uses (ADR-003 frontend §7 "L1 and Irisy positions are fixed"). Putting the boot position at
/// 75 % center created a visual jump when toggle later relocated to the
/// true right edge; aligning both paths to monitor_right means expansion
/// slides leftward smoothly without re-positioning.
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
    // x: anchor right edge to monitor right edge (no inset, matches
    // toggle_workspace_window's RIGHT_EDGE_INSET = 0.0).
    let x = monitor_x_logical + monitor_w_logical - win_w_logical;
    // y: vertical center of the screen
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

// ── Workspace toggle = main-window left-edge resize (ADR-003 §7.2 v3) ──
//
// ADR-003 frontend §7.2 v3 (2026-06-01): the workspace tab area lives
// inside the main window. Toggling slides the main window's LEFT edge
// 478 <-> 1600; the right edge stays anchored to the monitor's right
// edge so L1 + Irisy do not move on screen. Pre-v3 builds spawned a
// separate Tauri child window with URL `/?surface=workspace`; that
// path produced ADR-003 §7.7 known bug #1 (duplicate cockpit) and is
// retired here. Any stale child window from an older install is
// destroyed on the next toggle.

/// Compact main-window width: L1 (48) + Irisy (430).
const MAIN_COMPACT_WIDTH: f64 = 478.0;

/// Expanded main-window width: L1 (48) + L2 (200) + Tab (922) + Irisy (430).
/// Matches the original expanded-mode width referenced in ADR-003 §7.2.
const MAIN_EXPANDED_WIDTH: f64 = 1600.0;

/// Threshold separating compact from expanded for the toggle decision.
const EXPAND_THRESHOLD: f64 = 1000.0;

/// Toggle main-window between COMPACT (478) and EXPANDED (1600). Returns
/// `Ok(true)` when the window is now expanded (workspace tab area
/// visible), `Ok(false)` when collapsed back to companion size.
///
/// Preserves the window's CURRENT right edge — only the left edge moves.
/// L1 + Irisy stay glued to the right side of the window content; the
/// user can drag the window anywhere on screen and the toggle still
/// grows / shrinks leftward from wherever they parked it (bao
/// 2026-06-01: L1 and Irisy never change position relative to the
/// window; the window itself is movable).
///
/// Also destroys any pre-v3 leftover `workspace` child window.
#[tauri::command]
pub fn toggle_workspace_window(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::{LogicalPosition, LogicalSize, Manager};

    if let Some(stale) = app.get_webview_window("workspace") {
        // Pre-v3 builds spawned a "workspace" child window; v3 retired
        // the child-window path entirely. A close failure here only
        // matters if the user is mid-drag of that stale window — log
        // and continue so the toggle still resizes main.
        if let Err(e) = stale.close() {
            eprintln!("[toggle_workspace_window] stale child close failed: {e}");
        }
    }

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
    let main_x = main_pos.x as f64 / scale;
    let main_w = main_size.width as f64 / scale;
    let main_h = main_size.height as f64 / scale;
    let main_y = main_pos.y as f64 / scale;
    let right_edge = main_x + main_w;

    let (next_w, expanded) = if main_w >= EXPAND_THRESHOLD {
        (MAIN_COMPACT_WIDTH, false)
    } else {
        (MAIN_EXPANDED_WIDTH, true)
    };

    // Anchor the right edge to its current screen position; left edge moves.
    let next_x = right_edge - next_w;

    main.set_size(LogicalSize::new(next_w, main_h))
        .map_err(|e| e.to_string())?;
    main.set_position(LogicalPosition::new(next_x, main_y))
        .map_err(|e| e.to_string())?;

    Ok(expanded)
}

/// Ensure the main window is in EXPANDED mode (workspace tab area visible).
/// Idempotent — no-op when already expanded. Returns `Ok(true)` when this
/// call performed the expand, `Ok(false)` when the window was already
/// expanded. Used by L1 chip clicks (Pool / Notes / Coding / Settings) so
/// activating any of them surfaces the workspace without forcing the user
/// to first click the ▾ chevron.
///
/// bao 2026-06-03 — un-retires the v0.1.148 helper after observing that
/// `openSystemTab` alone leaves the window compact (the tab is registered
/// but invisible). Crucially this is **expand-only, not a toggle**, so
/// clicking the same L1 chip twice cannot collapse the workspace — the
/// ▾ chevron remains the single collapse path.
#[tauri::command]
pub fn ensure_workspace_window_expanded(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::{LogicalPosition, LogicalSize, Manager};

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
    let main_x = main_pos.x as f64 / scale;
    let main_w = main_size.width as f64 / scale;
    let main_h = main_size.height as f64 / scale;
    let main_y = main_pos.y as f64 / scale;
    let right_edge = main_x + main_w;

    if main_w >= EXPAND_THRESHOLD {
        return Ok(false);
    }

    let next_w = MAIN_EXPANDED_WIDTH;
    let next_x = right_edge - next_w;
    main.set_size(LogicalSize::new(next_w, main_h))
        .map_err(|e| e.to_string())?;
    main.set_position(LogicalPosition::new(next_x, main_y))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

/// Collapse the main window back to compact width when no L1 chip is
/// actively presenting a workspace. Counterpart of
/// `ensure_workspace_window_expanded`; idempotent when already compact.
/// ADR-002 substrate § provider v11 §3.11 (2026-06-07): added so the L1
/// chip click-toggle pattern (open → close → workspace collapses) has a
/// kernel-side primitive; PrimaryRail calls this when the user clicks
/// the active chip a second time. Returns `true` if it actually moved.
#[tauri::command]
pub fn collapse_workspace_window(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::{LogicalPosition, LogicalSize, Manager};

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
    let main_x = main_pos.x as f64 / scale;
    let main_w = main_size.width as f64 / scale;
    let main_h = main_size.height as f64 / scale;
    let main_y = main_pos.y as f64 / scale;
    let right_edge = main_x + main_w;

    if main_w < EXPAND_THRESHOLD {
        return Ok(false);
    }

    let next_w = MAIN_COMPACT_WIDTH;
    let next_x = right_edge - next_w;
    main.set_size(LogicalSize::new(next_w, main_h))
        .map_err(|e| e.to_string())?;
    main.set_position(LogicalPosition::new(next_x, main_y))
        .map_err(|e| e.to_string())?;
    Ok(true)
}

// ── Pi (sole brain) status + upgrade — ADR-002 substrate §4 ───────────────────────
//
// Replaces the retired `brain_list / brain_detect / brain_set_active`
// triple. There is one brain (Pi); the Settings → Brain pane reads
// `pi_status` for version + upgrade state, and binds the "Upgrade now"
// button to `pi_upgrade_now`.

#[derive(Debug, serde::Serialize)]
#[allow(dead_code)]
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

// ADR-002 substrate §1 v19 (2026-06-09, H-2026-06-09-002):
//   pi_status + pi_upgrade_now retired. Pi exited CTRL hot path. Per-agent
//   install/status now goes through `commands::agents::{install_agent,
//   launch_agent, agent_status, stop_agent, list_agents}`. The PiStatusView
//   struct above is kept declared so its Serialize derive doesn't fail when
//   downstream callers in `commands/mod.rs` invoke_handler! macro reference
//   absent symbols — those commands are already unregistered.

// ── Ollama install / model pull (Pi-first refactor, bao 2026-06-05) ────────

#[tauri::command]
pub fn ollama_status() -> Result<crate::shell::ollama_install::OllamaInstallStatus, String> {
    // Fresh probe each time the PWA asks — cheap enough (a single
    // `which` + a 5 s-timeout HTTP GET) and keeps the status accurate
    // immediately after Ollama install / model pull completes.
    Ok(crate::shell::ollama_install::probe_now())
}

#[tauri::command]
pub fn ollama_pull_default(
    app: tauri::AppHandle,
) -> Result<crate::shell::ollama_install::OllamaInstallStatus, String> {
    use tauri::Emitter;
    let app_for_cb = app.clone();
    crate::shell::ollama_install::spawn_pull_default(move |status| {
        // Emit on every progress line; PWA banner re-renders. The
        // event name matches the chat-stream-delta convention.
        let _ = app_for_cb.emit("ollama-pull-progress", status);
    })?;
    Ok(crate::shell::ollama_install::current_status())
}
