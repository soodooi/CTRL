// Trial-chat verification — the real-roundtrip "set_active" gate.
//
// The production 1-token `"hi"` round trip must produce its first output within
// one absolute 30-second budget spanning adapter setup and stream reception.
// Success commits the binding; timeout or provider error preserves the previous
// selection and surfaces the specific failure.
// (ADR-002 substrate § provider v69)
//
// This replaces the pre-PR conflation of `healthz` / `binary-exists`
// checks with "the provider works". Some failure modes (Anthropic
// returning a 401 with a custom JSON body, a CLI binary that's
// installed but never `login`ed) only surface on an actual chat
// request — the shallow probe gave false positives.

use std::time::Duration;

use crate::kernel::provider::r#trait::Provider;
use crate::kernel::provider::types::{ChatMessage, ChatOpts, ChatPrompt, ProviderError};

/// Absolute setup-to-first-output limit. A single budget avoids nested timeout
/// windows while accommodating valid remote providers with slower first tokens.
/// (ADR-002 substrate § provider v69)
const TRIAL_FIRST_OUTPUT_DEADLINE_MS: u64 = 30_000;

/// 1-token probe — single user turn "hi" with a tiny token budget. We
/// only care about the FIRST chunk; subsequent chunks are drained off
/// the receiver before returning so the provider's worker future exits
/// cleanly (no orphan task / leaked subprocess after a success).
pub async fn trial_chat(provider: &dyn Provider) -> Result<String, ProviderError> {
    provider.trial_verify()?;
    let prompt = ChatPrompt {
        system: None,
        messages: vec![ChatMessage {
            role: "user".into(),
            content: "hi".into(),
        }],
        temperature: None,
        max_tokens: Some(8),
    };
    // The model option and the outer timeout share the same absolute budget;
    // no nested timeout can accidentally double or truncate activation.
    // (ADR-002 substrate § provider v69)
    // The activation probe asks compatible adapters for a direct answer so
    // hidden reasoning cannot consume the tiny output budget before visible
    // content. Ordinary chat leaves this false and preserves model behavior.
    // (ADR-002 substrate § provider v69)
    let opts = ChatOpts {
        model: String::new(),
        deadline_ms: TRIAL_FIRST_OUTPUT_DEADLINE_MS,
        disable_reasoning: true,
    };
    let (mut rx, first) = tokio::time::timeout(
        Duration::from_millis(TRIAL_FIRST_OUTPUT_DEADLINE_MS),
        async {
            let mut rx = provider.chat_stream(&prompt, &opts).await?;
            // Ignore role/metadata chunks. Only non-empty model text proves the
            // provider produced output; a finish-only stream fails closed.
            // (ADR-002 substrate § provider v69)
            let first = loop {
                match rx.recv().await {
                    Some(Ok(chunk)) if !chunk.delta.is_empty() => break chunk,
                    Some(Ok(chunk)) if chunk.finish_reason.is_some() => {
                        return Err(ProviderError::ProviderError(
                            "trial chat: stream finished before first output".into(),
                        ))
                    }
                    Some(Ok(_)) => continue,
                    Some(Err(error)) => return Err(error),
                    None => {
                        return Err(ProviderError::ProviderError(
                            "trial chat: stream closed before first output".into(),
                        ))
                    }
                }
            };
            Ok::<_, ProviderError>((rx, first))
        },
    )
    // Timeout remains fail-closed and leaves the prior binding untouched.
    // (ADR-002 substrate § provider v69)
    .await
    .map_err(|_| ProviderError::DeadlineExceeded(TRIAL_FIRST_OUTPUT_DEADLINE_MS))??;

    // First chunk decides outcome.
    let mut reply = first.delta.clone();
    let mut saw_finish = first.finish_reason.is_some();

    // Best-effort drain so the provider worker exits — bounded by a
    // short additional window so a slow provider doesn't block the
    // whole verify call.
    let drain = async {
        while let Some(item) = rx.recv().await {
            match item {
                Ok(c) => {
                    reply.push_str(&c.delta);
                    if c.finish_reason.is_some() {
                        saw_finish = true;
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    };
    let _ = tokio::time::timeout(Duration::from_millis(1_500), drain).await;
    let _ = saw_finish;
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::collections::BTreeSet;
    use std::sync::Mutex;
    use tokio::sync::mpsc;

    use crate::kernel::provider::r#trait::Capability;
    use crate::kernel::provider::types::ChatChunk;

    #[derive(Clone, Copy)]
    enum TrialStream {
        Visible,
        FinishOnly,
        Closed,
        Error,
    }

    struct CapturingProvider {
        stream: TrialStream,
        disable_reasoning: Mutex<Option<bool>>,
    }

    impl CapturingProvider {
        fn new(stream: TrialStream) -> Self {
            Self {
                stream,
                disable_reasoning: Mutex::new(None),
            }
        }
    }

    #[async_trait]
    impl Provider for CapturingProvider {
        fn id(&self) -> &str {
            "trial-capture"
        }

        fn capabilities(&self) -> BTreeSet<Capability> {
            BTreeSet::from([Capability::TextChat])
        }

        async fn chat_stream(
            &self,
            _prompt: &ChatPrompt,
            opts: &ChatOpts,
        ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
            *self.disable_reasoning.lock().unwrap() = Some(opts.disable_reasoning);
            let (tx, rx) = mpsc::channel(2);
            match self.stream {
                TrialStream::Visible => {
                    tx.send(Ok(ChatChunk {
                        delta: "OK".into(),
                        finish_reason: Some("stop".into()),
                    }))
                    .await
                    .unwrap();
                }
                TrialStream::FinishOnly => {
                    tx.send(Ok(ChatChunk {
                        delta: String::new(),
                        finish_reason: Some("length".into()),
                    }))
                    .await
                    .unwrap();
                }
                TrialStream::Closed => {}
                TrialStream::Error => {
                    tx.send(Err(ProviderError::ProviderError("upstream failed".into())))
                        .await
                        .unwrap();
                }
            }
            drop(tx);
            Ok(rx)
        }

        fn trial_verify(&self) -> Result<(), ProviderError> {
            Ok(())
        }
    }

    /// The activation boundary must request direct output while retaining all
    /// existing finish-only/closed/error fail-closed behavior.
    /// (ADR-002 substrate § provider v69)
    #[tokio::test]
    async fn trial_requests_reasoning_disabled_and_remains_fail_closed() {
        let visible = CapturingProvider::new(TrialStream::Visible);
        assert_eq!(trial_chat(&visible).await.unwrap(), "OK");
        assert_eq!(*visible.disable_reasoning.lock().unwrap(), Some(true));

        for stream in [
            TrialStream::FinishOnly,
            TrialStream::Closed,
            TrialStream::Error,
        ] {
            let provider = CapturingProvider::new(stream);
            assert!(trial_chat(&provider).await.is_err());
            assert_eq!(*provider.disable_reasoning.lock().unwrap(), Some(true));
        }
    }
}
