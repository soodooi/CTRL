//! Calendar as a §14 source (ADR-002 §14.13 slice 3) — the FIRST product built
//! trait-only from the start: `QuerySource` + `RecordSink` over plain text,
//! exposed through the 3 unified gate verbs (describe/query/produce) with ZERO
//! bespoke per-op tools.
//!
//! **Storage substrate = one event per note under `calendar/`** with frontmatter
//! `{title, date, start?, end?, location?, tags?}` and a free-form body (agenda,
//! minutes links). This is the Obsidian Full Calendar note-per-event convention,
//! so the vim test passes by construction and an existing Obsidian calendar
//! vault reads as-is. Filenames are `calendar/<date>-<slug>.md`.

use crate::kernel::query::{
    CellType, Describe, FieldSpec, Operator, ProduceError, ProduceOp, QuerySource, RecordSink,
    Row, SourceKind,
};
use crate::kernel::vault;
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The vault subfolder events live in (scan scope + create target).
pub const CALENDAR_DIR: &str = "calendar";

/// A queryable + writable view over every event note (the Record profile of the
/// calendar). Rows are addressed by scan index; `path` locates the note.
pub struct CalendarSource {
    rows: Vec<Row>,
    /// Vault root — held so `produce` can create / edit / delete event notes.
    root: PathBuf,
}

impl CalendarSource {
    /// Scan `calendar/` for event notes. Notes that fail to read are skipped
    /// (read-only scan); an empty calendar is an empty source, not an error.
    pub fn load(vault_root: &Path) -> CalendarSource {
        let paths = vault::list(vault_root, Some(CALENDAR_DIR)).unwrap_or_default();
        let mut rows = Vec::new();
        for path in paths {
            let Ok(entry) = vault::read(vault_root, &path) else { continue };
            rows.push(event_to_row(&path, &entry.frontmatter));
        }
        CalendarSource { rows, root: vault_root.to_path_buf() }
    }

    /// The stable schema the calendar advertises via `describe`. `path` is the
    /// event note's address (read-only to the caller); `date` filters with the
    /// full date-operator set (Before/After/Within).
    pub fn fields() -> Vec<FieldSpec> {
        vec![
            field("path", "Note", CellType::Text),
            field("title", "Title", CellType::Text),
            field("date", "Date", CellType::Date),
            field("start", "Start", CellType::Text),
            field("end", "End", CellType::Text),
            field("location", "Location", CellType::Text),
            field("tags", "Tags", CellType::Tags),
        ]
    }

    /// Operators the calendar supports (mirrors the task / notes record set).
    pub fn operators() -> Vec<Operator> {
        use Operator::*;
        vec![Eq, Neq, Contains, Before, After, Within, HasTag]
    }

    /// The vault notes a produce op will write, so the gate can lock them before
    /// dispatching (same posture as the task source's `affected_notes`).
    pub fn affected_notes(&self, op: &ProduceOp) -> Vec<String> {
        match op {
            ProduceOp::SetCell { row, .. } => {
                self.row_path(*row).map(|p| vec![p]).unwrap_or_default()
            }
            ProduceOp::DeleteRows { indices } => {
                indices.iter().filter_map(|&i| self.row_path(i).ok()).collect()
            }
            // Locks the BASE path; `create_event` may write a deduped `-2` name
            // outside the lock set. Concurrent same-base creates still serialize
            // on the base lock (covers the dedup race); a collision on the
            // deduped name needs a stale-index op addressing that exact path —
            // the same cross-call TOCTOU class slice 2 documents.
            ProduceOp::UpsertRows { rows } => rows
                .iter()
                .map(|r| {
                    event_note_path(
                        r.get("date").map(String::as_str).unwrap_or(""),
                        r.get("title").map(String::as_str).unwrap_or(""),
                    )
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    /// The note path a scanned row addresses.
    fn row_path(&self, row: usize) -> Result<String, ProduceError> {
        self.rows
            .get(row)
            .and_then(|r| r.get("path").cloned())
            .ok_or_else(|| ProduceError::OutOfRange { what: format!("row {row}") })
    }
}

impl QuerySource for CalendarSource {
    fn describe(&self) -> Describe {
        Describe {
            source_kind: SourceKind::Record,
            fields: Self::fields(),
            operators: Self::operators(),
        }
    }

    fn rows(&self) -> &[Row] {
        &self.rows
    }
}

/// The `describe` the calendar advertises without scanning any note (the gate's
/// `calendar_describe` returns this — the type layer Irisy reads first).
pub fn describe() -> Describe {
    Describe {
        source_kind: SourceKind::Record,
        fields: CalendarSource::fields(),
        operators: CalendarSource::operators(),
    }
}

/// The WRITE side of the calendar (ADR-002 §14.13): the unified `ProduceOp`
/// vocabulary over event notes. Events have a FIXED schema, so field-mutating
/// ops are `Unsupported`. produce self-persists per addressed note.
impl RecordSink for CalendarSource {
    fn supported_ops(&self) -> Vec<&'static str> {
        vec!["set_cell", "upsert_rows", "delete_rows"]
    }

    fn produce(&mut self, op: ProduceOp) -> Result<(), ProduceError> {
        match op {
            ProduceOp::SetCell { row, field, value } => {
                let path = self.row_path(row)?;
                set_event_field(&self.root, &path, &field, &value)
            }
            ProduceOp::UpsertRows { rows } => {
                for r in rows {
                    create_event(&self.root, &r)?;
                }
                Ok(())
            }
            ProduceOp::DeleteRows { indices } => {
                let mut paths: Vec<String> =
                    indices.iter().filter_map(|&i| self.row_path(i).ok()).collect();
                paths.sort();
                paths.dedup();
                for p in paths {
                    vault::delete(&self.root, &p).map_err(map_vault_err)?;
                }
                Ok(())
            }
            other => Err(ProduceError::Unsupported {
                op: other.kind().to_string(),
                supported: self.supported_ops().iter().map(|s| s.to_string()).collect(),
            }),
        }
    }
}

/// The frontmatter keys an event exposes as writable cells.
const EVENT_FIELDS: [&str; 6] = ["title", "date", "start", "end", "location", "tags"];

/// Produce (update): set one frontmatter field of an event note in place,
/// preserving the body + every other frontmatter key verbatim.
fn set_event_field(
    root: &Path,
    path: &str,
    field: &str,
    value: &str,
) -> Result<(), ProduceError> {
    if !EVENT_FIELDS.contains(&field) {
        return Err(ProduceError::UnknownField { field: field.to_string() });
    }
    if field == "date" && parse_date(value).is_none() {
        return Err(ProduceError::Conflict {
            message: format!("'{value}' is not a YYYY-MM-DD date"),
        });
    }
    let entry = vault::read(root, path).map_err(map_vault_err)?;
    let mut fm = object_or_empty(entry.frontmatter);
    let obj = fm.as_object_mut().expect("object_or_empty returns an object");
    if field == "tags" {
        obj.insert(field.into(), tags_value(value));
    } else {
        obj.insert(field.into(), Value::String(value.trim().to_string()));
    }
    vault::write(root, path, &entry.content, &fm).map_err(map_vault_err)?;
    Ok(())
}

/// Produce (create): write a new event note from a row. `title` + `date`
/// required; the filename is `calendar/<date>-<slug>.md` (deduped with a
/// numeric suffix if taken).
fn create_event(root: &Path, row: &Row) -> Result<(), ProduceError> {
    let title = row.get("title").map(String::as_str).unwrap_or("").trim();
    if title.is_empty() {
        return Err(ProduceError::Conflict { message: "event requires a non-empty title".into() });
    }
    let date = row.get("date").map(String::as_str).unwrap_or("").trim();
    if parse_date(date).is_none() {
        return Err(ProduceError::Conflict {
            message: format!("event requires date=YYYY-MM-DD, got '{date}'"),
        });
    }
    let mut fm = serde_json::Map::new();
    fm.insert("title".into(), Value::String(title.to_string()));
    fm.insert("date".into(), Value::String(date.to_string()));
    for key in ["start", "end", "location"] {
        if let Some(v) = row.get(key).map(|s| s.trim()).filter(|s| !s.is_empty()) {
            fm.insert(key.into(), Value::String(v.to_string()));
        }
    }
    if let Some(t) = row.get("tags").filter(|s| !s.trim().is_empty()) {
        fm.insert("tags".into(), tags_value(t));
    }
    let base = event_note_path(date, title);
    let path = unique_note_path(root, &base)?;
    vault::write(root, &path, "", &Value::Object(fm)).map_err(map_vault_err)?;
    Ok(())
}

/// `calendar/<date>-<slug>.md` for a new event.
fn event_note_path(date: &str, title: &str) -> String {
    format!("{CALENDAR_DIR}/{date}-{}.md", slugify(title))
}

/// Dedupe a target path with `-2`, `-3`, … if a same-slug event already exists
/// on that date (two "standup" events on one day are distinct notes). Beyond 99
/// same-slug same-day events we refuse rather than silently overwrite.
fn unique_note_path(root: &Path, base: &str) -> Result<String, ProduceError> {
    if vault::read(root, base).is_err() {
        return Ok(base.to_string());
    }
    let stem = base.strip_suffix(".md").unwrap_or(base);
    for n in 2..100 {
        let candidate = format!("{stem}-{n}.md");
        if vault::read(root, &candidate).is_err() {
            return Ok(candidate);
        }
    }
    Err(ProduceError::Conflict {
        message: format!("more than 99 same-slug events on one day ({base})"),
    })
}

/// ASCII slug of an event title (lowercase alnum, `-` separated; non-ASCII
/// collapses to `event` — the title stays verbatim in frontmatter).
fn slugify(title: &str) -> String {
    let slug = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "event".to_string()
    } else {
        slug
    }
}

/// Comma-separated tags → frontmatter array (matching the notes convention).
fn tags_value(s: &str) -> Value {
    Value::Array(
        s.split(',')
            .map(|t| t.trim().trim_start_matches('#'))
            .filter(|t| !t.is_empty())
            .map(|t| Value::String(t.to_string()))
            .collect(),
    )
}

fn parse_date(s: &str) -> Option<chrono::NaiveDate> {
    chrono::NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

fn object_or_empty(v: Value) -> Value {
    if v.is_object() {
        v
    } else {
        Value::Object(serde_json::Map::new())
    }
}

fn map_vault_err(e: vault::VaultError) -> ProduceError {
    ProduceError::Conflict { message: format!("{e:?}") }
}

/// Project one event note (path + frontmatter) into a queryable row.
fn event_to_row(path: &str, fm: &Value) -> Row {
    let mut row = Row::new();
    row.insert("path".into(), path.to_string());
    row.insert("title".into(), fm_str(fm, "title"));
    row.insert("date".into(), fm_str(fm, "date"));
    row.insert("start".into(), fm_str(fm, "start"));
    row.insert("end".into(), fm_str(fm, "end"));
    row.insert("location".into(), fm_str(fm, "location"));
    row.insert("tags".into(), tags_of(fm));
    row
}

fn fm_str(fm: &Value, key: &str) -> String {
    match fm.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Join frontmatter `tags` (array or scalar) into the comma form `has_tag`
/// understands (same shape as the notes source).
fn tags_of(fm: &Value) -> String {
    match fm.get("tags") {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|x| x.as_str().map(str::to_string))
            .collect::<Vec<_>>()
            .join(", "),
        Some(Value::String(s)) => s.clone(),
        _ => String::new(),
    }
}

fn field(key: &str, label: &str, cell_type: CellType) -> FieldSpec {
    FieldSpec {
        key: key.to_string(),
        label: label.to_string(),
        cell_type,
        options: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{Filter, QueryRequest};
    use chrono::NaiveDate;

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 2).unwrap()
    }

    fn seed_event(root: &Path, rel: &str, fm: Value) {
        vault::write(root, rel, "notes body", &fm).unwrap();
    }

    #[test]
    fn describe_is_record_with_date_operators() {
        let d = describe();
        assert_eq!(d.source_kind, SourceKind::Record);
        assert!(d.fields.iter().any(|f| f.key == "date" && f.cell_type == CellType::Date));
        assert!(d.operators.contains(&Operator::Within));
        assert!(d.operators.contains(&Operator::HasTag));
    }

    #[test]
    fn load_and_query_events_by_date_window() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        seed_event(
            root,
            "calendar/2026-07-02-standup.md",
            serde_json::json!({ "title": "Standup", "date": "2026-07-02", "start": "09:30", "tags": ["work"] }),
        );
        seed_event(
            root,
            "calendar/2026-08-01-offsite.md",
            serde_json::json!({ "title": "Offsite", "date": "2026-08-01", "location": "Kyoto" }),
        );
        let src = CalendarSource::load(root);
        assert_eq!(src.rows().len(), 2);

        let req = QueryRequest {
            filters: vec![Filter {
                field: "date".into(),
                op: Operator::Within,
                value: "today".into(),
            }],
            ..Default::default()
        };
        let out = src.query(&req, today()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["title"], "Standup");
        assert_eq!(out.rows[0]["start"], "09:30");
        assert_eq!(out.rows[0]["tags"], "work");
    }

    #[test]
    fn produce_upsert_creates_event_note_that_vim_can_read() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let mut src = CalendarSource::load(root);
        let mut r = Row::new();
        r.insert("title".into(), "Team Sync".into());
        r.insert("date".into(), "2026-07-10".into());
        r.insert("start".into(), "14:00".into());
        r.insert("end".into(), "15:00".into());
        r.insert("tags".into(), "work, sync".into());
        src.produce(ProduceOp::UpsertRows { rows: vec![r] }).unwrap();

        // vim test: a plain markdown note with YAML frontmatter exists on disk.
        let raw =
            std::fs::read_to_string(root.join("calendar/2026-07-10-team-sync.md")).unwrap();
        assert!(raw.contains("title: Team Sync"));
        assert!(raw.contains("date: 2026-07-10"));
        assert!(raw.contains("start: '14:00'") || raw.contains("start: \"14:00\"") || raw.contains("start: 14:00"));

        // And it scans back as a row.
        let src2 = CalendarSource::load(root);
        assert_eq!(src2.rows().len(), 1);
        assert_eq!(src2.rows()[0]["title"], "Team Sync");
        assert_eq!(src2.rows()[0]["tags"], "work, sync");
    }

    #[test]
    fn produce_upsert_dedupes_same_slug_same_day() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let mut src = CalendarSource::load(root);
        let mut r = Row::new();
        r.insert("title".into(), "Standup".into());
        r.insert("date".into(), "2026-07-10".into());
        src.produce(ProduceOp::UpsertRows { rows: vec![r.clone(), r] }).unwrap();
        let src2 = CalendarSource::load(root);
        assert_eq!(src2.rows().len(), 2, "two same-title events are two notes");
    }

    #[test]
    fn produce_set_cell_edits_frontmatter_preserving_body() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        seed_event(
            root,
            "calendar/2026-07-02-standup.md",
            serde_json::json!({ "title": "Standup", "date": "2026-07-02", "custom_key": "kept" }),
        );
        let mut src = CalendarSource::load(root);
        src.produce(ProduceOp::SetCell { row: 0, field: "location".into(), value: "Room 4".into() })
            .unwrap();
        let entry = vault::read(root, "calendar/2026-07-02-standup.md").unwrap();
        assert_eq!(entry.frontmatter["location"], "Room 4");
        assert_eq!(entry.frontmatter["custom_key"], "kept", "unknown fm keys survive");
        assert_eq!(entry.content.trim(), "notes body", "body untouched");
    }

    #[test]
    fn produce_set_cell_validates_field_and_date() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        seed_event(
            root,
            "calendar/2026-07-02-a.md",
            serde_json::json!({ "title": "A", "date": "2026-07-02" }),
        );
        let mut src = CalendarSource::load(root);
        assert!(matches!(
            src.produce(ProduceOp::SetCell { row: 0, field: "nope".into(), value: "x".into() }),
            Err(ProduceError::UnknownField { .. })
        ));
        assert!(matches!(
            src.produce(ProduceOp::SetCell { row: 0, field: "date".into(), value: "tomorrow".into() }),
            Err(ProduceError::Conflict { .. })
        ));
        assert!(matches!(
            src.produce(ProduceOp::SetCell { row: 9, field: "title".into(), value: "x".into() }),
            Err(ProduceError::OutOfRange { .. })
        ));
    }

    #[test]
    fn produce_delete_rows_removes_event_notes() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        seed_event(root, "calendar/2026-07-02-a.md", serde_json::json!({ "title": "A", "date": "2026-07-02" }));
        seed_event(root, "calendar/2026-07-03-b.md", serde_json::json!({ "title": "B", "date": "2026-07-03" }));
        let mut src = CalendarSource::load(root);
        let ia = src.rows().iter().position(|r| r["title"] == "A").unwrap();
        src.produce(ProduceOp::DeleteRows { indices: vec![ia] }).unwrap();
        let src2 = CalendarSource::load(root);
        assert_eq!(src2.rows().len(), 1);
        assert_eq!(src2.rows()[0]["title"], "B");
    }

    #[test]
    fn produce_field_ops_are_unsupported() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut src = CalendarSource::load(dir.path());
        let err = src.produce(ProduceOp::DeleteField { key: "x".into() }).unwrap_err();
        match err {
            ProduceError::Unsupported { op, supported } => {
                assert_eq!(op, "delete_field");
                assert!(supported.contains(&"upsert_rows".to_string()));
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn upsert_requires_title_and_valid_date() {
        let dir = tempfile::TempDir::new().unwrap();
        let mut src = CalendarSource::load(dir.path());
        let mut no_title = Row::new();
        no_title.insert("date".into(), "2026-07-10".into());
        assert!(matches!(
            src.produce(ProduceOp::UpsertRows { rows: vec![no_title] }),
            Err(ProduceError::Conflict { .. })
        ));
        let mut bad_date = Row::new();
        bad_date.insert("title".into(), "X".into());
        bad_date.insert("date".into(), "July 10".into());
        assert!(matches!(
            src.produce(ProduceOp::UpsertRows { rows: vec![bad_date] }),
            Err(ProduceError::Conflict { .. })
        ));
    }

    #[test]
    fn slugify_handles_non_ascii_and_spaces() {
        assert_eq!(slugify("Team Sync #2"), "team-sync-2");
        // CJK collapses to the `event` fallback (escaped: the all-English hard
        // rule bans raw CJK literals even in tests).
        assert_eq!(slugify("\u{5468}\u{4f1a}"), "event");
        assert_eq!(slugify("  "), "event");
    }
}
