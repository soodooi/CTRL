// kernel::sourcing_scheduler — wakes once per day, runs vault_sourcing::run.
//
// (ADR-002 substrate § vault v1 §8.4 sourcing-workflow, 2026-06-01 —
// memory `decision_vault_adr_002_section_8`. Closes "kernel cron
// trigger" gap surfaced by bao 2026-06-03.)
//
// Triggers per §8.4 are kept independent (cron / threshold / manual);
// this module owns only the cron path. Reads cron expression from
// `vault/.ctrl/sourcing.yaml`. Supports the canonical `minute hour
// dom mon dow` shape (only `minute` and `hour` are honored — daily
// granularity is sufficient until users ask for finer grain). On the
// chosen minute, `vault_sourcing::run(today)` is invoked at most once
// per local day; a sentinel file at `vault/.ctrl/state/sourcing-last-run.txt`
// records the last successful run date and is checked at every tick
// so the task is safe to call repeatedly and survives restart loops.
//
// Tick cadence: 60 s. Wider than that risks missing the window when
// the user laptop sleeps over the cron minute; finer than that wakes
// the kernel needlessly during the other 59 minutes of every hour.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use chrono::{Datelike, Local, Timelike};

use crate::kernel::vault_sourcing;

/// Spawn the daily sourcing scheduler on the supplied tokio runtime.
/// The task lives for the kernel process lifetime; there is no stop
/// channel since the same task ID handles cron, sleep, and re-arm.
pub fn spawn(vault_root: std::path::PathBuf) {
    let root = Arc::new(vault_root);
    tokio::spawn(async move {
        loop {
            // Wake every 60 s — `sleep_until` would be ideal but
            // requires re-parsing the cron after every clock change;
            // a 60 s tick is honest and survives time-zone shifts.
            tokio::time::sleep(Duration::from_secs(60)).await;
            if let Err(e) = tick(&root).await {
                tracing::warn!(error = %e, "sourcing_scheduler: tick failed");
            }
        }
    });
}

async fn tick(vault_root: &Path) -> Result<(), String> {
    let cron = read_cron_expression(vault_root)
        .ok_or_else(|| "cron expression unavailable".to_string())?;
    let (cron_minute, cron_hour) = parse_minute_hour(&cron)
        .ok_or_else(|| format!("unsupported cron expression: {cron}"))?;

    let now = Local::now();
    let today_yyyy_mm_dd = format!(
        "{:04}-{:02}-{:02}",
        now.year(),
        now.month(),
        now.day(),
    );

    // Has today's run already happened?
    let sentinel_path = vault_root.join(".ctrl/state/sourcing-last-run.txt");
    let already_ran_today = std::fs::read_to_string(&sentinel_path)
        .map(|s| s.trim() == today_yyyy_mm_dd)
        .unwrap_or(false);
    if already_ran_today {
        return Ok(());
    }

    // Are we inside the cron window? We give a 90-second grace either
    // side of the configured minute so a tick that lands on H:M+0.5
    // still fires even if the previous tick landed on H:M-30s.
    let now_minute = now.hour() as i32 * 60 + now.minute() as i32;
    let cron_minute_of_day = cron_hour as i32 * 60 + cron_minute as i32;
    let delta = (now_minute - cron_minute_of_day).abs();
    if delta > 1 {
        return Ok(());
    }

    tracing::info!(
        cron = %cron,
        today = %today_yyyy_mm_dd,
        "sourcing_scheduler: firing daily sourcing run",
    );
    let report = vault_sourcing::run(vault_root, &today_yyyy_mm_dd)
        .map_err(|e| format!("vault_sourcing::run: {e}"))?;
    tracing::info!(
        items = report.items_processed,
        skipped = report.skipped_already_indexed,
        review = %report.review_path,
        "sourcing_scheduler: daily run complete",
    );

    // Write sentinel last so a failed run is retried on the next tick.
    if let Some(parent) = sentinel_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&sentinel_path, &today_yyyy_mm_dd) {
        tracing::warn!(error = %e, "sourcing_scheduler: sentinel write failed");
    }
    Ok(())
}

/// Pull the cron expression from `vault/.ctrl/sourcing.yaml`. Returns
/// `None` when the file is missing (sourcing not seeded yet) or when
/// the YAML lacks the `triggers.cron` key — both treated as "no cron
/// configured, do nothing this tick".
fn read_cron_expression(vault_root: &Path) -> Option<String> {
    let cfg_path = vault_root.join(".ctrl/sourcing.yaml");
    let body = std::fs::read_to_string(&cfg_path).ok()?;
    // Hand-rolled mini-parser: full YAML library is overkill for a
    // single nested string. Looks for `cron:` after `triggers:` (the
    // seed lays out exactly this shape; user edits beyond it land in
    // the deferred Pi flow anyway).
    let mut in_triggers = false;
    for line in body.lines() {
        let trimmed = line.trim_end();
        if trimmed.starts_with("triggers:") {
            in_triggers = true;
            continue;
        }
        if in_triggers {
            // Out of the triggers block once we see a non-indented key.
            if !line.starts_with(' ') && !line.starts_with('\t') {
                in_triggers = false;
                continue;
            }
            let t = line.trim_start();
            if let Some(rest) = t.strip_prefix("cron:") {
                let val = rest.trim().trim_matches('"').trim_matches('\'').to_string();
                if val.is_empty() {
                    return None;
                }
                return Some(val);
            }
        }
    }
    None
}

/// Extract `(minute, hour)` from a 5-field cron expression. Returns
/// `None` for any field that is not a plain integer 0-59 / 0-23 —
/// `*` / ranges / step values / lists are not supported by this
/// scheduler (they fall back to deferred-batch handling). The cron
/// fields after hour are ignored on purpose; daily granularity is the
/// only target.
fn parse_minute_hour(cron: &str) -> Option<(u32, u32)> {
    let parts: Vec<&str> = cron.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let minute: u32 = parts[0].parse().ok()?;
    let hour: u32 = parts[1].parse().ok()?;
    if minute > 59 || hour > 23 {
        return None;
    }
    Some((minute, hour))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_minute_hour_accepts_seed_default() {
        // Seed default: `"0 9 * * *"` → 9:00 local daily.
        assert_eq!(parse_minute_hour("0 9 * * *"), Some((0, 9)));
    }

    #[test]
    fn parse_minute_hour_rejects_wildcard() {
        assert_eq!(parse_minute_hour("* 9 * * *"), None);
        assert_eq!(parse_minute_hour("0 * * * *"), None);
    }

    #[test]
    fn parse_minute_hour_rejects_out_of_range() {
        assert_eq!(parse_minute_hour("60 9 * * *"), None);
        assert_eq!(parse_minute_hour("0 24 * * *"), None);
    }
}
