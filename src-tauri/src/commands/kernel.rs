// Kernel commands — keycap CRUD + MCP introspection/invocation.
//
// Sub-PR d: real wire via `tauri::State<KernelHandle>`. Stub data lives in
// a fallback path while the manifest registry + persistence schema lands
// in sub-PR e (which also removes win/ and consolidates the tool registry).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::shell::KernelHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeycapSummary {
    pub id: String,
    pub name: String,
    pub keycap_color: String,
    pub icon: String,
}

/// Built-in seed keycaps so a fresh install isn't empty. The real manifest
/// registry replaces this in sub-PR e once `win/` is removed and the manifest
/// loader becomes the single source of truth.
fn seed_keycaps() -> Vec<KeycapSummary> {
    vec![
        KeycapSummary {
            id: "ctrl-chat".into(),
            name: "CTRL Chat".into(),
            keycap_color: "cobalt".into(),
            icon: "💬".into(),
        },
        KeycapSummary {
            id: "clipboard-ai".into(),
            name: "改写粘贴".into(),
            keycap_color: "amber".into(),
            icon: "✦".into(),
        },
        KeycapSummary {
            id: "ai-translate".into(),
            name: "AI 翻译".into(),
            keycap_color: "jade".into(),
            icon: "译".into(),
        },
        KeycapSummary {
            id: "ai-ocr".into(),
            name: "AI OCR".into(),
            keycap_color: "platinum".into(),
            icon: "◫".into(),
        },
        KeycapSummary {
            id: "ai-text".into(),
            name: "文本处理".into(),
            keycap_color: "graphite".into(),
            icon: "Aa".into(),
        },
    ]
}

#[tauri::command]
pub async fn list_keycaps(_kernel: State<'_, KernelHandle>) -> Result<Vec<KeycapSummary>, String> {
    // sub-PR e: read from kernel::persistence + manifest registry.
    Ok(seed_keycaps())
}

#[derive(Debug, Deserialize)]
pub struct McpInstallArgs {
    pub server_url: String,
    pub tool_name: String,
    pub display_name: String,
    pub keycap_color: Option<String>,
    pub icon: Option<String>,
}

#[tauri::command]
pub async fn install_keycap_from_mcp(
    args: McpInstallArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<KeycapSummary, String> {
    // sub-PR e: kernel.mcp_host.list_tools(server_url) -> derive manifest ->
    // persist in event store. For now, fabricate a summary so the wizard UI
    // flow at least has a confirmation shape to render.
    Ok(KeycapSummary {
        id: format!("mcp-{}-{}", slugify(&args.server_url), slugify(&args.tool_name)),
        name: args.display_name,
        keycap_color: args.keycap_color.unwrap_or_else(|| "cobalt".into()),
        icon: args.icon.unwrap_or_else(|| "◆".into()),
    })
}

#[derive(Debug, Deserialize)]
pub struct RunKeycapArgs {
    pub keycap_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RunKeycapResult {
    pub output: serde_json::Value,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn run_keycap(
    args: RunKeycapArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<RunKeycapResult, String> {
    let started = std::time::Instant::now();
    // sub-PR e: route to scheduler::run_actor + Effect dispatch + ST-SS stream.
    let output = serde_json::json!({
        "stub": true,
        "keycap_id": args.keycap_id,
        "echo_input": args.input,
        "note": "wired to scheduler in sub-PR e",
    });
    Ok(RunKeycapResult {
        output,
        duration_ms: started.elapsed().as_millis() as u64,
    })
}

#[derive(Debug, Deserialize)]
pub struct McpCallArgs {
    pub server_url: String,
    pub tool_name: String,
    pub args: serde_json::Value,
}

#[tauri::command]
pub async fn mcp_call(
    _args: McpCallArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<serde_json::Value, String> {
    // sub-PR e: kernel.mcp_host.call_tool(server_url, tool_name, args).
    Err("mcp_call wired in sub-PR e".into())
}

#[tauri::command]
pub async fn list_mcp_servers(_kernel: State<'_, KernelHandle>) -> Result<Vec<String>, String> {
    // sub-PR e: kernel.mcp_host.list_servers().
    Ok(Vec::new())
}

/// Open the dedicated workspace window for a keycap activation.
///
/// Per bao 2026-05-14 directive: the workspace is a SECOND window separate
/// from the launcher pool. PWA pool.tsx handleActivate calls this on every
/// keycap click; the workspace window navigates to /workspace?keycap_id=...
/// and is shown / focused. Closing the workspace doesn't quit the app.
#[tauri::command]
pub async fn open_workspace(keycap_id: String, app: tauri::AppHandle) -> Result<(), String> {
    crate::shell::WindowController::open_workspace(&app, &keycap_id).map_err(|e| e.to_string())
}

fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}
