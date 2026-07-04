//! Periodic notes — daily / weekly / monthly / quarterly / yearly resolution
//! (ADR-002 §1.9 v46 E1; LRA `/periodic/{period}/` parity). Pure path math over
//! the vault's plain-markdown convention: one note per period under a
//! period-named folder. The daily convention matches `tasks_source`'s
//! `daily_note_path` ("add a task to today's daily note" and "open today's
//! daily note" must land on the SAME file).

use chrono::{Datelike, NaiveDate};
use schemars::JsonSchema;
use serde::Deserialize;

/// The fixed period set — a compile-time enum, never a free string
/// (anti-hallucination, ADR-002 §14.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Period {
    Daily,
    Weekly,
    Monthly,
    Quarterly,
    Yearly,
}

/// Vault-relative path of the periodic note covering `date`.
/// daily/2026-07-02.md · weekly/2026-W27.md · monthly/2026-07.md ·
/// quarterly/2026-Q3.md · yearly/2026.md
pub fn note_path(period: Period, date: NaiveDate) -> String {
    match period {
        Period::Daily => format!("daily/{}.md", date.format("%Y-%m-%d")),
        Period::Weekly => {
            let iso = date.iso_week();
            format!("weekly/{}-W{:02}.md", iso.year(), iso.week())
        }
        Period::Monthly => format!("monthly/{}.md", date.format("%Y-%m")),
        Period::Quarterly => {
            format!("quarterly/{}-Q{}.md", date.year(), (date.month0() / 3) + 1)
        }
        Period::Yearly => format!("yearly/{}.md", date.year()),
    }
}

/// Seed frontmatter for a fresh periodic note (same journal shape the task
/// daily-note seed uses, plus the period tag).
pub fn seed_frontmatter(period: Period) -> serde_json::Value {
    let tag = match period {
        Period::Daily => "daily",
        Period::Weekly => "weekly",
        Period::Monthly => "monthly",
        Period::Quarterly => "quarterly",
        Period::Yearly => "yearly",
    };
    serde_json::json!({ "type": "journal", "tags": [tag] })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(y: i32, m: u32, day: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, day).unwrap()
    }

    #[test]
    fn resolves_every_period_shape() {
        let date = d(2026, 7, 2);
        assert_eq!(note_path(Period::Daily, date), "daily/2026-07-02.md");
        assert_eq!(note_path(Period::Weekly, date), "weekly/2026-W27.md");
        assert_eq!(note_path(Period::Monthly, date), "monthly/2026-07.md");
        assert_eq!(note_path(Period::Quarterly, date), "quarterly/2026-Q3.md");
        assert_eq!(note_path(Period::Yearly, date), "yearly/2026.md");
    }

    #[test]
    fn daily_matches_the_task_source_convention() {
        // "add to today's daily note" (task_produce) and note_periodic must
        // land on the same file.
        let date = d(2026, 12, 31);
        assert_eq!(note_path(Period::Daily, date), format!("daily/{}.md", date.format("%Y-%m-%d")));
    }

    #[test]
    fn iso_week_year_boundary_is_correct() {
        // 2026-01-01 falls in ISO week 2026-W01; 2027-01-01 is a Friday in
        // ISO 2026-W53 — the ISO YEAR (not calendar year) must be used.
        assert_eq!(note_path(Period::Weekly, d(2026, 1, 1)), "weekly/2026-W01.md");
        assert_eq!(note_path(Period::Weekly, d(2027, 1, 1)), "weekly/2026-W53.md");
        // Quarter boundaries.
        assert_eq!(note_path(Period::Quarterly, d(2026, 1, 1)), "quarterly/2026-Q1.md");
        assert_eq!(note_path(Period::Quarterly, d(2026, 12, 31)), "quarterly/2026-Q4.md");
    }
}
