// Shared text.chat route resolution — ADR-002 substrate § provider v9
// §3.5 (2026-06-06) semantics, extracted 2026-06-10 so the HTTP endpoint
// (/text-chat) and the in-process Irisy chat command share ONE
// implementation of candidate walking + cooldown + first-chunk peek
// (`feedback_no_redundancy_one_ssot`).
//
// Per v9: only the consumer's primary is attempted (`chain.fallbacks`
// intentionally ignored); failure surfaces to the caller and the user
// re-picks in Settings. The loop still handles N candidates so a future
// fallback re-enable is a one-line change at the call site.

use std::sync::Arc;

use tokio::sync::mpsc;

use super::registry::ProviderRegistry;
use super::r#trait::Consumer;
use super::types::{ChatChunk, ChatOpts, ChatPrompt, ProviderError};

pub type ChunkRx = mpsc::Receiver<Result<ChatChunk, ProviderError>>;

/// Resolve the route chain for `consumer` and return the first candidate
/// that produces a healthy stream (first-chunk peek, ADR-002 § provider
/// v2 §3.5 M1/M2 amendments 2026-06-04). On success returns the chosen
/// provider id + a receiver pre-loaded with the peeked first chunk.
pub async fn route_text_chat(
    registry: &Arc<ProviderRegistry>,
    consumer: &Consumer,
    prompt: &ChatPrompt,
    opts: &ChatOpts,
) -> Result<(String, ChunkRx), String> {
    let chain = registry.route_chain(consumer);

    let mut candidates: Vec<String> = Vec::new();
    if let Some(primary) = chain.primary.clone() {
        candidates.push(primary);
    }
    if candidates.is_empty() {
        // No primary configured for this consumer — last-resort backstop
        // (primary_text_chat walks primary → fallbacks → IrisyFallback →
        // any ready provider). No first-chunk peek on this path, matching
        // the pre-extraction /text-chat behaviour.
        let provider = registry
            .primary_text_chat()
            .ok_or_else(|| "no provider configured for text.chat".to_string())?;
        let rx = provider
            .chat_stream(prompt, opts)
            .await
            .map_err(|e| format!("provider chat_stream failed: {e}"))?;
        return Ok((provider.id().to_string(), rx));
    }

    let primary_id = candidates.first().cloned();
    let mut primary_error: Option<(String, ProviderError)> = None;
    let n_candidates = candidates.len();

    for (i, manifest_id) in candidates.iter().enumerate() {
        // Skip a primary that recently failed AND there is at least one
        // fallback left to try (saves the ~300 ms claude CLI spawn while
        // an OAuth outage holds). ADR-002 § provider v2 §3.5 M2.
        if i == 0 && n_candidates > 1 && registry.is_in_cooldown(manifest_id) {
            primary_error = Some((
                manifest_id.clone(),
                ProviderError::ProviderError(format!(
                    "{manifest_id}: in cooldown after recent failure"
                )),
            ));
            continue;
        }
        let Some(provider) = registry.get(manifest_id) else {
            continue;
        };
        let mut rx = match provider.chat_stream(prompt, opts).await {
            Ok(rx) => rx,
            Err(e) => {
                registry.mark_failure(manifest_id, &e.to_string());
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), e));
                }
                continue;
            }
        };
        // First-chunk peek (M1): most auth/network failures surface as
        // the FIRST stream item being Err, not as chat_stream() erroring.
        match rx.recv().await {
            Some(Ok(first_chunk)) => {
                registry.clear_failure(manifest_id);
                let (tx_bridge, rx_bridge) =
                    mpsc::channel::<Result<ChatChunk, ProviderError>>(64);
                if tx_bridge.send(Ok(first_chunk)).await.is_err() {
                    return Err("client closed before first chunk forwarded".to_string());
                }
                tokio::spawn(async move {
                    while let Some(item) = rx.recv().await {
                        if tx_bridge.send(item).await.is_err() {
                            break;
                        }
                    }
                });
                if i > 0 {
                    let reason = if let Some((from_id, err)) = primary_error.take() {
                        let r = err.to_string();
                        registry.record_failover(&from_id, manifest_id, &r);
                        r
                    } else if let Some(from_id) = primary_id.clone() {
                        let r = "primary provider not registered".to_string();
                        registry.record_failover(&from_id, manifest_id, &r);
                        r
                    } else {
                        "primary unavailable".to_string()
                    };
                    tracing::info!(
                        from = ?primary_id,
                        to = %manifest_id,
                        reason = %reason,
                        "provider: fallback served (v9 — no UI override emitted)"
                    );
                }
                return Ok((manifest_id.clone(), rx_bridge));
            }
            Some(Err(e)) => {
                registry.mark_failure(manifest_id, &e.to_string());
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), e));
                }
                continue;
            }
            None => {
                let synthetic = ProviderError::ProviderError(format!(
                    "{manifest_id}: stream closed before first chunk"
                ));
                registry.mark_failure(manifest_id, &synthetic.to_string());
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), synthetic));
                }
                continue;
            }
        }
    }

    let detail = primary_error
        .map(|(_, e)| e.to_string())
        .unwrap_or_else(|| "all providers in route chain refused".to_string());
    Err(format!("provider chat_stream failed: {detail}"))
}
