// Shared text.chat route resolution. The router consumes the exact explicit
// `RouteChain`: primary first, then the separately bound fallback. Catalogue
// entries and adapter construction never enter routing by themselves. Every
// production text-chat caller uses this router or its completion drain helper.
// (ADR-002 substrate § provider v71)

use std::sync::Arc;

use tokio::sync::mpsc;

use super::registry::ProviderRegistry;
use super::r#trait::{Consumer, ProviderRuntimeStatus};
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
) -> Result<(String, ChunkRx), ProviderError> {
    let chain = registry.route_chain(consumer);

    // Only user-bound intent enters the hot path; catalogue/configuration do
    // not synthesize candidates. (ADR-002 substrate § provider v71)
    let mut candidates: Vec<String> = chain.primary.clone().into_iter().collect();
    candidates.extend(chain.fallbacks);
    if candidates.is_empty() {
        return Err(ProviderError::ProviderError(
            "no provider is explicitly bound for text.chat".to_string(),
        ));
    }

    let primary_id = candidates.first().cloned();
    let mut primary_error: Option<(String, ProviderError)> = None;
    let mut last_error: Option<ProviderError> = None;
    let mut auth_error: Option<ProviderError> = None;
    let n_candidates = candidates.len();

    for (i, manifest_id) in candidates.iter().enumerate() {
        // Skip a primary that recently failed AND there is at least one
        // fallback left to try (saves the ~300 ms claude CLI spawn while
        // an OAuth outage holds). ADR-002 § provider v2 §3.5 M2.
        if i == 0 && n_candidates > 1 && registry.is_in_cooldown(manifest_id) {
            let error = ProviderError::ProviderError(format!(
                "{manifest_id}: in cooldown after recent failure"
            ));
            primary_error = Some((manifest_id.clone(), error.clone()));
            last_error = Some(error);
            continue;
        }
        let Some(provider) = registry.get(manifest_id) else {
            continue;
        };
        // Local runtime unavailability skips only this explicit candidate;
        // it never causes a catalogue scan. (ADR-002 substrate § provider v71)
        let runtime = provider.runtime_availability().await;
        if runtime.status == ProviderRuntimeStatus::Unavailable {
            let error = ProviderError::ProviderError(
                runtime
                    .detail
                    .unwrap_or_else(|| format!("{manifest_id}: runtime unavailable")),
            );
            registry.mark_failure(manifest_id, &error.to_string());
            if i == 0 {
                primary_error = Some((manifest_id.clone(), error.clone()));
            }
            last_error = Some(error);
            continue;
        }
        // Keep each candidate's typed failure so fallback exhaustion can return
        // policy-relevant authentication state. (ADR-002 substrate § provider v71)
        let mut rx = match provider.chat_stream(prompt, opts).await {
            Ok(rx) => rx,
            Err(e) => {
                registry.mark_failure(manifest_id, &e.to_string());
                if matches!(e, ProviderError::AuthFailed) {
                    auth_error = Some(e.clone());
                }
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), e.clone()));
                }
                last_error = Some(e);
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
                    // Bridge closure is a typed provider-route failure.
                    // (ADR-002 substrate § provider v71)
                    return Err(ProviderError::ProviderError(
                        "client closed before first chunk forwarded".to_string(),
                    ));
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
                // First-output failures preserve their typed category across
                // candidate walking. (ADR-002 substrate § provider v71)
                registry.mark_failure(manifest_id, &e.to_string());
                if matches!(e, ProviderError::AuthFailed) {
                    auth_error = Some(e.clone());
                }
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), e.clone()));
                }
                last_error = Some(e);
                continue;
            }
            None => {
                let synthetic = ProviderError::ProviderError(format!(
                    "{manifest_id}: stream closed before first chunk"
                ));
                registry.mark_failure(manifest_id, &synthetic.to_string());
                if i == 0 {
                    primary_error = Some((manifest_id.clone(), synthetic.clone()));
                }
                last_error = Some(synthetic);
                continue;
            }
        }
    }

    // Preserve authentication as a typed terminal failure even when it came
    // from the explicit fallback; display strings are not routing policy.
    // (ADR-002 substrate § provider v71)
    Err(auth_error
        .or(last_error)
        .or_else(|| primary_error.map(|(_, error)| error))
        .unwrap_or_else(|| {
            ProviderError::ProviderError("all providers in route chain refused".to_string())
        }))
}

/// Route through the same production chain and drain the selected stream into
/// one string. Candidate walking remains exclusively in `route_text_chat`.
/// (ADR-002 substrate § provider v71)
pub async fn route_text_completion(
    registry: &Arc<ProviderRegistry>,
    consumer: &Consumer,
    prompt: &ChatPrompt,
    opts: &ChatOpts,
) -> Result<(String, String), ProviderError> {
    let (provider_id, mut rx) = route_text_chat(registry, consumer, prompt, opts).await?;
    let mut output = String::new();
    while let Some(item) = rx.recv().await {
        let chunk = item?;
        output.push_str(&chunk.delta);
        if chunk.finish_reason.is_some() {
            break;
        }
    }
    Ok((provider_id, output))
}
