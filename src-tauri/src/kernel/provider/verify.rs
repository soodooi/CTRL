// Trial-chat verification — the real-roundtrip "set_active" gate.
//
// ADR-004 §9.1 lock #4: `set_active(provider_id, capability)` MUST send
// a real 1-token `"hi"` chat with a 5 s deadline. First chunk arriving
// inside the deadline ⇒ commit + persist; timeout / error ⇒ keep the
// previous selection + surface the specific error (auth / network /
// model-not-found).
//
// This replaces the pre-PR conflation of `healthz` / `binary-exists`
// checks with "the provider works". Some failure modes (Anthropic
// returning a 401 with a custom JSON body, a CLI binary that's
// installed but never `login`ed) only surface on an actual chat
// request — the shallow probe gave false positives.

use std::time::Duration;

use crate::kernel::provider::r#trait::Provider;
use crate::kernel::provider::types::{ChatMessage, ChatOpts, ChatPrompt, ProviderError};

/// Wall-clock limit per ADR-004 §9.1 lock #4.
const TRIAL_DEADLINE_MS: u64 = 5_000;

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
    let opts = ChatOpts {
        model: String::new(),
        deadline_ms: TRIAL_DEADLINE_MS,
    };
    let stream = tokio::time::timeout(
        Duration::from_millis(TRIAL_DEADLINE_MS),
        provider.chat_stream(&prompt, &opts),
    )
    .await
    .map_err(|_| ProviderError::DeadlineExceeded(TRIAL_DEADLINE_MS))??;
    let mut rx = stream;

    // First chunk decides outcome.
    let first = match tokio::time::timeout(
        Duration::from_millis(TRIAL_DEADLINE_MS),
        rx.recv(),
    )
    .await
    {
        Ok(Some(Ok(chunk))) => chunk,
        Ok(Some(Err(e))) => return Err(e),
        Ok(None) => {
            return Err(ProviderError::ProviderError(
                "trial chat: stream closed before first chunk".into(),
            ))
        }
        Err(_) => return Err(ProviderError::DeadlineExceeded(TRIAL_DEADLINE_MS)),
    };
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
