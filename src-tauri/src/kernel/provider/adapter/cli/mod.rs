// CLI subprocess adapters — one-shot (codex / gemini).
//
// The adapter spawns external binaries that speak NDJSON on stdin /
// stdout via a generic manifest-driven spawner.
//
// ADR-002 substrate § provider v61 (2026-07-11): the persistent
// `claude` subscription adapter (claude_persistent.rs) was removed —
// routing chat through the `claude` CLI billed against a Claude
// Pro/Max subscription violates Anthropic's usage policy (subscription
// auth is for Claude apps, not a backend LLM provider). Anthropic
// access is BYOK API key only (ADR-006 cross-cutting § byok-no-claude).

pub mod one_shot;
