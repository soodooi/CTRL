// claude_persistent — bespoke adapter for the `claude` CLI subprocess.
//
// ADR-002 substrate § provider v2 lock #5 — "claude_persistent.rs is bespoke, Goose-style
// OnceCell<Mutex<CliProcess>>". The pattern is lifted from
// `goose/providers/claude_code.rs` (FINDING-R2.md §3): one persistent
// child for the lifetime of the process, NDJSON stdin/stdout, drain
// protocol between turns to handle aborted streams.
//
// Why this provider is special: post-2026-04 Anthropic third-party-tool
// ban, the ONLY way for an external tool to bill a user's Claude Pro/Max
// subscription is to spawn the official `claude` CLI and let it use its
// own OAuth token. The CLI has a real warm-up cost (~80-150 ms Node +
// 100-300 ms vault unlock + 50-200 ms OAuth refresh) — paying it once
// per session instead of once per turn saves 300-650 ms on chat-heavy
// usage. That latency floor is the difference between "feels snappy"
// and "feels laggy" in the Irisy companion.
//
// The persistent child uses `--input-format stream-json --output-format
// stream-json`, emitting one NDJSON event per stdin/stdout line. Each
// turn writes one user event, then reads `assistant` + `result` events
// until the result terminates the turn. On abort (consumer drop /
// deadline) we mark the child needs_drain so the NEXT turn flushes any
// in-flight tokens before posting a new user message.
//
// `ANTHROPIC_API_KEY` is stripped from the child env so the CLI falls
// through to its keychain-stored OAuth token. Without that the request
// would bill the user's API account instead of their subscription.

use std::collections::BTreeSet;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{mpsc, Mutex, OnceCell};

use crate::kernel::provider::manifest::ProviderManifest;
use crate::kernel::provider::r#trait::{Capability, Provider};
use crate::kernel::provider::types::{ChatChunk, ChatMessage, ChatOpts, ChatPrompt, ProviderError};

const DEFAULT_DEADLINE_MS: u64 = 120_000;
const STREAM_BUFFER: usize = 64;
/// How long we'll wait for the previous turn's tail tokens to drain
/// before giving up and posting the next turn anyway. Matches Goose's
/// 30 s; longer than typical Anthropic stream-tail (<5 s) by 6x so we
/// almost never abort the drain in normal use.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(30);

pub struct ClaudePersistentProvider {
    id: String,
    binary: String,
    env_strip: Vec<String>,
    default_model: String,
    capabilities: BTreeSet<Capability>,
    /// Lazily-spawned long-lived child. First chat populates it; every
    /// subsequent chat reuses the same stdin/stdout pair under one
    /// per-turn lock so we don't interleave NDJSON events.
    cli: OnceCell<Arc<Mutex<CliProcess>>>,
}

impl ClaudePersistentProvider {
    pub fn from_manifest(manifest: Arc<ProviderManifest>) -> Result<Self, ProviderError> {
        let binary = manifest
            .binary
            .clone()
            .ok_or_else(|| ProviderError::ProviderError(format!(
                "claude_persistent manifest {} missing `binary`",
                manifest.id
            )))?;
        let default_model = manifest
            .models
            .first()
            .cloned()
            .unwrap_or_else(|| "sonnet".to_string());
        let capabilities = manifest.capabilities.iter().cloned().collect();
        Ok(Self {
            id: manifest.id.clone(),
            binary,
            env_strip: manifest.env_strip.clone(),
            default_model,
            capabilities,
            cli: OnceCell::new(),
        })
    }

    fn resolve_model<'a>(&'a self, model: &'a str) -> &'a str {
        if model.is_empty() {
            &self.default_model
        } else {
            model
        }
    }

    async fn cli_handle(
        &self,
        model: &str,
        system: Option<&str>,
    ) -> Result<Arc<Mutex<CliProcess>>, ProviderError> {
        let binary = self.binary.clone();
        let env_strip = self.env_strip.clone();
        let model_owned = model.to_string();
        let system_owned = system.map(|s| s.to_string());
        let handle = self
            .cli
            .get_or_try_init(|| async move {
                let cli = CliProcess::spawn(&binary, &env_strip, &model_owned, system_owned.as_deref()).await?;
                Ok::<_, ProviderError>(Arc::new(Mutex::new(cli)))
            })
            .await?
            .clone();
        Ok(handle)
    }
}

#[async_trait]
impl Provider for ClaudePersistentProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn capabilities(&self) -> BTreeSet<Capability> {
        self.capabilities.clone()
    }

    async fn chat_stream(
        &self,
        prompt: &ChatPrompt,
        opts: &ChatOpts,
    ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
        let model = self.resolve_model(&opts.model).to_string();
        let deadline = if opts.deadline_ms == 0 {
            DEFAULT_DEADLINE_MS
        } else {
            opts.deadline_ms
        };

        let cli_arc = self.cli_handle(&model, prompt.system.as_deref()).await?;
        let folded = fold_history_into_user(&prompt.messages);
        let provider_id = self.id.clone();

        let (tx, rx) = mpsc::channel(STREAM_BUFFER);
        let tx_deadline = tx.clone();
        tokio::spawn(async move {
            let work = async {
                let mut cli = cli_arc.lock().await;
                // Drain any tail tokens from a previously-aborted turn so
                // we don't read them as part of THIS turn's reply.
                cli.drain_pending_response().await;

                if let Err(e) = cli.write_user_event(&folded).await {
                    let _ = tx.send(Err(e)).await;
                    return;
                }

                let mut emitted_finish = false;
                loop {
                    match cli.read_one_event().await {
                        Ok(Some(EventOutcome::Chunk(c))) => {
                            let is_done = c.finish_reason.is_some();
                            if is_done {
                                emitted_finish = true;
                            }
                            if tx.send(Ok(c)).await.is_err() {
                                cli.needs_drain = true;
                                return;
                            }
                            if is_done {
                                return;
                            }
                        }
                        Ok(Some(EventOutcome::Skip)) => continue,
                        Ok(None) => {
                            if !emitted_finish {
                                let _ = tx
                                    .send(Err(ProviderError::ProviderError(format!(
                                        "{provider_id}: child stdout ended without result event"
                                    ))))
                                    .await;
                            }
                            return;
                        }
                        Err(e) => {
                            let _ = tx.send(Err(e)).await;
                            cli.needs_drain = true;
                            return;
                        }
                    }
                }
            };
            if tokio::time::timeout(Duration::from_millis(deadline), work)
                .await
                .is_err()
            {
                let _ = tx_deadline
                    .send(Err(ProviderError::DeadlineExceeded(deadline)))
                    .await;
            }
        });

        Ok(rx)
    }

    fn trial_verify(&self) -> Result<(), ProviderError> {
        if self.binary.trim().is_empty() {
            return Err(ProviderError::NotConfigured(format!(
                "{}: claude binary path empty",
                self.id
            )));
        }
        Ok(())
    }
}

// ── persistent child wrapper ─────────────────────────────────────────────

struct CliProcess {
    child: Child,
    stdin: ChildStdin,
    reader: BufReader<ChildStdout>,
    needs_drain: bool,
}

impl CliProcess {
    async fn spawn(
        binary: &str,
        env_strip: &[String],
        model: &str,
        system: Option<&str>,
    ) -> Result<Self, ProviderError> {
        // ADR-002 substrate §1 + memory `feedback_no_claude_in_production` lock: when
        // the user has the `claude` Code CLI installed externally, the
        // claude-oauth adapter is allowed to spawn it (user choice, not
        // CTRL-bundled SDK). But Tauri inherits a sparse PATH
        // (`/usr/bin:/bin:/usr/sbin:/sbin` — verified in production via
        // `ps eww`), so `Command::new("claude")` fails NotFound even when
        // `/opt/homebrew/bin/claude` (cask) or `~/.npm-global/bin/claude`
        // (npm -g) exists. brain_supervisor + pi_install hit the same
        // trap and fix it by prepending common bin dirs to PATH; this
        // adapter is the third spawn site and was missed.
        // bao 2026-05-31 (124-trail diagnose): "aren't you on a claude
        // subscription? how come vmark could detect it?" — claude IS installed locally
        // (/opt/homebrew/Caskroom/claude-code/...), the adapter just
        // couldn't see it.
        let resolved_binary = resolve_binary_path(binary);
        let mut cmd = Command::new(&resolved_binary);
        cmd.arg("--output-format")
            .arg("stream-json")
            .arg("--input-format")
            .arg("stream-json")
            .arg("--model")
            .arg(model)
            .arg("--verbose")
            // Disable the CLI's own tool invocations — Irisy drives the
            // ReAct loop in the PWA, claude is a pure text responder
            // here. Without this it tries Bash/Edit and blocks on a
            // permission prompt with stdin closed.
            .arg("--tools")
            .arg("")
            .arg("-p")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        // Augment PATH so the spawned `claude` can in turn find its own
        // node helper, ripgrep, etc. via env. Without this `claude` itself
        // may exit silently when its internal `env: node` shim 127s.
        let augmented_path = augmented_path();
        cmd.env("PATH", &augmented_path);
        for var in env_strip {
            cmd.env_remove(var);
        }
        if let Some(sys) = system {
            cmd.arg("--system-prompt").arg(sys);
        }

        let mut child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ProviderError::ProviderError(format!(
                    "claude binary {:?} not found on PATH ({}). Install Claude Code CLI or override `binary` in the manifest.",
                    binary, augmented_path
                ))
            } else {
                ProviderError::ProviderError(format!("claude spawn failed: {e}"))
            }
        })?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| ProviderError::ProviderError("claude stdin not piped".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProviderError::ProviderError("claude stdout not piped".into()))?;
        // Detach stderr to a background drain so the child's stderr pipe
        // never fills + back-pressures the assistant tokens.
        if let Some(mut stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut buf = Vec::with_capacity(1024);
                let _ = stderr.read_to_end(&mut buf).await;
            });
        }
        Ok(Self {
            child,
            stdin,
            reader: BufReader::new(stdout),
            needs_drain: false,
        })
    }

    async fn write_user_event(&mut self, content: &str) -> Result<(), ProviderError> {
        let event = UserEvent {
            ty: "user",
            message: UserPayload {
                role: "user",
                content,
            },
        };
        let line = serde_json::to_string(&event).map_err(|e| {
            ProviderError::ProviderError(format!("claude stdin serialize: {e}"))
        })?;
        self.stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| ProviderError::ProviderError(format!("claude stdin write: {e}")))?;
        self.stdin
            .write_all(b"\n")
            .await
            .map_err(|e| ProviderError::ProviderError(format!("claude stdin newline: {e}")))?;
        self.stdin
            .flush()
            .await
            .map_err(|e| ProviderError::ProviderError(format!("claude stdin flush: {e}")))?;
        Ok(())
    }

    /// Read one NDJSON event off stdout. Maps it to a `ChatChunk`, a
    /// skip (control event we ignore), or end-of-stream (`Ok(None)`).
    async fn read_one_event(&mut self) -> Result<Option<EventOutcome>, ProviderError> {
        let mut line = String::new();
        match self.reader.read_line(&mut line).await {
            Ok(0) => Ok(None),
            Ok(_) => Ok(Some(parse_event_line(line.trim()))),
            Err(e) => Err(ProviderError::ProviderError(format!(
                "claude stdout read: {e}"
            ))),
        }
    }

    /// Flush any pending tokens from a previously-aborted turn so the
    /// next turn doesn't read them as its own reply. Bounded by
    /// DRAIN_TIMEOUT; on timeout we leave `needs_drain = true` so the
    /// next caller retries.
    async fn drain_pending_response(&mut self) {
        if !self.needs_drain {
            return;
        }
        tracing::debug!("claude_persistent: draining pending response");
        let drain = async {
            loop {
                let mut line = String::new();
                match self.reader.read_line(&mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                            match parsed.get("type").and_then(|t| t.as_str()) {
                                Some("result") | Some("error") => break,
                                _ => continue,
                            }
                        }
                    }
                    Err(_) => break,
                }
            }
        };
        match tokio::time::timeout(DRAIN_TIMEOUT, drain).await {
            Ok(()) => {
                self.needs_drain = false;
                tracing::debug!("claude_persistent: drain complete");
            }
            Err(_) => tracing::warn!(
                "claude_persistent: drain did not finish within {DRAIN_TIMEOUT:?}; will retry"
            ),
        }
    }
}

impl Drop for CliProcess {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

enum EventOutcome {
    Chunk(ChatChunk),
    Skip,
}

// ── stream-json wire shapes ──────────────────────────────────────────────

#[derive(Serialize)]
struct UserEvent<'a> {
    #[serde(rename = "type")]
    ty: &'a str,
    message: UserPayload<'a>,
}

#[derive(Serialize)]
struct UserPayload<'a> {
    role: &'a str,
    content: &'a str,
}

fn parse_event_line(line: &str) -> EventOutcome {
    if line.is_empty() {
        return EventOutcome::Skip;
    }
    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(x) => x,
        Err(_) => return EventOutcome::Skip,
    };
    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
        "assistant" => {
            let content_arr = match v.pointer("/message/content").and_then(|c| c.as_array()) {
                Some(a) => a,
                None => return EventOutcome::Skip,
            };
            let mut text = String::new();
            for block in content_arr {
                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                    if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                        text.push_str(t);
                    }
                }
            }
            if text.is_empty() {
                EventOutcome::Skip
            } else {
                EventOutcome::Chunk(ChatChunk {
                    delta: text,
                    finish_reason: None,
                })
            }
        }
        "result" => EventOutcome::Chunk(ChatChunk {
            delta: String::new(),
            finish_reason: Some("stop".into()),
        }),
        _ => EventOutcome::Skip,
    }
}

fn fold_history_into_user(messages: &[ChatMessage]) -> String {
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

/// Resolve a CLI binary name to an absolute path by scanning common bin
/// dirs the Tauri-sparse PATH omits. Falls back to the original name on
/// miss — `Command::spawn` will then surface the canonical NotFound.
///
/// bao 2026-05-31 (124-trail): Tauri ctrl process inherits PATH =
/// `/usr/bin:/bin:/usr/sbin:/sbin`. `claude` lives at
/// `/opt/homebrew/bin/claude` (Cask) or `~/.npm-global/bin/claude`
/// (`npm i -g`); neither is on the sparse PATH. Same trap brain_supervisor
/// + pi_install fix at their spawn sites.
fn resolve_binary_path(binary: &str) -> String {
    // Already absolute — trust caller.
    if std::path::Path::new(binary).is_absolute() {
        return binary.to_string();
    }
    for dir in candidate_bin_dirs() {
        let candidate = std::path::Path::new(&dir).join(binary);
        if candidate.is_file() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    binary.to_string()
}

/// Augmented PATH for `claude`'s own subprocess use (it shells out to its
/// internal node + helpers). Prepends common bin dirs so `env: node not
/// found` doesn't 127 the child.
fn augmented_path() -> String {
    let existing = std::env::var("PATH").unwrap_or_default();
    let mut parts: Vec<String> = candidate_bin_dirs();
    if !existing.is_empty() {
        for p in existing.split(':') {
            if !parts.iter().any(|q| q == p) {
                parts.push(p.to_string());
            }
        }
    }
    parts.join(":")
}

fn candidate_bin_dirs() -> Vec<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = vec![
        "/opt/homebrew/bin".into(),     // Apple Silicon Homebrew (Cask + Brew)
        "/usr/local/bin".into(),        // Intel Homebrew + manual installs
    ];
    if !home.is_empty() {
        dirs.push(format!("{home}/.npm-global/bin")); // npm -g without sudo
        dirs.push(format!("{home}/.volta/bin"));      // Volta-managed node
        dirs.push(format!("{home}/.nvm/versions/node/current/bin"));
        dirs.push(format!("{home}/.ctrl/pi/node_modules/.bin"));
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fold_single_message_returns_content_verbatim() {
        let msgs = vec![ChatMessage {
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
            ChatMessage { role: "user".into(), content: "hi".into() },
            ChatMessage { role: "assistant".into(), content: "hey".into() },
            ChatMessage { role: "user".into(), content: "more?".into() },
        ];
        let folded = fold_history_into_user(&msgs);
        assert!(folded.contains("[user] hi"));
        assert!(folded.contains("[assistant] hey"));
        assert!(folded.contains("Current turn:\nmore?"));
    }

    #[test]
    fn parse_assistant_text_block_yields_delta() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi"}]}}"#;
        match parse_event_line(line) {
            EventOutcome::Chunk(c) => {
                assert_eq!(c.delta, "Hi");
                assert!(c.finish_reason.is_none());
            }
            EventOutcome::Skip => panic!("expected chunk"),
        }
    }

    #[test]
    fn parse_assistant_concatenates_multiple_text_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hello "},{"type":"text","text":"world"}]}}"#;
        match parse_event_line(line) {
            EventOutcome::Chunk(c) => assert_eq!(c.delta, "Hello world"),
            EventOutcome::Skip => panic!("expected chunk"),
        }
    }

    #[test]
    fn parse_assistant_skips_tool_use_blocks() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"x","name":"y","input":{}},{"type":"text","text":"after tool"}]}}"#;
        match parse_event_line(line) {
            EventOutcome::Chunk(c) => assert_eq!(c.delta, "after tool"),
            EventOutcome::Skip => panic!("expected chunk"),
        }
    }

    #[test]
    fn parse_result_yields_finish_reason() {
        let line = r#"{"type":"result","total_cost_usd":0,"is_error":false}"#;
        match parse_event_line(line) {
            EventOutcome::Chunk(c) => assert_eq!(c.finish_reason.as_deref(), Some("stop")),
            EventOutcome::Skip => panic!("expected chunk"),
        }
    }

    #[test]
    fn parse_other_events_skip() {
        for line in [
            r#"{"type":"system","subtype":"init"}"#,
            r#"{"type":"user","message":{}}"#,
            "{}",
            "not json",
            "",
        ] {
            assert!(matches!(parse_event_line(line), EventOutcome::Skip));
        }
    }
}
