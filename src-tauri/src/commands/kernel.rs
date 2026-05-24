// Kernel commands — keycap CRUD + MCP introspection/invocation.
//
// Sub-PR d: real wire via `tauri::State<KernelHandle>`. Stub data lives in
// a fallback path while the manifest registry + persistence schema lands
// in sub-PR e (which also removes win/ and consolidates the tool registry).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

use crate::shell::KernelHandle;

/// Resolve the on-disk keycap directory ($HOME/.ctrl/keycaps). Errors out
/// when HOME isn't set — typically a misconfigured CI env, not a user
/// failure mode.
fn keycap_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME env var not set".to_string())?;
    Ok(PathBuf::from(home).join(".ctrl").join("keycaps"))
}

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
        KeycapSummary {
            id: "code-space".into(),
            name: "Code Space".into(),
            keycap_color: "graphite".into(),
            icon: "⌨".into(),
        },
    ]
}

/// Build a KeycapSummary projection from a parsed manifest JSON value.
/// Defaults match the seed_keycaps fallbacks so a manifest missing a
/// field still produces a renderable card.
fn manifest_to_summary(manifest: &serde_json::Value, id: &str) -> KeycapSummary {
    KeycapSummary {
        id: id.to_string(),
        name: manifest
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or(id)
            .to_string(),
        keycap_color: manifest
            .get("keycap_color")
            .and_then(|v| v.as_str())
            .unwrap_or("cobalt")
            .to_string(),
        icon: manifest
            .get("icon")
            .and_then(|v| v.as_str())
            .unwrap_or("◆")
            .to_string(),
    }
}

/// Scan a keycap directory and return summaries for every well-formed
/// child. Malformed entries (missing manifest.json, bad JSON, missing id)
/// are skipped silently — they'll surface in trace logs but shouldn't
/// crash the keyboard render.
fn list_installed_in(dir: &Path) -> Vec<KeycapSummary> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return Vec::new(), // dir doesn't exist yet — fresh install
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let manifest_path = path.join("manifest.json");
        let bytes = match fs::read(&manifest_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let manifest: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(?path, error = %e, "skipping keycap with malformed manifest");
                continue;
            }
        };
        let id = match manifest.get("id").and_then(|v| v.as_str()) {
            Some(s) => s.to_string(),
            None => {
                tracing::warn!(?path, "skipping keycap with missing manifest.id");
                continue;
            }
        };
        out.push(manifest_to_summary(&manifest, &id));
    }
    out
}

#[tauri::command]
pub async fn list_keycaps(_kernel: State<'_, KernelHandle>) -> Result<Vec<KeycapSummary>, String> {
    let dir = keycap_dir()?;
    let installed = list_installed_in(&dir);
    let installed_ids: std::collections::HashSet<String> =
        installed.iter().map(|k| k.id.clone()).collect();

    // Seeds fill the keyboard before any install — fresh CTRL isn't empty.
    // Installed keycaps win on id collision so a user who installs an
    // override of "clipboard-ai" sees their version, not the seed.
    let mut out = installed;
    for s in seed_keycaps() {
        if !installed_ids.contains(&s.id) {
            out.push(s);
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
pub struct InstallKeycapArgs {
    /// The validated manifest (Zod-checked PWA side). Must carry a string `id`.
    pub manifest: serde_json::Value,
    /// MCP server source code (TypeScript or Python).
    pub server_code: String,
    /// Filename to write `server_code` under. Restricted to a safe basename.
    pub server_code_filename: String,
}

/// Validate that an id is safe to use as a directory name. Rejects `..`,
/// path separators, empty strings, and over-long values that could hit
/// filesystem limits.
fn validate_keycap_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("manifest.id is empty".into());
    }
    if id.len() > 128 {
        return Err(format!("manifest.id too long ({} > 128)", id.len()));
    }
    if id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("manifest.id contains illegal characters: {id}"));
    }
    // Allow lowercase alphanumerics + `-` + `_` + `.` — the same shape
    // npm / Linux package ids use; rejects spaces and shell-meta.
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
    {
        return Err(format!("manifest.id has non-alphanumeric chars: {id}"));
    }
    Ok(())
}

/// Reduce a user-supplied filename to a safe basename. Empty / unsafe
/// inputs fall back to `server.ts`.
fn sanitize_server_filename(raw: &str) -> String {
    let basename = raw.rsplit('/').next().unwrap_or("").rsplit('\\').next().unwrap_or("");
    let safe: String = basename
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '.' || *c == '-' || *c == '_')
        .collect();
    if safe.is_empty() || safe.starts_with('.') {
        "server.ts".to_string()
    } else {
        safe
    }
}

fn install_into(
    dir: &Path,
    args: &InstallKeycapArgs,
) -> Result<KeycapSummary, String> {
    let id = args
        .manifest
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "manifest.id missing or not a string".to_string())?
        .to_string();
    validate_keycap_id(&id)?;

    let target = dir.join(&id);
    fs::create_dir_all(&target).map_err(|e| format!("create dir {target:?}: {e}"))?;

    let manifest_bytes = serde_json::to_vec_pretty(&args.manifest)
        .map_err(|e| format!("serialize manifest: {e}"))?;
    fs::write(target.join("manifest.json"), &manifest_bytes)
        .map_err(|e| format!("write manifest.json: {e}"))?;

    let server_filename = sanitize_server_filename(&args.server_code_filename);
    fs::write(target.join(&server_filename), &args.server_code)
        .map_err(|e| format!("write {server_filename}: {e}"))?;

    Ok(manifest_to_summary(&args.manifest, &id))
}

#[tauri::command]
pub async fn install_keycap(
    args: InstallKeycapArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<KeycapSummary, String> {
    let dir = keycap_dir()?;
    let summary = install_into(&dir, &args)?;
    tracing::info!(keycap_id = %summary.id, "install_keycap ok");
    Ok(summary)
}

#[derive(Debug, Deserialize)]
pub struct McpInstallArgs {
    /// MCP server source — tells the kernel how to spawn / connect:
    ///   { "kind": "npm",   "package": "@modelcontextprotocol/server-puppeteer", "args": [] }
    ///   { "kind": "pypi",  "package": "mcp-server-fetch", "args": [] }
    ///   { "kind": "local", "command": "/path/to/bin", "args": [] }
    ///   { "kind": "http",  "url": "https://api.example.com/mcp" }
    pub source: crate::kernel::mcp_host::McpServerSource,
    /// Which advertised tool to expose as this keycap (1 tool per keycap).
    pub tool_name: String,
    pub display_name: String,
    pub keycap_color: Option<String>,
    pub icon: Option<String>,
    /// Optional override of the auto-derived id. Generated as
    /// `mcp-<source-hash>-<tool>` when absent.
    pub keycap_id: Option<String>,
    /// Free-form description shown in the keycap details panel.
    pub description: Option<String>,
}

#[tauri::command]
pub async fn install_keycap_from_mcp(
    args: McpInstallArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<KeycapSummary, String> {
    use crate::kernel::mcp_host::{McpServerDescriptor, McpServerSource};

    let host = kernel.runtime.mcp_host.clone();

    // Stable server id derived from the source so a re-install with the
    // same source produces the same entry (no duplicate descriptors after
    // upgrade flow). Hash inputs include kind + identifiers, NOT args.
    let server_id = derive_server_id(&args.source);

    // Server keycap id — either user-supplied or auto-derived. Validated
    // identically to install_keycap's path so the same id-safety rules
    // hold.
    let keycap_id = match args.keycap_id.clone() {
        Some(id) => {
            validate_keycap_id(&id)?;
            id
        }
        None => format!("mcp-{}-{}", server_id.trim_start_matches("mcp-"), slugify(&args.tool_name)),
    };

    // Register descriptor with mcp_host (in-memory) so connect / invoke
    // find the source.
    let descriptor = McpServerDescriptor {
        id: server_id.clone(),
        name: args.display_name.clone(),
        version: "0.0.0".into(), // populated from MCP initialize response (P4).
        description: args.description.clone().unwrap_or_default(),
        tools: Vec::new(), // populated by list_tools below.
        source: args.source.clone(),
    };
    host.register(descriptor.clone()).await;

    // Connect + list_tools to (1) validate the server actually spawns,
    // (2) verify the requested tool exists. Best-effort: http transport
    // isn't wired in this commit, so http installs skip validation and
    // trust the user.
    match args.source {
        McpServerSource::Http { .. } => {}
        _ => {
            let tools = host
                .list_tools(&server_id)
                .await
                .map_err(|e| format!("MCP probe (list_tools) failed: {e}"))?;
            let tool_names: Vec<&str> = tools.iter().map(|t| t.name.as_ref()).collect();
            if !tool_names.iter().any(|n| *n == args.tool_name.as_str()) {
                return Err(format!(
                    "MCP server {server_id:?} does not advertise tool {:?}. Available: {:?}",
                    args.tool_name, tool_names
                ));
            }
        }
    }

    // Persist registry so next boot re-registers without the wizard.
    if let Some(reg_path) = crate::kernel::mcp_host::McpHost::default_registry_path() {
        if let Err(e) = host.save_registry(&reg_path).await {
            tracing::warn!(error = %e, "mcp_host: save_registry failed (continuing — keycap manifest still wrote)");
        }
    }

    // Write a keycap manifest under ~/.ctrl/keycaps/<id>/ so list_keycaps
    // surfaces the new entry and run_keycap can dispatch via manifest.
    let manifest = serde_json::json!({
        "id": keycap_id,
        "name": args.display_name,
        "version": "0.1.0",
        "description": args.description.clone().unwrap_or_default(),
        "icon": args.icon.clone().unwrap_or_else(|| "◆".into()),
        "keycap_color": args.keycap_color.clone().unwrap_or_else(|| "cobalt".into()),
        "source": {
            "type": "mcp",
            "server_id": server_id,
            "tool_name": args.tool_name,
        },
    });
    let install_args = InstallKeycapArgs {
        manifest: manifest.clone(),
        server_code: String::new(),       // MCP-sourced keycaps have no local TS server.
        server_code_filename: String::new(),
    };
    let dir = keycap_dir()?;
    let summary = install_into(&dir, &install_args)?;

    tracing::info!(
        keycap_id = %summary.id,
        server_id = %descriptor.id,
        tool = %args.tool_name,
        "install_keycap_from_mcp ok"
    );
    Ok(summary)
}

fn derive_server_id(source: &crate::kernel::mcp_host::McpServerSource) -> String {
    use crate::kernel::mcp_host::McpServerSource;
    // Lightweight stable hash via DefaultHasher — collision probability
    // is fine for a per-user registry that holds at most low-hundreds
    // of entries. Avoids pulling sha2 just for cosmetic id strings.
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    match source {
        McpServerSource::Npm { package, .. } => {
            "npm".hash(&mut h);
            package.hash(&mut h);
        }
        McpServerSource::Pypi { package, .. } => {
            "pypi".hash(&mut h);
            package.hash(&mut h);
        }
        McpServerSource::Local { command, .. } => {
            "local".hash(&mut h);
            command.hash(&mut h);
        }
        McpServerSource::Http { url } => {
            "http".hash(&mut h);
            url.hash(&mut h);
        }
    }
    format!("mcp-{:x}", h.finish())
}

use crate::kernel::mcp_host::McpHostError;

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
    kernel: State<'_, KernelHandle>,
) -> Result<RunKeycapResult, String> {
    use crate::kernel::event::{Cell, CellKind, Op, OpKind};

    let started = std::time::Instant::now();
    let stream_id = format!("keycap-{}", args.keycap_id);

    // Publish KeycapInvoked immediately so the PWA workspace pane sees
    // an event before any work happens.
    kernel.bridge.publish_op(Op {
        kind: OpKind::KeycapInvoked,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.clone()),
        payload: serde_json::json!({
            "keycap_id": args.keycap_id,
            "input": args.input,
        }),
    });

    // Dispatch: seed LLM-flavored keycaps route to the LLM port; anything
    // else falls through to the echo stub until a manifest-driven dispatch
    // path lands.
    let dispatch = classify_keycap(&args.keycap_id);
    let result = match dispatch {
        KeycapDispatch::TextChat { system } => {
            run_text_chat(&kernel, &args, &stream_id, system).await
        }
        KeycapDispatch::McpInvoke { server_id, tool_name } => {
            run_mcp_invoke(&kernel, &args, &stream_id, &server_id, &tool_name).await
        }
        KeycapDispatch::Stub => Ok(serde_json::json!({
            "stub": true,
            "keycap_id": args.keycap_id,
            "echo_input": args.input,
            "note": "no manifest-driven dispatch yet for this keycap",
        })),
    };

    let duration_ms = started.elapsed().as_millis() as u64;

    match result {
        Ok(output) => {
            kernel.bridge.publish_op(Op {
                kind: OpKind::KeycapCompleted,
                ts_ms: now_ms(),
                stream_id: Some(stream_id),
                payload: serde_json::json!({
                    "keycap_id": args.keycap_id,
                    "output": output.clone(),
                    "duration_ms": duration_ms,
                }),
            });
            Ok(RunKeycapResult { output, duration_ms })
        }
        Err(err_msg) => {
            // Publish a KeycapFailed Op AND a LlmResponse cell carrying
            // the error text — the PWA workspace surfaces both, but only
            // the cell content is human-readable inline.
            kernel.bridge.publish_cell(Cell {
                kind: CellKind::LlmResponse,
                ts_ms: now_ms(),
                stream_id: Some(stream_id.clone()),
                payload: serde_json::json!({
                    "delta": format!("\n[error] {err_msg}"),
                    "error": true,
                }),
            });
            kernel.bridge.publish_op(Op {
                kind: OpKind::KeycapFailed,
                ts_ms: now_ms(),
                stream_id: Some(stream_id),
                payload: serde_json::json!({
                    "keycap_id": args.keycap_id,
                    "error": err_msg.clone(),
                    "duration_ms": duration_ms,
                }),
            });
            Err(err_msg)
        }
    }
}

/// Classify a keycap id into a dispatch path. Installed manifests
/// (~/.ctrl/keycaps/<id>/manifest.json) win over the seed lookup so
/// user-installed MCP / builtin keycaps take precedence over hardcoded
/// fallbacks.
enum KeycapDispatch {
    TextChat { system: &'static str },
    McpInvoke { server_id: String, tool_name: String },
    Stub,
}

fn classify_keycap(keycap_id: &str) -> KeycapDispatch {
    if let Some(d) = classify_from_installed_manifest(keycap_id) {
        return d;
    }
    classify_seed(keycap_id)
}

fn classify_from_installed_manifest(keycap_id: &str) -> Option<KeycapDispatch> {
    let dir = keycap_dir().ok()?;
    let path = dir.join(keycap_id).join("manifest.json");
    let bytes = fs::read(&path).ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let source = manifest.get("source")?;
    let kind = source.get("type").and_then(|v| v.as_str())?;
    match kind {
        "mcp" => {
            let server_id = source.get("server_id").and_then(|v| v.as_str())?.to_string();
            let tool_name = source.get("tool_name").and_then(|v| v.as_str())?.to_string();
            if server_id.is_empty() || tool_name.is_empty() {
                return None;
            }
            Some(KeycapDispatch::McpInvoke { server_id, tool_name })
        }
        _ => None,
    }
}

fn classify_seed(keycap_id: &str) -> KeycapDispatch {
    match keycap_id {
        "ctrl-chat" => KeycapDispatch::TextChat {
            system: "You are CTRL, a concise AI assistant inside a desktop launcher. \
                     Reply in the user's language. Keep answers terse and useful.",
        },
        "clipboard-ai" => KeycapDispatch::TextChat {
            system: "You are CTRL's clipboard rewriter. Take the user's input text and \
                     rewrite it for clarity, tone, and grammar without changing meaning. \
                     Reply with the rewritten text only — no preamble.",
        },
        "ai-translate" => KeycapDispatch::TextChat {
            system: "You are CTRL's translator. Detect the source language of the user's \
                     input and translate it to the other of {English, 中文} (whichever \
                     it is NOT). Reply with the translation only.",
        },
        "ai-text" => KeycapDispatch::TextChat {
            system: "You are CTRL's text processor. Help the user transform, summarize, \
                     or restructure their input. Be concise.",
        },
        _ => KeycapDispatch::Stub,
    }
}

/// Run a text.chat dispatch: pull text from input, call the LLM port's
/// primary adapter with streaming, publish each chunk as a LlmResponse
/// cell on `keycap-<id>`, return accumulated content as the output.
async fn run_text_chat(
    kernel: &State<'_, KernelHandle>,
    args: &RunKeycapArgs,
    stream_id: &str,
    system: &'static str,
) -> Result<serde_json::Value, String> {
    use crate::kernel::event::{Cell, CellKind};
    use crate::kernel::llm_port::{LlmMessage, LlmPrompt};

    let runtime = &kernel.runtime;
    let adapter = runtime
        .llm_port
        .primary_adapter()
        .ok_or_else(|| {
            "No LLM adapter registered. Run `setup_llm_key volc <key>` to enable Doubao / Volcano Ark."
                .to_string()
        })?
        .clone();

    // Accept either input.text (simple shape PWA Irisy sends) or
    // input.messages (full multi-turn). The text shape gets wrapped as
    // a single user turn.
    let user_text = args
        .input
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let messages: Vec<LlmMessage> = if let Some(arr) = args.input.get("messages").and_then(|v| v.as_array()) {
        arr.iter()
            .filter_map(|m| {
                let role = m.get("role")?.as_str()?.to_string();
                let content = m.get("content")?.as_str()?.to_string();
                Some(LlmMessage { role, content })
            })
            .collect()
    } else if !user_text.is_empty() {
        vec![LlmMessage {
            role: "user".into(),
            content: user_text,
        }]
    } else {
        return Err("input must include either `text` (string) or `messages` (array)".into());
    };

    if messages.is_empty() {
        return Err("input.messages is empty after parsing".into());
    }

    let prompt = LlmPrompt {
        system: Some(system.to_string()),
        messages,
        temperature: None,
        max_tokens: None,
    };

    let mut rx = adapter
        .stream_chat("", &prompt, 30_000)
        .await
        .map_err(|e| format!("llm stream_chat failed: {e}"))?;

    let mut accumulated = String::new();
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => {
                if !chunk.delta.is_empty() {
                    accumulated.push_str(&chunk.delta);
                    kernel.bridge.publish_cell(Cell {
                        kind: CellKind::LlmResponse,
                        ts_ms: now_ms(),
                        stream_id: Some(stream_id.to_string()),
                        payload: serde_json::json!({
                            "delta": chunk.delta,
                            "done": false,
                        }),
                    });
                }
                if chunk.finish_reason.is_some() {
                    break;
                }
            }
            Err(e) => return Err(format!("llm stream error: {e}")),
        }
    }

    // Publish a final done cell so the PWA can stop spinners.
    kernel.bridge.publish_cell(Cell {
        kind: CellKind::LlmResponse,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.to_string()),
        payload: serde_json::json!({
            "delta": "",
            "done": true,
        }),
    });

    Ok(serde_json::json!({
        "content": accumulated,
        "adapter": adapter.name(),
    }))
}

/// Run an MCP-dispatch keycap: forward input directly to the connected
/// MCP server's `tool_name`, publish the JSON result as an
/// `McpToolResult` cell so the workspace pane can render it. The mcp_host
/// connects lazily on first invoke; subsequent presses on the same
/// keycap reuse the spawned child.
async fn run_mcp_invoke(
    kernel: &State<'_, KernelHandle>,
    args: &RunKeycapArgs,
    stream_id: &str,
    server_id: &str,
    tool_name: &str,
) -> Result<serde_json::Value, String> {
    use crate::kernel::event::{Cell, CellKind};

    let host = kernel.runtime.mcp_host.clone();
    let invoke_args = args.input.clone();
    let result = host
        .invoke(server_id, tool_name, invoke_args)
        .await
        .map_err(|e| format!("mcp invoke failed (server={server_id}, tool={tool_name}): {e}"))?;

    kernel.bridge.publish_cell(Cell {
        kind: CellKind::McpToolResult,
        ts_ms: now_ms(),
        stream_id: Some(stream_id.to_string()),
        payload: serde_json::json!({
            "server_id": server_id,
            "tool_name": tool_name,
            "result": result,
        }),
    });

    Ok(result)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Deserialize)]
pub struct McpCallArgs {
    /// Either the stable server_id from the descriptor registry, or
    /// `server_url` kept as a back-compat alias (PWA hasn't migrated
    /// yet; both names route through the same lookup).
    #[serde(alias = "server_url")]
    pub server_id: String,
    pub tool_name: String,
    pub args: serde_json::Value,
}

#[tauri::command]
pub async fn mcp_call(
    args: McpCallArgs,
    kernel: State<'_, KernelHandle>,
) -> Result<serde_json::Value, String> {
    kernel
        .runtime
        .mcp_host
        .invoke(&args.server_id, &args.tool_name, args.args)
        .await
        .map_err(|e| format!("mcp_call failed: {e}"))
}

#[tauri::command]
pub async fn list_mcp_servers(
    kernel: State<'_, KernelHandle>,
) -> Result<Vec<crate::kernel::mcp_host::McpServerDescriptor>, String> {
    Ok(kernel.runtime.mcp_host.list_installed().await)
}

/// `mcp_server_info` — return the kernel's own MCP server URL + ephemeral
/// bearer token. The PWA hands these to `bootstrap_hermes` (and to any
/// external agent like Claude Code that the user points at the local
/// kernel). Returns null fields when the server failed to bind.
#[derive(serde::Serialize)]
pub struct McpServerInfo {
    pub url: Option<String>,
    pub token: Option<String>,
}

#[tauri::command]
pub async fn mcp_server_info(kernel: State<'_, KernelHandle>) -> Result<McpServerInfo, String> {
    match &kernel.mcp_server {
        Some(h) => Ok(McpServerInfo {
            url: Some(h.url()),
            token: Some(h.auth_token.as_ref().clone()),
        }),
        None => Ok(McpServerInfo {
            url: None,
            token: None,
        }),
    }
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

// ── Irisy lifecycle commands (Config / Debug / Improvement / Retire) ──

#[derive(Debug, Deserialize)]
pub struct UninstallKeycapArgs {
    pub keycap_id: String,
}

/// Remove an installed keycap's on-disk directory. Surfacing an error on
/// "already gone" (instead of silent no-op) lets Irisy give the user a
/// clear "X was not installed" reply rather than pretending success.
#[tauri::command]
pub async fn uninstall_keycap(
    args: UninstallKeycapArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<(), String> {
    validate_keycap_id(&args.keycap_id)?;
    let dir = keycap_dir()?;
    let target = dir.join(&args.keycap_id);
    if !target.exists() {
        return Err(format!("keycap {} not installed", args.keycap_id));
    }
    fs::remove_dir_all(&target).map_err(|e| format!("remove {target:?}: {e}"))?;
    tracing::info!(keycap_id = %args.keycap_id, "uninstall_keycap ok");
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct ReadKeycapManifestArgs {
    pub keycap_id: String,
}

/// Return the parsed manifest.json for an installed keycap so Irisy can
/// inspect declared config schemas, source bindings, and metadata when
/// answering debug / improvement questions.
#[tauri::command]
pub async fn read_keycap_manifest(
    args: ReadKeycapManifestArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<serde_json::Value, String> {
    validate_keycap_id(&args.keycap_id)?;
    let dir = keycap_dir()?;
    let path = dir.join(&args.keycap_id).join("manifest.json");
    let bytes = fs::read(&path).map_err(|e| format!("read {path:?}: {e}"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("parse manifest.json: {e}"))
}

#[derive(Debug, Deserialize)]
pub struct SetKeycapConfigArgs {
    pub keycap_id: String,
    /// Free-form JSON object that REPLACES the previous config override.
    /// Pass `{}` to clear all overrides.
    pub config: serde_json::Value,
}

/// Write the per-user override config for a keycap. Dispatch reads this
/// alongside the upstream manifest at run_keycap time (Config tier of
/// the 3-tier adjustment model: Config / Patch / Fork).
#[tauri::command]
pub async fn set_keycap_config(
    args: SetKeycapConfigArgs,
    _kernel: State<'_, KernelHandle>,
) -> Result<(), String> {
    validate_keycap_id(&args.keycap_id)?;
    if !args.config.is_object() {
        return Err("config must be a JSON object".into());
    }
    let dir = keycap_dir()?;
    let target = dir.join(&args.keycap_id);
    if !target.exists() {
        return Err(format!("keycap {} not installed", args.keycap_id));
    }
    let path = target.join("config.json");
    let body = serde_json::to_vec_pretty(&args.config)
        .map_err(|e| format!("serialize config: {e}"))?;
    fs::write(&path, &body).map_err(|e| format!("write {path:?}: {e}"))?;
    tracing::info!(keycap_id = %args.keycap_id, "set_keycap_config ok");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_tmp(label: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        let pid = std::process::id();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-keycaps-test-{label}-{pid}-{nanos}"));
        p
    }

    #[test]
    fn validate_keycap_id_rejects_path_traversal() {
        assert!(validate_keycap_id("").is_err());
        assert!(validate_keycap_id("..").is_err());
        assert!(validate_keycap_id("../etc").is_err());
        assert!(validate_keycap_id("foo/bar").is_err());
        assert!(validate_keycap_id("foo\\bar").is_err());
        assert!(validate_keycap_id("name with space").is_err());
        assert!(validate_keycap_id("clipboard-ai").is_ok());
        assert!(validate_keycap_id("ctrl.builtin.text-chat").is_ok());
    }

    #[test]
    fn sanitize_server_filename_drops_paths_and_falls_back() {
        assert_eq!(sanitize_server_filename(""), "server.ts");
        assert_eq!(sanitize_server_filename(".."), "server.ts");
        assert_eq!(sanitize_server_filename("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_server_filename("server.py"), "server.py");
        assert_eq!(sanitize_server_filename("ok name.ts"), "okname.ts");
    }

    #[test]
    fn install_then_list_roundtrip() {
        let dir = fresh_tmp("roundtrip");
        let manifest = serde_json::json!({
            "id": "test-keycap",
            "name": "Test Keycap",
            "icon": "T",
            "keycap_color": "amber",
            "version": "0.1.0",
        });
        let args = InstallKeycapArgs {
            manifest: manifest.clone(),
            server_code: "// noop\n".to_string(),
            server_code_filename: "server.ts".to_string(),
        };
        let summary = install_into(&dir, &args).expect("install ok");
        assert_eq!(summary.id, "test-keycap");
        assert_eq!(summary.name, "Test Keycap");
        assert_eq!(summary.keycap_color, "amber");

        let listed = list_installed_in(&dir);
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, "test-keycap");

        // Verify files actually landed.
        let keycap_path = dir.join("test-keycap");
        assert!(keycap_path.join("manifest.json").exists());
        assert!(keycap_path.join("server.ts").exists());

        // Cleanup so we don't leave temp dirs.
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_rejects_dangerous_id() {
        let dir = fresh_tmp("dangerous");
        let manifest = serde_json::json!({
            "id": "../escaped",
            "name": "Evil",
        });
        let args = InstallKeycapArgs {
            manifest,
            server_code: String::new(),
            server_code_filename: "server.ts".to_string(),
        };
        let err = install_into(&dir, &args).unwrap_err();
        assert!(err.contains("illegal"), "expected illegal-chars error, got: {err}");
    }

    #[test]
    fn list_installed_skips_malformed_dirs() {
        let dir = fresh_tmp("malformed");
        fs::create_dir_all(&dir).unwrap();
        // Empty dir (no manifest)
        fs::create_dir_all(dir.join("no-manifest")).unwrap();
        // Malformed JSON
        fs::create_dir_all(dir.join("bad-json")).unwrap();
        fs::write(dir.join("bad-json/manifest.json"), b"not valid json").unwrap();
        // Missing id
        fs::create_dir_all(dir.join("no-id")).unwrap();
        fs::write(
            dir.join("no-id/manifest.json"),
            b"{\"name\":\"orphan\"}",
        )
        .unwrap();

        let listed = list_installed_in(&dir);
        assert_eq!(listed.len(), 0, "all three are malformed; expected empty");

        let _ = fs::remove_dir_all(&dir);
    }
}
