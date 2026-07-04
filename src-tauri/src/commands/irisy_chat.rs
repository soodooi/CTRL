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
// stay fully usable (CLAUDE.md derived rule #2).
//
// Contract (unchanged — the PWA's ChatStreamTransport keeps working):
//   invoke('irisy_chat_stream', { args: { request_id, messages, model?,
//                                          temperature?, max_tokens? } })
//   listen('chat-stream-delta', payload => { request_id, delta, done, error? })

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use crate::commands::chat::MessageWire;
use crate::kernel::provider::routing::route_text_chat;
use crate::kernel::provider::r#trait::Consumer;
use crate::kernel::provider::types::{ChatMessage, ChatOpts, ChatPrompt};
use crate::shell::KernelHandle;

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
    // Cap mode: when `skill_id` is set, the kernel loads the matching
    // SKILL.md (via `list_local_skills`) and prepends it as a system
    // message so the provider operates under that skill for this turn.
    #[serde(default)]
    pub skill_id: Option<String>,
    // Session mode hint ("assistant" | "coding" | "cap"). Coding mode
    // is owned by opencode (/coding route) in the v19 aggregator; the
    // header below remains for the transition window.
    #[serde(default)]
    pub mode: Option<String>,
    // Coding-mode project directory hint.
    #[serde(default)]
    pub project_dir: Option<String>,
    // ADR-005 irisy §8.6 — the selected agent ("shell") id for this surface
    // (hermes / codex / claude-code). BYO-CLI selection is short-circuited
    // client-side (CTRL does not supervise a BYO loop), so a value reaching here
    // is the embedded engine; recorded for audit/telemetry + future routing.
    #[serde(default)]
    pub agent: Option<String>,
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

/// Reset Irisy's engine session so the NEXT turn starts a FRESH session and
/// re-hydrates from the replayed transcript (ADR-005 §8.4). Called on new-chat /
/// resume / fork so the engine's memory follows the conversation the user is
/// actually looking at, instead of silently carrying the old context across a
/// switch. Cheap + safe: the next `prompt` re-primes + replays the transcript.
#[tauri::command]
pub async fn irisy_reset_engine() -> Result<(), String> {
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
    tokio::spawn(async move {
        if let Err(e) = forward_to_provider(&app_clone, &request_id, args, registry).await {
            emit_done(&app_clone, &request_id, Some(e));
        }
    });

    Ok(())
}

/// Load the SKILL.md body for a given skill id (the user-facing cap name).
/// Reuses `list_local_skills` so the discovery rules (~/.claude/skills/ +
/// plugin caches) stay in one place (`feedback_no_redundancy_one_ssot`).
/// Returns `None` if the skill is not found or unreadable; the caller
/// falls back to no system prompt so Irisy still works on a stale id.
async fn load_skill_system_prompt(skill_id: &str) -> Option<String> {
    let skills =
        crate::commands::skills::list_local_skills(Some(skill_id.to_string()))
            .await
            .ok()?;
    let skill = skills.into_iter().find(|s| s.name == skill_id)?;
    std::fs::read_to_string(&skill.path).ok()
}

/// Mode-specific system header. Coding turns name the project dir so a
/// shell-capable provider can cd there; assistant/cap modes need none
/// (cap mode's SKILL.md is the prompt, loaded separately).
fn build_mode_system_header(mode: Option<&str>, project_dir: Option<&str>) -> Option<String> {
    // Capability truth header, EVERY mode (ADR-005 irisy § persona-shell v5 §6.2):
    // the provider-direct path holds no tools, so a capability/identity question
    // ("can you go online?") is answered by the raw base model — which wrongly
    // denies web access ("I can't browse") and calls its own research
    // "simulated". State what CTRL actually grants so Irisy never lies about it.
    // Mentioning web_search here is safe: turn_needs_agent() only scans the last
    // USER message, never these system headers, so it can't self-trigger routing.
    let mut header = String::from(
        "You are Irisy, the user's assistant inside CTRL. Through CTRL you CAN \
         search the live web (a web_search tool), read and write the user's notes \
         and vault, and create feature packs — these run whenever a request needs \
         them. So if the user asks whether you can go online, research, or search \
         the web, the answer is YES. NEVER tell the user you cannot browse the \
         internet, and never call your research 'simulated' or 'from training \
         data' — that is false. If they want live research, have them phrase it as \
         a request (e.g. \"search the web for ...\") and CTRL runs the search for \
         you.",
    );
    if mode.unwrap_or("personal") == "coding" {
        let dir = project_dir.unwrap_or("~");
        header.push_str(&format!(
            " You are also operating in CTRL's Coding mode. The user's active \
             project directory is `{dir}`. Treat this as your working directory \
             for the rest of this turn — `cd` there with your shell tool before \
             running build / test / git commands. Prefer making changes inside \
             this directory rather than the user's home folder."
        ));
    }
    Some(header)
}

/// Pick the EXECUTION path for this turn (ADR-005 irisy § persona-shell v5,
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
        "note", "save to", "save it to", "my notes", "knowledge base",
        "build a tool", "make a tool", "generate an image", "an image of",
        "make a video", "voiceover", "transcribe", "ocr", "web search",
        // online-research intents (ADR-005 irisy § persona-shell v5 §6.2): the
        // web_search tool lives only on the agent path; a research request must
        // reach hermes or the tool-less direct path denies it can go online.
        "search the web", "search online", "go online", "research online",
        "look it up online", "browse the web",
        "schedule a", "recurring", "refactor", "edit the file",
        // feature-pack intents (bao 2026-06-25: Irisy installs + uses packs via
        // the gate's mcp_pack_* tools — only hermes holds them, direct has none)
        "feature pack", "install a tool", "install the tool", "use a tool",
        "run an action", "run the tool", "my portfolio", "my holdings", "my stocks",
        // market-data intents (ADR-005 irisy § persona-shell v5 §6.2, 2026-06-26):
        // stock/quote turns read live data via the gate's http.get — only the
        // agent path holds tools; provider-direct has none and would hallucinate.
        "stock", "ticker", "watchlist", "stock price", "stock quote", "daily review",
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
        "smart table", "smart-table", "kanban", "filter by", "sort by", "group by",
    ];
    NEEDS.iter().any(|k| last.contains(k))
        || cjk_query_needles().iter().any(|k| last.contains(k))
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
        // market-data intents (ADR-005 irisy § persona-shell v5 §6.2, 2026-06-26)
        &[0x76EF, 0x76D8],                 // watch the market
        &[0x9009, 0x80A1],                 // pick stocks
        &[0x80A1, 0x7968],                 // stock
        &[0x80A1, 0x4EF7],                 // stock price
        &[0x884C, 0x60C5],                 // quote / market data
        &[0x5927, 0x76D8],                 // the broad market
        &[0x590D, 0x76D8],                 // daily review / recap
        // feature-pack management intents (ADR-005 irisy § persona-shell v5 §6.2
        // routing + ADR-002 substrate § composition §7.4 mcp_pack_* tools): only
        // the agent path holds the gate's pack tools (list / install / uninstall
        // / run). Per ADR-005 irisy § persona-shell v5 §6.2: a user asking about
        // feature packs in plain language must reach hermes, not the tool-less
        // provider-direct path (2026-06-28: a "which feature packs are installed"
        // ask routed direct and the model guessed instead of calling mcp_pack_list).
        &[0x529F, 0x80FD, 0x5305],         // feature pack
        &[0x5378, 0x8F7D],                 // uninstall
        &[0x5B89, 0x88C5],                 // install
        // online-research intents (ADR-005 irisy § persona-shell v5 §6.2): route
        // "go online / research / search the web" to hermes, which holds the
        // web_search gate tool; the direct path has none and denies it can browse.
        &[0x8054, 0x7F51],                 // go online (lian-wang)
        &[0x8FDE, 0x7F51],                 // connect to net (variant)
        &[0x4E0A, 0x7F51],                 // get online (shang-wang)
        &[0x8C03, 0x7814],                 // research (diao-yan)
        &[0x641C, 0x7D22],                 // search (sou-suo)
    ];
    CODEPOINTS
        .iter()
        .map(|cps| cps.iter().filter_map(|&c| char::from_u32(c)).collect::<String>())
        .collect()
}

/// Retrieve top vault matches for the latest user message and format them as a
/// context block, so the provider-direct path shares the same knowledge base as
/// hermes (ADR-005 irisy § persona-shell v5 §6.2). hermes searches the vault
/// live via its tools; the direct path has no tools, so we inject read-only
/// context here. Returns None when the vault is unavailable or nothing matches.
fn retrieve_kb_context(messages: &[ChatMessage]) -> Option<String> {
    let root = crate::kernel::vault::default_vault_root()?;
    retrieve_kb_context_at(&root, messages)
}

/// Core of retrieve_kb_context with an explicit vault root (ADR-005 irisy §
/// persona-shell v5 §6.2), so it is testable against a temp vault; the public
/// wrapper resolves the default root.
fn retrieve_kb_context_at(
    root: &std::path::Path,
    messages: &[ChatMessage],
) -> Option<String> {
    let query = messages
        .iter()
        .rev()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())?;
    if query.trim().is_empty() {
        return None;
    }
    let paths = crate::kernel::vault::search(root, &query, 3).ok()?;
    if paths.is_empty() {
        return None;
    }
    let mut block = String::from(
        "# Possibly-relevant notes from the user's knowledge base\n\
         (Use only if they actually answer the question; cite the path when you do.)\n",
    );
    for p in paths.iter().take(3) {
        let snippet: String = crate::kernel::vault::read(root, p)
            .map(|e| e.content)
            .unwrap_or_default()
            .chars()
            .take(500)
            .collect();
        if snippet.trim().is_empty() {
            continue;
        }
        block.push_str(&format!("\n## {p}\n{snippet}\n"));
    }
    Some(block)
}

async fn forward_to_provider(
    app: &AppHandle,
    request_id: &str,
    args: IrisyChatStreamArgs,
    registry: std::sync::Arc<crate::kernel::provider::registry::ProviderRegistry>,
) -> Result<(), String> {
    let mut messages: Vec<ChatMessage> = Vec::new();
    if let Some(skill_id) = args.skill_id.as_deref() {
        if let Some(prompt) = load_skill_system_prompt(skill_id).await {
            messages.push(ChatMessage {
                role: "system".to_string(),
                content: prompt,
            });
        }
    }
    if let Some(header) =
        build_mode_system_header(args.mode.as_deref(), args.project_dir.as_deref())
    {
        messages.push(ChatMessage {
            role: "system".to_string(),
            content: header,
        });
    }
    for m in args.messages.into_iter() {
        messages.push(ChatMessage {
            role: m.role,
            content: m.content,
        });
    }

    // ADR-002 substrate §1.8 v23 (bao 2026-06-17: Irisy defaults to hermes):
    // Irisy defaults to the hermes agent — the REAL assistant (its own SOUL.md
    // persona, persistent memory, skills) STREAMING over ACP. The bare provider
    // router answers as the raw vendor model with no Irisy identity (observed:
    // "I am Doubao"), so it is the FALLBACK only (offline / no hermes / hermes
    // error, CLAUDE.md derived rule #2). A slow agent turn stays interruptible
    // via the Stop button + never-block input (IrisyChat). Coding -> opencode.
    let coding_mode = args.mode.as_deref() == Some("coding");
    // Routing (ADR-005 irisy § persona-shell v5 §6.2): tool/action turns ->
    // hermes; pure-language turns -> provider-direct (clean + fast). Both share
    // the same persona/memory substrate (composed system prompt). `mode` can
    // force a path: "agent" always hermes, "direct" always provider.
    // ADR-005 irisy §8.3 (v7): ONE persistent engine ≡ ONE conversation. EVERY
    // non-coding turn goes to the engine so it owns the whole context — we no
    // longer split normal conversation to the tool-less provider-direct path,
    // which fragmented memory (§8.2). provider-direct is now ONLY a fallback:
    // an explicit `direct` mode, coding mode, or hermes not installed. The old
    // `turn_needs_agent` heuristic + `force_agent` no longer gate the engine.
    let force_direct = args.mode.as_deref() == Some("direct");
    // ADR-005 irisy §8.7: the RIGHT-region Irisy engine is a selectable ACP agent
    // (`hermes` default | `codex` | `claude-code`). hermes is the bundled default
    // and must be installed; a BYO engine reaching here was UI-gated on detection
    // (`list_byo_drivers` present), so we trust it and let the adapter spawn.
    let engine = args
        .agent
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or("hermes");
    let engine_ready = engine != "hermes"
        || crate::shell::agent_installer::is_installed(
            &crate::shell::agent_installer::AgentName::Hermes,
        );
    let use_agent = !coding_mode && !force_direct && engine_ready;
    if use_agent {
        // Conversation turns (user/assistant, in order) — the engine gets the
        // latest user message each turn, plus the prior turns replayed ONCE to
        // re-hydrate a fresh session (§8.4, in AcpClient::prompt).
        let turns: Vec<(String, String)> = messages
            .iter()
            .filter(|m| m.role == "user" || m.role == "assistant")
            .map(|m| (m.role.clone(), m.content.clone()))
            .collect();
        if turns.iter().any(|(r, _)| r == "user") {
            // Auth reuse (ADR-005 §8.8): hermes gets the active Irisy provider;
            // a BYO engine gets ITS canonical BYOK credential from the keychain
            // (codex → openai key, claude-code → anthropic key) so the user
            // never signs in twice. Empty when unconfigured → the CLI uses its
            // own login. The key rides only into the adapter subprocess env.
            let provider_env = if engine == "hermes" {
                registry.agent_env_injection()
            } else {
                registry.byo_engine_auth_env(engine)
            };
            let mut guard = crate::shell::acp_client::singleton().lock().await;
            // Engine switch (§8.7): if a different engine is running, reset so we
            // restart with the chosen adapter.
            if let Some(c) = guard.as_mut() {
                if c.engine() != engine {
                    *guard = None;
                }
            }
            let ready = if guard.is_none() {
                match crate::shell::acp_client::AcpClient::start(engine, &provider_env).await {
                    Ok(c) => {
                        *guard = Some(c);
                        true
                    }
                    Err(e) => {
                        eprintln!("[acp] {engine} start failed, using provider router: {e}");
                        false
                    }
                }
            } else {
                true
            };
            if ready {
                let client = guard.as_mut().expect("acp client present");
                let rid = request_id.to_string();
                let app2 = app.clone();
                // Feed the engine CTRL's composed system prompt (persona +
                // capability catalog) the PWA built — ADR-005 § persona-shell v5
                // (§6.2). System messages → preamble; user/assistant → turns.
                let system_preamble = messages
                    .iter()
                    .filter(|m| m.role == "system")
                    .map(|m| m.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let result = client
                    .prompt(&turns, Some(&system_preamble), |e: crate::shell::acp_client::AcpEvent| {
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
                    })
                    .await;
                match result {
                    Ok(_) => {
                        drop(guard);
                        emit_done(app, request_id, None);
                        return Ok(());
                    }
                    Err(e) => {
                        // ADR-005 irisy §8.3 (v7): do NOT nuke a LIVE engine session
                        // on a transient error — that was an amnesia mechanism (§8.2).
                        // Continuity is the ENGINE's: keep the session so its whole
                        // conversation context survives for the next turn; reset only
                        // when the engine process is genuinely DEAD (next turn then
                        // restarts + re-primes). Either way this turn falls through to
                        // the provider router so the user still gets an answer.
                        let dead = guard.as_mut().map(|c| !c.is_alive()).unwrap_or(true);
                        if dead {
                            *guard = None;
                        }
                        drop(guard);
                        eprintln!(
                            "[acp] hermes prompt failed (engine {}), using provider router: {e}",
                            if dead { "dead \u{2014} reset" } else { "alive \u{2014} session kept" }
                        );
                    }
                }
            }
        }
    }

    // KB retrieval for the provider-direct path so it shares the same vault as
    // hermes (ADR-005 irisy § persona-shell v5 §6.2). Injected right before the
    // user turn; hermes doesn't need this (it searches the vault live).
    if let Some(kb) = retrieve_kb_context(&messages) {
        let pos = messages
            .iter()
            .rposition(|m| m.role == "user")
            .unwrap_or(messages.len());
        messages.insert(
            pos,
            ChatMessage {
                role: "system".to_string(),
                content: kb,
            },
        );
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
    let model = if model_raw == "default" { String::new() } else { model_raw };
    let opts = ChatOpts {
        model,
        deadline_ms: 120_000,
    };

    let (_provider_id, mut rx) =
        route_text_chat(&registry, &Consumer::IrisyPrimary, &prompt, &opts).await?;

    while let Some(item) = rx.recv().await {
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
        assert!(turn_needs_agent(&user("filter by stage and sort by amount")));
        assert!(turn_needs_agent(&user("show the leads in a kanban board")));
        assert!(turn_needs_agent(&user("query my smart table for won deals")));
        // ADR-005 irisy § persona-shell v5 §6.2 — market-data turns read live
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
        // ADR-005 irisy § persona-shell v5 §6.2 — online-research intents must
        // reach hermes (it holds the web_search gate tool); the direct path has
        // none and would wrongly tell the user it cannot browse the internet.
        assert!(turn_needs_agent(&user("search the web for the latest news")));
        assert!(turn_needs_agent(&user("go online and research this")));
        // Chinese: go-online (U+8054 U+7F51) + research (U+8C03 U+7814) — the
        // exact phrasing that routed direct and got "I can't browse" (2026-06-28).
        assert!(turn_needs_agent(&user("\u{4f60}\u{80fd}\u{8fde}\u{7f51}\u{8c03}\u{7814}\u{4e86}")));
        assert!(turn_needs_agent(&user("\u{5e2e}\u{6211}\u{8054}\u{7f51}\u{67e5}\u{4e00}\u{4e0b}")));
    }

    #[test]
    fn empty_or_no_user_message_stays_direct() {
        assert!(!turn_needs_agent(&[]));
        assert!(!turn_needs_agent(&user("")));
    }

    #[test]
    fn kb_context_injects_a_matching_note_and_skips_misses() {
        let mut root = std::env::temp_dir();
        root.push(format!("ctrl_kb_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        crate::kernel::vault::write(
            &root,
            "notes/pomodoro.md",
            "The Pomodoro technique uses 25-minute focus intervals.",
            &serde_json::json!({}),
        )
        .unwrap();

        // Test mode uses the substring scan, so query a phrase that is in the
        // note. Real runs use FTS5 term search.
        let hit = retrieve_kb_context_at(&root, &user("pomodoro technique"))
            .expect("should find the note");
        assert!(hit.contains("Pomodoro technique uses"), "injects content: {hit}");
        assert!(hit.contains("pomodoro.md"), "cites the path: {hit}");

        // Unrelated query -> no injection.
        assert!(
            retrieve_kb_context_at(&root, &user("quantum physics homework")).is_none()
        );

        let _ = std::fs::remove_dir_all(&root);
    }
}
