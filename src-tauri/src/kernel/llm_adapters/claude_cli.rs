// ClaudeCliAdapter — LlmAdapter that spawns the `claude` CLI binary as
// a subprocess for each turn. Stdin gets the user message as NDJSON,
// stdout yields the response as NDJSON events.
//
// Why this path exists: after Anthropic's 2026-04 third-party-tool API
// ban, the ONLY way for an external tool to bill a request against a
// user's Claude Pro/Max subscription is to spawn the official `claude`
// CLI and let it use its own OAuth token. Direct HTTP to api.anthropic
// .com requires a BYOK API key (= billed separately to user's API
// account). This adapter serves the subscription-holder case;
// AnthropicHttpAdapter serves the BYOK case.
//
// Auth flow: we explicitly env_remove("ANTHROPIC_API_KEY") so the CLI
// falls through to its keychain-stored OAuth token. Without this,
// passing ANTHROPIC_API_KEY through would bill the user's API account
// even when they have a subscription.
//
// Pattern inspired by Cline `apps/vscode/src/integrations/claude-code/
// run.ts` and Goose `crates/goose/src/providers/claude_code.rs`,
// simplified to per-turn spawn (no persistent process). Goose's
// persistent-subprocess optimization saves the ~400-600ms Node cold
// start per turn — worth doing in v1.1, not v1. Single-turn `-p` mode
// matches what these reference implementations use for one-shot calls.

use crate::kernel::llm_port::{LlmAdapter, LlmChunk, LlmError, LlmMessage, LlmPrompt};
use async_trait::async_trait;
use serde::Serialize;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

/// 120s — `claude` CLI does its own networking + tool calls, slower
/// than a raw HTTP turn. Generous deadline avoids surprise timeouts on
/// extended thinking models.
const DEFAULT_DEADLINE_MS: u64 = 120_000;
const STREAM_BUFFER: usize = 64;

#[derive(Clone)]
pub struct ClaudeCliAdapter {
    name: String,
    binary_path: String,
    default_model: String,
}

impl ClaudeCliAdapter {
    pub fn new(
        name: impl Into<String>,
        binary_path: impl Into<String>,
        default_model: impl Into<String>,
    ) -> Self {
        Self {
            name: name.into(),
            binary_path: binary_path.into(),
            default_model: default_model.into(),
        }
    }

    /// Resolve `claude` in PATH. Returns the absolute path so the spawn
    /// site has a stable target even if the parent process's PATH later
    /// changes. None when `claude` is not installed.
    pub fn locate_binary() -> Option<String> {
        // `which`-equivalent: spawn `command -v claude` via login shell so
        // we pick up Homebrew / nvm / pyenv PATH additions the GUI parent
        // (Tauri shell) usually misses. Sync std::process is fine — this
        // runs once at boot, not on every turn.
        let output = std::process::Command::new("sh")
            .arg("-lc")
            .arg("command -v claude")
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if path.is_empty() {
            None
        } else {
            Some(path)
        }
    }

    fn resolve_model<'a>(&'a self, model: &'a str) -> &'a str {
        if model.is_empty() {
            &self.default_model
        } else {
            model
        }
    }

    async fn spawn_and_stream(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        deadline_ms: u64,
    ) -> Result<mpsc::Receiver<Result<LlmChunk, LlmError>>, LlmError> {
        let resolved = self.resolve_model(model).to_string();
        let deadline = if deadline_ms == 0 {
            DEFAULT_DEADLINE_MS
        } else {
            deadline_ms
        };

        let mut cmd = Command::new(&self.binary_path);
        cmd.arg("--output-format")
            .arg("stream-json")
            .arg("--input-format")
            .arg("stream-json")
            .arg("--model")
            .arg(&resolved)
            .arg("--max-turns")
            .arg("1")
            .arg("--verbose")
            // Disable claude's OWN built-in tools. In the Irisy chat, claude is
            // a pure TEXT responder that drives the FRONTEND ReAct loop via
            // <call> tags. Without this it tries to run Bash/Edit itself (it's
            // an agent) and then blocks on a permission prompt with stdin closed
            // — the chat hangs forever. Empty list = no built-in tools.
            .arg("--tools")
            .arg("")
            .arg("-p")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            // If we drop the child (deadline hit, or the PWA closes the
            // receiver), kill the subprocess — otherwise a stuck `claude`
            // (e.g. waiting on a tool permission with stdin closed) would
            // live forever and the Irisy chat would hang with no recovery.
            .kill_on_drop(true);
        // CRITICAL: drop ANTHROPIC_API_KEY so the CLI uses its stored
        // OAuth subscription token, not the user's API account key.
        cmd.env_remove("ANTHROPIC_API_KEY");

        if let Some(sys) = &prompt.system {
            cmd.arg("--system-prompt").arg(sys);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| LlmError::ProviderError(format!("claude spawn failed: {e}")))?;

        let stdin_payload = build_stdin_payload(&prompt.messages)?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(stdin_payload.as_bytes())
                .await
                .map_err(|e| LlmError::ProviderError(format!("claude stdin write: {e}")))?;
            // shutdown() signals EOF — without it the CLI waits for more
            // messages and never starts processing in --max-turns 1 mode.
            stdin.shutdown().await.ok();
        } else {
            return Err(LlmError::ProviderError("claude stdin not piped".into()));
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| LlmError::ProviderError("claude stdout not piped".into()))?;
        let stderr = child.stderr.take();

        let (tx, rx) = mpsc::channel(STREAM_BUFFER);
        // A separate sender kept outside the read loop so the deadline branch
        // can still report an error after the loop future (which owns `child`)
        // is dropped + the subprocess killed.
        let tx_deadline = tx.clone();
        tokio::spawn(async move {
            let read_loop = async move {
                let mut reader = BufReader::new(stdout).lines();
                loop {
                    match reader.next_line().await {
                        Ok(Some(line)) => {
                            if let Some(chunk) = parse_stream_json_line(&line) {
                                if tx.send(Ok(chunk)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = tx
                                .send(Err(LlmError::ProviderError(format!(
                                    "claude stdout read: {e}"
                                ))))
                                .await;
                            return;
                        }
                    }
                }
                // Reap the child + drain stderr so non-zero exits surface as
                // a typed error rather than disappearing into the void.
                if let Ok(status) = child.wait().await {
                    if !status.success() {
                        let mut stderr_text = String::new();
                        if let Some(mut e) = stderr {
                            let _ = e.read_to_string(&mut stderr_text).await;
                        }
                        let err = classify_cli_error(status.code(), &stderr_text);
                        let _ = tx.send(Err(err)).await;
                    }
                }
            };
            // Watchdog: if claude wedges (no output, never exits), the read
            // loop never completes. Bound it — on timeout the read_loop future
            // is dropped, `child` drops with it, and kill_on_drop terminates
            // the subprocess so it can't linger. Then surface a typed error so
            // the Irisy chat unsticks instead of hanging forever.
            if tokio::time::timeout(Duration::from_millis(deadline), read_loop)
                .await
                .is_err()
            {
                let _ = tx_deadline
                    .send(Err(LlmError::DeadlineExceeded(deadline)))
                    .await;
            }
        });

        Ok(rx)
    }
}

#[async_trait]
impl LlmAdapter for ClaudeCliAdapter {
    fn name(&self) -> &str {
        &self.name
    }

    fn supports(&self, _model: &str) -> bool {
        true
    }

    async fn complete(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        deadline_ms: u64,
    ) -> Result<String, LlmError> {
        let deadline = if deadline_ms == 0 {
            DEFAULT_DEADLINE_MS
        } else {
            deadline_ms
        };
        let mut rx = tokio::time::timeout(
            Duration::from_millis(deadline),
            self.spawn_and_stream(model, prompt, deadline),
        )
        .await
        .map_err(|_| LlmError::DeadlineExceeded(deadline))??;

        let mut acc = String::new();
        let collect = async {
            while let Some(item) = rx.recv().await {
                match item {
                    Ok(c) => acc.push_str(&c.delta),
                    Err(e) => return Err(e),
                }
            }
            Ok(acc)
        };
        tokio::time::timeout(Duration::from_millis(deadline), collect)
            .await
            .map_err(|_| LlmError::DeadlineExceeded(deadline))?
    }

    async fn stream_chat(
        &self,
        model: &str,
        prompt: &LlmPrompt,
        deadline_ms: u64,
    ) -> Result<mpsc::Receiver<Result<LlmChunk, LlmError>>, LlmError> {
        self.spawn_and_stream(model, prompt, deadline_ms).await
    }
}

// ── stream-json wire shapes ─────────────────────────────────────────────

#[derive(Serialize)]
struct UserEvent<'a> {
    #[serde(rename = "type")]
    ty: &'a str, // "user"
    message: UserPayload<'a>,
}

#[derive(Serialize)]
struct UserPayload<'a> {
    role: &'a str, // "user"
    content: &'a str,
}

fn build_stdin_payload(messages: &[LlmMessage]) -> Result<String, LlmError> {
    // Claude Code's stream-json input mode accepts one event per line.
    // For single-turn `-p --max-turns 1`, we fold any prior conversation
    // into a single user message — lossy but acceptable for v1. A real
    // multi-turn implementation would spawn a persistent CLI session and
    // emit one event per turn; that's the v1.1 optimization.
    let folded = fold_history_into_user(messages);
    let event = UserEvent {
        ty: "user",
        message: UserPayload {
            role: "user",
            content: &folded,
        },
    };
    let line = serde_json::to_string(&event)
        .map_err(|e| LlmError::ProviderError(format!("serialize claude stdin: {e}")))?;
    Ok(format!("{line}\n"))
}

fn fold_history_into_user(messages: &[LlmMessage]) -> String {
    if messages.is_empty() {
        return String::new();
    }
    let last_idx = messages.len() - 1;
    if last_idx == 0 {
        return messages[0].content.clone();
    }
    let mut out = String::from("Previous turns:\n");
    for m in &messages[..last_idx] {
        out.push('[');
        out.push_str(&m.role);
        out.push_str("] ");
        out.push_str(&m.content);
        out.push('\n');
    }
    out.push_str("\nCurrent turn:\n");
    out.push_str(&messages[last_idx].content);
    out
}

fn parse_stream_json_line(line: &str) -> Option<LlmChunk> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    match v.get("type").and_then(|t| t.as_str())? {
        "assistant" => {
            // {"type":"assistant","message":{"content":[{"type":"text","text":"..."}, ...]}}
            // The content array can carry multiple blocks (text + tool_use);
            // v1 picks up only the text blocks — tool use rendering is the
            // keycap layer's job.
            let content_arr = v.pointer("/message/content")?.as_array()?;
            let mut text = String::new();
            for block in content_arr {
                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        text.push_str(t);
                    }
                }
            }
            if text.is_empty() {
                return None;
            }
            Some(LlmChunk {
                delta: text,
                finish_reason: None,
            })
        }
        "result" => Some(LlmChunk {
            delta: String::new(),
            finish_reason: Some("stop".into()),
        }),
        _ => None,
    }
}

fn classify_cli_error(exit_code: Option<i32>, stderr: &str) -> LlmError {
    let lower = stderr.to_lowercase();
    // The CLI prints these phrases (verified against `claude` v2.x output)
    // when the OAuth token is missing or expired — surface as AuthFailed
    // so the keycap UI can render a "run claude login" affordance instead
    // of a generic provider error.
    if lower.contains("not authenticated")
        || lower.contains("please login")
        || lower.contains("login required")
        || lower.contains("expired")
    {
        return LlmError::AuthFailed;
    }
    if lower.contains("rate limit") || lower.contains("quota") {
        return LlmError::QuotaExhausted;
    }
    let code = exit_code
        .map(|c| c.to_string())
        .unwrap_or_else(|| "signal".into());
    LlmError::ProviderError(format!("claude exit {code}: {}", stderr.trim()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_single_message_returns_content_verbatim() {
        let msgs = vec![LlmMessage {
            role: "user".into(),
            content: "hello".into(),
        }];
        assert_eq!(fold_history_into_user(&msgs), "hello");
    }

    #[test]
    fn fold_empty_returns_empty() {
        assert_eq!(fold_history_into_user(&[]), "");
    }

    #[test]
    fn fold_multi_turn_prefixes_history() {
        let msgs = vec![
            LlmMessage {
                role: "user".into(),
                content: "hi".into(),
            },
            LlmMessage {
                role: "assistant".into(),
                content: "hey".into(),
            },
            LlmMessage {
                role: "user".into(),
                content: "what's up".into(),
            },
        ];
        let folded = fold_history_into_user(&msgs);
        assert!(folded.contains("[user] hi"));
        assert!(folded.contains("[assistant] hey"));
        assert!(folded.contains("Current turn:\nwhat's up"));
    }

    #[test]
    fn build_stdin_payload_ends_with_newline() {
        let msgs = vec![LlmMessage {
            role: "user".into(),
            content: "x".into(),
        }];
        let payload = build_stdin_payload(&msgs).unwrap();
        assert!(payload.ends_with('\n'));
        assert!(payload.contains(r#""type":"user""#));
        assert!(payload.contains(r#""content":"x""#));
    }

    #[test]
    fn parse_assistant_text_block() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}"#;
        let c = parse_stream_json_line(line).unwrap();
        assert_eq!(c.delta, "Hello");
        assert!(c.finish_reason.is_none());
    }

    #[test]
    fn parse_assistant_concatenates_multiple_text_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}}"#;
        let c = parse_stream_json_line(line).unwrap();
        assert_eq!(c.delta, "Hello world");
    }

    #[test]
    fn parse_assistant_skips_tool_use_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":"y","input":{}},{"type":"text","text":"after tool"}]}}"#;
        let c = parse_stream_json_line(line).unwrap();
        assert_eq!(c.delta, "after tool");
    }

    #[test]
    fn parse_result_signals_stop() {
        let line = r#"{"type":"result","total_cost_usd":0,"is_error":false}"#;
        let c = parse_stream_json_line(line).unwrap();
        assert_eq!(c.delta, "");
        assert_eq!(c.finish_reason.as_deref(), Some("stop"));
    }

    #[test]
    fn parse_skips_system_and_ping() {
        assert!(parse_stream_json_line(r#"{"type":"system","subtype":"init"}"#).is_none());
        assert!(parse_stream_json_line(r#"{"type":"user","message":{}}"#).is_none());
    }

    #[test]
    fn parse_skips_garbage() {
        assert!(parse_stream_json_line("").is_none());
        assert!(parse_stream_json_line("not json").is_none());
        assert!(parse_stream_json_line(r#"{}"#).is_none());
    }

    #[test]
    fn classify_cli_error_detects_auth_phrases() {
        assert!(matches!(
            classify_cli_error(Some(1), "Error: Not authenticated. Please login."),
            LlmError::AuthFailed
        ));
        assert!(matches!(
            classify_cli_error(Some(1), "OAuth token expired"),
            LlmError::AuthFailed
        ));
    }

    #[test]
    fn classify_cli_error_detects_quota() {
        assert!(matches!(
            classify_cli_error(Some(1), "rate limit exceeded"),
            LlmError::QuotaExhausted
        ));
    }

    #[test]
    fn classify_cli_error_falls_through_to_provider_error() {
        assert!(matches!(
            classify_cli_error(Some(2), "unknown failure"),
            LlmError::ProviderError(_)
        ));
    }
}
