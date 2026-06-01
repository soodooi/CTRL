// ADR-002 substrate § provider v2 §3.2 — verbatim VMark port (ISC).
// Source: github.com/xiaolai/vmark, src-tauri/src/ai_provider/rest_providers.rs
// (top-of-file constants + read_body_capped helper). Lifted into this
// shared module so the 4 per-provider files (anthropic.rs / openai.rs /
// google.rs / ollama.rs) can be byte-identical with their VMark source
// function bodies. License: THIRD_PARTY_LICENSES/vmark-ISC.txt

use std::time::Duration;

/// Per-request timeout (entire request, including body read) for prompt calls.
pub(super) const PROMPT_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Cap on REST response body size before JSON parse. Mirrors the runner-side
/// 5 MB output cap so a runaway provider can't OOM the process by returning
/// a multi-GB body that gets fully buffered + parsed before the post-parse
/// limit is checked. Aligns with `MAX_COLLECT_BYTES` in VMark
/// `ai_provider/mod.rs`.
pub(super) const MAX_REST_BODY_BYTES: usize = 5 * 1024 * 1024;

/// Read a response body with a hard byte cap. Returns Err if the body
/// exceeds the cap before fully reading. Uses byte-level reading rather than
/// `resp.json()` so we can short-circuit on size.
pub(super) async fn read_body_capped(
    mut resp: reqwest::Response,
) -> Result<Vec<u8>, String> {
    let mut buf: Vec<u8> = Vec::new();
    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                if buf.len().saturating_add(chunk.len()) > MAX_REST_BODY_BYTES {
                    return Err(format!(
                        "Response body exceeded {} MB cap",
                        MAX_REST_BODY_BYTES / (1024 * 1024)
                    ));
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(None) => return Ok(buf),
            Err(e) => return Err(format!("Failed to read response body: {}", e)),
        }
    }
}

/// Flatten a `ChatPrompt` into a single prompt string for the verbatim
/// VMark functions (which take `&str prompt` and emit one chunk). CTRL
/// keeps multi-turn structure in the prompt; this helper concatenates
/// the last user message (or the whole conversation when the last role
/// isn't `user`) so the verbatim ports see the same shape VMark feeds.
pub(super) fn flatten_prompt(prompt: &crate::kernel::provider::types::ChatPrompt) -> String {
    let mut buf = String::new();
    if let Some(system) = prompt.system.as_deref() {
        if !system.trim().is_empty() {
            buf.push_str(system.trim());
            buf.push_str("\n\n");
        }
    }
    for msg in &prompt.messages {
        if !buf.is_empty() {
            buf.push_str("\n\n");
        }
        buf.push_str(&msg.role);
        buf.push_str(": ");
        buf.push_str(&msg.content);
    }
    buf
}
