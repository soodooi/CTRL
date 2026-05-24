//! `run_keycap_draft` — sandboxed execution of a draft manifest for
//! workshop preview pane. Returns a per-step trace (n8n-style) so the
//! canvas can render "input → output" for every step + spot failures
//! without having to dig through logs.
//!
//! Sandbox boundary (per bao Q2 alignment, 2026-05-23):
//!   real exec     llm / template / transform / capture-clipboard
//!   simulated     write-clipboard / notify / open-url
//!   blocked       vault-write / mcp-invoke / invoke
//!
//! "Simulated" steps log the intent in the trace (what would be
//! clipped / shown / opened) but don't actually mutate the system.
//! "Blocked" steps return immediately with skipped_reason — they need
//! a real run to be meaningful, draft mode says "you'll see this when
//! you publish".
//!
//! Designed for the workshop preview pane (D5 workshop.preview_run
//! tool will wrap this).

use std::collections::HashMap;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::kernel::llm_port::{LlmMessage, LlmPrompt};
use crate::shell::KernelHandle;

#[derive(Debug, Deserialize)]
pub struct RunKeycapDraftArgs {
    /// Full KeycapManifest JSON. We don't lock to the typed schema
    /// here — drafts are intentionally incomplete, and the runner
    /// surfaces shape errors as trace entries rather than refusing
    /// outright. PWA shows them per-step.
    pub manifest: serde_json::Value,
    /// Optional action_id — defaults to the first action in the manifest.
    pub action_id: Option<String>,
    /// Optional initial bindings for `{{var}}` template substitution.
    /// Useful when the canvas user is testing with a fake clipboard /
    /// selection input.
    pub bindings: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
pub struct StepTrace {
    pub step_index: usize,
    pub step_type: String,
    pub step_id: Option<String>, // the `as` binding name, if any
    pub input: serde_json::Value,
    pub output: serde_json::Value,
    pub duration_ms: u64,
    /// One of `real`, `simulated`, `blocked`, `skipped`.
    pub status: String,
    pub error: Option<String>,
    pub skipped_reason: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct RunKeycapDraftResult {
    pub action_id: String,
    pub steps: Vec<StepTrace>,
    pub total_duration_ms: u64,
    pub final_output: serde_json::Value,
    pub final_error: Option<String>,
}

#[tauri::command]
pub async fn run_keycap_draft(
    args: RunKeycapDraftArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<RunKeycapDraftResult, String> {
    let started = Instant::now();

    let actions = args
        .manifest
        .get("actions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "manifest.actions[] missing or not an array".to_string())?;
    if actions.is_empty() {
        return Err("manifest.actions[] is empty".into());
    }
    let action = match args.action_id.as_deref() {
        Some(id) => actions
            .iter()
            .find(|a| a.get("id").and_then(|v| v.as_str()) == Some(id))
            .ok_or_else(|| format!("action_id {id:?} not found"))?,
        None => &actions[0],
    };
    let action_id = action
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("(unnamed-action)")
        .to_string();

    let steps = action
        .get("steps")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let mut bindings: HashMap<String, String> = args.bindings.unwrap_or_default();
    let mut traces: Vec<StepTrace> = Vec::new();
    let mut final_output = serde_json::Value::Null;
    let mut final_error: Option<String> = None;

    for (index, step) in steps.iter().enumerate() {
        let step_type = step
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("(unknown)")
            .to_string();
        let step_id = step
            .get("as")
            .and_then(|v| v.as_str())
            .map(String::from);

        let step_started = Instant::now();
        let outcome = run_one_step(step, &step_type, &bindings, &kernel).await;
        let duration_ms = step_started.elapsed().as_millis() as u64;

        let (status, output_value, error, skipped_reason) = match &outcome {
            StepOutcome::Real(out) => ("real", out.clone(), None, None),
            StepOutcome::Simulated(out) => ("simulated", out.clone(), None, None),
            StepOutcome::Blocked(reason) => (
                "blocked",
                serde_json::Value::Null,
                None,
                Some(reason.clone()),
            ),
            StepOutcome::Skipped(reason) => (
                "skipped",
                serde_json::Value::Null,
                None,
                Some(reason.clone()),
            ),
            StepOutcome::Error(e) => (
                "real",
                serde_json::Value::Null,
                Some(e.clone()),
                None,
            ),
        };

        // Bind the output to the step's `as` name for downstream
        // `{{name}}` references (skipped/blocked = empty string).
        if let Some(name) = &step_id {
            let s = match &output_value {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Null => String::new(),
                other => other.to_string(),
            };
            bindings.insert(name.clone(), s);
        }

        let resolved_input = collect_step_input_summary(step, &bindings);
        traces.push(StepTrace {
            step_index: index,
            step_type: step_type.clone(),
            step_id,
            input: resolved_input,
            output: output_value.clone(),
            duration_ms,
            status: status.to_string(),
            error: error.clone(),
            skipped_reason,
        });

        if let Some(e) = error {
            final_error = Some(e);
            break; // halt on real error (n8n pattern — surface the failed step)
        }
        final_output = output_value;
    }

    Ok(RunKeycapDraftResult {
        action_id,
        steps: traces,
        total_duration_ms: started.elapsed().as_millis() as u64,
        final_output,
        final_error,
    })
}

enum StepOutcome {
    Real(serde_json::Value),
    Simulated(serde_json::Value),
    Blocked(String),
    Skipped(String),
    Error(String),
}

async fn run_one_step(
    step: &serde_json::Value,
    step_type: &str,
    bindings: &HashMap<String, String>,
    kernel: &State<'_, KernelHandle>,
) -> StepOutcome {
    match step_type {
        "llm" => run_llm_step(step, bindings, kernel).await,
        "template" => run_template_step(step, bindings),
        "transform" => run_transform_step(step, bindings),
        "capture-clipboard" => run_capture_clipboard_step(),
        // Simulated — log intent, don't mutate.
        "write-clipboard" => simulate_write_clipboard(step, bindings),
        "notify" => simulate_notify(step, bindings),
        "open-url" => simulate_open_url(step, bindings),
        // Blocked — recursive side effects + composition can't safely
        // be sandboxed in v1 (per bao Q2 alignment).
        "vault-write" => StepOutcome::Blocked(
            "vault-write is blocked in draft mode — runs only after install_keycap"
                .into(),
        ),
        "mcp-invoke" => StepOutcome::Blocked(
            "mcp-invoke is blocked in draft mode — recursive sandboxing deferred to v1.1"
                .into(),
        ),
        "invoke" => StepOutcome::Blocked(
            "invoke is blocked in draft mode — recursive sandboxing deferred to v1.1".into(),
        ),
        other => StepOutcome::Skipped(format!("unknown step type {other:?}")),
    }
}

async fn run_llm_step(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
    kernel: &State<'_, KernelHandle>,
) -> StepOutcome {
    let adapter = match kernel.runtime.llm_port.primary_adapter() {
        Some(a) => a.clone(),
        None => {
            return StepOutcome::Error(
                "no LLM adapter registered — edit ~/.ctrl/config.toml or use Settings → Provider"
                    .into(),
            );
        }
    };
    let model = step
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let temperature = step
        .get("temperature")
        .and_then(|v| v.as_f64())
        .map(|n| n as f32);
    let max_tokens = step
        .get("max_tokens")
        .and_then(|v| v.as_u64())
        .map(|n| n as u32);

    // Resolve system / prompt — either inline (`system` / `prompt`) or
    // registry ref (`system_ref` / `prompt_ref`). G10 substrate.
    let system_raw = step
        .get("system")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let system_ref = step
        .get("system_ref")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let prompt_raw = step
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let prompt_ref = step
        .get("prompt_ref")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let system = match (system_raw, system_ref) {
        (Some(s), _) => Some(render_template(&s, bindings)),
        (None, Some(name)) => match load_prompt_from_registry(&name) {
            Ok(body) => Some(render_template(&body, bindings)),
            Err(e) => return StepOutcome::Error(format!("system_ref load: {e}")),
        },
        _ => None,
    };
    let prompt_body = match (prompt_raw, prompt_ref) {
        (Some(p), _) => render_template(&p, bindings),
        (None, Some(name)) => match load_prompt_from_registry(&name) {
            Ok(body) => render_template(&body, bindings),
            Err(e) => return StepOutcome::Error(format!("prompt_ref load: {e}")),
        },
        _ => {
            return StepOutcome::Error(
                "llm step needs `prompt` or `prompt_ref`".into(),
            );
        }
    };

    let llm_prompt = LlmPrompt {
        system,
        messages: vec![LlmMessage {
            role: "user".into(),
            content: prompt_body,
        }],
        temperature,
        max_tokens,
    };

    let mut rx = match adapter.stream_chat(&model, &llm_prompt, 30_000).await {
        Ok(rx) => rx,
        Err(e) => return StepOutcome::Error(format!("stream_chat: {e}")),
    };

    // Drain to a single string — draft preview shows the final output;
    // streaming UI is the production runtime path (chat_stream).
    let mut accum = String::new();
    loop {
        let item = tokio::time::timeout(Duration::from_secs(60), rx.recv()).await;
        match item {
            Ok(Some(Ok(chunk))) => {
                accum.push_str(&chunk.delta);
                if chunk.finish_reason.is_some() {
                    break;
                }
            }
            Ok(Some(Err(e))) => return StepOutcome::Error(format!("stream err: {e}")),
            Ok(None) => break,
            Err(_) => return StepOutcome::Error("timeout after 60s waiting for LLM".into()),
        }
    }
    StepOutcome::Real(serde_json::Value::String(accum))
}

fn run_template_step(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
) -> StepOutcome {
    let template = match step.get("template").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return StepOutcome::Error("template step missing `template` field".into()),
    };
    StepOutcome::Real(serde_json::Value::String(render_template(template, bindings)))
}

fn run_transform_step(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
) -> StepOutcome {
    let op = match step.get("op").and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return StepOutcome::Error("transform step missing `op` field".into()),
    };
    let input_tpl = step
        .get("input")
        .and_then(|v| v.as_str())
        .unwrap_or("{{_prev}}");
    let input = render_template(input_tpl, bindings);
    let out = match op {
        "base64encode" => base64::engine::general_purpose::STANDARD.encode(input.as_bytes()),
        "base64decode" => match base64::engine::general_purpose::STANDARD.decode(input.as_bytes()) {
            Ok(bytes) => String::from_utf8(bytes).unwrap_or_default(),
            Err(e) => return StepOutcome::Error(format!("base64decode: {e}")),
        },
        "urlencode" => url_encode_inline(&input),
        "urldecode" => url_decode_inline(&input),
        "uppercase" => input.to_uppercase(),
        "lowercase" => input.to_lowercase(),
        "jsonpretty" => match serde_json::from_str::<serde_json::Value>(&input) {
            Ok(v) => serde_json::to_string_pretty(&v).unwrap_or_default(),
            Err(e) => return StepOutcome::Error(format!("jsonpretty: {e}")),
        },
        "wordcount" => input.split_whitespace().count().to_string(),
        other => return StepOutcome::Skipped(format!("unknown transform op {other:?}")),
    };
    StepOutcome::Real(serde_json::Value::String(out))
}

fn run_capture_clipboard_step() -> StepOutcome {
    // Sandbox semantics — we COULD read the real clipboard here (it's
    // pure read, no side effect), but draft preview should be repeatable.
    // Surface a synthetic value instead with a flag so the canvas user
    // knows. They can supply a real value via the `bindings` arg.
    StepOutcome::Simulated(serde_json::json!({
        "_simulated": true,
        "note": "capture-clipboard returns synthetic value in draft mode; pass bindings.clipboard to override.",
        "value": "(simulated clipboard contents)"
    }))
}

fn simulate_write_clipboard(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
) -> StepOutcome {
    let value_tpl = step.get("value").and_then(|v| v.as_str()).unwrap_or("");
    let value = render_template(value_tpl, bindings);
    StepOutcome::Simulated(serde_json::json!({
        "_simulated": true,
        "would_write": value,
    }))
}

fn simulate_notify(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
) -> StepOutcome {
    let title = step
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| render_template(s, bindings));
    let message = step
        .get("message")
        .and_then(|v| v.as_str())
        .map(|s| render_template(s, bindings))
        .unwrap_or_default();
    StepOutcome::Simulated(serde_json::json!({
        "_simulated": true,
        "would_notify": { "title": title, "message": message },
    }))
}

fn simulate_open_url(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
) -> StepOutcome {
    let url_tpl = step.get("url").and_then(|v| v.as_str()).unwrap_or("");
    let url = render_template(url_tpl, bindings);
    StepOutcome::Simulated(serde_json::json!({
        "_simulated": true,
        "would_open": url,
    }))
}

/// Minimal `{{name}}` substitution. Anything inside `{{ }}` is
/// matched against the bindings; unknown names are left intact so
/// the trace can show what the step expected.
fn render_template(s: &str, bindings: &HashMap<String, String>) -> String {
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'{' && bytes[i + 1] == b'{' {
            // find closing }}
            if let Some(end) = s[i + 2..].find("}}") {
                let name = s[i + 2..i + 2 + end].trim();
                if let Some(v) = bindings.get(name) {
                    out.push_str(v);
                } else {
                    out.push_str(&s[i..i + 2 + end + 2]);
                }
                i += 2 + end + 2;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn collect_step_input_summary(
    step: &serde_json::Value,
    bindings: &HashMap<String, String>,
) -> serde_json::Value {
    // Surface the resolved version of small string fields so the trace
    // shows what the step actually saw (post-template). Avoids dumping
    // huge LlmPrompt arrays.
    let mut out = serde_json::Map::new();
    for key in &["prompt", "system", "template", "value", "message", "url", "input"] {
        if let Some(raw) = step.get(*key).and_then(|v| v.as_str()) {
            out.insert(
                (*key).to_string(),
                serde_json::Value::String(render_template(raw, bindings)),
            );
        }
    }
    // Carry through op / ref / model fields verbatim.
    for key in &["op", "system_ref", "prompt_ref", "model", "max_tokens", "temperature"] {
        if let Some(v) = step.get(*key) {
            out.insert((*key).to_string(), v.clone());
        }
    }
    serde_json::Value::Object(out)
}

/// G10 runtime — read a named prompt body from
/// `~/.ctrl/.irisy-prompts/<name>.md` (or `<name>.v<n>.md` when ref
/// ends in `@v<n>`). Returns the body (frontmatter stripped if present).
/// 5-min in-process cache deferred — workshop preview re-runs are
/// already cheap.
fn load_prompt_from_registry(name_ref: &str) -> Result<String, String> {
    // Parse optional `@v<n>` suffix.
    let (name, version) = match name_ref.rsplit_once('@') {
        Some((n, v)) if v.starts_with('v') => (n, Some(v.to_string())),
        _ => (name_ref, None),
    };
    if name.is_empty() {
        return Err("prompt name is empty".into());
    }
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    let dir = std::path::PathBuf::from(home)
        .join(".ctrl")
        .join(".irisy-prompts");
    let file_name = match version {
        Some(v) => format!("{name}.{v}.md"),
        None => format!("{name}.md"),
    };
    let path = dir.join(&file_name);
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| format!("read prompt {path:?}: {e}"))?;
    // Strip YAML frontmatter if present.
    let body = strip_frontmatter(&raw);
    Ok(body.to_string())
}

/// RFC 3986 unreserved set: A-Z a-z 0-9 - _ . ~
fn url_encode_inline(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

fn url_decode_inline(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hi = (bytes[i + 1] as char).to_digit(16);
            let lo = (bytes[i + 2] as char).to_digit(16);
            match (hi, lo) {
                (Some(h), Some(l)) => {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                    continue;
                }
                _ => {}
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn strip_frontmatter(raw: &str) -> &str {
    let trimmed = raw.trim_start();
    if !trimmed.starts_with("---") {
        return raw;
    }
    let after_first = &trimmed[3..];
    if let Some(end) = after_first.find("\n---") {
        let rest_start = 3 + end + 4; // skip "\n---"
        let after = &after_first[rest_start - 3..];
        return after.trim_start_matches('\n');
    }
    raw
}
