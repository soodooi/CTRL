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
    match mode.unwrap_or("personal") {
        "coding" => {
            let dir = project_dir.unwrap_or("~");
            Some(format!(
                "You are operating in CTRL's Coding mode. The user's \
                 active project directory is `{dir}`. Treat this as your \
                 working directory for the rest of this turn — `cd` there \
                 with your shell tool before running build / test / git \
                 commands. Prefer making changes inside this directory \
                 rather than the user's home folder."
            ))
        }
        _ => None,
    }
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
        "schedule a", "recurring", "refactor", "edit the file",
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
        // (Chinese equivalents pending — see hook/convention note.)
        "smart table", "smart-table", "kanban", "filter by", "sort by", "group by",
    ];
    NEEDS.iter().any(|k| last.contains(k))
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
    let force_agent = args.mode.as_deref() == Some("agent");
    let force_direct = args.mode.as_deref() == Some("direct");
    let use_agent = !coding_mode
        && !force_direct
        && crate::shell::agent_installer::is_installed(
            &crate::shell::agent_installer::AgentName::Hermes,
        )
        && (force_agent || turn_needs_agent(&messages));
    if use_agent {
        if let Some(last_user) = messages
            .iter()
            .rev()
            .find(|m| m.role == "user")
            .map(|m| m.content.clone())
        {
            let provider_env = registry.agent_env_injection();
            let mut guard = crate::shell::acp_client::singleton().lock().await;
            let ready = if guard.is_none() {
                match crate::shell::acp_client::AcpClient::start(&provider_env).await {
                    Ok(c) => {
                        *guard = Some(c);
                        true
                    }
                    Err(e) => {
                        eprintln!("[acp] hermes start failed, using provider router: {e}");
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
                // Feed hermes CTRL's composed system prompt (persona +
                // capability catalog + brain_state) the PWA already built —
                // ADR-005 irisy § persona-shell v5 (§6.2 capabilities).
                // Previously only `last_user` reached hermes, so it answered
                // from its own SOUL.md/skills and didn't know CTRL's
                // capabilities (leaked its own identity instead).
                let system_preamble = messages
                    .iter()
                    .filter(|m| m.role == "system")
                    .map(|m| m.content.as_str())
                    .collect::<Vec<_>>()
                    .join("\n\n");
                let result = client
                    .prompt(&last_user, Some(&system_preamble), |d: &str| {
                        let _ = app2.emit(
                            "chat-stream-delta",
                            StreamDelta {
                                request_id: rid.clone(),
                                delta: d.to_string(),
                                done: false,
                                error: None,
                                custom: None,
                            },
                        );
                    })
                    .await;
                match result {
                    Ok(_) => {
                        drop(guard);
                        emit_done(app, request_id, None);
                        return Ok(());
                    }
                    Err(e) => {
                        // Drop the (possibly wedged) client so the next turn
                        // restarts it cleanly, then fall through to the router.
                        *guard = None;
                        drop(guard);
                        eprintln!("[acp] hermes prompt failed, using provider router: {e}");
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
