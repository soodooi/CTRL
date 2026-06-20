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

/// The per-row prompts a run will issue: (row_index, prompt_text). Rows whose
/// target cell is already filled are skipped (idempotent resume, ADR-003
/// §6.5.4) unless `force` re-runs the whole column.
pub fn plan_rows(
    table: &SmartTable,
    target_field: &str,
    template: &str,
    force: bool,
) -> Vec<(usize, String)> {
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
        .map(|(i, row)| (i, render_prompt(template, row)))
        .collect()
}

/// Apply completed results back into the table's target column (merge by row
/// index). Returns the number of cells written.
pub fn apply_results(table: &mut SmartTable, target_field: &str, results: &[(usize, String)]) -> usize {
    let mut written = 0;
    for (idx, value) in results {
        if table.update_cell(*idx, target_field, value) {
            written += 1;
        }
    }
    written
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
        assert_eq!(plan[0].0, 0);
        assert_eq!(plan[0].1, "Classify: Loved it");
        // forced → both rows.
        assert_eq!(plan_rows(&t, "sentiment", "{review}", true).len(), 2);
    }

    #[test]
    fn apply_writes_results_by_index() {
        let mut t = table();
        let written = apply_results(&mut t, "sentiment", &[(0, "positive".into())]);
        assert_eq!(written, 1);
        assert_eq!(t.rows[0]["sentiment"], "positive");
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
}
