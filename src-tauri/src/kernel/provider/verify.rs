// Trial-chat verification — the real-roundtrip "set_active" gate.
//
// The production 1-token `"hi"` round trip must produce its first output within
// one absolute 30-second budget spanning adapter setup and stream reception.
// Success commits the binding; timeout or provider error preserves the previous
// selection and surfaces the specific failure.
// (ADR-002 substrate § provider v68)
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
/// (ADR-002 substrate § provider v68)
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
    // (ADR-002 substrate § provider v68)
    let opts = ChatOpts {
        model: String::new(),
        deadline_ms: TRIAL_FIRST_OUTPUT_DEADLINE_MS,
    };
    let (mut rx, first) = tokio::time::timeout(
        Duration::from_millis(TRIAL_FIRST_OUTPUT_DEADLINE_MS),
        async {
            let mut rx = provider.chat_stream(&prompt, &opts).await?;
            // Ignore role/metadata chunks. Only non-empty model text proves the
            // provider produced output; a finish-only stream fails closed.
            // (ADR-002 substrate § provider v68)
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
    // (ADR-002 substrate § provider v68)
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
