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

    // Match main's current visibility. PWA mounts during the main
    // window's prewarm (when main is hidden); we don't want the input
    // window to pop up alone with no chat above it. bao 2026-05-30:
    // '为什么安装后有一个输入框在页面,对话框不在'.
    let main_visible = app
        .get_webview_window("main")
        .map(|m| m.is_visible().unwrap_or(false))
        .unwrap_or(false);

    // Default = 2 rows of textarea + padding visible (bao 2026-05-30:
    // "对话框默认可以看见两行"). textarea is 14 px line-height ~21 px,
    // 2 rows = 42 px + 12 px top/bot padding + 4 px chrome = ~70 px.
    let win = WebviewWindowBuilder::new(
        &app,
        "input",
        WebviewUrl::App("/?surface=input".into()),
    )
    .title("CTRL · Input")
    .inner_size(430.0, 70.0)
    .min_inner_size(430.0, 70.0)
    .decorations(false)
    .transparent(false)
    .shadow(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(main_visible)
    .visible(main_visible)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.set_size(LogicalSize::new(430.0, 70.0));
    position_input_under_main(&app, &win)?;

    // Keep input glued to main as the user drags / resizes the main
    // window (bao 2026-05-30: "为什么移动不能一起移动输入框?").
    if let Some(main) = app.get_webview_window("main") {
        let app_handle = app.clone();
        main.on_window_event(move |event| match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                if let Some(input) = app_handle.get_webview_window("input") {
                    let _ = position_input_under_main(&app_handle, &input);
                }
            }
            _ => {}
        });
    }

    Ok(())
}

/// Activate the input window and pull keyboard focus to it. macOS
/// alwaysOnTop / .floating-level NSWindows don't always grab keyboard
/// focus from the foreground app on show — we explicitly activate the
/// NSApplication, make the window key, and let the WKWebView receive
/// the next keystrokes. bao 2026-05-30: '对话框无法输入'.
#[tauri::command]
pub fn activate_input_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let win = app
        .get_webview_window("input")
        .ok_or_else(|| "input window not found".to_string())?;
    let _ = win.show();
    let _ = win.set_focus();
    #[cfg(target_os = "macos")]
    unsafe {
        use objc2_app_kit::NSApp;
        use objc2_foundation::MainThreadMarker;
        if let Some(mtm) = MainThreadMarker::new() {
            NSApp(mtm).activate();
        }
    }
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

/// Position the input window directly under the main window, clamped so
/// the input never falls below the screen bottom (or behind the macOS
/// Dock). bao 2026-05-30: 'Dock 盖住了输入框'.
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
    let input_size = input.outer_size().map_err(|e| e.to_string())?;
    let monitor_pos = monitor.position();
    let monitor_h = monitor.size().height as f64 / scale;
    let monitor_top = monitor_pos.y as f64 / scale;
    let monitor_bottom = monitor_top + monitor_h - 80.0; // reserve Dock height

    // Right-align input under main's right edge so it sits below the
    // Irisy chat column even after the workspace expansion grows main
    // to 1600 px. In companion mode (main width = 430 ≈ input width =
    // 430) this collapses back to "full width below main"; in expanded
    // mode (main width = 1600, input width = 430) input sits in the
    // bottom-right under the Irisy chat 430-px column. bao 2026-05-30:
    // "输入框应该保持在 Irisy 对话框下方".
    let main_x = main_pos.x as f64 / scale;
    let main_w = main_size.width as f64 / scale;
    let input_w = input_size.width as f64 / scale;
    let desired_x = main_x + main_w - input_w;
    // Place input top flush against main's NSWindow frame bottom (no
    // overlap, no gap). NSWindow shadows on both windows blend at the
    // seam without hard overlap.
    let desired_y = (main_pos.y as f64 + main_size.height as f64) / scale;
    let input_h = input_size.height as f64 / scale;
    let max_y = monitor_bottom - input_h;
    let y = desired_y.min(max_y).max(monitor_top);
    input
        .set_position(LogicalPosition::new(desired_x, y))
        .map_err(|e| e.to_string())
}

// ── Workspace independent window (v2 revival, bao 2026-05-30) ──────────
//
// bao 钦定: "L1原来在哪，还在哪" + "工作区是独立窗口".
// Main keeps its 430-px companion shape (L1 + Irisy + InfraBar +
// input window below). Workspace is a SEPARATE Tauri window glued
// left of main via NSWindow.addChildWindow on macOS so AppKit cascades
// position + hide-show.
//
// 3 close paths (avoiding v0.1.95 ghost-window failure):
//   1. ▾ on main L1 (primary, always visible)
//   2. → button in WorkspaceSurface header (secondary, in-window)
//   3. Ctrl hotkey hides main → cascade hides workspace + input
//
// Visual unification (avoiding v0.1.98 "弹窗" complaint):
//   - Same chrome (decorations:false, shadow:true) as main + input
//   - Right edge of workspace flush against left edge of main (no gap)
//   - addChildWindow ordered: NSWindowAbove keeps z-order so neither
//     window clips the other

const WORKSPACE_DEFAULT_WIDTH: f64 = 1370.0;
const WORKSPACE_DEFAULT_HEIGHT: f64 = 720.0;
const WORKSPACE_MIN_WIDTH: f64 = 800.0;
const WORKSPACE_MIN_HEIGHT: f64 = 480.0;

#[tauri::command]
pub fn spawn_workspace_window(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(existing) = app.get_webview_window("workspace") {
        position_workspace_left_of_main(&app, &existing)?;
        existing.show().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let main_visible = app
        .get_webview_window("main")
        .map(|m| m.is_visible().unwrap_or(false))
        .unwrap_or(false);

    let win = WebviewWindowBuilder::new(
        &app,
        "workspace",
        WebviewUrl::App("/?surface=workspace".into()),
    )
    .title("CTRL · Workspace")
    .inner_size(WORKSPACE_DEFAULT_WIDTH, WORKSPACE_DEFAULT_HEIGHT)
    .min_inner_size(WORKSPACE_MIN_WIDTH, WORKSPACE_MIN_HEIGHT)
    .decorations(false)
    .transparent(false)
    .shadow(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .focused(false)
    .visible(main_visible)
    .resizable(true)
    .build()
    .map_err(|e| e.to_string())?;

    let _ = win.set_size(LogicalSize::new(
        WORKSPACE_DEFAULT_WIDTH,
        WORKSPACE_DEFAULT_HEIGHT,
    ));
    position_workspace_left_of_main(&app, &win)?;

    #[cfg(target_os = "macos")]
    {
        if let Err(e) = attach_as_child_of_main(&app, "workspace") {
            tracing::warn!(error = %e, "workspace addChildWindow failed — falling back to JS sync");
        }
    }

    if let Some(main) = app.get_webview_window("main") {
        let app_handle = app.clone();
        main.on_window_event(move |event| match event {
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                if let Some(workspace) = app_handle.get_webview_window("workspace") {
                    let _ = position_workspace_left_of_main(&app_handle, &workspace);
                }
            }
            _ => {}
        });
    }

    Ok(())
}

/// Toggle workspace independent window visibility. Returns the new
/// visible state. Lazy-spawns on first call. Backs the L1 ▾ button.
#[tauri::command]
pub fn toggle_workspace_window(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri::Manager;

    if let Some(win) = app.get_webview_window("workspace") {
        let visible = win.is_visible().unwrap_or(false);
        if visible {
            win.hide().map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            position_workspace_left_of_main(&app, &win)?;
            win.show().map_err(|e| e.to_string())?;
            Ok(true)
        }
    } else {
        spawn_workspace_window(app.clone())?;
        if let Some(win) = app.get_webview_window("workspace") {
            win.show().map_err(|e| e.to_string())?;
        }
        Ok(true)
    }
}

fn position_workspace_left_of_main(
    app: &tauri::AppHandle,
    workspace: &tauri::WebviewWindow,
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
    let workspace_size = workspace.outer_size().map_err(|e| e.to_string())?;
    let monitor_pos = monitor.position();

    let main_x = main_pos.x as f64 / scale;
    let workspace_w = workspace_size.width as f64 / scale;
    let monitor_x = monitor_pos.x as f64 / scale;

    let desired_x = (main_x - workspace_w).max(monitor_x);
    let desired_y = main_pos.y as f64 / scale;

    workspace
        .set_position(LogicalPosition::new(desired_x, desired_y))
        .map_err(|e| e.to_string())
}

#[cfg(target_os = "macos")]
fn attach_as_child_of_main(
    app: &tauri::AppHandle,
    child_label: &str,
) -> Result<(), String> {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;
    use tauri::Manager;

    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let child = app
        .get_webview_window(child_label)
        .ok_or_else(|| format!("{child_label} window not found"))?;

    let main_handle: *mut std::ffi::c_void = main
        .ns_window()
        .map_err(|e| format!("main ns_window: {e}"))? as _;
    let child_handle: *mut std::ffi::c_void = child
        .ns_window()
        .map_err(|e| format!("{child_label} ns_window: {e}"))? as _;

    let main_obj = main_handle as *mut AnyObject;
    let child_obj = child_handle as *mut AnyObject;

    // NSWindowOrderingMode::NSWindowAbove == 1.
    unsafe {
        let _: () = msg_send![&*main_obj, addChildWindow: &*child_obj, ordered: 1i64];
    }
    Ok(())
}
