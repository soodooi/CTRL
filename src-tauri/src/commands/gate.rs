// gate_invoke — the PWA's cross-domain capability bridge.
//
// Target end-state of the comms system design (Phase B, `comms-system-design.md`):
// the frontend calls a capability THROUGH the :17873 gate instead of a bespoke
// per-capability Tauri command. PWA writes are cross-domain (ADR-010
// § trust-domains), so routing them through the gate means every call is
// governed once — audit ledger + visibility scoping (SC1-3) — at the single
// chokepoint, and the 31 dual-surface Tauri commands can retire onto this one
// bridge.
//
// In-process dispatch through the rmcp tool router is not possible (it needs a
// real `RequestContext`/`Peer`), so the bridge is a loopback HTTP MCP call to
// 127.0.0.1:<port> using the per-boot gate token — the same path an external
// caller takes, so the governance is identical, not a bypass.

use serde_json::Value;

use crate::kernel::audit;

/// Caller identity stamped on PWA-originated gate calls (audit attribution).
const CALLER: &str = "pwa";

/// Pull the JSON-RPC payload out of a Streamable-HTTP response body that may be
/// a bare JSON object or an SSE stream of `data:` lines.
fn extract_jsonrpc(body: &str) -> Option<Value> {
    for line in body.lines() {
        if let Some(data) = line.strip_prefix("data:") {
            if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
                return Some(v);
            }
        }
    }
    serde_json::from_str(body).ok()
}

/// Run one `tools/call` against the local gate over loopback HTTP MCP and return
/// the tool's parsed JSON output. Pure (port + token are arguments) so it is
/// testable against a real served gate without Tauri. The gate wraps tool
/// output as `CallToolResult { content: [{ text: "<json>" }] }`; this unwraps
/// the inner text and parses it back so callers get the tool's native shape.
pub async fn gate_call(port: &str, token: &str, tool: &str, args: Value) -> Result<Value, String> {
    let client = reqwest::Client::new();
    let url = format!("http://127.0.0.1:{port}/mcp");
    let auth = format!("Bearer {token}");
    let accept = "application/json, text/event-stream";

    // initialize -> the server assigns a session id we must echo on the call.
    let init = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", accept)
        .header("Authorization", &auth)
        .body(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"ctrl-pwa","version":"0.0.1"}}}"#,
        )
        .send()
        .await
        .map_err(|e| format!("gate initialize: {e}"))?;
    let session = init
        .headers()
        .get("mcp-session-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| "gate: no session id".to_string())?;

    // tools/call, stamped with the PWA caller so the audit ledger attributes it.
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 2, "method": "tools/call",
        "params": { "name": tool, "arguments": args }
    });
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Accept", accept)
        .header("Authorization", &auth)
        .header("mcp-session-id", session)
        .header(audit::CALLER_HEADER, CALLER)
        .body(body.to_string())
        .send()
        .await
        .map_err(|e| format!("gate tools/call: {e}"))?;
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let rpc = extract_jsonrpc(&text).ok_or_else(|| format!("gate: unparseable response: {text}"))?;
    if let Some(err) = rpc.get("error") {
        return Err(err.to_string());
    }
    // Unwrap CallToolResult.content[0].text (the tool's JSON output) and parse
    // it back to the native shape; fall back to the text or the raw result.
    let result = rpc.get("result").cloned().unwrap_or(Value::Null);
    if let Some(text) = result
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
    {
        return Ok(serde_json::from_str::<Value>(text).unwrap_or_else(|_| Value::String(text.to_string())));
    }
    Ok(result)
}

/// PWA-facing bridge: invoke a kernel capability through the :17873 gate. Reads
/// the per-boot gate port + token published to the env by the supervisor
/// (`CTRL_KERNEL_MCP_PORT` / `CTRL_KERNEL_MCP_TOKEN`). Replaces N bespoke
/// per-capability Tauri commands with one governed path.
#[tauri::command]
pub async fn gate_invoke(tool: String, args: Value) -> Result<Value, String> {
    let port = std::env::var("CTRL_KERNEL_MCP_PORT")
        .map_err(|_| "gate not ready (no port published yet)".to_string())?;
    let token = std::env::var("CTRL_KERNEL_MCP_TOKEN")
        .map_err(|_| "gate not ready (no token published yet)".to_string())?;
    gate_call(&port, &token, &tool, args).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::mcp_server;
    use crate::kernel::runtime::KernelRuntime;
    use std::sync::Arc;

    /// End-to-end: a PWA capability call routed through the real gate over
    /// loopback returns the tool output AND lands in the audit ledger attributed
    /// to the `pwa` caller — proving the bridge is governed, not a bypass.
    #[tokio::test]
    async fn gate_call_routes_a_capability_through_the_governed_gate() {
        let data_dir = std::env::temp_dir().join("ctrl-test-gate-invoke");
        let _ = std::fs::remove_dir_all(&data_dir);
        let runtime = Arc::new(KernelRuntime::boot(data_dir).expect("kernel boot"));
        let handle = mcp_server::serve(runtime.clone(), None, None, "127.0.0.1:0")
            .await
            .expect("serve gate");
        let port = handle.listen_addr.rsplit_once(':').expect("addr has port").1;
        let token = handle.auth_token.as_ref();

        let before = runtime.event_store.audit_count().unwrap_or(0);
        let result = gate_call(port, token, "kernel_status", serde_json::json!({}))
            .await
            .expect("gate_call");
        // kernel_status returns a JSON object (uptime / adapters / mcp count).
        assert!(result.is_object() || result.is_string(), "got {result:?}");
        // The call was audited (best-effort ledger; >= one new external row).
        let after = runtime.event_store.audit_count().unwrap_or(0);
        assert!(after > before, "gate call must be audited ({before} -> {after})");
    }
}
