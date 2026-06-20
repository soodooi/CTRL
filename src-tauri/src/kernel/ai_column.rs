//! AI field shortcut (`run_ai_column`) — the AI-on-a-column differentiator of
//! ADR-003 §6.5.4 (a `produce` op of ADR-002 §14). Runs an LLM per row down a
//! target column: classify / extract / summarize / translate / generate, the
//! Airtable/Feishu "field shortcut" form (AI lives on the column, not a side
//! chat). This module holds the deterministic, testable core — prompt
//! templating with `{field}` tokens, the 100-row cost gate, and applying
//! results back. The provider call + batching is wired in the gate tool.
//!
//! NOTE (honest scope): this first cut runs the batch in one bounded call.
//! The async job triple (`start`/`status`/`cancel`) + the Semaphore-bounded
//! background job of §6.5.4 is the next slice; the cost gate caps the bounded
//! run so it cannot run away.

use crate::kernel::query::Row;
use crate::kernel::vault_smart_table::SmartTable;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Per ADR-003 §6.5.4: a column run over more than this many rows must get
/// explicit user confirmation before spending (BYOK is the user's money).
pub const COST_GATE_ROWS: usize = 100;

/// The AI operation kind — a fixed, table-independent enum (ADR-002 §14.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AiOp {
    Classify,
    Extract,
    Summarize,
    Translate,
    Generate,
}

impl AiOp {
    /// A system instruction that shapes the op (kept terse — the user's prompt
    /// carries the specifics).
    pub fn system_instruction(self) -> &'static str {
        match self {
            AiOp::Classify => "Classify the input. Reply with only the category label, no preamble.",
            AiOp::Extract => "Extract the requested information from the input. Reply with only the extracted value.",
            AiOp::Summarize => "Summarize the input concisely. Reply with only the summary.",
            AiOp::Translate => "Translate the input as instructed. Reply with only the translation.",
            AiOp::Generate => "Follow the instruction using the input. Reply with only the result.",
        }
    }
}

/// True when a run over `row_count` rows exceeds the cost gate and needs
/// explicit confirmation first.
pub fn over_cost_gate(row_count: usize) -> bool {
    row_count > COST_GATE_ROWS
}

/// Substitute `{field}` tokens in `template` with this row's cell values.
/// Unknown tokens are left as the empty string (the field simply has no value
/// in this row). Returns the per-row prompt text.
pub fn render_prompt(template: &str, row: &Row) -> String {
    let mut out = String::with_capacity(template.len());
    let mut chars = template.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            let mut key = String::new();
            let mut closed = false;
            for c2 in chars.by_ref() {
                if c2 == '}' {
                    closed = true;
                    break;
                }
                key.push(c2);
            }
            if closed {
                out.push_str(row.get(key.trim()).map(String::as_str).unwrap_or(""));
            } else {
                // Unterminated brace — emit verbatim.
                out.push('{');
                out.push_str(&key);
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// One planned row: its index, the rendered prompt, and a SNAPSHOT of the row
/// at plan time. The snapshot lets write-back target the row by identity (does
/// it still look the same?) rather than blindly by index, so a row edited or
/// shifted (insert/delete) mid-run is skipped instead of mis-targeted.
#[derive(Debug, Clone)]
pub struct PlanItem {
    pub index: usize,
    pub prompt: String,
    pub snapshot: Row,
}

/// Rows whose target cell is already filled are skipped (idempotent resume,
/// ADR-003 §6.5.4) unless `force` re-runs the whole column.
pub fn plan_rows(
    table: &SmartTable,
    target_field: &str,
    template: &str,
    force: bool,
) -> Vec<PlanItem> {
    table
        .rows
        .iter()
        .enumerate()
        .filter(|(_, row)| {
            force
                || row
                    .get(target_field)
                    .map(|v| v.trim().is_empty())
                    .unwrap_or(true)
        })
        .map(|(i, row)| PlanItem {
            index: i,
            prompt: render_prompt(template, row),
            snapshot: row.clone(),
        })
        .collect()
}

/// Apply results back into the target column, but ONLY where the row at `index`
/// still matches its plan-time snapshot (ignoring the target field). A row that
/// was edited / shifted mid-run is skipped — the safe "merge by row identity"
/// without an explicit id column (ADR-003 §6.5.4). Results are
/// `(index, snapshot, value)`. Returns the number of cells written.
pub fn apply_results(
    table: &mut SmartTable,
    target_field: &str,
    results: &[(usize, Row, String)],
) -> usize {
    let mut written = 0;
    for (idx, snapshot, value) in results {
        let still_matches = table
            .rows
            .get(*idx)
            .map(|r| rows_match(r, snapshot, target_field))
            .unwrap_or(false);
        if still_matches && table.update_cell(*idx, target_field, value) {
            written += 1;
        }
    }
    written
}

/// True when `row` equals `snapshot` on every field except `except` (the AI
/// target, which was empty at plan time).
fn rows_match(row: &Row, snapshot: &Row, except: &str) -> bool {
    let keys: std::collections::BTreeSet<&String> = row.keys().chain(snapshot.keys()).collect();
    keys.into_iter()
        .filter(|k| k.as_str() != except)
        .all(|k| row.get(k) == snapshot.get(k))
}

#[derive(Debug, Clone, Serialize)]
pub struct RunSummary {
    pub rows_total: usize,
    pub rows_planned: usize,
    pub rows_written: usize,
    pub errors: Vec<RowError>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RowError {
    pub row: usize,
    pub message: String,
}

/// Run one row's completion against a provider: build the prompt, stream, and
/// drain to a single trimmed string (or an error message). Extracted from the
/// gate tools so this drain logic is testable with a fake `Provider`
/// (ADR-003 §6.5.4) instead of only proven by compile.
pub async fn complete_row(
    adapter: &dyn crate::kernel::provider::Provider,
    system: &str,
    user: &str,
) -> Result<String, crate::kernel::provider::ProviderError> {
    use crate::kernel::provider::{ChatOpts, LlmMessage, LlmPrompt};
    let prompt = LlmPrompt {
        system: Some(system.to_string()),
        messages: vec![LlmMessage {
            role: "user".to_string(),
            content: user.to_string(),
        }],
        temperature: None,
        max_tokens: None,
    };
    let opts = ChatOpts {
        model: String::new(),
        deadline_ms: 60_000,
    };
    let mut rx = adapter.chat_stream(&prompt, &opts).await?;
    let mut out = String::new();
    while let Some(item) = rx.recv().await {
        match item {
            Ok(chunk) => {
                out.push_str(&chunk.delta);
                if chunk.finish_reason.is_some() {
                    break;
                }
            }
            Err(e) => return Err(e),
        }
    }
    Ok(out.trim().to_string())
}

// ─── Async job (ADR-003 §6.5.4 call-now/fetch-later) ─────────────────────────
// rmcp 1.7 has no progress notifications, so `run_ai_column.start` returns a
// job_id and the client polls `.status` ("poll for truth") and may `.cancel`.

pub type JobHandle = Arc<RwLock<JobState>>;
pub type JobRegistry = Arc<RwLock<HashMap<String, JobHandle>>>;

pub fn new_registry() -> JobRegistry {
    Arc::new(RwLock::new(HashMap::new()))
}

pub fn new_job(rows_total: usize) -> JobHandle {
    Arc::new(RwLock::new(JobState::new(rows_total)))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobPhase {
    Running,
    Done,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobState {
    pub phase: JobPhase,
    pub rows_total: usize,
    pub rows_done: usize,
    pub rows_written: usize,
    pub errors: Vec<RowError>,
    /// Cooperative cancel flag, polled between rows (not serialized to clients).
    #[serde(skip)]
    pub cancelled: bool,
}

impl JobState {
    pub fn new(rows_total: usize) -> JobState {
        JobState {
            phase: JobPhase::Running,
            rows_total,
            rows_done: 0,
            rows_written: 0,
            errors: Vec::new(),
            cancelled: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn table() -> SmartTable {
        let fm = serde_json::json!({
            "schema": [
                { "key": "review", "label": "Review", "type": "text" },
                { "key": "sentiment", "label": "Sentiment", "type": "text" }
            ]
        });
        let body = "\n| Review | Sentiment |\n|---|---|\n| Loved it | |\n| Terrible | bad |\n";
        SmartTable::parse(&fm, body)
    }

    #[test]
    fn render_substitutes_field_tokens() {
        let mut row = Row::new();
        row.insert("review".into(), "Loved it".into());
        assert_eq!(render_prompt("Sentiment of: {review}", &row), "Sentiment of: Loved it");
        assert_eq!(render_prompt("{missing} done", &row), " done");
    }

    #[test]
    fn cost_gate_at_100() {
        assert!(!over_cost_gate(100));
        assert!(over_cost_gate(101));
    }

    #[test]
    fn plan_skips_filled_cells_unless_forced() {
        let t = table();
        // row 0 sentiment empty, row 1 sentiment "bad" → only row 0 planned.
        let plan = plan_rows(&t, "sentiment", "Classify: {review}", false);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0].index, 0);
        assert_eq!(plan[0].prompt, "Classify: Loved it");
        // forced → both rows.
        assert_eq!(plan_rows(&t, "sentiment", "{review}", true).len(), 2);
    }

    #[test]
    fn apply_writes_when_snapshot_still_matches() {
        let mut t = table();
        let snap = t.rows[0].clone();
        let written = apply_results(&mut t, "sentiment", &[(0, snap, "positive".to_string())]);
        assert_eq!(written, 1);
        assert_eq!(t.rows[0]["sentiment"], "positive");
    }

    #[test]
    fn apply_skips_when_row_changed_under_it() {
        let mut t = table();
        // Snapshot of row 0 (review "Loved it"), then the user edits row 0's
        // review before the result lands → the result must NOT be written.
        let snap = t.rows[0].clone();
        t.update_cell(0, "review", "Hated it");
        let written = apply_results(&mut t, "sentiment", &[(0, snap, "positive".to_string())]);
        assert_eq!(written, 0);
        assert_eq!(t.rows[0]["sentiment"], "");
    }

    #[tokio::test]
    async fn job_registry_lifecycle() {
        let reg = new_registry();
        let job = new_job(3);
        reg.write().await.insert("j1".to_string(), job.clone());
        {
            let s = job.read().await;
            assert_eq!(s.phase, JobPhase::Running);
            assert_eq!(s.rows_total, 3);
            assert_eq!(s.rows_done, 0);
            assert!(!s.cancelled);
        }
        // Cancel flips the cooperative flag visible through the registry handle.
        job.write().await.cancelled = true;
        let reg_r = reg.read().await;
        assert!(reg_r.get("j1").unwrap().read().await.cancelled);
        assert!(reg_r.get("missing").is_none());
    }

    // A fake Provider so the real streaming-drain in `complete_row` is proven
    // by a test, not only by compile (independent-checker Should-fix: prove the
    // run-channel, don't skip it). ADR-002 substrate § provider v2 §3.2.
    use crate::kernel::provider::{
        Capability, ChatChunk, ChatOpts, ChatPrompt, Provider, ProviderError,
    };
    use std::collections::BTreeSet;
    use tokio::sync::mpsc;

    struct FakeProvider {
        ok: bool,
        chunks: Vec<&'static str>,
    }

    #[async_trait::async_trait]
    impl Provider for FakeProvider {
        fn id(&self) -> &str {
            "fake"
        }
        fn capabilities(&self) -> BTreeSet<Capability> {
            BTreeSet::new()
        }
        async fn chat_stream(
            &self,
            _prompt: &ChatPrompt,
            _opts: &ChatOpts,
        ) -> Result<mpsc::Receiver<Result<ChatChunk, ProviderError>>, ProviderError> {
            let (tx, rx) = mpsc::channel(8);
            if self.ok {
                let n = self.chunks.len();
                for (i, c) in self.chunks.iter().enumerate() {
                    let finish_reason = (i + 1 == n).then(|| "stop".to_string());
                    let _ = tx.send(Ok(ChatChunk { delta: c.to_string(), finish_reason })).await;
                }
            } else {
                let _ = tx.send(Err(ProviderError::ProviderError("boom".to_string()))).await;
            }
            Ok(rx)
        }
        fn trial_verify(&self) -> Result<(), ProviderError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn complete_row_accumulates_chunks_and_trims() {
        let p = FakeProvider { ok: true, chunks: vec![" pos", "itive "] };
        assert_eq!(complete_row(&p, "classify", "Loved it").await.unwrap(), "positive");
    }

    #[tokio::test]
    async fn complete_row_surfaces_stream_error() {
        let p = FakeProvider { ok: false, chunks: vec![] };
        let out = complete_row(&p, "classify", "x").await;
        assert!(out.is_err(), "a provider stream error must surface as Err, not a silent empty cell");
    }
}
