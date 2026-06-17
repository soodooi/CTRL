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

    // ADR-002 substrate §1.8 v23 + §1 brain v22 (decision A, 2026-06-12): route
    // to the hermes agent over ACP (its persistent memory + skills, STREAMING
    // agent_message_chunk into chat-stream-delta) ONLY when the caller explicitly
    // asks for the assistant agent (mode == "assistant"). Default Irisy chat goes
    // straight to the fast provider router below — the full hermes agent loop
    // (tool searches, multi-step) is too slow/blocking for everyday chat, and a
    // busy agent rejects new sends with "agent not idle" (the "can't send" bug).
    // On any hermes error we still fall back to the provider router (CLAUDE.md
    // derived rule #2).
    let use_hermes = args.mode.as_deref() == Some("assistant");
    if use_hermes
        && crate::shell::agent_installer::is_installed(
            &crate::shell::agent_installer::AgentName::Hermes,
        )
    {
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
                let result = client
                    .prompt(&last_user, |d: &str| {
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
