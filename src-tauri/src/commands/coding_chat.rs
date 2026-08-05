// coding_chat_stream — Coding scene -> opencode over ACP.
//
// The Coding module's `opencode` engine speaks Agent Client Protocol natively
// (verified directly against the installed binary: `opencode acp` completes
// initialize -> session/new -> session/prompt, streaming agent_thought_chunk /
// agent_message_chunk / tool_call / tool_call_update exactly like
// hermes/codex/claude-code). This reuses the SAME `AcpClient` machinery
// `acp_client.rs` already drives Irisy's engine with — CTRL spawns the ACP
// process and pipes structured events, never a PTY/terminal render. Fully
// replaces the embedded-xterm approach (which hit real, unresolved rendering
// bugs against a live opencode process) and the external-terminal launcher
// (which visually overlapped CTRL's always-on-top launcher panel).
// (ADR-001 spine §4 v17; ADR-003 frontend §8.5 v32; ADR-005 irisy §8.7 v30)
//
// Deliberately a SEPARATE Tauri command + singleton from `irisy_chat_stream`:
// Coding's `opencode` engine is rooted at the selected WORKSPACE (not the
// vault root), has no persona/skills/system-header composition, and must
// never be evicted by (or evict) Irisy's own right-region engine selection.
//
// Contract (mirrors irisy_chat_stream's event shapes so the PWA can reuse the
// same rendering — ToolStepView / thinking trace / streamed answer text):
//   invoke('coding_chat_stream', { args: { request_id, workspace, messages } })
//   listen('chat-stream-delta', payload => { request_id, delta, done, error? })
//   listen('chat-stream-tool', payload => { request_id, tool_call_id, phase, ... })
//   listen('chat-stream-thought', payload => { request_id, delta })

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex, OnceLock,
};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

use crate::commands::chat::MessageWire;
use crate::commands::chat_attachment::ChatAttachmentWire;

/// One-time capability brief for opencode (ADR-001 spine §4 v19; ADR-002
/// substrate §7 v76). It makes the existing `create-feature-pack` skill the
/// sole authoring authority for feature-pack requests: Coding provides the
/// gate and the skill; it does not create a parallel authoring workflow.
/// Without this, opencode can mistake a CTRL feature-pack request for generic
/// architecture consultation and offer unverified forms before researching.
const CODING_CAPABILITY_BRIEF: &str = "\
[CTRL context — you are opencode, running as CTRL's Coding engine in this \
workspace. You are connected to the `ctrl` MCP server (CTRL's kernel gate). \
Your default tool list is a curated subset; the full gate surface is one search \
away — call `gate_tool_search(\"keywords\")` to find a tool, then \
`gate_tool_call(name, args)` to run it. \
\
FEATURE-PACK MODE IS A MANDATORY CTRL LIFECYCLE, NOT A GENERIC DESIGN \
CONSULTATION. When asked to build, edit, or debug a CTRL feature pack, call \
`skill_list` and then `skill_read` for `create-feature-pack` FIRST. Follow \
that skill as the sole authoring authority and keep every lifecycle operation \
on the `:17873` gate. Do not replace it with a prompt-only workflow. \
\
REQUIRED ORDER: (1) understand one real user job; (2) before proposing any \
pack form, search `Research/feature-packs/` for prior work, discover reusable \
packs/MCPs/skills, verify official API/auth/endpoints or an existing server, \
and create or update `Research/feature-packs/<slug>.md`; (3) record the \
applicable `## Job`, `## Sources`, `## Comparable products`, `## User \
signals`, and `## Decision` sections in that note; (4) only then present ONE \
evidence-based recommended boundary, verified source/reuse decision, selected \
form, and configuration/secret consequence, point to the research note, and \
wait for explicit confirmation; (5) author that one form; (6) call \
`mcp_pack_validate`, repair every error, and validate until it passes; (7) only \
then call `mcp_pack_install`; (8) run and inspect a real form-specific smoke; \
(9) call `mcp_pack_publish` only on explicit share intent. \
\
Before research, do not give the user a menu of speculative pack forms or ask \
them to choose implementation variants. Do not claim a source, endpoint, \
auth method, dependency, zero-configuration install, or immediate usability \
until it is verified by research and, where applicable, validation, install, \
and the real smoke. Ask only about a genuinely ambiguous user-facing job. \
\
MANIFEST FORM: choose exactly one form from evidence, not convenience: \
`actions[]` for local deterministic logic (never network shell actions); \
`record_source` for a verified REST/OpenAPI source (use `mcp_pack_scaffold` \
from a verified OpenAPI operation as a draft, never invent endpoints); or \
`mcp-server` only for a verified existing MCP server or genuinely necessary \
small local service. Secrets belong only in `config_schema` fields with \
`kind: \"secret\"` — never in the manifest body, source, commands, logs, or \
chat; CTRL stores them in the OS keychain. \
\
COMPLETION CLAIMS: a generated manifest is neither valid nor created. Never \
install before validation passes. Never say a pack is created, usable, \
installable, or ready until the installed pack's form-specific smoke produced \
and you inspected real output. \
\
FRONTEND RENDERING CONTRACT: CTRL renders every installed pack through ONE \
shared component (`FeaturePackScene`), never bespoke per-pack UI. Manifest \
fields choose the rendering: `record_source` -> live records table via \
`source_describe`/`source_query`; `workspace.table_prefix` -> smart-table \
tabs; `knowledge_base` -> Guide tab; `actions[]` alone -> action bar and \
output pane. Prefer these declarative fields over custom frontend code.]";

#[derive(Debug, Deserialize)]
pub struct CodingChatStreamArgs {
    pub request_id: String,
    /// Absolute path to the selected Coding workspace (the configured CTRL
    /// root or an installed feature-pack scope — ADR-002 §1B.8). This is
    /// opencode's cwd, NOT the vault root Irisy's engine uses.
    pub workspace: String,
    pub messages: Vec<MessageWire>,
    /// Files dropped into the composer alongside this turn (ADR-002 substrate
    /// §1.8.6 v75; ADR-003 frontend §8.5 v35) — authoring reference material
    /// for opencode, not a data-import path. Empty for a turn with no
    /// attachment. Only meaningful on the turn containing the LATEST user
    /// message; the frontend never resends a prior turn's attachments.
    #[serde(default)]
    pub attachments: Vec<ChatAttachmentWire>,
    /// Optional explicit local SKILL.md pin. Auto is represented by None.
    /// A changed pin is paired with a frontend Coding-owner reset so this body
    /// only primes a fresh ACP session. (ADR-005 irisy §11 v38)
    #[serde(default)]
    pub skill_id: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct StreamDelta {
    request_id: String,
    delta: String,
    done: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ToolStep {
    request_id: String,
    tool_call_id: String,
    phase: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    output: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
struct ThoughtStep {
    request_id: String,
    delta: String,
}

fn emit_done(app: &AppHandle, request_id: &str, error: Option<String>) {
    let _ = app.emit(
        "chat-stream-delta",
        StreamDelta {
            request_id: request_id.to_string(),
            delta: String::new(),
            done: true,
            error,
        },
    );
}

#[derive(Debug, Deserialize)]
pub struct CodingCancelArgs {
    pub request_id: String,
}

struct ActiveCancellation {
    token: u64,
    sender: oneshot::Sender<()>,
}

fn coding_cancellations() -> &'static Mutex<HashMap<String, ActiveCancellation>> {
    static CANCELLATIONS: OnceLock<Mutex<HashMap<String, ActiveCancellation>>> = OnceLock::new();
    CANCELLATIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn coding_epoch() -> &'static AtomicU64 {
    static EPOCH: AtomicU64 = AtomicU64::new(0);
    &EPOCH
}

fn next_coding_task_token() -> u64 {
    static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);
    NEXT_TOKEN.fetch_add(1, Ordering::Relaxed)
}

fn is_current_coding_epoch(epoch: u64) -> bool {
    coding_epoch().load(Ordering::Acquire) == epoch
}

fn cancel_all_coding_turns() {
    let pending = std::mem::take(
        &mut *coding_cancellations()
            .lock()
            .expect("coding cancellation registry lock"),
    );
    for (_, active) in pending {
        let _ = active.sender.send(());
    }
}

fn remove_cancellation_if_owned(request_id: &str, token: u64) {
    let mut cancellations = coding_cancellations()
        .lock()
        .expect("coding cancellation registry lock");
    if cancellations
        .get(request_id)
        .is_some_and(|active| active.token == token)
    {
        cancellations.remove(request_id);
    }
}

/// Reset the Coding engine session after cancelling every active prompt. The
/// prompt owner drains ACP's terminal response before this reset can acquire
/// the client lock, so the next workspace never inherits stale stream output.
/// (ADR-005 irisy §8.3 v33)
#[tauri::command]
pub async fn coding_reset_engine() -> Result<(), String> {
    coding_epoch().fetch_add(1, Ordering::AcqRel);
    cancel_all_coding_turns();
    *crate::shell::acp_client::coding_singleton().lock().await = None;
    Ok(())
}

/// Cancel one UI-owned Coding prompt without killing the persistent OpenCode
/// session. The ACP client sends `session/cancel` and drains the original
/// prompt response before a later turn may reuse the stream.
/// (ADR-005 irisy §8.3 v33)
#[tauri::command]
pub async fn coding_cancel_stream(args: CodingCancelArgs) -> Result<(), String> {
    if let Some(active) = coding_cancellations()
        .lock()
        .expect("coding cancellation registry lock")
        .remove(&args.request_id)
    {
        let _ = active.sender.send(());
    }
    Ok(())
}

#[tauri::command]
pub async fn coding_chat_stream(args: CodingChatStreamArgs, app: AppHandle) -> Result<(), String> {
    let request_id = args.request_id.clone();
    let token = next_coding_task_token();
    let epoch = coding_epoch().load(Ordering::Acquire);
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    if let Some(previous) = coding_cancellations()
        .lock()
        .expect("coding cancellation registry lock")
        .insert(
            request_id.clone(),
            ActiveCancellation {
                token,
                sender: cancel_tx,
            },
        )
    {
        let _ = previous.sender.send(());
    }
    let app_clone = app.clone();
    tokio::spawn(async move {
        let result = run_turn(&app_clone, &request_id, args, &mut cancel_rx, epoch).await;
        remove_cancellation_if_owned(&request_id, token);
        if let Err(e) = result {
            emit_done(&app_clone, &request_id, Some(e));
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::CODING_CAPABILITY_BRIEF;

    // Attachment disk-reading is covered by `chat_attachment.rs`'s own tests
    // (ADR-002 substrate §1.8.6 v75) — this module no longer duplicates that
    // logic, only consumes it via `ChatAttachmentWire`/`read_all`.

    // Guards the authoritative lifecycle and its implementation boundaries.
    // The brief does not implement stateful orchestration; it must reliably
    // direct the engine to the existing governed skill instead. (ADR-001 spine
    // §4 v19; ADR-002 substrate §7 v76)
    #[test]
    fn brief_points_at_the_governed_authorities_and_lifecycle() {
        for required in [
            "gate_tool_search",
            "gate_tool_call",
            "create-feature-pack",
            "Research/feature-packs/",
            "## Job",
            "## Sources",
            "## Comparable products",
            "## User signals",
            "## Decision",
            "mcp_pack_validate",
            "mcp_pack_install",
            "mcp_pack_scaffold",
            "FeaturePackScene",
            "record_source",
            "table_prefix",
            "config_schema",
        ] {
            assert!(
                CODING_CAPABILITY_BRIEF.contains(required),
                "coding capability brief must mention {required}"
            );
        }
    }

    #[test]
    fn brief_forbids_speculation_before_evidence_and_confirmation() {
        for required in [
            "Before research, do not give the user a menu of speculative pack forms",
            "until it is verified by research",
            "wait for explicit confirmation",
            "choose exactly one form from evidence",
        ] {
            assert!(
                CODING_CAPABILITY_BRIEF.contains(required),
                "coding capability brief must prohibit premature speculation: {required}"
            );
        }
    }

    #[test]
    fn brief_requires_validation_install_and_smoke_before_completion_claims() {
        for required in [
            "mcp_pack_validate",
            "mcp_pack_install",
            "real form-specific smoke",
            "Never install before validation passes",
            "Never say a pack is created, usable, installable, or ready",
        ] {
            assert!(
                CODING_CAPABILITY_BRIEF.contains(required),
                "coding capability brief must require verified completion: {required}"
            );
        }
    }

    #[test]
    fn brief_orders_the_governed_lifecycle_on_the_gate() {
        let positions = [
            "`skill_list` and then `skill_read`",
            "REQUIRED ORDER:",
            "Research/feature-packs/",
            "only then present ONE",
            "wait for explicit confirmation",
            "`mcp_pack_validate`",
            "`mcp_pack_install`",
            "real form-specific smoke",
            "`mcp_pack_publish` only on explicit share intent",
        ]
        .map(|stage| {
            CODING_CAPABILITY_BRIEF
                .find(stage)
                .unwrap_or_else(|| panic!("coding capability brief must include {stage}"))
        });

        assert!(
            positions.windows(2).all(|pair| pair[0] < pair[1]),
            "coding capability brief must preserve the governed lifecycle order"
        );
        assert!(
            CODING_CAPABILITY_BRIEF.contains("keep every lifecycle operation on the `:17873` gate"),
            "coding capability brief must keep lifecycle operations on the gate"
        );
    }

    #[test]
    fn brief_never_tells_opencode_to_put_secrets_in_the_manifest() {
        assert!(CODING_CAPABILITY_BRIEF.contains("kind: \"secret\""));
        assert!(CODING_CAPABILITY_BRIEF
            .to_lowercase()
            .contains("never in the manifest"));
    }
}

async fn run_turn(
    app: &AppHandle,
    request_id: &str,
    args: CodingChatStreamArgs,
    cancellation: &mut oneshot::Receiver<()>,
    epoch: u64,
) -> Result<(), String> {
    if !is_current_coding_epoch(epoch) {
        return Ok(());
    }
    let workspace = PathBuf::from(&args.workspace);
    if !workspace.is_dir() {
        return Err(format!("workspace does not exist: {}", args.workspace));
    }

    let turns: Vec<(String, String)> = args
        .messages
        .iter()
        .filter(|m| m.role == "user" || m.role == "assistant")
        .map(|m| (m.role.clone(), m.content.clone()))
        .collect();
    if !turns.iter().any(|(r, _)| r == "user") {
        emit_done(app, request_id, None);
        return Ok(());
    }

    // An explicit pin is real execution scope, not a label: resolve the body
    // through the shared local-skill authority and prime it into this fresh
    // Coding ACP session. Auto contributes no pinned body.
    // (ADR-001 spine §4 v21; ADR-005 irisy §11 v38)
    let mut system_preamble = CODING_CAPABILITY_BRIEF.to_string();
    if let Some(skill_id) = args.skill_id.as_deref() {
        if let Some(skill_body) = crate::commands::skills::load_local_skill_by_name(skill_id).await {
            system_preamble.push_str("\n\n[Explicitly pinned CTRL skill — follow this playbook:]\n");
            system_preamble.push_str(&skill_body);
        }
    }

    // Attachments that fail to read (missing/too-large/unreadable) are
    // logged and skipped rather than failing the whole turn — the user's
    // text message still goes through (mirrors AcpClient::prompt's own
    // "never a silent drop, never a hard fail over one attachment" rule for
    // capability mismatches). (ADR-002 substrate §1.8.6 v75)
    let attachments = crate::commands::chat_attachment::read_all(args.attachments, "coding_chat");

    let mut guard = crate::shell::acp_client::coding_singleton().lock().await;
    if !is_current_coding_epoch(epoch) {
        drop(guard);
        return Ok(());
    }
    // A workspace switch needs a fresh process rooted at the new cwd — the
    // PWA calls `coding_reset_engine` before sending a turn in a different
    // workspace, but guard here too in case a stale client from a prior
    // workspace is still held.
    let stale_cwd = false; // AcpClient does not expose its cwd; PWA-side reset is authoritative.
    let _ = stale_cwd;
    if guard.is_none() {
        let env = BTreeMap::new();
        match crate::shell::acp_client::AcpClient::start_in_scoped(
            "opencode",
            &env,
            Some(&workspace),
            "coding",
            Some(crate::kernel::projector::OPENCODE_CODING_INTENT),
        )
        .await
        {
            Ok(c) => *guard = Some(c),
            Err(e) => return Err(format!("opencode ACP start failed: {e}")),
        }
    }
    let client = guard.as_mut().expect("acp client present");
    let rid = request_id.to_string();
    let app2 = app.clone();
    let result = client
        .prompt_cancellable(
            &turns,
            Some(&system_preamble),
            &attachments,
            |e: crate::shell::acp_client::AcpEvent| {
                use crate::shell::acp_client::AcpEvent;
                match e {
                    AcpEvent::Text(t) => {
                        let _ = app2.emit(
                            "chat-stream-delta",
                            StreamDelta {
                                request_id: rid.clone(),
                                delta: t,
                                done: false,
                                error: None,
                            },
                        );
                    }
                    AcpEvent::Thought(t) => {
                        let _ = app2.emit(
                            "chat-stream-thought",
                            ThoughtStep {
                                request_id: rid.clone(),
                                delta: t,
                            },
                        );
                    }
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
            cancellation,
        )
        .await;

    if !is_current_coding_epoch(epoch) {
        *guard = None;
        drop(guard);
        return Ok(());
    }

    match result {
        Ok(_) => {
            drop(guard);
            emit_done(app, request_id, None);
            Ok(())
        }
        Err(e) => {
            // Keep the session only after its ACP stream is quiescent. A live
            // process whose timed-out turn did not reach a terminal response
            // cannot safely serve a later Coding request. (ADR-005 irisy §8.3 v33)
            let reusable = guard.as_mut().map(|c| c.is_reusable()).unwrap_or(false);
            if !reusable {
                *guard = None;
            }
            drop(guard);
            Err(e.to_string())
        }
    }
}
