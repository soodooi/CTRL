// Inbound adapter — translates Tauri IPC into use-case calls.

use std::sync::Arc;

use tauri::{Manager, State};

use crate::application::ports::{
    AccessibilityPort, BrowserPort, ChatRequest, ClipboardPort, ConfigStorePort, LlmPort,
    LlmProfile, LlmSettings, NotifierPort, SecretStorePort, SelectionCapturePort, ToolRegistryPort,
};
use crate::application::step_runner::StepPorts;
use crate::application::use_cases;
use crate::domain::tool::Tool;

pub struct AppState {
    pub accessibility: Arc<dyn AccessibilityPort>,
    pub capture: Arc<dyn SelectionCapturePort>,
    pub tool_registry: Arc<dyn ToolRegistryPort>,
    pub clipboard: Arc<dyn ClipboardPort>,
    pub browser: Arc<dyn BrowserPort>,
    pub notifier: Arc<dyn NotifierPort>,
    pub llm: Option<Arc<dyn LlmPort>>,
    pub config_store: Arc<dyn ConfigStorePort>,
    pub secret_store: Arc<dyn SecretStorePort>,
}

#[tauri::command]
pub fn check_accessibility(state: State<'_, AppState>) -> bool {
    state.accessibility.is_trusted()
}

#[tauri::command]
pub fn open_accessibility_settings(state: State<'_, AppState>) {
    state.accessibility.open_settings();
}

#[tauri::command]
pub fn capture_selected_text(
    state: State<'_, AppState>,
) -> std::result::Result<String, String> {
    use_cases::capture_selection(&*state.capture).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_tools(state: State<'_, AppState>) -> std::result::Result<Vec<Tool>, String> {
    use_cases::list_tools(&*state.tool_registry).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_action(
    state: State<'_, AppState>,
    tool_id: String,
    action_id: String,
) -> std::result::Result<String, String> {
    let llm_ref: Option<&dyn LlmPort> = state.llm.as_deref();
    let ports = StepPorts {
        clipboard: &*state.clipboard,
        browser: &*state.browser,
        notifier: &*state.notifier,
        selection: &*state.capture,
        llm: llm_ref,
    };
    use_cases::run_action(&*state.tool_registry, &ports, &tool_id, &action_id)
        .map_err(|e| e.to_string())
}

// -------- Settings / LLM provider configuration commands --------

#[tauri::command]
pub fn get_llm_settings(state: State<'_, AppState>) -> std::result::Result<LlmSettings, String> {
    state
        .config_store
        .load_llm_settings()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_llm_key(
    state: State<'_, AppState>,
    profile: String,
    key: String,
) -> std::result::Result<(), String> {
    state
        .secret_store
        .write(&profile, &key)
        .map_err(|e| e.to_string())
}

/// Show or hide one of the three independent panel windows by label.
/// Each panel is its own NSWindow + webview, so toggling never resizes
/// anything — pool/workspace appear and disappear cleanly without
/// affecting the keyboard window's position. Labels: "pool", "workspace",
/// "main" (keyboard, though hiding it directly is unusual).
#[tauri::command]
pub fn set_panel_visible(
    app: tauri::AppHandle,
    label: String,
    visible: bool,
) -> std::result::Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("no window with label '{label}'"))?;
    if visible {
        window.show().map_err(|e| e.to_string())?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide all three panel windows (launcher full dismiss). Called on
/// Esc-Esc or when the app loses focus entirely.
#[tauri::command]
pub fn hide_all_panels(app: tauri::AppHandle) -> std::result::Result<(), String> {
    for label in ["main", "pool", "workspace"] {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.hide();
        }
    }
    Ok(())
}

/// Hide all panels iff no panel currently holds focus. Each window calls
/// this after its own blur (with a small delay) — if focus moved to
/// another of our panels, this is a no-op; if the user clicked into
/// another app entirely, all three panels disappear.
#[tauri::command]
pub fn hide_if_unfocused(app: tauri::AppHandle) -> std::result::Result<(), String> {
    let any_focused = ["main", "pool", "workspace"].iter().any(|label| {
        app.get_webview_window(label)
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
    });
    if !any_focused {
        return hide_all_panels(app);
    }
    Ok(())
}

/// Hide the main window (launcher dismiss). Kept for compatibility with
/// existing call sites; new code should prefer `hide_all_panels`.
#[tauri::command]
pub fn hide_window(app: tauri::AppHandle) -> std::result::Result<(), String> {
    hide_all_panels(app)
}

/// Non-destructively read the system clipboard for contextual suggestions.
/// Read-only — does not mutate clipboard contents. Returns empty string if
/// clipboard has no text (rather than erroring) so the UI can degrade gracefully.
#[tauri::command]
pub fn peek_clipboard(state: State<'_, AppState>) -> std::result::Result<String, String> {
    match state.clipboard.read() {
        Ok(text) => Ok(text),
        // Treat read failures as empty — suggestions are best-effort, not a hard requirement.
        Err(_) => Ok(String::new()),
    }
}

/// Generic chat completion — used by ChatWorkspace mini-chat continuation
/// (multi-turn follow-up after an initial AI tool result).
/// Routes through the gateway's default LLM profile; empty `model` falls back
/// to the profile's configured default model.
#[tauri::command]
pub fn run_chat(
    state: State<'_, AppState>,
    system: Option<String>,
    prompt: String,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
) -> std::result::Result<String, String> {
    let llm = state
        .llm
        .as_deref()
        .ok_or_else(|| "no LLM configured — open Settings to add a profile".to_string())?;
    let req = ChatRequest {
        model: String::new(),
        system,
        user: prompt,
        max_tokens,
        temperature,
    };
    llm.chat(&req).map(|r| r.text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn bootstrap_minimax(state: State<'_, AppState>) -> std::result::Result<LlmSettings, String> {
    let mut settings = state
        .config_store
        .load_llm_settings()
        .map_err(|e| e.to_string())?;
    if !settings.profiles.iter().any(|p| p.name == "minimax") {
        settings.profiles.push(LlmProfile {
            name: "minimax".into(),
            kind: "openai-compatible".into(),
            base_url: "https://api.minimax.chat/v1".into(),
            default_model: "abab6.5-chat".into(),
            api_key: None, // key goes to Keychain via set_llm_key, not here
        });
    }
    if settings.default_profile.is_none() {
        settings.default_profile = Some("minimax".into());
    }
    state
        .config_store
        .save_llm_settings(&settings)
        .map_err(|e| e.to_string())?;
    Ok(settings)
}
