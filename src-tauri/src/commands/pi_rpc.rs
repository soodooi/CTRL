// pi_rpc — Tauri command surface for the full Pi RpcClient API.
//
// bao 2026-06-05 "open all Pi capability": exposes every Pi RPC method
// through a single generic `pi_rpc(method, args)` Tauri command. PWA
// calls e.g. `invoke('pi_rpc', { method: 'abort', args: [] })` and we
// forward over HTTP to ctrl-pi-mcp's `/api/pi-rpc` endpoint which calls
// PiBridge.callRpc which delegates to the warm RpcClient.
//
// Why one generic command vs 25 per-method:
//   - No Rust boilerplate per method; adding a Pi method = 0 backend changes
//   - PWA gets compile-time typing via packages/ctrl-web/src/lib/usePiRpc.ts
//     wrappers; Rust stays a dumb pipe
//
// Also exposes:
//   - pi_sessions(op, path?) - fs-level list/delete (separate endpoint
//     because they do not require a warm RPC client)
//   - restart_brain() - kills the current ctrl-pi-mcp daemon; the
//     BrainSupervisor respawn loop picks up the next spawn (= picks up
//     any wrapper-file or extension changes since last spawn)

use serde::{Deserialize, Serialize};
use serde_json::Value;

const PI_RPC_URL: &str = "http://127.0.0.1:17874/api/pi-rpc";
const PI_SESSIONS_URL: &str = "http://127.0.0.1:17874/api/sessions";

/// Allowlist of Pi RpcClient methods reachable through this pass-through.
///
/// The command previously forwarded ANY `method` string straight to Pi,
/// so a compromised/abusive PWA context could invoke unintended internal
/// RPC surface. We gate on the exact set the PWA's typed wrappers expose
/// (`packages/ctrl-web/src/lib/usePiRpc.ts`); adding a Pi method is a
/// one-line edit here. Keep this in sync with the TS wrappers.
const ALLOWED_PI_RPC_METHODS: &[&str] = &[
    "newSession",
    "switchSession",
    "fork",
    "clone",
    "getForkMessages",
    "setSessionName",
    "getState",
    "getSessionStats",
    "getMessages",
    "getLastAssistantText",
    "steer",
    "followUp",
    "abort",
    "setSteeringMode",
    "setFollowUpMode",
    "getAvailableModels",
    "setModel",
    "cycleModel",
    "setThinkingLevel",
    "cycleThinkingLevel",
    "compact",
    "setAutoCompaction",
    "setAutoRetry",
    "abortRetry",
    "bash",
    "abortBash",
    "exportHtml",
    "getCommands",
];

#[derive(Debug, Serialize, Deserialize)]
struct RpcReq {
    method: String,
    args: Vec<Value>,
}

#[derive(Debug, Deserialize)]
struct RpcResp {
    result: Option<Value>,
    error: Option<String>,
}

/// Generic Pi RPC pass-through. method = any RpcClient method name; args
/// = positional argument array. Returns the JSON-decoded result or an
/// error string from Pi.
#[tauri::command]
pub async fn pi_rpc(method: String, args: Option<Vec<Value>>) -> Result<Value, String> {
    if !ALLOWED_PI_RPC_METHODS.contains(&method.as_str()) {
        tracing::warn!(method = %method, "pi_rpc: rejected non-allowlisted method");
        return Err(format!("pi_rpc: method {method:?} is not permitted"));
    }
    let req = RpcReq {
        method,
        args: args.unwrap_or_default(),
    };
    let client = reqwest::Client::new();
    let response = client
        .post(PI_RPC_URL)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("pi_rpc HTTP send failed: {e}"))?;
    let body: RpcResp = response
        .json()
        .await
        .map_err(|e| format!("pi_rpc response parse failed: {e}"))?;
    if let Some(err) = body.error {
        return Err(err);
    }
    Ok(body.result.unwrap_or(Value::Null))
}

#[derive(Debug, Serialize)]
struct SessionsReq<'a> {
    op: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

/// fs-level session operations. op = "list" returns Vec<SessionMeta>;
/// op = "delete" with `path` removes one jsonl. Neither requires a warm
/// RPC client (they read/write Pi's sessions dir directly).
#[tauri::command]
pub async fn pi_sessions(op: String, path: Option<String>) -> Result<Value, String> {
    let req = SessionsReq {
        op: op.as_str(),
        path,
    };
    let client = reqwest::Client::new();
    let response = client
        .post(PI_SESSIONS_URL)
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("pi_sessions HTTP send failed: {e}"))?;
    let body: RpcResp = response
        .json()
        .await
        .map_err(|e| format!("pi_sessions response parse failed: {e}"))?;
    if let Some(err) = body.error {
        return Err(err);
    }
    Ok(body.result.unwrap_or(Value::Null))
}

/// Kill the ctrl-pi-mcp daemon child so BrainSupervisor's supervise loop
/// respawns it with a fresh PiBridge (= picks up any wrapper TS changes
/// or new `--extension` blocks since last spawn). Zero CTRL.app restart.
/// bao 2026-06-05 (feedback_always_use_upgrade_path): "new versions must
/// be auto-upgraded, not manual reinstall" - this is the in-process
/// equivalent.
#[tauri::command]
pub fn restart_brain() -> Result<String, String> {
    crate::shell::brain_supervisor::restart()
        .map(|()| "brain restart signalled - supervisor will respawn within ~500ms".to_string())
        .map_err(|e| format!("restart_brain: {e}"))
}
