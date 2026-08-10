// irisy_chat_stream — Irisy persona shell → kernel provider router.
//
// ADR-002 substrate §1 v19 (2026-06-09, 3-agent aggregator) + ADR-005
// irisy § persona-shell v5: Irisy is the PWA persona layer, not a brain.
// The Pi MCP hop this command used to make (POST 127.0.0.1:17874, the
// ctrl-pi-mcp daemon) died with the Pi packages — this rewrite routes
// the turn through the in-process provider router instead
// (kernel::provider::routing::route_text_chat, same v9 §3.5 semantics
// the /text-chat HTTP endpoint uses).
//
// When the assistant agent (hermes, ADR-002 §1.1) ships its verified
// install + chat surface, this command gains an agent-first branch:
// route to hermes via the kernel MCP bus, fall back to the provider
// router when the agent is not installed — offline / fresh installs
// stay fully usable (.kiro/steering/development-philosophy.md derived rule #2).
//
// Contract (unchanged — the PWA's ChatStreamTransport keeps working):
//   invoke('irisy_chat_stream', { args: { request_id, messages, model?,
//                                          temperature?, max_tokens? } })
//   listen('chat-stream-delta', payload => { request_id, delta, done, error? })

use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex as StdMutex, OnceLock,
};
use tauri::{AppHandle, Emitter, State};

use crate::commands::chat::MessageWire;
// Shared attachment reader (ADR-002 substrate §1.8.6 v75; ADR-005 irisy §8.7 v32).
use crate::commands::chat_attachment::ChatAttachmentWire;
use crate::kernel::provider::r#trait::Consumer;
use crate::kernel::provider::routing::route_text_chat;
use crate::kernel::provider::types::{ChatMessage, ChatOpts, ChatPrompt};
use crate::kernel::resource::ResourceRef;
use crate::shell::KernelHandle;

#[derive(Debug, Deserialize, Serialize)]
pub struct IrisyTurnContext {
    pub session_id: String,
    pub resources: Vec<ResourceRef>,
    #[serde(default)]
    pub skill_id: Option<String>,
    pub capability_scope: Vec<String>,
    pub policy: String,
    pub task: String,
}

#[derive(Debug, Deserialize)]
pub struct IrisyChatStreamArgs {
    pub request_id: String,
    pub messages: Vec<MessageWire>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    pub context: IrisyTurnContext,
    /// Files dropped into Irisy's composer alongside this turn. Attachment
    /// bytes remain a transport concern and do not become hidden Resources.
    /// (ADR-005 irisy §11 v40)
    #[serde(default)]
    pub attachments: Vec<ChatAttachmentWire>,
}

#[derive(Debug, Serialize, Clone)]
struct StreamDelta {
    request_id: String,
    delta: String,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    // Wire-compat field: the Pi-era slash-command relay used this; no
    // kernel path emits it today but the PWA listener still reads it.
    #[serde(skip_serializing_if = "Option::is_none")]
    custom: Option<serde_json::Value>,
}

// ADR-005 irisy §8.6 (terminal-essence transparency): the engine streams its
// WORK — each tool call + result — over ACP alongside the answer text. We relay
// those on a parallel `chat-stream-tool` channel so the PWA can show the user
// what Irisy is doing (read this table / wrote that note / ran that connector),
// with drill-down to the raw input + output (§6 transparency by drill-down).
#[derive(Debug, Serialize, Clone)]
struct ToolStep {
    request_id: String,
    // Tool-call id from the engine; the `call` and its later `result` share it.
    tool_call_id: String,
    // "call" when the tool starts, "result" when it finishes.
    phase: String,
    // Human title, e.g. `mcp_ctrl_vault_search`.
    title: String,
    // "completed" / "failed" / "in_progress" — set on the `result` phase.
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    // Compact JSON of the tool input (call phase).
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<String>,
    // Result text (result phase).
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
}

// ADR-005 §8.6 — the engine's reasoning, streamed chunk by chunk on its own
// channel so the PWA can show a "thinking" trace (terminal-essence: you watch it
// reason, not just see the final answer) without polluting the answer text.
#[derive(Debug, Serialize, Clone)]
struct ThoughtStep {
    request_id: String,
    delta: String,
}

struct IrisyStreamAdmission {
    generation: AtomicU64,
}

impl IrisyStreamAdmission {
    const fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
        }
    }

    fn issue(&self) -> u64 {
        self.generation
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1)
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::Acquire) == generation
    }
}

// Detached Tauri workers are admitted in one monotonic order. Reset and newer
// streams invalidate workers that have not yet acquired the Hermes singleton,
// preventing a stale turn from starting after a reset or newer canonical turn.
// (ADR-005 irisy §11 v40)
static IRISY_STREAM_ADMISSION: IrisyStreamAdmission = IrisyStreamAdmission::new();

fn active_prompt_cancel() -> &'static StdMutex<Option<tokio::sync::oneshot::Sender<()>>> {
    static ACTIVE: OnceLock<StdMutex<Option<tokio::sync::oneshot::Sender<()>>>> = OnceLock::new();
    ACTIVE.get_or_init(|| StdMutex::new(None))
}

fn cancel_active_prompt() {
    let mut active = active_prompt_cancel()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some(cancel) = active.take() {
        let _ = cancel.send(());
    }
}

fn register_active_prompt(cancel: tokio::sync::oneshot::Sender<()>) {
    *active_prompt_cancel()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner) = Some(cancel);
}

fn clear_active_prompt() {
    active_prompt_cancel()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
}

/// Reset Irisy's engine session so the NEXT turn starts a FRESH session and
/// re-hydrates from the replayed transcript. Invalidation happens first, then
/// an active ACP request is cancelled and drained before its owner is removed.
/// (ADR-005 irisy §11 v40)
#[tauri::command]
pub async fn irisy_reset_engine() -> Result<(), String> {
    IRISY_STREAM_ADMISSION.issue();
    cancel_active_prompt();
    *crate::shell::acp_client::singleton().lock().await = None;
    Ok(())
}

#[tauri::command]
pub async fn irisy_chat_stream(
    args: IrisyChatStreamArgs,
    kernel: State<'_, KernelHandle>,
    app: AppHandle,
) -> Result<(), String> {
    let registry = kernel.runtime.provider_registry.clone();
    let request_id = args.request_id.clone();
    let app_clone = app.clone();
    // Admission order is fixed before detaching the worker.
    // (ADR-005 irisy §11 v40)
    let admission_generation = IRISY_STREAM_ADMISSION.issue();
    tokio::spawn(async move {
        if let Err(e) = forward_to_provider(
            &app_clone,
            &request_id,
            args,
            registry,
            admission_generation,
        )
        .await
        {
            emit_done(&app_clone, &request_id, Some(e));
        }
    });

    Ok(())
}

/// Load the SKILL.md body for an explicit user-facing skill id through the
/// one hot-scanned registry. A stale or unreadable pin is an execution error,
/// never an implicit switch back to Auto.
/// (ADR-002 substrate §16 v81; ADR-005 irisy §11 v40)
async fn load_skill_system_prompt(skill_id: &str) -> Result<String, String> {
    crate::commands::skills::load_local_skill_by_name(skill_id).await
}

const MAX_CONTEXT_ITEMS: usize = 32;
const MAX_SESSION_ID_BYTES: usize = 256;
const MAX_POLICY_BYTES: usize = 1_024;
const MAX_TASK_BYTES: usize = 65_536;
const MAX_SCOPE_ITEM_BYTES: usize = 128;

/// Validate and serialize the one authoritative turn-context envelope. Resource
/// parsing already happened through `ResourceRef` deserialization, so raw paths
/// and legacy mode/engine flags cannot enter runtime projection.
/// (ADR-005 irisy §11 v40)
fn build_context_system_header(context: &IrisyTurnContext) -> Result<String, String> {
    if context.session_id.trim().is_empty() || context.session_id.len() > MAX_SESSION_ID_BYTES {
        return Err("Irisy context has an invalid session_id".to_string());
    }
    if context.task.trim().is_empty() || context.task.len() > MAX_TASK_BYTES {
        return Err("Irisy context has an invalid task".to_string());
    }
    if context.policy.trim().is_empty() || context.policy.len() > MAX_POLICY_BYTES {
        return Err("Irisy context has an invalid policy".to_string());
    }
    if context.resources.len() > MAX_CONTEXT_ITEMS
        || context.capability_scope.is_empty()
        || context.capability_scope.len() > MAX_CONTEXT_ITEMS
        || context
            .capability_scope
            .iter()
            .any(|item| item.trim().is_empty() || item.len() > MAX_SCOPE_ITEM_BYTES)
    {
        return Err("Irisy context has an invalid resource or capability scope".to_string());
    }
    if context
        .skill_id
        .as_ref()
        .is_some_and(|skill_id| skill_id.trim().is_empty() || skill_id.len() > MAX_SCOPE_ITEM_BYTES)
    {
        return Err("Irisy context has an invalid skill_id".to_string());
    }

    let encoded = serde_json::to_string(context)
        .map_err(|error| format!("failed to encode Irisy context: {error}"))?;
    Ok(format!(
        "You are Irisy, CTRL's single managed AI identity. Treat only the canonical references and authorized capability scope in this envelope as turn context. Resolve Resources and invoke capabilities through CTRL's :17873 gate; never infer a raw local path, another persona, or another runtime owner. Mutations follow the declared policy and ReviewGate.\n<irisy_turn_context>{encoded}</irisy_turn_context>"
    ))
}

/// Pick the EXECUTION path for this turn (ADR-005 irisy §11 v40,
/// §6.2 capabilities). Both paths share the same persona + memory + KB
/// substrate (composeSystemPrompt); this only decides who runs the turn:
///   - hermes agent  -> turns that act on the user's data / files / KB, build a
///     tool, or generate media (they need real tool execution).
///   - provider-direct -> pure-language turns (chat / translate / summarize /
///     explain / identity / capability) — clean + fast, no agent loop.
/// Keyword heuristic on the latest user message, not a model classifier (GOAL
/// non-goal). Verbs alone are ambiguous (drafting an email stays direct), so we
/// anchor on the user's DATA / SYSTEM / MEDIA nouns + clear action phrases.
/// Chinese phrases are Unicode-escaped to keep the source all-English; the
/// trailing comment glosses each in English.
///
/// ADR-005 irisy §8.3 (v7): this no longer GATES the engine — every non-coding
/// turn now routes to the persistent engine regardless. Retained (test-covered)
/// as the documented heuristic should we ever need cheap pre-classification.
#[allow(dead_code)]
fn turn_needs_agent(messages: &[ChatMessage]) -> bool {
    let last = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.to_lowercase())
        .unwrap_or_default();
    const NEEDS: &[&str] = &[
        // English action / data / media phrases
        "note",
        "save to",
        "save it to",
        "my notes",
        "knowledge base",
        "build a tool",
        "make a tool",
        "generate an image",
        "an image of",
        "make a video",
        "voiceover",
        "transcribe",
        "ocr",
        "web search",
        // online-research intents (ADR-005 irisy §3 v5): the
        // web_search tool lives only on the agent path; a research request must
        // reach hermes or the tool-less direct path denies it can go online.
        "search the web",
        "search online",
        "go online",
        "research online",
        "look it up online",
        "browse the web",
        "schedule a",
        "recurring",
        "refactor",
        "edit the file",
        // feature-pack intents (bao 2026-06-25: Irisy installs + uses packs via
        // the gate's mcp_pack_* tools — only hermes holds them, direct has none)
        "feature pack",
        "install a tool",
        "install the tool",
        "use a tool",
        "run an action",
        "run the tool",
        "my portfolio",
        "my holdings",
        "my stocks",
        // market-data intents (ADR-005 irisy §3 v5, 2026-06-26):
        // stock/quote turns read live data via the gate's http.get — only the
        // agent path holds tools; provider-direct has none and would hallucinate.
        "stock",
        "ticker",
        "watchlist",
        "stock price",
        "stock quote",
        "daily review",
        // Chinese phrases (escaped; gloss in comment)
        "\u{7b14}\u{8bb0}",                 // note
        "\u{77e5}\u{8bc6}\u{5e93}",         // knowledge base
        "\u{9020}\u{5de5}\u{5177}",         // build a tool
        "\u{505a}\u{4e2a}\u{5de5}\u{5177}", // make a tool
        "\u{4e00}\u{952e}",                 // one-tap reusable tool
        "\u{751f}\u{6210}\u{56fe}",         // generate image
        "\u{753b}\u{4e00}\u{5f20}",         // draw a picture
        "\u{505a}\u{5f20}\u{56fe}",         // make a picture
        "\u{751f}\u{6210}\u{89c6}\u{9891}", // generate video
        "\u{77ed}\u{89c6}\u{9891}",         // short video
        "\u{914d}\u{97f3}",                 // voiceover
        "\u{8bed}\u{97f3}\u{5408}\u{6210}", // tts
        "\u{8f6c}\u{5199}",                 // transcribe
        "\u{8bc6}\u{522b}\u{56fe}",         // ocr an image
        "\u{63d0}\u{53d6}\u{8868}\u{683c}", // extract a table
        "\u{5b9a}\u{65f6}",                 // schedule
        "\u{6bcf}\u{5929}",                 // every day
        "\u{6bcf}\u{5468}",                 // every week
        "\u{91cd}\u{6784}",                 // refactor
        "\u{6539}\u{4ee3}\u{7801}",         // edit code
        "\u{641c}\u{7b14}\u{8bb0}",         // search notes
        "\u{5b58}\u{5230}",                 // save into
        "\u{8bb0}\u{5230}\u{6211}\u{7684}", // record into my ...
        // §14 query / smart-table operation phrases (ADR-002 substrate §14):
        // these intents must reach hermes, which holds the smart_table.* /
        // notes.query gate tools — the provider-direct path has no tools.
        "smart table",
        "smart-table",
        "kanban",
        "filter by",
        "sort by",
        "group by",
    ];
    NEEDS.iter().any(|k| last.contains(k)) || cjk_query_needles().iter().any(|k| last.contains(k))
}

/// §14 query/table intent needles whose runtime text is Chinese. Built from
/// Unicode code points (hex) rather than `\u{...}` string literals so the
/// source is literally all-English while the matched strings stay identical to
/// what a Chinese user types. Glosses in comments. (ADR-002 substrate §14.)
fn cjk_query_needles() -> Vec<String> {
    const CODEPOINTS: &[&[u32]] = &[
        &[0x67E5, 0x8868],                 // query a table
        &[0x7B5B, 0x9009],                 // filter
        &[0x770B, 0x677F],                 // kanban
        &[0x667A, 0x80FD, 0x8868, 0x683C], // smart table
        &[0x8868, 0x91CC],                 // in the table
        &[0x6392, 0x5E8F],                 // sort
        &[0x5206, 0x7EC4],                 // group
        // market-data intents (ADR-005 irisy §3 v5, 2026-06-26)
        &[0x76EF, 0x76D8], // watch the market
        &[0x9009, 0x80A1], // pick stocks
        &[0x80A1, 0x7968], // stock
        &[0x80A1, 0x4EF7], // stock price
        &[0x884C, 0x60C5], // quote / market data
        &[0x5927, 0x76D8], // the broad market
        &[0x590D, 0x76D8], // daily review / recap
        // feature-pack management intents (ADR-005 irisy §3 v5
        // routing + ADR-002 substrate § composition §7.4 mcp_pack_* tools): only
        // the agent path holds the gate's pack tools (list / install / uninstall
        // / run). Per ADR-005 irisy §3 v5: a user asking about
        // feature packs in plain language must reach hermes, not the tool-less
        // provider-direct path (2026-06-28: a "which feature packs are installed"
        // ask routed direct and the model guessed instead of calling mcp_pack_list).
        &[0x529F, 0x80FD, 0x5305], // feature pack
        &[0x5378, 0x8F7D],         // uninstall
        &[0x5B89, 0x88C5],         // install
        // online-research intents (ADR-005 irisy §3 v5): route
        // "go online / research / search the web" to hermes, which holds the
        // web_search gate tool; the direct path has none and denies it can browse.
        &[0x8054, 0x7F51], // go online (lian-wang)
        &[0x8FDE, 0x7F51], // connect to net (variant)
        &[0x4E0A, 0x7F51], // get online (shang-wang)
        &[0x8C03, 0x7814], // research (diao-yan)
        &[0x641C, 0x7D22], // search (sou-suo)
    ];
    CODEPOINTS
        .iter()
        .map(|cps| {
            cps.iter()
                .filter_map(|&c| char::from_u32(c))
                .collect::<String>()
        })
        .collect()
}

// Provider-direct turns receive only the explicit canonical context tuple; no
// implicit vault search or second runtime identity may augment it.
// (ADR-005 irisy §11 v40)
async fn forward_to_provider(
    app: &AppHandle,
    request_id: &str,
    args: IrisyChatStreamArgs,
    registry: std::sync::Arc<crate::kernel::provider::registry::ProviderRegistry>,
    admission_generation: u64,
) -> Result<(), String> {
    let canonical_session_id = args.context.session_id.clone();
    // The six-field tuple remains authoritative; its resolved capability facts
    // become the immutable gate header for this managed runtime owner.
    // (ADR-002 substrate §15.4 v84; ADR-005 irisy §11 v41)
    let gate_intent = args.context.capability_scope.join(",");
    let mut messages: Vec<ChatMessage> = Vec::new();
    let context_header = build_context_system_header(&args.context)?;
    // Explicit Skill pins resolve through the one local Skill discovery registry
    // and fail closed instead of silently changing Irisy's active context.
    // (ADR-002 substrate §16 v81; ADR-005 irisy §11 v40)
    if let Some(skill_id) = args.context.skill_id.as_deref() {
        let prompt = load_skill_system_prompt(skill_id).await?;
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: prompt,
        });
    }
    messages.push(ChatMessage {
        role: "system".to_string(),
        content: context_header,
    });
    for m in args.messages.into_iter() {
        messages.push(ChatMessage {
            role: m.role,
            content: m.content,
        });
    }

    // The managed runtime is fixed to bundled Hermes. A user-owned CLI is an
    // external :17873 client and cannot reach this owner-selection boundary.
    // The provider router remains an honest fallback only when Hermes is absent
    // or cannot start. (ADR-001 spine §4 v22; ADR-005 irisy §11 v40)
    let engine_ready = crate::shell::agent_installer::is_installed(
        &crate::shell::agent_installer::AgentName::Hermes,
    );
    if engine_ready {
        // Conversation turns (user/assistant, in order) — the engine gets the
        // latest user message each turn, plus prior turns replayed once when a
        // canonical session rehydrates. (ADR-005 irisy §11 v40)
        let turns: Vec<(String, String)> = messages
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| (m.role.clone(), m.content.clone()))
            .collect();
        if turns.iter().any(|(r, _)| r == "user") {
            // Only the fixed Hermes owner receives managed provider projection.
            // (ADR-005 irisy §11 v40)
            let provider_env = registry.agent_env_injection().await;
            let mut guard = crate::shell::acp_client::singleton().lock().await;
            // Admission is rechecked under the owner lock before any start,
            // bind, replay, or prompt. (ADR-005 irisy §11 v40)
            if !IRISY_STREAM_ADMISSION.is_current(admission_generation) {
                return Err("Irisy request was superseded before execution".to_string());
            }
            // Canonical transcript ownership is checked and replaced atomically
            // under the sole managed Irisy runtime lock.
            // (ADR-005 irisy §11 v40)
            let current_owner = guard
                .as_ref()
                .and_then(|client| client.canonical_session_id());
            let scope_changed = guard
                .as_ref()
                .is_some_and(|client| client.gate_intent() != Some(gate_intent.as_str()));
            if crate::shell::acp_client::canonical_session_changed(
                current_owner,
                &canonical_session_id,
            ) || scope_changed
            {
                // A different transcript or live FCT authorization projection
                // cannot reuse primed history or immutable MCP headers.
                // (ADR-002 substrate §15.4 v84; ADR-005 irisy §11 v41)
                *guard = None;
            }
            let ready = if guard.is_none() {
                match crate::shell::acp_client::AcpClient::start_with_intent(
                    &provider_env,
                    Some(&gate_intent),
                )
                .await
                {
                    Ok(client) => {
                        *guard = Some(client);
                        true
                    }
                    Err(error) => {
                        eprintln!("[acp] hermes start failed, using provider router: {error}");
                        false
                    }
                }
            } else {
                true
            };
            if ready {
                // Reset may advance admission while Hermes is starting. Recheck
                // before binding or submitting any prompt.
                // (ADR-005 irisy §11 v40)
                if !IRISY_STREAM_ADMISSION.is_current(admission_generation) {
                    return Err("Irisy request was superseded before execution".to_string());
                }
                let client = guard.as_mut().expect("acp client present");
                client.bind_canonical_session(canonical_session_id.clone());
                let rid = request_id.to_string();
                let app2 = app.clone();
                // Feed the fixed Irisy runtime the canonical context preamble;
                // system messages never create another persona or owner.
                // (ADR-005 irisy §11 v40)
                let system_preamble = messages
                    .iter()
                    .filter(|m| m.role == "system")
                    .map(|m| m.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                // ADR-002 substrate §1.8.6 v75; ADR-005 irisy §8.7 v32 — read
                // any dropped files once per turn (only the LATEST user turn
                // ever carries attachments; replayed prior turns do not).
                // Attachments belong only to this canonical Irisy turn.
                // (ADR-005 irisy §11 v40)
                let attachments =
                    crate::commands::chat_attachment::read_all(args.attachments, "irisy_chat");
                let (cancel_tx, mut cancellation) = tokio::sync::oneshot::channel();
                // Register cancellation before the final admission check so a
                // concurrent reset either signals this request or invalidates it.
                // (ADR-005 irisy §11 v40)
                register_active_prompt(cancel_tx);
                if !IRISY_STREAM_ADMISSION.is_current(admission_generation) {
                    clear_active_prompt();
                    return Err("Irisy request was superseded before execution".to_string());
                }
                let result = client
                    .prompt_cancellable(
                        &turns,
                        Some(&system_preamble),
                        &attachments,
                        move |e: crate::shell::acp_client::AcpEvent| {
                            use crate::shell::acp_client::AcpEvent;
                            match e {
                                // The visible answer — the existing text channel.
                                AcpEvent::Text(t) => {
                                    let _ = app2.emit(
                                        "chat-stream-delta",
                                        StreamDelta {
                                            request_id: rid.clone(),
                                            delta: t,
                                            done: false,
                                            error: None,
                                            custom: None,
                                        },
                                    );
                                }
                                // Reasoning — its own channel so the PWA renders it
                                // as a dim "thinking" trace (never fabricated).
                                AcpEvent::Thought(t) => {
                                    let _ = app2.emit(
                                        "chat-stream-thought",
                                        ThoughtStep {
                                            request_id: rid.clone(),
                                            delta: t,
                                        },
                                    );
                                }
                                // The engine's work — the transparency channel (§8.6).
                                AcpEvent::ToolCall { id, title, input } => {
                                    let _ = app2.emit(
                                        "chat-stream-tool",
                                        ToolStep {
                                            request_id: rid.clone(),
                                            tool_call_id: id,
                                            phase: "call".to_string(),
                                            title,
                                            status: None,
                                            input: Some(input),
                                            output: None,
                                        },
                                    );
                                }
                                AcpEvent::ToolResult { id, status, output } => {
                                    let _ = app2.emit(
                                        "chat-stream-tool",
                                        ToolStep {
                                            request_id: rid.clone(),
                                            tool_call_id: id,
                                            phase: "result".to_string(),
                                            title: String::new(),
                                            status: Some(status),
                                            input: None,
                                            output: Some(output),
                                        },
                                    );
                                }
                            }
                        },
                        &mut cancellation,
                    )
                    .await;
                // The drained terminal response closes this request owner.
                // (ADR-005 irisy §11 v40)
                clear_active_prompt();
                match result {
                    Ok(_) => {
                        drop(guard);
                        emit_done(app, request_id, None);
                        return Ok(());
                    }
                    Err(error) => {
                        // Once a prompt is submitted, provider fallback could
                        // duplicate effects and split Hermes history from the
                        // canonical transcript. Discard the owner and require an
                        // explicit retry instead. (ADR-005 irisy §11 v40)
                        *guard = None;
                        drop(guard);
                        emit_done(
                            app,
                            request_id,
                            Some(format!(
                                "Hermes turn failed after submission; retry explicitly: {error}"
                            )),
                        );
                        return Ok(());
                    }
                }
            }
        }
    }

    let prompt = ChatPrompt {
        system: None,
        messages,
        temperature: args.temperature,
        max_tokens: args.max_tokens,
    };
    // "default" is a wire sentinel for "no preference" — let the adapter
    // fall through to its manifest models[0].
    let model_raw = args.model.unwrap_or_default();
    let model = if model_raw == "default" {
        String::new()
    } else {
        model_raw
    };
    // Ordinary chat preserves the provider's reasoning behavior; only the
    // activation trial requests a direct response.
    // (ADR-002 substrate § provider v69)
    let opts = ChatOpts {
        model,
        deadline_ms: 120_000,
        disable_reasoning: false,
    };

    // Provider-direct is stateless, but its detached submission still obeys
    // the same admission/reset order so a cleared turn cannot start late.
    // (ADR-005 irisy §11 v40)
    let admission_guard = crate::shell::acp_client::singleton().lock().await;
    if !IRISY_STREAM_ADMISSION.is_current(admission_generation) {
        return Err("Irisy request was superseded before execution".to_string());
    }
    let route = route_text_chat(&registry, &Consumer::IrisyPrimary, &prompt, &opts)
        .await
        .map_err(|error| error.to_string());
    drop(admission_guard);
    let (_provider_id, mut rx) = route?;

    while let Some(item) = rx.recv().await {
        if !IRISY_STREAM_ADMISSION.is_current(admission_generation) {
            emit_done(
                app,
                request_id,
                Some("Irisy request was superseded during execution".to_string()),
            );
            return Ok(());
        }
        match item {
            Ok(chunk) => {
                if !chunk.delta.is_empty() {
                    let _ = app.emit(
                        "chat-stream-delta",
                        StreamDelta {
                            request_id: request_id.to_string(),
                            delta: chunk.delta,
                            done: false,
                            error: None,
                            custom: None,
                        },
                    );
                }
                if chunk.finish_reason.is_some() {
                    emit_done(app, request_id, None);
                    return Ok(());
                }
            }
            Err(e) => {
                emit_done(app, request_id, Some(e.to_string()));
                return Ok(());
            }
        }
    }

    // Stream ended without an explicit finish_reason — synthesise done
    // so the PWA loop exits instead of spinning.
    emit_done(app, request_id, None);
    Ok(())
}

fn emit_done(app: &AppHandle, request_id: &str, error: Option<String>) {
    let _ = app.emit(
        "chat-stream-delta",
        StreamDelta {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            error,
            custom: None,
        },
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn reset_rejects_worker_admitted_before_the_next_turn() {
        let admission = std::sync::Arc::new(IrisyStreamAdmission::new());
        let stale_generation = admission.issue();
        let paused = std::sync::Arc::new(tokio::sync::Barrier::new(2));
        let resume = std::sync::Arc::new(tokio::sync::Barrier::new(2));
        let worker_admission = admission.clone();
        let worker_paused = paused.clone();
        let worker_resume = resume.clone();
        let worker = tokio::spawn(async move {
            worker_paused.wait().await;
            worker_resume.wait().await;
            worker_admission.is_current(stale_generation)
        });

        paused.wait().await;
        admission.issue(); // Reset invalidates every pre-reset detached worker.
        let next_generation = admission.issue();
        resume.wait().await;

        // Only the post-reset turn may reach the Hermes owner.
        // (ADR-005 irisy §11 v40)
        assert!(!worker.await.expect("stale worker check"));
        assert!(admission.is_current(next_generation));
    }

    fn user(s: &str) -> Vec<ChatMessage> {
        vec![ChatMessage {
            role: "user".to_string(),
            content: s.to_string(),
        }]
    }

    #[test]
    fn pure_language_turns_stay_direct() {
        assert!(!turn_needs_agent(&user("translate this to english: hello")));
        assert!(!turn_needs_agent(&user("summarize this article for me")));
        assert!(!turn_needs_agent(&user("who are you and what can you do")));
        // Drafting text is pure-language, not a vault action.
        assert!(!turn_needs_agent(&user("write me an email to my boss")));
    }

    // Action and research intents route through the one Hermes-backed Irisy
    // runtime so canonical tools remain the only capability surface.
    // (ADR-005 irisy §11 v40)
    #[test]
    fn action_turns_route_to_agent() {
        assert!(turn_needs_agent(&user("save this to my notes")));
        assert!(turn_needs_agent(&user("generate an image of a cat")));
        assert!(turn_needs_agent(&user("refactor this code")));
        // ADR-005 irisy § persona v5 §3 — action turns route to the agent.
        // The Chinese word for "notes" (U+7B14 U+8BB0) is escaped to keep the
        // source all-English.
        assert!(turn_needs_agent(&user("\u{7b14}\u{8bb0}")));
        // §14: smart-table / query intents must reach hermes (it holds the
        // smart_table.* gate tools; the direct path has none).
        assert!(turn_needs_agent(&user(
            "filter by stage and sort by amount"
        )));
        assert!(turn_needs_agent(&user("show the leads in a kanban board")));
        assert!(turn_needs_agent(&user(
            "query my smart table for won deals"
        )));
        // ADR-005 irisy §3 v5 — market-data turns read live
        // quotes via the gate's http.get; only the agent path holds tools.
        assert!(turn_needs_agent(&user("what's the AAPL stock price today")));
        assert!(turn_needs_agent(&user("track these tickers for me")));
        assert!(turn_needs_agent(&user("add NVDA to my watchlist")));
        // Chinese market-data intents (code-point escaped to keep the source
        // all-English): watch-the-market (U+76EF U+76D8) and pick-stocks
        // (U+9009 U+80A1) — both must reach the agent path for http.get.
        assert!(turn_needs_agent(&user("\u{76EF}\u{76D8}")));
        assert!(turn_needs_agent(&user("\u{5e2e}\u{6211}\u{9009}\u{80A1}")));
        // daily review / recap (U+590D U+76D8) routes to the agent too.
        assert!(turn_needs_agent(&user("\u{4eca}\u{65e5}\u{590D}\u{76D8}")));
        assert!(turn_needs_agent(&user("give me a daily review")));
        // ADR-005 irisy §3 v5 — online-research intents must
        // reach hermes (it holds the web_search gate tool); the direct path has
        // none and would wrongly tell the user it cannot browse the internet.
        assert!(turn_needs_agent(&user(
            "search the web for the latest news"
        )));
        assert!(turn_needs_agent(&user("go online and research this")));
        // Chinese: go-online (U+8054 U+7F51) + research (U+8C03 U+7814) — the
        // exact phrasing that routed direct and got "I can't browse" (2026-06-28).
        assert!(turn_needs_agent(&user(
            "\u{4f60}\u{80fd}\u{8fde}\u{7f51}\u{8c03}\u{7814}\u{4e86}"
        )));
        // Agent-routed turns still use the single canonical Irisy identity.
        // (ADR-005 irisy §11 v40)
        assert!(turn_needs_agent(&user(
            "\u{5e2e}\u{6211}\u{8054}\u{7f51}\u{67e5}\u{4e00}\u{4e0b}"
        )));
    }

    #[test]
    fn empty_or_no_user_message_stays_direct() {
        assert!(!turn_needs_agent(&[]));
        assert!(!turn_needs_agent(&user("")));
    }
}
