// ADR-002 substrate § capability-faces v19 §13.4 (2026-06-09, H-2026-06-09-002).
//
// API-face adapters — aggregator endpoints CTRL routes per typed capability.
// Differs from `adapter/rest/` (which holds the 1-to-1 LLM REST adapters
// CTRL ported from VMark) and `adapter/cli/` (which holds CLI providers
// like claude-code).
//
// The API face exists because aggregators (fal.ai 985 endpoints, future
// OpenRouter-like / LiteLLM-style proxies) don't fit the chat-stream
// shape of the Provider trait — image.generate / video.generate are
// one-shot HTTP POSTs returning a URL or BLOB, not streamed token deltas.
// Adapters here implement bespoke per-capability clients and register
// commands directly under `crate::commands::*` instead of going through
// the chat-stream routing.

pub mod fal_ai;
