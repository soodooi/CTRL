// kernel::composition — Linear flow executor for composite keycaps.
//
// Per bao 2026-05-23 framing: "做小 + 拿来即用 + 简单创建". A composite
// keycap chains base keycap MCP tools (vault.read → llm.chat → vault.write)
// declaratively. Users / Irisy author manifest.flow as a linear `steps[]`
// list — NOT a state machine, NOT a visual graph (ADR-001 anti-list rejects
// the n8n/Coze drag-graph paradigm).
//
// State machine `ActorFlow` from tool-manifest spec §6 is a separate
// advanced shape (rare; deferred). This module supports the simple linear
// form bao actually wants users to write:
//
//   flow:
//     - call: base.vault.read
//       args: { path: "daily.md" }
//       save_as: today
//     - call: base.llm.chat
//       args: { messages: [{role: user, content: "Summarize: ${today.body}"}] }
//       save_as: summary
//     - call: base.vault.write
//       args: { path: "summary.md", body: "${summary}" }
//
// Each step calls one base MCP tool (handled in-process via shared kernel
// modules — same backend as mcp_server.rs tool handlers — so composition
// has zero HTTP overhead). Variable interpolation `${name}` and dotted-path
// `${name.field}` substitution lets later steps consume earlier outputs.

use crate::kernel::local_storage::LocalStorage;
use crate::kernel::llm_port::{LlmMessage, LlmPrompt};
use crate::kernel::runtime::KernelRuntime;
use crate::kernel::vault;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

/// Linear flow as authored by composite keycap manifests. Top-level
/// shape:
///
/// ```yaml
/// flow:
///   steps:
///     - call: base.<tool>
///       args: { ... }
///       save_as: <var>            # optional
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Flow {
    pub steps: Vec<FlowStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FlowStep {
    /// Tool name. Currently the 11 `base.*` tool ids ship in-tree.
    /// External MCP tools route through `base.mcp.call` with a server +
    /// tool argument pair.
    pub call: String,
    /// Tool arguments. Strings (and string fields nested inside objects /
    /// arrays) are interpolated with `${var}` substitution before dispatch.
    #[serde(default)]
    pub args: serde_json::Value,
    /// Name to bind this step's return value to. Omitting it discards
    /// the result (e.g. a side-effect-only step).
    #[serde(default)]
    pub save_as: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum FlowError {
    #[error("unknown base tool: {0}")]
    UnknownTool(String),
    #[error("step `{0}` failed: {1}")]
    StepFailed(String, String),
    #[error("missing required arg `{0}` for tool `{1}`")]
    MissingArg(String, String),
    #[error("invalid arg `{0}` for tool `{1}`: {2}")]
    InvalidArg(String, String, String),
    #[error("vault root unresolved (HOME unset)")]
    VaultRootUnresolved,
    #[error("local storage unavailable")]
    LocalStorageUnavailable,
}

/// Executes a `Flow`. Owns nothing it can mutate; pulls `Arc<KernelRuntime>`
/// to reach LLM / MCP host / vault / storage. Stateless across invocations.
pub struct FlowExecutor {
    runtime: Arc<KernelRuntime>,
}

impl FlowExecutor {
    pub fn new(runtime: Arc<KernelRuntime>) -> Self {
        Self { runtime }
    }

    /// Run a flow with an `input` bound as `${input}` from step 1. Returns
    /// either the variable named `output` (if the flow set it) or the last
    /// step's result. Errors abort the chain — no partial-commit retries
    /// (composer responsibility, not runtime's).
    pub async fn execute(
        &self,
        flow: &Flow,
        input: serde_json::Value,
    ) -> Result<serde_json::Value, FlowError> {
        let mut vars: HashMap<String, serde_json::Value> = HashMap::new();
        vars.insert("input".to_string(), input);
        let mut last_result = serde_json::Value::Null;

        for (idx, step) in flow.steps.iter().enumerate() {
            let resolved_args = interpolate(&step.args, &vars);
            let result = self.dispatch(&step.call, resolved_args).await.map_err(|e| {
                FlowError::StepFailed(
                    step.save_as.clone().unwrap_or_else(|| format!("step_{idx}")),
                    e.to_string(),
                )
            })?;
            if let Some(name) = &step.save_as {
                vars.insert(name.clone(), result.clone());
            }
            last_result = result;
        }
        Ok(vars.get("output").cloned().unwrap_or(last_result))
    }

    /// Route a single base-tool call to its kernel-side implementation.
    /// Tool names match the MCP server's exposed tool surface 1:1 so
    /// composition + direct-MCP invocations behave identically.
    async fn dispatch(
        &self,
        tool: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, FlowError> {
        match tool {
            "base.llm.chat" => self.call_llm_chat(args).await,
            "base.http.get" => self.call_http_get(args).await,
            "base.http.post" => self.call_http_post(args).await,
            "base.vault.read" => self.call_vault_read(args).await,
            "base.vault.write" => self.call_vault_write(args).await,
            "base.vault.list" => self.call_vault_list(args).await,
            "base.vault.search" => self.call_vault_search(args).await,
            "base.kv.get" => self.call_kv_get(args).await,
            "base.kv.set" => self.call_kv_set(args).await,
            "base.mcp.call" => self.call_mcp_call(args).await,
            other => Err(FlowError::UnknownTool(other.into())),
        }
    }

    // ─── Base tool handlers ───────────────────────────────────────────

    async fn call_llm_chat(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let messages_raw = required_field(&args, "messages", "base.llm.chat")?;
        let arr = messages_raw.as_array().ok_or_else(|| {
            FlowError::InvalidArg("messages".into(), "base.llm.chat".into(), "expected array".into())
        })?;
        let messages: Vec<LlmMessage> = arr
            .iter()
            .map(|m| LlmMessage {
                role: m
                    .get("role")
                    .and_then(|v| v.as_str())
                    .unwrap_or("user")
                    .to_string(),
                content: m
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
            .collect();
        let adapter = self
            .runtime
            .llm_port
            .primary_adapter()
            .ok_or_else(|| {
                FlowError::StepFailed(
                    "base.llm.chat".into(),
                    "no LLM adapter registered".into(),
                )
            })?
            .clone();
        let model = args
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let prompt = LlmPrompt {
            system: None,
            messages,
            temperature: args
                .get("temperature")
                .and_then(|v| v.as_f64())
                .map(|f| f as f32),
            max_tokens: args.get("max_tokens").and_then(|v| v.as_u64()).map(|n| n as u32),
        };
        let response = adapter
            .complete(&model, &prompt, 60_000)
            .await
            .map_err(|e| FlowError::StepFailed("base.llm.chat".into(), e.to_string()))?;
        Ok(serde_json::Value::String(response))
    }

    async fn call_http_get(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let url = required_string(&args, "url", "base.http.get")?;
        let headers = args
            .get("headers")
            .and_then(|v| v.as_object())
            .map(|m| {
                m.iter()
                    .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                    .collect::<std::collections::BTreeMap<_, _>>()
            })
            .unwrap_or_default();
        let timeout_ms = args.get("timeout_ms").and_then(|v| v.as_u64()).unwrap_or(30_000);
        http_request(reqwest::Method::GET, url, headers, None, timeout_ms).await
    }

    async fn call_http_post(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let url = required_string(&args, "url", "base.http.post")?;
        let body = args.get("body").cloned();
        let headers = args
            .get("headers")
            .and_then(|v| v.as_object())
            .map(|m| {
                m.iter()
                    .map(|(k, v)| (k.clone(), v.as_str().unwrap_or("").to_string()))
                    .collect::<std::collections::BTreeMap<_, _>>()
            })
            .unwrap_or_default();
        let timeout_ms = args.get("timeout_ms").and_then(|v| v.as_u64()).unwrap_or(30_000);
        http_request(reqwest::Method::POST, url, headers, body, timeout_ms).await
    }

    async fn call_vault_read(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let path = required_string(&args, "path", "base.vault.read")?;
        let root = vault::default_vault_root().ok_or(FlowError::VaultRootUnresolved)?;
        let entry = vault::read(&root, &path)
            .map_err(|e| FlowError::StepFailed("base.vault.read".into(), e.to_string()))?;
        serde_json::to_value(&entry)
            .map_err(|e| FlowError::StepFailed("base.vault.read".into(), e.to_string()))
    }

    async fn call_vault_write(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let path = required_string(&args, "path", "base.vault.write")?;
        let body = required_string(&args, "body", "base.vault.write")?;
        let frontmatter = args
            .get("frontmatter")
            .cloned()
            .unwrap_or(serde_json::Value::Null);
        let root = vault::default_vault_root().ok_or(FlowError::VaultRootUnresolved)?;
        vault::write(&root, &path, &body, &frontmatter)
            .map_err(|e| FlowError::StepFailed("base.vault.write".into(), e.to_string()))?;
        Ok(serde_json::json!({ "written_path": path }))
    }

    async fn call_vault_list(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let subdir = args.get("subdir").and_then(|v| v.as_str()).map(String::from);
        let root = vault::default_vault_root().ok_or(FlowError::VaultRootUnresolved)?;
        let entries = vault::list(&root, subdir.as_deref())
            .map_err(|e| FlowError::StepFailed("base.vault.list".into(), e.to_string()))?;
        serde_json::to_value(&entries)
            .map_err(|e| FlowError::StepFailed("base.vault.list".into(), e.to_string()))
    }

    async fn call_vault_search(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let query = required_string(&args, "query", "base.vault.search")?;
        let limit = args.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
        let root = vault::default_vault_root().ok_or(FlowError::VaultRootUnresolved)?;
        let hits = vault::search(&root, &query, limit)
            .map_err(|e| FlowError::StepFailed("base.vault.search".into(), e.to_string()))?;
        serde_json::to_value(&hits)
            .map_err(|e| FlowError::StepFailed("base.vault.search".into(), e.to_string()))
    }

    async fn call_kv_get(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let ns = required_string(&args, "namespace", "base.kv.get")?;
        let key = required_string(&args, "key", "base.kv.get")?;
        let ls = self.local_storage()?;
        let value = ls
            .get(&ns, &key)
            .map_err(|e| FlowError::StepFailed("base.kv.get".into(), e.to_string()))?;
        Ok(value.unwrap_or(serde_json::Value::Null))
    }

    async fn call_kv_set(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let ns = required_string(&args, "namespace", "base.kv.set")?;
        let key = required_string(&args, "key", "base.kv.set")?;
        let value = args.get("value").cloned().unwrap_or(serde_json::Value::Null);
        let ls = self.local_storage()?;
        ls.set(&ns, &key, &value)
            .map_err(|e| FlowError::StepFailed("base.kv.set".into(), e.to_string()))?;
        Ok(serde_json::json!({ "ok": true }))
    }

    async fn call_mcp_call(&self, args: serde_json::Value) -> Result<serde_json::Value, FlowError> {
        let server = required_string(&args, "server_id", "base.mcp.call")?;
        let tool = required_string(&args, "tool", "base.mcp.call")?;
        let tool_args = args.get("args").cloned().unwrap_or(serde_json::Value::Null);
        self.runtime
            .mcp_host
            .invoke(&server, &tool, tool_args)
            .await
            .map_err(|e| FlowError::StepFailed("base.mcp.call".into(), e.to_string()))
    }

    fn local_storage(&self) -> Result<&Arc<LocalStorage>, FlowError> {
        self.runtime
            .local_storage
            .as_ref()
            .ok_or(FlowError::LocalStorageUnavailable)
    }
}

// ─── Variable interpolation ──────────────────────────────────────────
//
// Replaces `${name}` and `${name.field}` patterns inside any string-typed
// value in the args tree. Non-string values pass through unchanged.
// Dotted-path resolves field-by-field against the saved variable's
// JSON object. Missing variables leave the placeholder text in place
// so debugging is straightforward (vs silent empty substitution).

fn interpolate(
    value: &serde_json::Value,
    vars: &HashMap<String, serde_json::Value>,
) -> serde_json::Value {
    match value {
        serde_json::Value::String(s) => serde_json::Value::String(interp_string(s, vars)),
        serde_json::Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                out.insert(k.clone(), interpolate(v, vars));
            }
            serde_json::Value::Object(out)
        }
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(|v| interpolate(v, vars)).collect())
        }
        other => other.clone(),
    }
}

fn interp_string(input: &str, vars: &HashMap<String, serde_json::Value>) -> String {
    // Find every `${...}` and substitute. Naive scan; flow args are small,
    // regex compile would dominate. Unknown placeholders left in place.
    let mut out = String::with_capacity(input.len());
    let mut cursor = 0;
    let bytes = input.as_bytes();
    while cursor < bytes.len() {
        // Look for "${" — substring match without regex.
        if cursor + 1 < bytes.len() && bytes[cursor] == b'$' && bytes[cursor + 1] == b'{' {
            // Find matching '}'.
            if let Some(end) = input[cursor + 2..].find('}') {
                let path = &input[cursor + 2..cursor + 2 + end];
                if let Some(resolved) = resolve_path(path, vars) {
                    out.push_str(&resolved);
                } else {
                    // Pass placeholder verbatim so unresolved variables
                    // are visible to the creator at runtime.
                    out.push_str("${");
                    out.push_str(path);
                    out.push('}');
                }
                cursor += end + 3; // past "${path}"
                continue;
            }
        }
        out.push(input[cursor..].chars().next().unwrap_or(' '));
        cursor += input[cursor..].chars().next().map(|c| c.len_utf8()).unwrap_or(1);
    }
    out
}

fn resolve_path(path: &str, vars: &HashMap<String, serde_json::Value>) -> Option<String> {
    let mut parts = path.split('.');
    let head = parts.next()?;
    let mut current = vars.get(head)?.clone();
    for segment in parts {
        current = current.get(segment)?.clone();
    }
    Some(match current {
        serde_json::Value::String(s) => s,
        other => other.to_string(),
    })
}

// ─── Arg validation helpers ──────────────────────────────────────────

fn required_field<'a>(
    args: &'a serde_json::Value,
    name: &str,
    tool: &str,
) -> Result<&'a serde_json::Value, FlowError> {
    args.get(name)
        .ok_or_else(|| FlowError::MissingArg(name.into(), tool.into()))
}

fn required_string(args: &serde_json::Value, name: &str, tool: &str) -> Result<String, FlowError> {
    required_field(args, name, tool)?
        .as_str()
        .map(String::from)
        .ok_or_else(|| FlowError::InvalidArg(name.into(), tool.into(), "expected string".into()))
}

// ─── HTTP helper (shared with mcp_server.rs http tools) ──────────────

async fn http_request(
    method: reqwest::Method,
    url: String,
    headers: std::collections::BTreeMap<String, String>,
    body: Option<serde_json::Value>,
    timeout_ms: u64,
) -> Result<serde_json::Value, FlowError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| FlowError::StepFailed("http".into(), e.to_string()))?;
    let mut req = client.request(method, &url);
    let mut content_type_set = false;
    for (k, v) in &headers {
        if k.eq_ignore_ascii_case("content-type") {
            content_type_set = true;
        }
        req = req.header(k, v);
    }
    if let Some(body) = body {
        match body {
            serde_json::Value::String(s) => {
                req = req.body(s);
            }
            other => {
                if !content_type_set {
                    req = req.header("content-type", "application/json");
                }
                req = req.body(other.to_string());
            }
        }
    }
    let resp = req
        .send()
        .await
        .map_err(|e| FlowError::StepFailed("http".into(), e.to_string()))?;
    let status = resp.status().as_u16();
    let resp_headers: std::collections::BTreeMap<String, String> = resp
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body_text = resp
        .text()
        .await
        .map_err(|e| FlowError::StepFailed("http".into(), e.to_string()))?;
    Ok(serde_json::json!({
        "status": status,
        "body": body_text,
        "headers": resp_headers,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, serde_json::Value)]) -> HashMap<String, serde_json::Value> {
        pairs.iter().map(|(k, v)| ((*k).to_string(), v.clone())).collect()
    }

    #[test]
    fn interp_plain_variable() {
        let v = vars(&[("name", serde_json::Value::String("world".into()))]);
        assert_eq!(interp_string("hello ${name}", &v), "hello world");
    }

    #[test]
    fn interp_dotted_path() {
        let v = vars(&[("user", serde_json::json!({ "first": "Ada", "last": "Lovelace" }))]);
        assert_eq!(interp_string("${user.first} ${user.last}", &v), "Ada Lovelace");
    }

    #[test]
    fn interp_unresolved_leaves_placeholder() {
        let v = vars(&[]);
        assert_eq!(interp_string("hi ${missing}", &v), "hi ${missing}");
    }

    #[test]
    fn interp_nested_object_value() {
        let v = vars(&[("clip", serde_json::Value::String("text".into()))]);
        let args = serde_json::json!({
            "messages": [{ "role": "user", "content": "Translate: ${clip}" }]
        });
        let interpolated = interpolate(&args, &v);
        assert_eq!(
            interpolated["messages"][0]["content"],
            serde_json::Value::String("Translate: text".into())
        );
    }
}
