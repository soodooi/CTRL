// One-shot CLI provider — manifest-driven generic spawner for codex /
// gemini / any CLI that exposes a single-turn JSON I/O mode.
//
// ADR-002 substrate § provider v1 lock #5: "cli/one_shot.rs (codex/gemini, manifest-driven,
// ~200 LOC)". Compared to claude_persistent.rs, this adapter is
// stateless — one spawn per turn, no warm child to reuse, no NDJSON
// control protocol. The trade-off is the ~80-150 ms node-cold-start
// per turn; for codex / gemini that's acceptable because they don't
// expose a persistent stream-json mode.
//
// Wire convention: the binary receives the rendered prompt on stdin
// (one line: the last user message, fall back to concatenated history),
// and writes one JSON envelope per emitted token on stdout. Manifest
// `args_template` controls the arg vector; `{model}` is the only
// placeholder today. Adapters that need richer templating extend the
// substitution table below.

use std::collections::BTreeMap;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;

use crate::kernel::provider::manifest::ProviderManifest;
use crate::kernel::provider::r#trait::{Capability, Provider};
use crate::kernel::provider::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

/// 120 s — CLIs that themselves dispatch tool calls (codex with shell
/// access, etc.) can run longer than a raw HTTP turn. Generous deadline
/// avoids surprise timeouts; the watchdog inside `spawn_and_stream` kills
/// the subprocess if it wedges past the wall clock.
const DEFAULT_DEADLINE_MS: u64 = 120_000;
const STREAM_BUFFER: usize = 64;

pub struct OneShotCliProvider {
    id: String,
    binary: String,
    args_template: Vec<String>,
    env_strip: Vec<String>,
    env_inject: BTreeMap<String, String>,
    default_model: String,
    auth_secret: String,
    capabilities: std::collections::BTreeSet<Capability>,
}

impl OneShotCliProvider {
    pub fn from_manifest(
        manifest: Arc<ProviderManifest>,
        auth_secret: String,
    ) -> Result<Self, ProviderError> {
        let binary = manifest.binary.clone().ok_or_else(|| {
            ProviderError::ProviderError(format!("cli manifest {} missing `binary`", manifest.id))
        })?;
        let default_model = manifest.models.first().cloned().unwrap_or_default();
        let capabilities = manifest.capabilities.iter().cloned().collect();
        Ok(Self {
            id: manifest.id.clone(),
            binary,
            args_template: manifest.args_template.clone(),
            env_strip: manifest.env_strip.clone(),
            env_inject: manifest.env_inject.clone(),
            default_model,
            auth_secret,
            capabilities,
        })
    }

    fn resolve_model<'a>(&'a self, model: &'a str) -> &'a str {
        if model.is_empty() {
            &self.default_model
        } else {
            model
        }
    }

    fn rendered_args(&self, model: &str) -> Vec<String> {
        if self.args_template.is_empty() {
            return vec!["-p".to_string(), "--model".to_string(), model.to_string()];
        }
        self.args_template
            .iter()
            .map(|arg| substitute_args(arg, model))
            .collect()
    }
}

#[async_trait]
impl Provider for OneShotCliProvider {
    fn id(&self) -> &str {
        &self.id
    }

    fn capabilities(&self) -> std::collections::BTreeSet<Capability> {
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

        let args = self.rendered_args(&model);
        let mut cmd = Command::new(&self.binary);
        cmd.args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for var in &self.env_strip {
            cmd.env_remove(var);
        }
        for (k, v) in &self.env_inject {
            let resolved = v.replace("${auth}", &self.auth_secret);
            cmd.env(k, resolved);
        }

        let mut child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                ProviderError::ProviderError(format!(
                    "{} binary {:?} not found on PATH",
                    self.id, self.binary
                ))
            } else {
                ProviderError::ProviderError(format!("{} spawn failed: {e}", self.id))
            }
        })?;

        // Build stdin payload — collapse history into a single user
        // line, matching the v1 claude one-shot convention. CLIs that
        // want richer stdin override args_template + parse their own
        // format in a future adapter.
        let stdin_payload = fold_history(&prompt.messages);
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(stdin_payload.as_bytes())
                .await
                .map_err(|e| ProviderError::ProviderError(format!("stdin write: {e}")))?;
            let _ = stdin.shutdown().await;
        } else {
            return Err(ProviderError::ProviderError("stdin not piped".into()));
        }

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| ProviderError::ProviderError("stdout not piped".into()))?;
        let stderr = child.stderr.take();
        let provider_id = self.id.clone();

        let (tx, rx) = mpsc::channel(STREAM_BUFFER);
        let tx_deadline = tx.clone();
        tokio::spawn(async move {
            let read_loop = async move {
                let mut reader = BufReader::new(stdout).lines();
                loop {
                    match reader.next_line().await {
                        Ok(Some(line)) => {
                            if let Some(chunk) = parse_text_line(&line) {
                                if tx.send(Ok(chunk)).await.is_err() {
                                    return;
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(e) => {
                            let _ = tx
                                .send(Err(ProviderError::ProviderError(format!(
                                    "{provider_id} stdout read: {e}"
                                ))))
                                .await;
                            return;
                        }
                    }
                }
                if let Ok(status) = child.wait().await {
                    if !status.success() {
                        let mut stderr_text = String::new();
                        if let Some(mut e) = stderr {
                            let _ = e.read_to_string(&mut stderr_text).await;
                        }
                        let _ = tx
                            .send(Err(ProviderError::ProviderError(format!(
                                "{provider_id} exit {:?}: {}",
                                status.code(),
                                stderr_text.trim()
                            ))))
                            .await;
                    } else {
                        // Emit a synthetic stop so consumers can drop
                        // their `while let Some(...)` loops on a typed
                        // sentinel rather than a closed-channel hint.
                        let _ = tx
                            .send(Ok(ChatChunk {
                                delta: String::new(),
                                finish_reason: Some("stop".into()),
                            }))
                            .await;
                    }
                }
            };
            if tokio::time::timeout(Duration::from_millis(deadline), read_loop)
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
                "{}: binary path empty",
                self.id
            )));
        }
        Ok(())
    }
}

/// Replace `{model}` placeholders. Extra placeholders land here as
/// adapters demand them — keep the list tiny so manifests stay
/// declarative (no shell injection / arbitrary substitution).
fn substitute_args(arg: &str, model: &str) -> String {
    arg.replace("{model}", model)
}

/// Collapse multi-turn history into a single user line. Lossy by design
/// (one-shot CLIs don't preserve turn structure); good enough for the
/// "drop me a quick answer" path.
fn fold_history(messages: &[crate::kernel::provider::types::ChatMessage]) -> String {
    if messages.is_empty() {
        return String::new();
    }
    let last_idx = messages.len() - 1;
    if last_idx == 0 {
        return format!("{}\n", messages[0].content);
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
    out.push('\n');
    out
}

/// Parse one stdout line. v1 supports `{"delta":"text"}` (CTRL's own
/// wire) AND plain text (codex's `-p` default). Unknown JSON shapes
/// are returned verbatim as a delta — better surface garbage than
/// silently drop tokens.
fn parse_text_line(line: &str) -> Option<ChatChunk> {
    let line = line.trim_end();
    if line.is_empty() {
        return None;
    }
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
        if let Some(delta) = v.get("delta").and_then(|d| d.as_str()) {
            if delta.is_empty() {
                return None;
            }
            return Some(ChatChunk {
                delta: delta.to_string(),
                finish_reason: v
                    .get("finish_reason")
                    .and_then(|f| f.as_str())
                    .map(|s| s.to_string()),
            });
        }
        // Unknown JSON shape — emit its toString so the operator can
        // diagnose, but don't crash the pipeline.
        return Some(ChatChunk {
            delta: line.to_string(),
            finish_reason: None,
        });
    }
    Some(ChatChunk {
        delta: line.to_string(),
        finish_reason: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::provider::types::ChatMessage;

    #[test]
    fn substitute_args_replaces_model_placeholder() {
        assert_eq!(substitute_args("--model", "x"), "--model");
        assert_eq!(substitute_args("{model}", "gpt-x"), "gpt-x");
        assert_eq!(substitute_args("--model={model}", "gpt-x"), "--model=gpt-x");
    }

    #[test]
    fn fold_history_single_message_emits_content() {
        let m = vec![ChatMessage { role: "user".into(), content: "hi".into() }];
        assert_eq!(fold_history(&m), "hi\n");
    }

    #[test]
    fn fold_history_multi_turn_includes_prior_and_current() {
        let m = vec![
            ChatMessage { role: "user".into(), content: "hi".into() },
            ChatMessage { role: "assistant".into(), content: "hey".into() },
            ChatMessage { role: "user".into(), content: "more?".into() },
        ];
        let s = fold_history(&m);
        assert!(s.contains("[user] hi"));
        assert!(s.contains("[assistant] hey"));
        assert!(s.contains("Current turn:\nmore?"));
    }

    #[test]
    fn parse_text_line_picks_delta_json() {
        let c = parse_text_line(r#"{"delta":"Hello"}"#).unwrap();
        assert_eq!(c.delta, "Hello");
    }

    #[test]
    fn parse_text_line_passes_through_plain_text() {
        let c = parse_text_line("plain output").unwrap();
        assert_eq!(c.delta, "plain output");
    }

    #[test]
    fn parse_text_line_skips_blank() {
        assert!(parse_text_line("").is_none());
        assert!(parse_text_line("   ").is_none());
    }
}
