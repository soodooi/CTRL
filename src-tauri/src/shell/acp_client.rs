// Kernel ACP client — drives hermes (the assistant brain) over the Agent
// Client Protocol (ADR-002 substrate §1.8). Newline-delimited JSON-RPC 2.0
// on stdio: initialize -> session/new -> session/prompt, streaming the
// agent_message_chunk text back to the caller via an on_delta callback.
//
// Design (§1.8.1 single door):
// - ONE persistent hermes-acp process + ONE ACP session, reused across turns
//   (held in the `singleton()` Mutex). Only the first prompt pays uvx/plugin
//   startup (~7s); later turns are warm.
// - Single-tasked: prompts serialize through the Mutex, and one read loop on
//   the calling task handles notifications + answers agent->client requests
//   inline, so no concurrent reader is needed (mirrors the JS probe).
// - Verified end-to-end by scripts/probes/hermes-acp-probe.mjs (2026-06-17).
//
// MCP-bus passthrough (§1.8.2): `session/new` passes CTRL's :17873 bus as the
// agent's MCP server (build_mcp_servers), so hermes reaches the FULL CTRL tool
// surface — Notes / clipboard / OCR / provider router (fal.ai image/video) /
// downstream MCP servers (via mcp.proxy_*; Obsidian connector retired, ADR-002
// §1.9 v46) / skills — through the single ACP door. This is how
// the functions ACP itself scopes out (messaging/cron) are supplied by CTRL's
// own layers instead of hermes's upgrade-fragile internal protocol.

use agent_client_protocol::schema::v1 as acp_v1;
use anyhow::{anyhow, Context, Result};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU8, Ordering};
// Non-blocking owner-state projection for diagnostics.
// (ADR-005 irisy §8.6.1 v26)
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

/// Per-line read budget — covers uvx cold start + first-token model latency.
const READ_TIMEOUT: Duration = Duration::from_secs(180);
/// Time allowed for ACP to acknowledge a timed-out prompt after `session/cancel`.
/// This is a recovery boundary, not a second prompt latency budget.
const CANCEL_DRAIN_TIMEOUT: Duration = Duration::from_secs(15);

pub struct AcpClient {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    session_id: String,
    next_id: i64,
    /// False after a timed-out turn cannot be drained to its terminal response.
    /// A live process alone is not safe to reuse because its next notification
    /// could otherwise be attributed to a later UI request.
    /// (ADR-005 irisy §8.3 v33)
    reusable: bool,
    /// Whether the CTRL capability preamble has been sent this session (§1.8.2).
    primed: bool,
    /// Which Irisy engine this client drives — `hermes` | `codex` | `claude-code`
    /// (ADR-005 irisy §8.7). All speak ACP; only the spawn command differs. When
    /// the user switches engine the caller resets the singleton so it restarts
    /// with the chosen adapter.
    engine_id: String,
    /// The connected engine's negotiated multi-modal prompt capabilities, read
    /// from `initialize`'s response (ADR-002 substrate §1.8.6 v75). Shared by
    /// every ACP-driven engine (Irisy's selectable engine AND Coding's
    /// opencode) — `prompt()` consults this before ever emitting an `Image` or
    /// `EmbeddedResource` ContentBlock, since sending one the engine did not
    /// advertise is a protocol violation the engine may reject the whole turn
    /// over.
    prompt_caps: PromptCapsSnapshot,
}

/// The connected engine's negotiated multi-modal prompt capabilities
/// (ADR-002 substrate §1.8.6 v75) — read once from `initialize`'s
/// `agentCapabilities.promptCapabilities` and held for the life of the
/// session. `Text` and `ResourceLink` are baseline (every ACP agent MUST
/// accept them per the spec) so they need no capability bit here.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PromptCapsSnapshot {
    pub image: bool,
    pub embedded_context: bool,
}

fn parse_prompt_caps(init: &Value) -> PromptCapsSnapshot {
    let caps = init
        .get("agentCapabilities")
        .and_then(|c| c.get("promptCapabilities"));
    PromptCapsSnapshot {
        image: caps
            .and_then(|c| c.get("image"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        embedded_context: caps
            .and_then(|c| c.get("embeddedContext"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
    }
}

/// One dropped/attached file, ready to become an ACP `ContentBlock`
/// (ADR-002 substrate §1.8.6 v75). The caller (e.g. `coding_chat.rs`) reads
/// the file and classifies it into ONE of these three shapes; `AcpClient`
/// decides, per the connected engine's negotiated capabilities, whether it
/// becomes an inline `Image`/`EmbeddedResource` block or degrades to a text
/// notice.
#[derive(Debug, Clone)]
pub enum AttachmentContent {
    /// Plain UTF-8 text (e.g. a dropped `.md`/`.txt`/`.json` file) — becomes
    /// an `EmbeddedResource` `TextResourceContents` when the engine supports
    /// `embeddedContext`.
    Text(String),
    /// Base64-encoded image bytes (e.g. a dropped `.png`/`.jpg`) — becomes an
    /// `Image` ContentBlock when the engine supports `image`.
    ImageBase64(String),
    /// Base64-encoded arbitrary binary (e.g. a dropped `.pdf`) — becomes an
    /// `EmbeddedResource` `BlobResourceContents` when the engine supports
    /// `embeddedContext`.
    BlobBase64(String),
}

#[derive(Debug, Clone)]
pub struct Attachment {
    /// Display name (e.g. the original filename) — surfaced in the
    /// unsupported-capability text notice and as the embedded resource's URI.
    pub name: String,
    pub mime_type: String,
    pub content: AttachmentContent,
}

/// Base64-length ceiling for an inlined image (ADR-002 §1.8.6 v75), applied
/// AFTER any client-side downscale — a hard backstop against an oversized
/// single stdio JSON-RPC line (§1.8.1 has no multipart framing to absorb an
/// unbounded attachment). Matches the general chat-attachment industry
/// ceiling of a few MB raw (base64 inflates size ~4/3) rather than inventing
/// a bespoke number.
const MAX_IMAGE_BASE64_CHARS: usize = 8_000_000;
/// Character ceiling for an inlined text resource; beyond this we truncate
/// with an explicit notice rather than silently cutting content or letting
/// the stdio line balloon unbounded.
const MAX_TEXT_RESOURCE_CHARS: usize = 100_000;

/// Build the ContentBlocks for one turn: the text prompt plus any attachment
/// that the connected engine's negotiated capabilities actually admit
/// (ADR-002 substrate §1.8.6 v75). An attachment whose required capability is
/// NOT advertised degrades to a plain text notice — never a silent drop and
/// never an attempt to send a block type the engine didn't opt into (which it
/// may reject the whole turn over).
fn build_prompt_blocks(
    text: &str,
    attachments: &[Attachment],
    caps: PromptCapsSnapshot,
) -> Vec<Value> {
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    for att in attachments {
        let unsupported_notice = || {
            json!({
                "type": "text",
                "text": format!(
                    "[User attached '{}' ({}) but the connected engine does not accept inline attachments of this kind.]",
                    att.name, att.mime_type
                )
            })
        };
        let block = match &att.content {
            AttachmentContent::ImageBase64(base64) => {
                if !caps.image {
                    unsupported_notice()
                } else if base64.len() > MAX_IMAGE_BASE64_CHARS {
                    json!({
                        "type": "text",
                        "text": format!(
                            "[User attached image '{}' but it exceeds the inline size limit and was not sent.]",
                            att.name
                        )
                    })
                } else {
                    json!({ "type": "image", "data": base64, "mimeType": att.mime_type })
                }
            }
            AttachmentContent::Text(text) => {
                if !caps.embedded_context {
                    unsupported_notice()
                } else {
                    let (body, truncated) = if text.chars().count() > MAX_TEXT_RESOURCE_CHARS {
                        (
                            text.chars()
                                .take(MAX_TEXT_RESOURCE_CHARS)
                                .collect::<String>(),
                            true,
                        )
                    } else {
                        (text.clone(), false)
                    };
                    let body = if truncated {
                        format!("{body}\n\n[...truncated, file exceeds the inline size limit...]")
                    } else {
                        body
                    };
                    json!({
                        "type": "resource",
                        "resource": { "uri": att.name.clone(), "text": body, "mimeType": att.mime_type }
                    })
                }
            }
            AttachmentContent::BlobBase64(base64) => {
                if !caps.embedded_context {
                    unsupported_notice()
                } else if base64.len() > MAX_IMAGE_BASE64_CHARS {
                    json!({
                        "type": "text",
                        "text": format!(
                            "[User attached '{}' but it exceeds the inline size limit and was not sent.]",
                            att.name
                        )
                    })
                } else {
                    json!({
                        "type": "resource",
                        "resource": { "uri": att.name.clone(), "blob": base64, "mimeType": att.mime_type }
                    })
                }
            }
        };
        blocks.push(block);
    }
    blocks
}

/// Structured streaming events from the ACP engine (ADR-005 §8.6 transparency).
/// The read loop maps each `session/update` sub-type to one of these so the
/// caller can surface the engine's WORK — its reasoning and each tool call /
/// result — instead of only the final answer text (§6 transparency by drill-down).
/// Owned strings: tool events are rare and text deltas are small, so the alloc
/// per event is negligible and it keeps the callback free of lifetimes.
pub enum AcpEvent {
    /// `agent_message_chunk` — a chunk of the visible answer.
    Text(String),
    /// `agent_thought_chunk` — a chunk of the engine's reasoning.
    Thought(String),
    /// `tool_call` — the engine started a tool. `input` = compact JSON of rawInput.
    ToolCall {
        id: String,
        title: String,
        input: String,
    },
    /// `tool_call_update` — a tool finished (or changed status). `output` = its
    /// result text; `status` = e.g. `completed` / `failed` / `in_progress`.
    ToolResult {
        id: String,
        status: String,
        output: String,
    },
}

/// Plain text of an ACP `ContentBlock` (only the `text` variant carries text).
fn block_text(b: &acp_v1::ContentBlock) -> String {
    match b {
        acp_v1::ContentBlock::Text(t) => t.text.clone(),
        _ => String::new(),
    }
}

/// Concatenated text of a tool call's `content` items (skips diff/terminal).
fn tool_content_text(items: &[acp_v1::ToolCallContent]) -> String {
    let mut out = String::new();
    for it in items {
        if let acp_v1::ToolCallContent::Content(c) = it {
            out.push_str(&block_text(&c.content));
        }
    }
    out
}

/// The ACP status string (`completed` / `failed` / …) via serde, future-proof to
/// new variants — no hand-maintained match.
fn status_str(s: &acp_v1::ToolCallStatus) -> String {
    serde_json::to_value(s)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}

/// Map one ACP `session/update` payload to an `AcpEvent`, or `None` for update
/// kinds we don't surface yet (usage / available_commands / plan / mode).
///
/// ADR-005 §8.6.2 (v15): deserialize into the maintained `agent-client-protocol`
/// (Apache-2.0) `SessionUpdate` type instead of hand-poking JSON — the crate owns
/// the wire schema, so new fields / variants ride along and `#[non_exhaustive]`
/// keeps us forward-compatible.
fn parse_session_update(u: &Value) -> Option<AcpEvent> {
    let update: acp_v1::SessionUpdate = serde_json::from_value(u.clone()).ok()?;
    match update {
        acp_v1::SessionUpdate::AgentMessageChunk(cc) => {
            let t = block_text(&cc.content);
            (!t.is_empty()).then_some(AcpEvent::Text(t))
        }
        acp_v1::SessionUpdate::AgentThoughtChunk(cc) => {
            let t = block_text(&cc.content);
            (!t.is_empty()).then_some(AcpEvent::Thought(t))
        }
        acp_v1::SessionUpdate::ToolCall(tc) => {
            let input = match tc.raw_input {
                Some(v) if !v.is_null() => serde_json::to_string(&v).unwrap_or_default(),
                _ => tool_content_text(&tc.content),
            };
            Some(AcpEvent::ToolCall {
                id: tc.tool_call_id.0.to_string(),
                title: tc.title,
                input,
            })
        }
        acp_v1::SessionUpdate::ToolCallUpdate(tcu) => {
            let status = tcu
                .fields
                .status
                .as_ref()
                .map(status_str)
                .unwrap_or_default();
            let output = tcu
                .fields
                .content
                .as_deref()
                .map(tool_content_text)
                .unwrap_or_default();
            Some(AcpEvent::ToolResult {
                id: tcu.tool_call_id.0.to_string(),
                status,
                output,
            })
        }
        _ => None,
    }
}

/// One-time capability brief prepended to the first turn so hermes KNOWS it can
/// drive CTRL's tools (the user's notes vault is reachable via the `ctrl` MCP
/// server passed in session/new; ADR-002 §1.9 v46 — notes are CTRL-native)
/// instead of answering from its own memory (ADR-002 substrate §1.8.2 v23).
/// Concise so it doesn't fight SOUL.md.
const CTRL_CAPABILITY_BRIEF: &str = "\
[CTRL context — you are Irisy, the user's personal assistant inside CTRL. Your \
CAPABILITIES ARE THE `ctrl` TOOLS connected to you (already wired): that ctrl \
tool list is the single source of truth for what you can do, and it is your \
PRIMARY toolset — prefer it over any built-in. Your VISIBLE ctrl tools are the \
common set, but the gate has ~100 tools total; the rest are one search away. \
When you need a capability that is not in your visible tools — editing a note \
surgically, AI table columns, connectors (REST/calendar), scaffolding / \
validating / publishing a feature pack, or calling an installed MCP — call \
`gate_tool_search(\"keywords\")` to find the tool (name + schema), then \
`gate_tool_call(name, args)` to run it. NEVER tell the user you cannot do \
something before searching the full tool surface this way. Through ctrl you reach the user's \
OWN notes vault (the vault tools already point at the library the user configured), their structured tables, \
live market data, web search, and building new feature packs — their real data \
and work, on their machine. Built-in tools are a secondary aid (e.g. image \
generation, browsing) — use them only when the ctrl tools lack a capability, and \
never present them as your main repertoire. When asked what you can do, lead \
with what the ctrl tools give you (the user's notes, tables, market data, web \
search, building feature packs) — not a long list of built-ins — and never \
claim a capability the ctrl tools don't provide. When the user asks about their \
notes or knowledge, USE the vault tools — do not answer from memory alone. \
PROJECT COMPANION: the user's projects live under projects/<name>/ in the \
vault; CTRL itself is the FIRST companion project (projects/ctrl/vault = its \
strategy docs, projects/ctrl/decisions = its ADRs) — when asked about the CTRL \
project, its architecture or decisions, READ those files, never answer from \
memory. For note edits prefer the surgical tools over whole-file writes: \
note_map first (see real headings/frontmatter keys), then doc_produce \
(append/replace/delete_section by heading; set/delete_frontmatter_key). \
note_get reads a note WITH its links/backlinks in one call; note_periodic \
resolves today's daily / weekly / monthly note; note_recent_changes = what \
changed lately; note_history / note_diff / vault_pulse show WHO (user vs \
agents) changed what — cite them when asked what happened in the vault. \
STRUCTURED DATA: the user's tables are multi-sheet BASES (like a Bitable) — one \
base holds several LINKED data-tables. When the user describes a whole connected \
dataset (a CRM, a project tracker, an inventory), build it in ONE shot with \
smart_table_base_scaffold(base_name, tables[{name, fields[{key,label,type, \
options?, link_to?, display?}]}]): set a field's link_to=<another table's name> \
to wire a REFERENCE (relation) between tables — do NOT create tables one-by-one \
for a connected base. For a single standalone table use smart_table_create; to \
edit an existing table's cells/rows/fields use smart_table_produce; seed rows \
with smart_table_append_row / batch_append_rows. \
For live market data use the market/stock tools on the gate (market_quote / \
market_screen for global tickers; a stocks feature pack adds richer domain \
tools when installed) — use them, never invent a quote or statistic. \
WHEN A SKILL MATCHES THE TASK, skill_read it and FOLLOW it BEFORE you answer — \
do not work from memory when a playbook exists. In particular, for any A-share \
buy/sell analysis / \u{9009}\u{80A1} / \u{6B62}\u{635F} / \u{76EF}\u{76D8} \
request, FIRST call skill_list then skill_read the matching skill (e.g. \
stock-analysis-cn) and follow its data recipes: it carries the live-data \
recipes (EastMoney kline / realtime / fund-flow) that the plain quote tool \
lacks. NEVER state a price, P/E, revenue, fund-flow, moving average or any \
market or fundamental number from memory — pull it live per the skill; if you \
genuinely cannot pull a figure, say so rather than recalling one. Domain \
playbooks (watchlist conventions, daily-review recipes) live in the relevant \
feature pack's knowledge base as skills — load them ON DEMAND via skill_list / \
skill_read when the task matches, not from this brief. \
USING AN INSTALLED CONNECTOR PACK (a self-hosted app the user runs, e.g. \
Ghostfolio — NOT one you create): its data is a record source reached \
through the GENERIC gate tools source_describe / source_query / source_produce \
with source_id=<pack-id> (e.g. source_query with source_id=\"ctrl-ghostfolio\"). \
There are NO tools named after the product, so NEVER search for a 'ghostfolio' \
tool, find none, and tell the user it can't be done — call source_describe with \
the pack id FIRST. 'Installed' means only the CONNECTOR is present; the app \
itself may not be RUNNING. When source_query returns 'not configured', that does \
NOT mean you need a URL or token from the user — it means SET IT UP FIRST: call \
mcp_pack_provision with mcp_id=<pack-id> (the 'Set up' button), which brings the \
app up in Docker AND auto-authenticates, one click, no manual URL or token. So \
when the user asks whether you can use such a pack, offer to Set it up; never \
demand an instance URL or API token — that manual path is only a last-resort \
fallback for an instance they already run themselves. LibreOffice is different \
under the Companion contract (ADR-005 irisy §10 v35): call source_describe first \
with source_id=\"ctrl-libreoffice\" and, if the source is unavailable, relay its \
manifest-owned unavailable_message exactly. \
NEVER request or suggest a bridge URL, bridge token, environment variable, or \
manual credential setup for LibreOffice. \
You also have web_search(query) for facts / news / research you don't already \
hold — call it instead of guessing. It uses any BYOK keyed provider you have \
configured (Tavily / Brave / Serper / Exa) and otherwise a keyless full-web \
fallback (DuckDuckGo, then Wikipedia) — so YES, you CAN search the live web; \
never tell the user you cannot, and never call your research 'simulated'. When \
research is done, ANSWER IN THE CHAT BY DEFAULT. Ordinary questions and short \
findings stay conversational — do NOT produce an HTML file for them, and do NOT \
turn every research turn into a document. Build an HTML artifact ONLY when it \
clearly earns one: the user asks for a document / report / deck / dashboard / \
slides / something visual or saveable, OR the findings are substantial enough \
that the user will want to keep, scan, or revisit them (a multi-source report, a \
comparison, a structured guide). Never make the user name a format or repeat \
'presentation' to control this — infer it from the request and the result. When \
you DO build one, write it to the vault (Research/<topic>.html) and leave only a \
one-line pointer in the chat (it opens in the workspace — good-looking, \
editable, auto-saved; the dialog stays for conversation). Pick the skill by need \
(skill_list / skill_read; ADR-002 substrate § 7.4 v34): render-html for a simple report / long-page (static \
inline CSS) is the lighter default; frontend-slides-editable is ONLY for an \
actual slide deck or visual dashboard the user wants to present, never for plain \
findings. Either way the document must be FULLY self-contained — never load from \
a CDN, never inline a secret. \
FEATURE-PACK CREATION: when the user asks for a reusable tool, connector, data \
tracker, shortcut, or pack, first call skill_list with query \
\"create feature pack\", then skill_read the returned create-feature-pack SKILL.md and FOLLOW it as the \
active authoring authority. The release-owned CTRL copy is the governed baseline; \
a same-name user skill is an explicit local override and therefore wins discovery. \
Keep every lifecycle operation on the :17873 gate, keep secrets out of manifests/chat/logs, \
never use a networked shell action, and claim creation only from a real installed-capability smoke. \
Publish only when the user explicitly asks to share. The skill owns the lifecycle \
and pack-form details; do not reproduce or improvise them here. \
(ADR-002 substrate § 7.4 v34; ADR-005 irisy §9 v25) \
Your long-term memory is the user's SOUL.md (ADR-005 irisy v5 §6.3): read it and \
persist durable facts THERE via the ctrl soul/memory tools, not in your own \
private store, so the chat and agent paths share one memory and never drift. \
REVIEW GATE (ADR-002 §264): high-blast writes you make (creating/updating/deleting \
notes, tables, rows, fields; sending; publishing; installing packs) pause for the \
user's one-tap approval — this is normal and by design (their data sovereignty). \
Proceed to the write as usual; if a call comes back denied, the user declined it \
— acknowledge and adjust, do not silently retry the same write.]";

/// Process-wide persistent client. `None` until the first turn starts it;
/// reset to `None` on any error so the next turn restarts cleanly.
pub fn singleton() -> &'static Mutex<Option<AcpClient>> {
    static ACP: OnceLock<Mutex<Option<AcpClient>>> = OnceLock::new();
    ACP.get_or_init(|| Mutex::new(None))
}

/// A SECOND, independent persistent client for the Coding module's `opencode`
/// engine (ADR-001 spine §4 v16). Deliberately separate from `singleton()` — that
/// one is Irisy's right-region engine (hermes/codex/claude-code) rooted at the
/// vault; this one is the Coding scene's engine rooted at whichever workspace
/// the user selected. The two must never share a slot: switching Irisy's
/// engine must not kill a live Coding session and vice versa.
pub fn coding_singleton() -> &'static Mutex<Option<AcpClient>> {
    static ACP: OnceLock<Mutex<Option<AcpClient>>> = OnceLock::new();
    ACP.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AcpDiagnosticsState {
    Idle = 0,
    Starting = 1,
    Busy = 2,
    Ready = 3,
    Failed = 4,
}

static ACP_DIAGNOSTICS_STATE: AtomicU8 = AtomicU8::new(AcpDiagnosticsState::Idle as u8);

fn set_diagnostics_state(state: AcpDiagnosticsState) {
    ACP_DIAGNOSTICS_STATE.store(state as u8, Ordering::Release);
}

fn current_diagnostics_state() -> AcpDiagnosticsState {
    match ACP_DIAGNOSTICS_STATE.load(Ordering::Acquire) {
        1 => AcpDiagnosticsState::Starting,
        2 => AcpDiagnosticsState::Busy,
        3 => AcpDiagnosticsState::Ready,
        4 => AcpDiagnosticsState::Failed,
        _ => AcpDiagnosticsState::Idle,
    }
}

struct AcpStartupDiagnostics {
    engine: String,
    started: std::time::Instant,
    completed: bool,
}

impl Drop for AcpStartupDiagnostics {
    fn drop(&mut self) {
        if self.completed {
            return;
        }
        set_diagnostics_state(AcpDiagnosticsState::Failed);
        crate::kernel::diagnostics::record(crate::kernel::diagnostics::RecordEvent {
            module: crate::kernel::diagnostics::DiagnosticsModule::Irisy,
            session_id: None,
            correlation_id: None,
            kind: "acp_lifecycle",
            phase: "startup",
            severity: "error",
            outcome: "failed",
            duration_ms: Some(self.started.elapsed().as_millis() as u64),
            capture_only: false,
            attributes: serde_json::json!({ "engine": self.engine.as_str() }),
        });
    }
}

#[derive(Debug, Clone)]
pub struct AcpDiagnosticsSnapshot {
    pub state: AcpDiagnosticsState,
    pub engine: Option<String>,
}

/// Observe the live ACP singleton without starting it or waiting behind a turn.
/// Owner activity is projected atomically while its lock is held, so a healthy
/// active turn remains distinguishable from startup or failure. No prompt,
/// thought, tool payload, or process path crosses this boundary.
/// (ADR-005 irisy §8.6.1 v26)
pub fn diagnostics_snapshot() -> AcpDiagnosticsSnapshot {
    let Ok(mut guard) = singleton().try_lock() else {
        return AcpDiagnosticsSnapshot {
            state: current_diagnostics_state(),
            engine: None,
        };
    };
    let Some(client) = guard.as_mut() else {
        set_diagnostics_state(AcpDiagnosticsState::Idle);
        return AcpDiagnosticsSnapshot {
            state: AcpDiagnosticsState::Idle,
            engine: None,
        };
    };
    let engine = Some(client.engine_id.clone());
    let state = if client.is_alive() {
        let state = current_diagnostics_state();
        if matches!(
            state,
            AcpDiagnosticsState::Idle | AcpDiagnosticsState::Failed
        ) {
            set_diagnostics_state(AcpDiagnosticsState::Ready);
            AcpDiagnosticsState::Ready
        } else {
            state
        }
    } else {
        set_diagnostics_state(AcpDiagnosticsState::Failed);
        AcpDiagnosticsState::Failed
    };
    AcpDiagnosticsSnapshot { state, engine }
}

/// Best-effort kill of the persistent hermes-acp process at app shutdown
/// (RunEvent::ExitRequested with an explicit code). try_lock so a turn in
/// flight never blocks exit; the OS reclaims the child either way.
pub fn shutdown() {
    if let Ok(mut g) = singleton().try_lock() {
        if let Some(mut c) = g.take() {
            let _ = c.child.start_kill();
            // Shutdown updates only ACP-owned lifecycle metadata.
            // (ADR-005 irisy §8.6.1 v26)
            set_diagnostics_state(AcpDiagnosticsState::Idle);
        }
    }
    if let Ok(mut g) = coding_singleton().try_lock() {
        if let Some(mut c) = g.take() {
            let _ = c.child.start_kill();
        }
    }
}

fn notes_dir() -> Result<PathBuf> {
    // hermes's cwd = the user's REAL configured vault, NOT a hardcoded Notes dir
    // (bao 2026-06-29: pkm is the single default knowledge base — there is no
    // separate notes store; feature-pack-specific docs live in their own project
    // dir). Follow `configured_vault_root` so the engine's working directory never
    // drifts from where the vault tools actually read/write (root-fix for "Irisy
    // organized the wrong library").
    let p = crate::kernel::vault::configured_vault_root()
        .or_else(crate::kernel::vault::default_vault_root)
        .ok_or_else(|| anyhow!("vault root"))?;
    std::fs::create_dir_all(&p).context("create vault dir")?;
    Ok(p)
}

/// Irisy's engine soul, owned by CTRL (ADR-005 §9.5). hermes reads ~/.hermes/SOUL.md
/// as its persona every turn; that file was an ORPHAN runtime copy no code owned,
/// so it silently kept a stale "co-pilot" persona while the real soul lived
/// elsewhere. This seed is the single owner of the engine identity.
const HERMES_SOUL: &str = include_str!("hermes-soul.md");

/// Re-pin ~/.hermes/SOUL.md from the repo seed before every hermes launch
/// (ADR-005 §9.5 — close the orphan-soul drain). CTRL owns the engine IDENTITY;
/// the user's learned memory lives in hermes's own MEMORY.md / the vault, not in
/// this file, so overwriting identity is safe. Idempotent: only writes when the
/// content differs, to avoid needless IO / mtime churn.
fn ensure_hermes_soul() {
    let Some(base) = directories::BaseDirs::new() else {
        return;
    };
    let soul = base.home_dir().join(".hermes").join("SOUL.md");
    if std::fs::read_to_string(&soul).ok().as_deref() == Some(HERMES_SOUL) {
        return;
    }
    if let Some(dir) = soul.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(&soul, HERMES_SOUL);
}

/// MCP-bus passthrough (ADR-001 spine §4 v21; ADR-010 communication
/// § trust-domains v11): expose CTRL's governed kernel MCP server to an ACP
/// owner with an explicit caller and optional capability intent. Assistant and
/// Coding share transport only; their gate projections remain distinct.
fn build_mcp_servers(caller: &str, intent: Option<&str>) -> Vec<Value> {
    let token = match std::env::var("CTRL_KERNEL_MCP_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => return Vec::new(),
    };
    let port = std::env::var("CTRL_KERNEL_MCP_PORT").unwrap_or_else(|_| "17873".to_string());
    let mut headers = vec![
        json!({ "name": "Authorization", "value": format!("Bearer {token}") }),
        json!({ "name": "x-ctrl-caller", "value": caller }),
    ];
    if let Some(intent) = intent.filter(|value| !value.is_empty()) {
        headers.push(json!({ "name": "x-ctrl-intent", "value": intent }));
    }
    vec![json!({
        "type": "http",
        "name": "ctrl",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": headers
    })]
}

/// Pick an "allow" outcome for an ACP `session/request_permission` request by
/// scanning the offered `options` (ADR-002 substrate §1.8 v23 — single door):
/// prefer `allow_once`, then `allow_always`, then any non-`reject` option;
/// cancel only when no allow option is offered. Without this the client
/// cancelled every tool permission, so hermes could never execute a tool call —
/// notes were never saved, searches never ran (P-1/P-3/P-4). The :17873 gate is
/// the real permission/audit layer; this ACP prompt is hermes-side, approved
/// headlessly so the agent loop can actually do work.
fn select_allow_outcome(req: &Value) -> Value {
    let cancelled = json!({ "outcome": { "outcome": "cancelled" } });
    let Some(options) = req
        .get("params")
        .and_then(|p| p.get("options"))
        .and_then(|o| o.as_array())
    else {
        return cancelled;
    };
    let kind_of = |o: &Value| {
        o.get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string()
    };
    let pick = options
        .iter()
        .find(|o| kind_of(o) == "allow_once")
        .or_else(|| options.iter().find(|o| kind_of(o) == "allow_always"))
        .or_else(|| options.iter().find(|o| !kind_of(o).starts_with("reject")));
    match pick
        .and_then(|o| o.get("optionId"))
        .and_then(|i| i.as_str())
    {
        Some(option_id) => {
            json!({ "outcome": { "outcome": "selected", "optionId": option_id } })
        }
        None => cancelled,
    }
}

/// Build the spawn argv for an Irisy engine (ADR-005 irisy §8.7). All engines
/// speak ACP; only the launch command differs. hermes is the bundled default
/// (uvx, with the Python pin + `--with mcp` the adapter needs); Codex and
/// Claude Code are driven via their npm-distributed ACP adapters (npx fetches
/// on first use), which wrap the user's OWN installed CLI — the UI only offers
/// a BYO engine once `list_byo_drivers` has detected it. `opencode` (the Coding
/// module's engine, ADR-001 spine §4 v16) speaks ACP NATIVELY via its own `acp`
/// subcommand — verified directly against the user's installed binary
/// (`opencode acp` completes `initialize` -> `session/new` ->
/// `session/prompt`, streaming `agent_thought_chunk` / `agent_message_chunk`
/// exactly like hermes/codex/claude-code) — so it needs no wrapper adapter.
fn engine_argv(engine: &str) -> Result<Vec<String>> {
    use crate::shell::agent_installer::{
        read_manifest, AgentName, HERMES_MCP_SPEC, HERMES_PYTHON,
    };
    match engine {
        "" | "hermes" => {
            let manifest =
                read_manifest(&AgentName::Hermes).ok_or_else(|| anyhow!("hermes not installed"))?;
            let mut argv = manifest.entry_cmd.clone();
            if argv.is_empty() {
                return Err(anyhow!("hermes manifest.entry_cmd empty"));
            }
            // Stale manifests lack the Python pin hermes-agent[acp] needs (>=3.11);
            // inject it so uvx fetches a managed CPython (see agent_installer).
            if argv[0].ends_with("uvx") && !argv.iter().any(|a| a == "--python") {
                argv.splice(1..1, ["--python".to_string(), HERMES_PYTHON.to_string()]);
            }
            // CRITICAL: `hermes-agent[acp]` does NOT depend on the `mcp` package.
            // Normalize stale manifests as well as inject missing dependencies:
            // Hermes 0.18 checks `streamablehttp_client`, which MCP 2.x removed,
            // and otherwise silently registers zero CTRL tools.
            // (ADR-002 substrate §1.8 v23)
            let mcp_spec_index = argv.windows(2).position(|w| {
                w[0] == "--with"
                    && (w[1] == "mcp"
                        || w[1].starts_with("mcp<")
                        || w[1].starts_with("mcp>")
                        || w[1].starts_with("mcp="))
            });
            if let Some(index) = mcp_spec_index {
                argv[index + 1] = HERMES_MCP_SPEC.to_string();
            } else if argv[0].ends_with("uvx") {
                argv.splice(
                    1..1,
                    ["--with".to_string(), HERMES_MCP_SPEC.to_string()],
                );
            }
            Ok(argv)
        }
        // npm-distributed ACP adapters wrapping the user's own CLI (verified on a
        // real machine 2026-06-29): codex moved to `@agentclientprotocol/codex-acp`
        // (the old `@zed-industries/codex-acp` is DEPRECATED and answers nothing on
        // stdio → silent hang); claude-code is still `@zed-industries/claude-code-acp`.
        "codex" => Ok(vec![
            "npx".to_string(),
            "-y".to_string(),
            "@agentclientprotocol/codex-acp".to_string(),
        ]),
        "claude-code" => Ok(vec![
            "npx".to_string(),
            "-y".to_string(),
            "@zed-industries/claude-code-acp".to_string(),
        ]),
        // ADR-001 spine §4 v16: opencode speaks ACP natively via its own
        // `acp` subcommand — no wrapper adapter needed.
        "opencode" => Ok(vec!["opencode".to_string(), "acp".to_string()]),
        other => Err(anyhow!("unknown Irisy engine: {other}")),
    }
}

/// Resolve the actual CLI binary a BYO ACP adapter wraps (ADR-005 §8.8): CTRL's
/// one-click managed install (~/.ctrl/agents/<id>/node_modules/.bin/<bin>) first,
/// else the user's own on PATH. None when neither exists — the adapter then falls
/// back to its own discovery. This is what lets codex-acp find the codex CTRL
/// installed instead of hanging.
fn resolve_engine_binary(engine: &str) -> Option<PathBuf> {
    use crate::shell::agent_installer::{agent_dir, AgentName};
    let agent = match engine {
        "codex" => AgentName::Codex,
        "claude-code" => AgentName::ClaudeCode,
        // opencode is always the user's own PATH install (never CTRL-managed —
        // it is the Coding module's BYO-CLI, ADR-001 §4), so it never has a
        // ~/.ctrl/agents/<id> dir to check first.
        _ => return None,
    };
    if let Ok(dir) = agent_dir(&agent) {
        let p = dir.join("node_modules").join(".bin").join(agent.bin_name());
        if p.exists() {
            return Some(p);
        }
    }
    crate::kernel::provider::path_resolver::resolve_binary_path(agent.bin_name())
}

// Keep response identity and cancellation framing separate from request dispatch so
// the original prompt remains the only stream owner through its terminal response.
// (ADR-005 irisy §8.3 v33)
fn parse_json_rpc_line(line: &str) -> Option<Value> {
    let line = line.trim();
    line.starts_with('{')
        .then(|| serde_json::from_str(line).ok())
        .flatten()
}

fn is_response_for(message: &Value, id: i64) -> bool {
    message.get("id").and_then(|value| value.as_i64()) == Some(id)
        && (message.get("result").is_some() || message.get("error").is_some())
}

fn cancel_notification(session_id: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "session/cancel",
        "params": { "sessionId": session_id }
    })
}

impl AcpClient {
    /// Spawn the selected ACP engine, handshake (initialize), and open one ACP
    /// session. `engine` = `hermes` (default) | `codex` | `claude-code`
    /// (ADR-005 irisy §8.7). `provider_env` is the BYOK credential the engine
    /// should use (ADR-002 §1.3): for hermes the active Irisy provider (also
    /// mirrored into ~/.hermes/.env); for a BYO engine its canonical key
    /// (OPENAI_API_KEY / ANTHROPIC_API_KEY, via byo_engine_auth_env) — injected
    /// into the adapter subprocess env below so Codex / Claude reuse the key the
    /// user already configured in CTRL instead of a second sign-in (§8.8).
    pub async fn start(engine: &str, provider_env: &BTreeMap<String, String>) -> Result<Self> {
        Self::start_in_scoped(engine, provider_env, None, "hermes", None).await
    }

    /// Start an ACP owner with an explicit gate projection. Runtime/session
    /// ownership and capability visibility remain actor-specific even though
    /// all owners use the same ACP transport and :17873 gate.
    /// (ADR-001 spine §4 v21; ADR-005 irisy §11 v38)
    pub async fn start_in_scoped(
        engine: &str,
        provider_env: &BTreeMap<String, String>,
        cwd_override: Option<&std::path::Path>,
        gate_caller: &str,
        gate_intent: Option<&str>,
    ) -> Result<Self> {
        let engine = if engine.is_empty() { "hermes" } else { engine };
        set_diagnostics_state(AcpDiagnosticsState::Starting);
        let mut startup_diagnostics = AcpStartupDiagnostics {
            engine: engine.to_string(),
            started: std::time::Instant::now(),
            completed: false,
        };
        crate::kernel::diagnostics::record(crate::kernel::diagnostics::RecordEvent {
            module: crate::kernel::diagnostics::DiagnosticsModule::Irisy,
            session_id: None,
            correlation_id: None,
            kind: "acp_lifecycle",
            phase: "startup",
            severity: "info",
            outcome: "starting",
            duration_ms: None,
            capture_only: false,
            attributes: serde_json::json!({ "engine": engine }),
        });
        let argv = engine_argv(engine)?;

        // Provider projection is synchronized by ProviderRegistry under its
        // mutation lock before this launch. ACP owns only the Hermes soul here.
        // (ADR-002 substrate § provider v71)
        if engine == "hermes" {
            ensure_hermes_soul();
        }

        let cwd = match cwd_override {
            Some(p) => p.to_path_buf(),
            None => notes_dir()?,
        };
        let mut cmd = Command::new(&argv[0]);
        cmd.args(&argv[1..]);
        for (k, v) in provider_env {
            cmd.env(k, v);
        }
        cmd.current_dir(&cwd);
        // BYO engines launch via npx and WRAP the user's own CLI binary. CTRL's
        // one-click install lands codex/claude under ~/.ctrl/agents (NOT on PATH),
        // so without this the adapter can't find the binary and hangs (ADR-005
        // §8.8 — the pending PATH-wiring item). Make discoverable: (a) the Node
        // runtime so `npx` resolves even where CTRL bootstrapped Node; (b) the
        // wrapped binary's dir on PATH; (c) for codex, CODEX_PATH points straight
        // at it (codex-acp honors it).
        if engine == "codex" || engine == "claude-code" {
            let mut extra: Vec<String> = Vec::new();
            if let Ok(node_bin) = crate::shell::agent_installer::ensure_node() {
                extra.push(node_bin.display().to_string());
            }
            if let Some(cli) = resolve_engine_binary(engine) {
                if let Some(dir) = cli.parent() {
                    extra.push(dir.display().to_string());
                }
                if engine == "codex" {
                    cmd.env("CODEX_PATH", &cli);
                }
            }
            if !extra.is_empty() {
                let sep = if cfg!(windows) { ";" } else { ":" };
                let existing = std::env::var("PATH").unwrap_or_default();
                cmd.env("PATH", format!("{}{}{}", extra.join(sep), sep, existing));
            }
        }
        // stdout = JSON-RPC wire (clean); stderr = adapter logs, drained to CTRL's
        // stderr below so the pipe can't fill AND startup failures (npx fetch,
        // "binary not found", auth prompts) are VISIBLE instead of a silent 180s
        // hang. kill_on_drop ties the child to this struct.
        cmd.stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd
            .spawn()
            .with_context(|| format!("spawn {engine} acp ({})", argv.join(" ")))?;
        let stdin = child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        // Drain stderr (ADR-005 §8.8): without this the piped buffer fills and the
        // adapter blocks; with it, the real reason a BYO engine stalls shows up.
        if let Some(errpipe) = child.stderr.take() {
            let eng = engine.to_string();
            tokio::spawn(async move {
                let mut lines = BufReader::new(errpipe).lines();
                while let Ok(Some(l)) = lines.next_line().await {
                    eprintln!("[acp:{eng}] {l}");
                }
            });
        }
        let mut s = AcpClient {
            child,
            stdin,
            reader: BufReader::new(stdout),
            session_id: String::new(),
            next_id: 0,
            reusable: true,
            primed: false,
            engine_id: engine.to_string(),
            // Filled in below once `initialize` responds.
            // (ADR-002 substrate § Multi-modal prompt attachments v75)
            prompt_caps: PromptCapsSnapshot::default(),
        };

        let mut noop = |_: AcpEvent| {};
        let init = s
            .request(
                "initialize",
                json!({
                    "protocolVersion": 1,
                    "clientCapabilities": { "fs": { "readTextFile": false, "writeTextFile": false } }
                }),
                &mut noop,
            )
            .await
            .context("ACP initialize")?;
        // Capture the engine's negotiated multi-modal capabilities
        // (ADR-002 substrate §1.8.6 v75) — `prompt()` consults this before
        // ever emitting an Image/EmbeddedResource block.
        s.prompt_caps = parse_prompt_caps(&init);

        // ACP authenticate (ADR-005 §8.8, verified vs codex-acp 1.0.1 2026-06-29):
        // some engines REQUIRE an explicit `authenticate` before `session/new` —
        // codex returns "Authentication required" otherwise. hermes advertises no
        // authMethods, so this is skipped for it (no regression). We prefer the
        // `api-key` method: codex-acp reads OPENAI_API_KEY (injected from the user's
        // CTRL provider via byo_engine_auth_env), so this is what lets "use our
        // OpenAI key, no second login" actually work. A failure here is logged but
        // not fatal — session/new returns the authoritative error, which the caller
        // surfaces (e.g. "configure an OpenAI key, or run codex login").
        if let Some(methods) = init.get("authMethods").and_then(|m| m.as_array()) {
            let method_id = methods
                .iter()
                .find_map(|m| {
                    m.get("id")
                        .and_then(|i| i.as_str())
                        .filter(|id| *id == "api-key")
                })
                .or_else(|| {
                    methods
                        .iter()
                        .find_map(|m| m.get("id").and_then(|i| i.as_str()))
                });
            if let Some(mid) = method_id {
                let mid = mid.to_string();
                if let Err(e) = s
                    .request("authenticate", json!({ "methodId": mid }), &mut noop)
                    .await
                {
                    eprintln!("[acp:{engine}] authenticate({mid}) failed: {e}");
                }
            }
        }

        // Project the actor-specific gate scope into the fresh ACP session.
        // The selected cwd, caller, and intent are immutable for this owner;
        // changing Resource or Skill resets the owner before another prompt.
        // (ADR-001 spine §4 v21; ADR-005 irisy §11 v38)
        let mcp_servers = build_mcp_servers(gate_caller, gate_intent);
        let had_mcp = !mcp_servers.is_empty();
        let cwd_str = cwd.to_string_lossy().to_string();
        let ns = match s
            .request(
                "session/new",
                json!({ "cwd": cwd_str, "mcpServers": mcp_servers }),
                &mut noop,
            )
            .await
        {
            Ok(v) => v,
            Err(e) if had_mcp => {
                eprintln!(
                    "[acp] session/new with MCP passthrough failed ({e}); retrying without tools"
                );
                s.request(
                    "session/new",
                    json!({ "cwd": cwd_str, "mcpServers": [] }),
                    &mut noop,
                )
                .await
                .context("ACP session/new")?
            }
            Err(e) => return Err(e.context("ACP session/new")),
        };
        s.session_id = ns
            .get("sessionId")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("session/new returned no sessionId"))?
            .to_string();
        // Project only lifecycle metadata after session creation; never prompt
        // or tool payloads. (ADR-005 irisy §8.6.1 v26)
        crate::kernel::diagnostics::record(crate::kernel::diagnostics::RecordEvent {
            module: crate::kernel::diagnostics::DiagnosticsModule::Irisy,
            session_id: Some(&s.session_id),
            correlation_id: None,
            kind: "acp_lifecycle",
            phase: "startup",
            severity: "info",
            outcome: "ready",
            duration_ms: None,
            capture_only: false,
            attributes: serde_json::json!({ "engine": engine }),
        });
        set_diagnostics_state(AcpDiagnosticsState::Ready);
        startup_diagnostics.completed = true;
        Ok(s)
    }

    /// True while the ACP child process is still running.
    pub fn is_alive(&mut self) -> bool {
        matches!(self.child.try_wait(), Ok(None))
    }

    /// True when the child is alive and its stdout stream is safe for another
    /// request. A prompt timeout retains the session only after the ACP-required
    /// terminal response has been drained; otherwise callers must re-hydrate.
    /// (ADR-005 irisy §8.3 v33)
    pub fn is_reusable(&mut self) -> bool {
        self.reusable && self.is_alive()
    }

    /// Which Irisy engine this client drives (ADR-005 §8.7). The caller compares
    /// it to the selected engine and resets the singleton on a switch.
    pub fn engine(&self) -> &str {
        &self.engine_id
    }

    /// Run one prompt turn; `on_event` receives streamed events as they arrive.
    /// `turns` is the conversation so far as `(role, content)` pairs (user /
    /// assistant, in order). The actual prompt = the last `user` turn; the
    /// earlier turns are used ONLY to re-hydrate a fresh session (§8.4).
    /// `attachments` are files dropped alongside the LATEST user turn only
    /// (ADR-002 substrate §1.8.6 v75) — never replayed for prior turns, since
    /// they were already sent (or degraded to a text notice) when originally
    /// submitted. Returns the ACP stopReason.
    pub async fn prompt(
        &mut self,
        turns: &[(String, String)],
        system_preamble: Option<&str>,
        attachments: &[Attachment],
        on_event: impl FnMut(AcpEvent) + Send,
    ) -> Result<String> {
        self.prompt_inner(turns, system_preamble, attachments, on_event, None)
            .await
    }

    /// Run a prompt that can be cancelled by its owning UI request. Cancellation
    /// always travels through ACP's `session/cancel` and terminal-response drain,
    /// so a newer Coding turn cannot inherit stale output from an abandoned one.
    /// (ADR-005 irisy §8.3 v33)
    pub async fn prompt_cancellable(
        &mut self,
        turns: &[(String, String)],
        system_preamble: Option<&str>,
        attachments: &[Attachment],
        on_event: impl FnMut(AcpEvent) + Send,
        cancellation: &mut tokio::sync::oneshot::Receiver<()>,
    ) -> Result<String> {
        self.prompt_inner(
            turns,
            system_preamble,
            attachments,
            on_event,
            Some(cancellation),
        )
        .await
    }

    // A bootstrap interrupted before a terminal response must remain replayable
    // from the durable transcript; only a completed first prompt establishes it.
    // (ADR-005 irisy §8.3 v33)
    async fn prompt_inner(
        &mut self,
        turns: &[(String, String)],
        system_preamble: Option<&str>,
        attachments: &[Attachment],
        mut on_event: impl FnMut(AcpEvent) + Send,
        cancellation: Option<&mut tokio::sync::oneshot::Receiver<()>>,
    ) -> Result<String> {
        let sid = self.session_id.clone();
        let last_user = turns
            .iter()
            .rev()
            .find(|(r, _)| r == "user")
            .map(|(_, c)| c.clone())
            .unwrap_or_default();
        // Prime the first turn of a session with CTRL's composed system prompt
        // (persona + capability catalog, ADR-005 v5 §6.2) THEN the capability
        // brief THEN — the §8.4 fix — a replay of the prior conversation so a
        // fresh / restarted engine session starts WITH context instead of blank
        // (the durable transcript is the recovery source; the live session is
        // the working context). While the SAME session continues, only the
        // latest user message is sent (the engine already holds the history).
        // (ADR-005 irisy §8.3 v33)
        let bootstrap_pending = !self.primed;
        let turn_text = if !bootstrap_pending {
            last_user
        } else {
            let mut head = String::new();
            if let Some(sys) = system_preamble {
                let sys = sys.trim();
                if !sys.is_empty() {
                    head.push_str(sys);
                    head.push_str("\n\n");
                }
            }
            head.push_str(CTRL_CAPABILITY_BRIEF);
            // Replay everything before the final user message (§8.4).
            let last_idx = turns.iter().rposition(|(r, _)| r == "user");
            let prior = match last_idx {
                Some(i) => &turns[..i],
                None => &turns[..],
            };
            if !prior.is_empty() {
                head.push_str("\n\n[Conversation so far \u{2014} context only, continue it:]\n");
                for (role, content) in prior {
                    let who = if role == "user" { "User" } else { "Irisy" };
                    head.push_str(&format!("{who}: {}\n", content.trim()));
                }
            }
            format!("{head}\n\n{last_user}")
        };
        // Record only turn timing and owner health after the existing ACP request.
        // (ADR-005 irisy §8.6.1 v26)
        let started = std::time::Instant::now();
        set_diagnostics_state(AcpDiagnosticsState::Busy);
        let prompt_blocks = build_prompt_blocks(&turn_text, attachments, self.prompt_caps);
        let result = if let Some(cancellation) = cancellation {
            self.request_cancellable(
                "session/prompt",
                json!({ "sessionId": sid, "prompt": prompt_blocks }),
                &mut on_event,
                cancellation,
            )
            .await
        } else {
            self.request(
                "session/prompt",
                json!({ "sessionId": sid, "prompt": prompt_blocks }),
                &mut on_event,
            )
            .await
        };
        let alive = self.is_alive();
        let (severity, outcome) = if result.is_ok() {
            ("info", "ok")
        } else if alive {
            ("warn", "degraded")
        } else {
            ("error", "failed")
        };
        set_diagnostics_state(if alive {
            AcpDiagnosticsState::Ready
        } else {
            AcpDiagnosticsState::Failed
        });
        crate::kernel::diagnostics::record(crate::kernel::diagnostics::RecordEvent {
            module: crate::kernel::diagnostics::DiagnosticsModule::Irisy,
            session_id: Some(&self.session_id),
            correlation_id: None,
            kind: "acp_lifecycle",
            phase: "turn",
            severity,
            outcome,
            duration_ms: Some(started.elapsed().as_millis() as u64),
            capture_only: true,
            attributes: serde_json::json!({ "engine": self.engine_id }),
        });
        let res = result?;
        // A drained cancellation restores stream ordering, but it does not
        // prove the agent accepted this session's bootstrap context. Commit
        // priming only after the first prompt finishes successfully so a
        // later turn replays it if the bootstrap was interrupted.
        // (ADR-005 irisy §8.3 v33)
        if bootstrap_pending {
            self.primed = true;
        }
        Ok(res
            .get("stopReason")
            .and_then(|v| v.as_str())
            .unwrap_or("end_turn")
            .to_string())
    }

    async fn write_msg(&mut self, v: &Value) -> Result<()> {
        let mut line = serde_json::to_string(v)?;
        line.push('\n');
        self.stdin.write_all(line.as_bytes()).await?;
        self.stdin.flush().await?;
        Ok(())
    }

    /// Send a JSON-RPC request, then pump stdout until its response arrives,
    /// mapping each `session/update` to an `AcpEvent` for `on_event` (text,
    /// reasoning, tool call / result) and answering any agent->client requests
    /// (permission / fs) minimally so the turn never stalls.
    async fn request(
        &mut self,
        method: &str,
        params: Value,
        on_event: &mut (dyn FnMut(AcpEvent) + Send),
    ) -> Result<Value> {
        self.request_with_read_timeout(method, params, on_event, READ_TIMEOUT)
            .await
    }

    // Keep cancellation, timeout, and EOF on one state machine: reuse is safe
    // only after the original prompt's terminal response was drained.
    // (ADR-005 irisy §8.3 v33)
    async fn request_cancellable(
        &mut self,
        method: &str,
        params: Value,
        on_event: &mut (dyn FnMut(AcpEvent) + Send),
        cancellation: &mut tokio::sync::oneshot::Receiver<()>,
    ) -> Result<Value> {
        self.request_with_read_timeout_and_cancellation(
            method,
            params,
            on_event,
            READ_TIMEOUT,
            Some(cancellation),
        )
        .await
    }

    async fn request_with_read_timeout(
        &mut self,
        method: &str,
        params: Value,
        on_event: &mut (dyn FnMut(AcpEvent) + Send),
        read_timeout: Duration,
    ) -> Result<Value> {
        self.request_with_read_timeout_and_cancellation(
            method,
            params,
            on_event,
            read_timeout,
            None,
        )
        .await
    }

    async fn request_with_read_timeout_and_cancellation(
        &mut self,
        method: &str,
        params: Value,
        on_event: &mut (dyn FnMut(AcpEvent) + Send),
        read_timeout: Duration,
        mut cancellation: Option<&mut tokio::sync::oneshot::Receiver<()>>,
    ) -> Result<Value> {
        if !self.reusable {
            return Err(anyhow!("ACP session is not reusable"));
        }

        let id = self.next_id;
        self.next_id += 1;
        self.write_msg(&json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))
            .await?;

        // A read outcome may release the stream only after its original prompt's
        // terminal response was drained; all other terminal failures revoke reuse.
        // (ADR-005 irisy §8.3 v33)
        loop {
            let mut line = String::new();
            let read = tokio::time::timeout(read_timeout, self.reader.read_line(&mut line));
            let read_result = if let Some(cancellation) = cancellation.as_deref_mut() {
                tokio::select! {
                    _ = cancellation => {
                        let acp = format!("{}-acp", self.engine_id);
                        if method != "session/prompt" || self.session_id.is_empty() {
                            self.reusable = false;
                            return Err(anyhow!("{acp} request cancelled"));
                        }
                        if let Err(cancel_error) = self.cancel_and_drain_prompt(id).await {
                            self.reusable = false;
                            return Err(anyhow!(
                                "{acp} prompt cancelled; session cancellation was not confirmed: {cancel_error}"
                            ));
                        }
                        return Err(anyhow!("{acp} prompt cancelled"));
                    }
                    result = read => result,
                }
            } else {
                read.await
            };
            let n = match read_result {
                Ok(result) => result?,
                Err(_) => {
                    let acp = format!("{}-acp", self.engine_id);
                    if method != "session/prompt" || self.session_id.is_empty() {
                        self.reusable = false;
                        return Err(anyhow!("{acp} read timed out"));
                    }
                    if let Err(cancel_error) = self.cancel_and_drain_prompt(id).await {
                        self.reusable = false;
                        return Err(anyhow!(
                            "{acp} read timed out; session cancellation was not confirmed: {cancel_error}"
                        ));
                    }
                    return Err(anyhow!("{acp} read timed out"));
                }
            };
            if n == 0 {
                self.reusable = false;
                return Err(anyhow!("{}-acp closed stdout", self.engine_id));
            }
            let Some(v) = parse_json_rpc_line(&line) else {
                continue;
            };

            // Only the original request's terminal response completes this turn;
            // later notifications remain owned by that same stream boundary.
            // (ADR-005 irisy §8.3 v33)
            if is_response_for(&v, id) {
                if let Some(err) = v.get("error") {
                    return Err(anyhow!("ACP error: {err}"));
                }
                return Ok(v.get("result").cloned().unwrap_or(Value::Null));
            }

            if v.get("method").and_then(|m| m.as_str()) == Some("session/update") {
                if let Some(u) = v.get("params").and_then(|p| p.get("update")) {
                    if let Some(ev) = parse_session_update(u) {
                        on_event(ev);
                    }
                }
                continue;
            }

            self.reply_to_agent_request(&v).await?;
        }
    }

    /// Cancel a timed-out prompt and consume the original prompt's terminal
    /// response before this client accepts another request. ACP requires
    /// `session/cancel` to be a notification scoped by `sessionId`, followed by
    /// pending updates and a final response to the original prompt. Updates are
    /// deliberately discarded here: their UI callback belongs to the timed-out
    /// turn, never the next one. (ADR-005 irisy §8.3 v33)
    async fn cancel_and_drain_prompt(&mut self, prompt_id: i64) -> Result<()> {
        self.write_msg(&cancel_notification(&self.session_id))
            .await?;

        let deadline = tokio::time::Instant::now() + CANCEL_DRAIN_TIMEOUT;
        loop {
            let remaining = deadline
                .checked_duration_since(tokio::time::Instant::now())
                .ok_or_else(|| anyhow!("ACP cancellation drain timed out"))?;
            let mut line = String::new();
            let n = tokio::time::timeout(remaining, self.reader.read_line(&mut line))
                .await
                .map_err(|_| anyhow!("ACP cancellation drain timed out"))??;
            if n == 0 {
                return Err(anyhow!("ACP closed stdout during cancellation drain"));
            }
            let Some(v) = parse_json_rpc_line(&line) else {
                continue;
            };
            if is_response_for(&v, prompt_id) {
                return Ok(());
            }
            // ACP requires pending session/update notifications before the
            // prompt response. They establish the stream boundary but must not
            // be emitted through the expired request's callback.
            if v.get("method").and_then(|m| m.as_str()) == Some("session/update") {
                continue;
            }
            self.reply_to_agent_request(&v).await?;
        }
    }

    // Agent requests still need replies while draining so the original prompt can
    // reach its terminal response without leaking output to a later owner.
    // (ADR-005 irisy §8.3 v33)
    async fn reply_to_agent_request(&mut self, v: &Value) -> Result<()> {
        if let (Some(req_id), Some(req_method)) = (
            v.get("id").and_then(|i| i.as_i64()),
            v.get("method").and_then(|m| m.as_str()),
        ) {
            let result = if req_method == "session/request_permission" {
                select_allow_outcome(v)
            } else if req_method == "fs/read_text_file" {
                json!({ "content": "" })
            } else {
                Value::Null
            };
            // Drain-time replies preserve the active request owner's ACP boundary.
            // (ADR-005 irisy §8.3 v38)
            self.write_msg(&json!({ "jsonrpc": "2.0", "id": req_id, "result": result }))
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn perm_req(options: Value) -> Value {
        json!({ "params": { "options": options } })
    }

    #[tokio::test]
    async fn timeout_drains_late_updates_before_reusing_the_session() {
        let mut child = tokio::process::Command::new("sh")
            .args([
                "-c",
                r#"while IFS= read -r line; do
case "$line" in
  *'"method":"session/prompt"'*) sleep 1 ;;
  *'"method":"session/cancel"'*)
    printf '%s\n' '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"late"}}}}'
    printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"stopReason":"cancelled"}}'
    ;;
  *'"method":"session/list"'*)
    printf '%s\n' '{"jsonrpc":"2.0","id":1,"result":{"sessions":[]}}'
    exit 0
    ;;
esac
done"#,
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("start ACP fixture");
        let stdin = child.stdin.take().expect("fixture stdin");
        let stdout = child.stdout.take().expect("fixture stdout");
        let mut client = AcpClient {
            child,
            stdin,
            reader: BufReader::new(stdout),
            session_id: "session-42".to_string(),
            next_id: 0,
            reusable: true,
            primed: false,
            engine_id: "fixture".to_string(),
            prompt_caps: PromptCapsSnapshot::default(),
        };
        let mut events = Vec::new();
        let timed_out = client
            .request_with_read_timeout(
                "session/prompt",
                json!({}),
                &mut |event| events.push(event),
                std::time::Duration::from_millis(10),
            )
            .await;
        assert!(timed_out
            .unwrap_err()
            .to_string()
            .contains("read timed out"));
        assert!(
            events.is_empty(),
            "late update leaked through the expired callback"
        );
        assert!(
            client.is_reusable(),
            "terminal prompt response must restore reuse"
        );

        let response = client
            .request_with_read_timeout(
                "session/list",
                json!({}),
                &mut |_| {},
                std::time::Duration::from_millis(50),
            )
            .await
            .expect("next request uses the drained session");
        assert_eq!(response, json!({ "sessions": [] }));
    }

    #[tokio::test]
    async fn unconfirmed_cancellation_marks_the_session_unusable() {
        let mut child = tokio::process::Command::new("sh")
            .args([
                "-c",
                r#"while IFS= read -r line; do
case "$line" in
  *'"method":"session/prompt"'*) sleep 1 ;;
  *'"method":"session/cancel"'*) exit 0 ;;
esac
done"#,
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("start ACP fixture");
        let stdin = child.stdin.take().expect("fixture stdin");
        let stdout = child.stdout.take().expect("fixture stdout");
        let mut client = AcpClient {
            child,
            stdin,
            reader: BufReader::new(stdout),
            session_id: "session-42".to_string(),
            next_id: 0,
            reusable: true,
            primed: false,
            engine_id: "fixture".to_string(),
            prompt_caps: PromptCapsSnapshot::default(),
        };
        let result = client
            .request_with_read_timeout(
                "session/prompt",
                json!({}),
                &mut |_| {},
                std::time::Duration::from_millis(10),
            )
            .await;
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("session cancellation was not confirmed"));
        assert!(
            !client.reusable,
            "unconfirmed cancellation must prevent reuse"
        );
    }

    #[tokio::test]
    async fn cancelled_bootstrap_is_not_marked_primed() {
        let mut child = tokio::process::Command::new("sh")
            .args([
                "-c",
                r#"while IFS= read -r line; do
case "$line" in
  *'"method":"session/prompt"'*) : ;;
  *'"method":"session/cancel"'*)
    printf '%s\n' '{"jsonrpc":"2.0","id":0,"result":{"stopReason":"cancelled"}}'
    ;;
esac
done"#,
            ])
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .expect("start ACP fixture");
        let stdin = child.stdin.take().expect("fixture stdin");
        let stdout = child.stdout.take().expect("fixture stdout");
        let mut client = AcpClient {
            child,
            stdin,
            reader: BufReader::new(stdout),
            session_id: "session-42".to_string(),
            next_id: 0,
            reusable: true,
            primed: false,
            engine_id: "fixture".to_string(),
            prompt_caps: PromptCapsSnapshot::default(),
        };
        let turns = vec![("user".to_string(), "first turn".to_string())];
        let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel();
        cancel_tx.send(()).expect("cancel bootstrap turn");

        let error = client
            .prompt_cancellable(&turns, Some("test preamble"), &[], |_| {}, &mut cancel_rx)
            .await
            .expect_err("bootstrap prompt is cancelled");
        assert!(error.to_string().contains("prompt cancelled"));
        assert!(
            client.is_reusable(),
            "terminal cancellation response keeps ordering safe"
        );
        assert!(
            !client.primed,
            "an interrupted bootstrap must be replayed before the session is reused"
        );
    }

    #[test]
    fn timeout_cancellation_uses_the_acp_session_notification() {
        assert_eq!(
            cancel_notification("session-42"),
            json!({
                "jsonrpc": "2.0",
                "method": "session/cancel",
                "params": { "sessionId": "session-42" }
            })
        );
    }

    #[test]
    fn terminal_response_is_matched_to_the_timed_out_prompt_only() {
        assert!(is_response_for(
            &json!({ "id": 7, "result": { "stopReason": "cancelled" } }),
            7
        ));
        assert!(is_response_for(
            &json!({ "id": 7, "error": { "code": -32000 } }),
            7
        ));
        assert!(!is_response_for(&json!({ "id": 8, "result": {} }), 7));
        assert!(!is_response_for(
            &json!({ "method": "session/update", "params": {} }),
            7
        ));
    }

    // ADR-001 spine §4 v16: opencode speaks ACP NATIVELY via its own `acp`
    // subcommand (verified directly against the installed binary), so its
    // spawn argv is just `opencode acp` — no npx wrapper adapter like
    // codex/claude-code.
    #[test]
    fn opencode_engine_argv_is_native_acp_subcommand() {
        let argv = engine_argv("opencode").expect("opencode argv");
        assert_eq!(argv, vec!["opencode".to_string(), "acp".to_string()]);
    }

    #[test]
    fn resolve_engine_binary_never_looks_up_opencode() {
        // opencode is always the user's own PATH install (never a
        // CTRL-managed ~/.ctrl/agents/<id> dir) — resolve_engine_binary must
        // return None for it so callers fall through to their own discovery.
        assert!(resolve_engine_binary("opencode").is_none());
    }

    // §1.8.6 (ADR-002 substrate v75) — capability negotiation from a real
    // `initialize` response shape (image/embeddedContext booleans, matching
    // the ACP `PromptCapabilities` schema).
    #[test]
    fn parses_prompt_caps_from_initialize_response() {
        let init = json!({
            "agentCapabilities": {
                "promptCapabilities": { "image": true, "embeddedContext": false }
            }
        });
        let caps = parse_prompt_caps(&init);
        assert!(caps.image);
        assert!(!caps.embedded_context);
    }

    #[test]
    fn missing_prompt_caps_default_to_unsupported() {
        // An engine that advertises no promptCapabilities at all (or omits
        // the field) must default to "supports nothing beyond baseline" —
        // never silently assume image/embeddedContext support.
        let caps = parse_prompt_caps(&json!({}));
        assert!(!caps.image);
        assert!(!caps.embedded_context);
    }

    // §1.8.6 — build_prompt_blocks decides ContentBlock shape from negotiated
    // capabilities, never sends an unsupported block type, and degrades to a
    // text notice rather than dropping the attachment silently.
    #[test]
    fn image_becomes_image_block_when_capability_present() {
        let att = Attachment {
            name: "screenshot.png".to_string(),
            mime_type: "image/png".to_string(),
            content: AttachmentContent::ImageBase64("Zm9v".to_string()),
        };
        let blocks = build_prompt_blocks(
            "hi",
            &[att],
            PromptCapsSnapshot {
                image: true,
                embedded_context: false,
            },
        );
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["data"], "Zm9v");
        assert_eq!(blocks[1]["mimeType"], "image/png");
    }

    #[test]
    fn image_degrades_to_text_notice_when_capability_absent() {
        let att = Attachment {
            name: "screenshot.png".to_string(),
            mime_type: "image/png".to_string(),
            content: AttachmentContent::ImageBase64("Zm9v".to_string()),
        };
        let blocks = build_prompt_blocks("hi", &[att], PromptCapsSnapshot::default());
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[1]["type"], "text");
        let notice = blocks[1]["text"].as_str().unwrap();
        assert!(notice.contains("screenshot.png"));
        assert!(notice.contains("does not accept"));
    }

    #[test]
    fn text_attachment_becomes_embedded_resource_when_capability_present() {
        let att = Attachment {
            name: "notes.md".to_string(),
            mime_type: "text/markdown".to_string(),
            content: AttachmentContent::Text("# competitor notes".to_string()),
        };
        let blocks = build_prompt_blocks(
            "hi",
            &[att],
            PromptCapsSnapshot {
                image: false,
                embedded_context: true,
            },
        );
        assert_eq!(blocks[1]["type"], "resource");
        assert_eq!(blocks[1]["resource"]["text"], "# competitor notes");
        assert_eq!(blocks[1]["resource"]["uri"], "notes.md");
    }

    #[test]
    fn text_attachment_degrades_to_notice_when_embedded_context_absent() {
        let att = Attachment {
            name: "notes.md".to_string(),
            mime_type: "text/markdown".to_string(),
            content: AttachmentContent::Text("# competitor notes".to_string()),
        };
        let blocks = build_prompt_blocks("hi", &[att], PromptCapsSnapshot::default());
        assert_eq!(blocks[1]["type"], "text");
        assert!(blocks[1]["text"].as_str().unwrap().contains("notes.md"));
    }

    #[test]
    fn oversized_text_attachment_is_truncated_with_explicit_notice() {
        let big = "x".repeat(MAX_TEXT_RESOURCE_CHARS + 500);
        let att = Attachment {
            name: "huge.txt".to_string(),
            mime_type: "text/plain".to_string(),
            content: AttachmentContent::Text(big),
        };
        let blocks = build_prompt_blocks(
            "hi",
            &[att],
            PromptCapsSnapshot {
                image: false,
                embedded_context: true,
            },
        );
        let text = blocks[1]["resource"]["text"].as_str().unwrap();
        assert!(text.len() < MAX_TEXT_RESOURCE_CHARS + 500);
        assert!(text.contains("truncated"));
    }

    #[test]
    fn oversized_image_is_rejected_with_explicit_notice_not_sent_raw() {
        let huge_base64 = "A".repeat(MAX_IMAGE_BASE64_CHARS + 10);
        let att = Attachment {
            name: "huge.png".to_string(),
            mime_type: "image/png".to_string(),
            content: AttachmentContent::ImageBase64(huge_base64),
        };
        let blocks = build_prompt_blocks(
            "hi",
            &[att],
            PromptCapsSnapshot {
                image: true,
                embedded_context: false,
            },
        );
        assert_eq!(blocks[1]["type"], "text");
        assert!(blocks[1]["text"]
            .as_str()
            .unwrap()
            .contains("exceeds the inline size limit"));
    }

    #[test]
    fn no_attachments_yields_only_the_text_block() {
        let blocks = build_prompt_blocks("hi", &[], PromptCapsSnapshot::default());
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0]["type"], "text");
        assert_eq!(blocks[0]["text"], "hi");
    }

    // singleton() and coding_singleton() must be genuinely independent slots —
    // switching Irisy's engine must never evict a live Coding session and
    // vice versa (ADR-005 irisy §8.7 v30 / ADR-001 spine §4 v16).
    #[test]
    fn irisy_and_coding_singletons_are_independent_slots() {
        assert!(!std::ptr::eq(
            singleton() as *const _ as *const u8,
            coding_singleton() as *const _ as *const u8
        ));
    }

    #[test]
    fn approves_allow_once_over_other_options() {
        let req = perm_req(json!([
            { "optionId": "r", "kind": "reject_once" },
            { "optionId": "a", "kind": "allow_once" },
            { "optionId": "aa", "kind": "allow_always" },
        ]));
        assert_eq!(
            select_allow_outcome(&req),
            json!({ "outcome": { "outcome": "selected", "optionId": "a" } })
        );
    }

    #[test]
    fn falls_back_to_allow_always_then_any_non_reject() {
        let only_always = perm_req(json!([
            { "optionId": "r", "kind": "reject_once" },
            { "optionId": "aa", "kind": "allow_always" },
        ]));
        assert_eq!(
            select_allow_outcome(&only_always),
            json!({ "outcome": { "outcome": "selected", "optionId": "aa" } })
        );

        // Unknown kind that isn't a reject is still usable.
        let custom = perm_req(json!([
            { "optionId": "r", "kind": "reject_always" },
            { "optionId": "x", "kind": "grant" },
        ]));
        assert_eq!(
            select_allow_outcome(&custom),
            json!({ "outcome": { "outcome": "selected", "optionId": "x" } })
        );
    }

    #[test]
    fn cancels_when_only_reject_options_or_none() {
        let only_reject = perm_req(json!([
            { "optionId": "r1", "kind": "reject_once" },
            { "optionId": "r2", "kind": "reject_always" },
        ]));
        assert_eq!(
            select_allow_outcome(&only_reject),
            json!({ "outcome": { "outcome": "cancelled" } })
        );
        // Malformed / missing options -> cancel, never panic.
        assert_eq!(
            select_allow_outcome(&json!({})),
            json!({ "outcome": { "outcome": "cancelled" } })
        );
    }

    // ADR-005 §8.6 — the read loop maps ACP session/update to AcpEvent. These
    // payloads are the real shapes captured from hermes-acp 0.16.0 (2026-07-04).
    #[test]
    fn maps_tool_call_and_result_from_real_payloads() {
        let call = json!({
            "sessionUpdate": "tool_call",
            "toolCallId": "tc-1d09b052f3af",
            "title": "mcp_ctrl_vault_search",
            "kind": "other",
            "rawInput": { "query": "ghostfolio" },
            "content": [{ "type": "content", "content": { "type": "text", "text": "{}" } }]
        });
        match parse_session_update(&call) {
            Some(AcpEvent::ToolCall { id, title, input }) => {
                assert_eq!(id, "tc-1d09b052f3af");
                assert_eq!(title, "mcp_ctrl_vault_search");
                assert_eq!(input, r#"{"query":"ghostfolio"}"#);
            }
            _ => panic!("expected ToolCall"),
        }

        let update = json!({
            "sessionUpdate": "tool_call_update",
            "toolCallId": "tc-1d09b052f3af",
            "status": "completed",
            "content": [{ "type": "content",
                "content": { "type": "text", "text": "mcp_ctrl_vault_search result\n- **result:** []" } }]
        });
        match parse_session_update(&update) {
            Some(AcpEvent::ToolResult { id, status, output }) => {
                assert_eq!(id, "tc-1d09b052f3af");
                assert_eq!(status, "completed");
                assert!(output.contains("result"));
            }
            _ => panic!("expected ToolResult"),
        }
    }

    #[test]
    fn maps_text_and_thought_and_ignores_noise() {
        let msg = json!({ "sessionUpdate": "agent_message_chunk",
            "content": { "type": "text", "text": "hello" } });
        assert!(matches!(parse_session_update(&msg), Some(AcpEvent::Text(t)) if t == "hello"));

        let thought = json!({ "sessionUpdate": "agent_thought_chunk",
            "content": { "type": "text", "text": "thinking" } });
        assert!(
            matches!(parse_session_update(&thought), Some(AcpEvent::Thought(t)) if t == "thinking")
        );

        // usage_update / available_commands_update are not surfaced yet.
        let usage = json!({ "sessionUpdate": "usage_update", "tokens": 42 });
        assert!(parse_session_update(&usage).is_none());
    }

    #[test]
    fn failed_startup_guard_closes_the_diagnostic_span() {
        let engine = "diagnostics-startup-failure-test";
        {
            let _guard = AcpStartupDiagnostics {
                engine: engine.to_string(),
                started: std::time::Instant::now(),
                completed: false,
            };
        }
        assert_eq!(current_diagnostics_state(), AcpDiagnosticsState::Failed);
        let trace = crate::kernel::diagnostics::trace(
            crate::kernel::diagnostics::DiagnosticsModule::Irisy,
            None,
            Some(200),
        );
        assert!(trace.events.iter().any(|event| {
            event.phase == "startup"
                && event.outcome == "failed"
                && event.attributes["engine"] == engine
        }));
    }

    // Irisy must route pack creation through one accepted local playbook rather
    // than duplicating its lifecycle in the capability brief.
    // (ADR-002 substrate § 7.4 v34)
    #[test]
    fn pack_creation_brief_routes_to_the_governed_skill_without_duplication() {
        for required in ["create-feature-pack", "skill_list", "skill_read", ":17873"] {
            assert!(
                CTRL_CAPABILITY_BRIEF.contains(required),
                "capability brief must contain {required}"
            );
        }

        for duplicated_or_stale in [
            "mcp_pack_validate",
            "mcp_pack_install",
            "The required lifecycle is",
            "skills_list / skill_view",
            "ONLY way to create a pack",
            "two real tools",
            "curl -s",
        ] {
            assert!(
                !CTRL_CAPABILITY_BRIEF.contains(duplicated_or_stale),
                "duplicated or stale pack guidance remains: {duplicated_or_stale}"
            );
        }
    }

    // LibreOffice is an application Companion, not a manually configured
    // connector. Irisy must give only manifest-owned user action and must never
    // expose the private transport boundary. (ADR-005 irisy §11 v37;
    // ADR-010 communication § transports v13)
    #[test]
    fn libreoffice_brief_uses_companion_guidance_without_private_credentials() {
        for required in [
            "source_id=\"ctrl-libreoffice\"",
            "source_describe",
            "manifest-owned unavailable_message",
        ] {
            assert!(CTRL_CAPABILITY_BRIEF.contains(required), "missing {required}");
        }
        let manifest: serde_json::Value = serde_json::from_slice(
            include_bytes!(concat!(
                env!("CARGO_MANIFEST_DIR"),
                "/../packages/ctrl-mcps/optional/ctrl-libreoffice/manifest.json"
            )),
        )
        .unwrap();
        let public_guidance = manifest
            .pointer("/record_source/unavailable_message")
            .and_then(serde_json::Value::as_str)
            .unwrap();
        assert!(
            !CTRL_CAPABILITY_BRIEF.contains(public_guidance),
            "manifest guidance must not be duplicated in the compiled brief"
        );
        for forbidden in [
            "CTRL_LIBREOFFICE_BRIDGE_URL",
            "CTRL_LIBREOFFICE_BRIDGE_TOKEN",
        ] {
            assert!(!CTRL_CAPABILITY_BRIEF.contains(forbidden), "leaked {forbidden}");
        }
    }

    /// Real end-to-end: spawn `opencode acp` via the kernel client (the SAME
    /// AcpClient::start_in path coding_chat.rs uses), run one streamed prompt
    /// turn in a temp workspace. Requires `opencode` on PATH + a configured
    /// model. Verified manually 2026-07-27 against opencode 1.18.5 before this
    /// test was written (initialize -> session/new -> session/prompt streamed
    /// agent_thought_chunk then agent_message_chunk then stopReason=end_turn).
    /// Run: `cargo test opencode_acp_smoke -- --ignored --nocapture`
    // (ADR-001 spine §4 v21; ADR-003 frontend §8.5 v39; ADR-005 irisy §11 v38)
    #[tokio::test]
    #[ignore]
    async fn opencode_acp_smoke() {
        let dir = tempfile::TempDir::new().expect("tempdir");
        let env = BTreeMap::new();
        let mut client = AcpClient::start_in_scoped(
            "opencode",
            &env,
            Some(dir.path()),
            "coding",
            Some(crate::kernel::projector::OPENCODE_CODING_INTENT),
        )
        .await
        .expect("start opencode acp");
        let mut answer = String::new();
        let turns = vec![(
            "user".to_string(),
            "Say hello in exactly 3 words.".to_string(),
        )];
        let stop = client
            .prompt(&turns, None, &[], |e| {
                if let AcpEvent::Text(t) = e {
                    answer.push_str(&t)
                }
            })
            .await
            .expect("prompt turn");
        println!("\nANSWER: {answer:?}  stopReason={stop}");
        assert!(!answer.trim().is_empty(), "no streamed text from opencode");
    }

    /// Real end-to-end: spawn hermes-acp via the kernel client, run one
    /// streamed prompt turn. Network + uvx + a configured hermes provider.
    /// Run: `cargo test acp_smoke -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn acp_smoke() {
        let env = BTreeMap::new();
        let mut client = AcpClient::start("hermes", &env)
            .await
            .expect("start hermes-acp");
        let mut answer = String::new();
        let turns = vec![("user".to_string(), "Reply with exactly: ACP OK".to_string())];
        // No attachments in this smoke (ADR-002 substrate §1.8.6 v75).
        let stop = client
            .prompt(&turns, None, &[], |e| {
                if let AcpEvent::Text(t) = e {
                    answer.push_str(&t)
                }
            })
            .await
            .expect("prompt turn");
        println!("\nANSWER: {answer:?}  stopReason={stop}");
        assert!(!answer.trim().is_empty(), "no streamed text from hermes");
    }
}
