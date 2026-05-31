// CLI subprocess adapters — one-shot (codex / gemini) + persistent (claude).
//
// Both adapters spawn external binaries that speak NDJSON on stdin /
// stdout. The split is intentional: most CLIs don't keep a long-lived
// stream-json session, so one_shot covers them with a generic manifest-
// driven spawner; claude requires a stateful child + drain protocol
// because it's billed against the user's OAuth subscription and warm-
// state matters (300-900 ms savings per turn — see FINDING-R2.md §3).

pub mod claude_persistent;
pub mod one_shot;
