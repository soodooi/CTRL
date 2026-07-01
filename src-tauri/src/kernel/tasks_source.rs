//! Tasks as a first-class RecordSource of the Unified Operation Interface
//! (ADR-002 §14) — the first slice of the LifeOS layer (GOAL Phase 1 SC1,
//! governing `vault/ctrl/lifeos-layer-restructure.md`).
//!
//! Each task is a plain markdown file with YAML frontmatter under a
//! configurable vault subdir (default `Tasks/`), so `vim Tasks/<slug>.md`
//! shows a real, hand-editable task — the vim test passes by construction, no
//! opaque store. `describe`/`query` reuse the shared kernel query engine (the
//! same one smart-tables and the KB use); `produce` (create / update) writes
//! the task file back through the same `vault` layer smart-table `produce`
//! uses. No bespoke storage, no new spine primitive — a new RecordSource that
//! Irisy and the BYO-CLI driver operate through the `:17873` gate.

use crate::kernel::query::{
    CellType, Describe, FieldSpec, Operator, QuerySource, Row, SourceKind,
};
use crate::kernel::vault;
use chrono::NaiveDate;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

/// Default vault subdir tasks live under. The user can pass another (layout is
/// user policy — ADR-006 §3 principle #7, not hardcoded beyond this default).
pub const DEFAULT_TASKS_DIR: &str = "Tasks";

/// The lifecycle states a task's `status` field carries. Plain strings on disk
/// so `vim` edits round-trip; `done` is the single "complete" sentinel.
pub const STATUS_TODO: &str = "todo";
pub const STATUS_DOING: &str = "doing";
pub const STATUS_DONE: &str = "done";

/// A queryable view over the task files in one vault subdir (the Record profile
/// of the LifeOS Task source).
pub struct TaskSource {
    rows: Vec<Row>,
}

impl TaskSource {
    /// Build from the vault by reading each task file's frontmatter. `subdir`
    /// scopes the scan (None = the default `Tasks/`). A missing dir (no task
    /// created yet) is an empty source, not an error — so `query` works before
    /// the first `produce`.
    pub fn load(vault_root: &Path, subdir: Option<&str>) -> TaskSource {
        let dir = subdir.unwrap_or(DEFAULT_TASKS_DIR);
        let paths = vault::list(vault_root, Some(dir)).unwrap_or_default();
        let mut rows = Vec::with_capacity(paths.len());
        for path in paths {
            // A task that fails to read is skipped, not fatal (read-only scan).
            if let Ok(entry) = vault::read(vault_root, &path) {
                rows.push(task_to_row(&path, &entry.frontmatter));
            }
        }
        TaskSource { rows }
    }

    /// The stable schema a task RecordSource advertises via `describe`. `status`
    /// is a Select over the fixed lifecycle so Irisy filters it as an enum.
    pub fn fields() -> Vec<FieldSpec> {
        vec![
            field("path", "Path", CellType::Text),
            field("title", "Title", CellType::Text),
            select("status", "Status", &[STATUS_TODO, STATUS_DOING, STATUS_DONE]),
            field("due", "Due", CellType::Date),
            field("priority", "Priority", CellType::Number),
            field("tags", "Tags", CellType::Tags),
            field("created", "Created", CellType::Date),
            field("modified", "Modified", CellType::Date),
        ]
    }

    /// Operators a task RecordSource supports (mirrors the KB / smart-table set).
    pub fn operators() -> Vec<Operator> {
        use Operator::*;
        vec![Eq, Neq, Contains, Gt, Lt, Gte, Lte, Before, After, Within, Is, HasTag]
    }
}

impl QuerySource for TaskSource {
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

/// The `describe` a task source advertises without loading any rows (the gate's
/// `task_describe` returns this — the type layer Irisy reads before querying).
pub fn describe() -> Describe {
    Describe {
        source_kind: SourceKind::Record,
        fields: TaskSource::fields(),
        operators: TaskSource::operators(),
    }
}

/// Produce (create) a new task file (ADR-002 §14 `produce` verb). `values`
/// carries frontmatter fields (at minimum `title`); `status` defaults to
/// `todo`, `created`/`modified` are stamped to `today` (injected for
/// determinism). The filename is a unique slug of the title under `subdir`, so
/// the file is human-findable. Returns the vault-relative path written.
pub fn create(
    vault_root: &Path,
    subdir: Option<&str>,
    values: &BTreeMap<String, String>,
    body: &str,
    today: NaiveDate,
) -> Result<String, TaskError> {
    let dir = subdir.unwrap_or(DEFAULT_TASKS_DIR);
    let title = values
        .get("title")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .ok_or(TaskError::MissingTitle)?;

    let today_str = today.format("%Y-%m-%d").to_string();
    let mut fm = serde_json::Map::new();
    // Stored fields, with sensible defaults. Anything the caller passes wins,
    // except path/created/modified which the source owns.
    fm.insert("title".into(), Value::String(title.to_string()));
    fm.insert(
        "status".into(),
        Value::String(normalize_status(values.get("status"))),
    );
    for key in ["due", "priority", "tags"] {
        if let Some(v) = values.get(key).map(|s| s.trim()).filter(|s| !s.is_empty()) {
            fm.insert(key.into(), Value::String(v.to_string()));
        }
    }
    fm.insert("created".into(), Value::String(today_str.clone()));
    fm.insert("modified".into(), Value::String(today_str));

    let rel = unique_task_path(vault_root, dir, title);
    vault::write(vault_root, &rel, body, &Value::Object(fm)).map_err(TaskError::Vault)?;
    Ok(rel)
}

/// Produce (update) one frontmatter field of an existing task, bumping
/// `modified` (ADR-002 §14 `produce`). Read-modify-write through the same vault
/// layer, preserving the task body. `path`/`created` are owned by the source
/// and cannot be set this way. Completing a task = `update(.., "status",
/// "done", ..)`.
pub fn update(
    vault_root: &Path,
    path: &str,
    field: &str,
    value: &str,
    today: NaiveDate,
) -> Result<(), TaskError> {
    if matches!(field, "path" | "created") {
        return Err(TaskError::ReadOnlyField(field.to_string()));
    }
    let entry = vault::read(vault_root, path).map_err(TaskError::Vault)?;
    let mut fm = match entry.frontmatter {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    if field == "status" {
        fm.insert("status".into(), Value::String(normalize_status(Some(&value.to_string()))));
    } else {
        fm.insert(field.to_string(), Value::String(value.to_string()));
    }
    fm.insert(
        "modified".into(),
        Value::String(today.format("%Y-%m-%d").to_string()),
    );
    vault::write(vault_root, path, &entry.content, &Value::Object(fm)).map_err(TaskError::Vault)?;
    Ok(())
}

/// Errors a task `produce` can return (read stays infallible-per-file).
#[derive(Debug)]
pub enum TaskError {
    MissingTitle,
    ReadOnlyField(String),
    Vault(vault::VaultError),
}

impl std::fmt::Display for TaskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskError::MissingTitle => write!(f, "task requires a non-empty 'title'"),
            TaskError::ReadOnlyField(k) => {
                write!(f, "field '{k}' is owned by the task source (read-only)")
            }
            TaskError::Vault(e) => write!(f, "{e:?}"),
        }
    }
}

// ─── internals ──────────────────────────────────────────────────────────────

/// Map an incoming status onto the known lifecycle; unknown/empty → `todo`.
fn normalize_status(raw: Option<&String>) -> String {
    match raw.map(|s| s.trim().to_lowercase()).as_deref() {
        Some(STATUS_DOING) => STATUS_DOING,
        Some(STATUS_DONE) => STATUS_DONE,
        _ => STATUS_TODO,
    }
    .to_string()
}

/// Project one task (path + parsed frontmatter) into a queryable row. Same
/// shape as the schema `describe` advertises.
fn task_to_row(path: &str, fm: &Value) -> Row {
    let mut row = Row::new();
    row.insert("path".into(), path.to_string());
    row.insert("title".into(), title_of(path, fm));
    row.insert("status".into(), status_of(fm));
    for key in ["due", "priority", "created", "modified"] {
        row.insert(key.into(), fm_str(fm, key));
    }
    row.insert("tags".into(), tags_of(fm));
    row
}

fn title_of(path: &str, fm: &Value) -> String {
    if let Some(t) = fm.get("title").and_then(Value::as_str) {
        if !t.trim().is_empty() {
            return t.to_string();
        }
    }
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn status_of(fm: &Value) -> String {
    normalize_status(fm.get("status").and_then(Value::as_str).map(str::to_string).as_ref())
}

/// Join frontmatter `tags` (array or scalar) into the comma form `HasTag` reads.
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

fn fm_str(fm: &Value, key: &str) -> String {
    match fm.get(key) {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

fn field(key: &str, label: &str, cell_type: CellType) -> FieldSpec {
    FieldSpec { key: key.to_string(), label: label.to_string(), cell_type, options: None }
}

fn select(key: &str, label: &str, options: &[&str]) -> FieldSpec {
    FieldSpec {
        key: key.to_string(),
        label: label.to_string(),
        cell_type: CellType::Select,
        options: Some(options.iter().map(|s| s.to_string()).collect()),
    }
}

/// A filesystem-safe, human-readable filename stem from the task title.
fn slugify(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut prev_dash = false;
    for ch in title.trim().to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let slug = out.trim_matches('-').to_string();
    if slug.is_empty() {
        "task".to_string()
    } else {
        slug
    }
}

/// A vault-relative task path that does not collide with an existing file
/// (`<dir>/<slug>.md`, then `-2`, `-3`, …). Deterministic given vault state.
fn unique_task_path(vault_root: &Path, dir: &str, title: &str) -> String {
    let slug = slugify(title);
    let base = format!("{}/{}", dir.trim_end_matches('/'), slug);
    let mut rel = format!("{base}.md");
    let mut n = 2;
    while vault::read(vault_root, &rel).is_ok() {
        rel = format!("{base}-{n}.md");
        n += 1;
    }
    rel
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{Filter, Operator, QueryRequest, QuerySource};

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()
    }

    fn vals(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn describe_is_record_with_status_select() {
        let d = describe();
        assert_eq!(d.source_kind, SourceKind::Record);
        let status = d.fields.iter().find(|f| f.key == "status").unwrap();
        assert_eq!(status.cell_type, CellType::Select);
        assert_eq!(
            status.options.as_ref().unwrap(),
            &vec!["todo".to_string(), "doing".to_string(), "done".to_string()]
        );
        assert!(d.operators.contains(&Operator::HasTag));
    }

    #[test]
    fn create_writes_plain_markdown_that_vim_can_read() {
        // vim test: after produce, the task is a real markdown file with
        // human-readable frontmatter fields on disk.
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let rel = create(
            root,
            None,
            &vals(&[("title", "Ship the LifeOS layer"), ("due", "2026-07-05"), ("tags", "ctrl, p1")]),
            "Notes about the task.",
            today(),
        )
        .unwrap();
        assert_eq!(rel, "Tasks/ship-the-lifeos-layer.md");
        let raw = std::fs::read_to_string(root.join(&rel)).unwrap();
        assert!(raw.contains("title: Ship the LifeOS layer"));
        assert!(raw.contains("status: todo"));
        assert!(raw.contains("due: 2026-07-05"));
        assert!(raw.contains("created: 2026-06-30"));
        assert!(raw.contains("Notes about the task."));
    }

    #[test]
    fn create_slug_collision_gets_suffix() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let a = create(root, None, &vals(&[("title", "Call Bob")]), "", today()).unwrap();
        let b = create(root, None, &vals(&[("title", "Call Bob")]), "", today()).unwrap();
        assert_eq!(a, "Tasks/call-bob.md");
        assert_eq!(b, "Tasks/call-bob-2.md");
    }

    #[test]
    fn create_requires_title() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(matches!(
            create(dir.path(), None, &vals(&[("title", "  ")]), "", today()),
            Err(TaskError::MissingTitle)
        ));
    }

    #[test]
    fn load_and_query_by_status_and_due() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        create(root, None, &vals(&[("title", "Due soon"), ("due", "2026-06-30")]), "", today()).unwrap();
        create(root, None, &vals(&[("title", "Later"), ("due", "2026-12-01")]), "", today()).unwrap();
        let done = create(root, None, &vals(&[("title", "Finished")]), "", today()).unwrap();
        update(root, &done, "status", "done", today()).unwrap();

        // Query: open (status != done) tasks. Use status Eq todo.
        let src = TaskSource::load(root, None);
        let req = QueryRequest {
            filters: vec![Filter { field: "status".into(), op: Operator::Eq, value: "todo".into() }],
            ..Default::default()
        };
        let out = src.query(&req, today()).unwrap();
        assert_eq!(out.match_count, 2);
        assert!(out.rows.iter().all(|r| r["status"] == "todo"));

        // Query: due within today.
        let req = QueryRequest {
            filters: vec![Filter { field: "due".into(), op: Operator::Within, value: "today".into() }],
            ..Default::default()
        };
        let out = src.query(&req, today()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["title"], "Due soon");
    }

    #[test]
    fn update_completes_and_bumps_modified_preserving_body() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let rel = create(root, None, &vals(&[("title", "Write ADR")]), "body kept", today()).unwrap();
        let later = NaiveDate::from_ymd_opt(2026, 7, 2).unwrap();
        update(root, &rel, "status", "done", later).unwrap();

        let entry = vault::read(root, &rel).unwrap();
        assert_eq!(entry.frontmatter.get("status").unwrap(), "done");
        assert_eq!(entry.frontmatter.get("modified").unwrap(), "2026-07-02");
        assert_eq!(entry.frontmatter.get("created").unwrap(), "2026-06-30"); // unchanged
        assert!(entry.content.contains("body kept"));
    }

    #[test]
    fn update_rejects_source_owned_fields() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let rel = create(root, None, &vals(&[("title", "X")]), "", today()).unwrap();
        assert!(matches!(
            update(root, &rel, "created", "2000-01-01", today()),
            Err(TaskError::ReadOnlyField(_))
        ));
    }

    #[test]
    fn unknown_field_query_rejected() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        create(root, None, &vals(&[("title", "X")]), "", today()).unwrap();
        let src = TaskSource::load(root, None);
        let req = QueryRequest {
            filters: vec![Filter { field: "bogus".into(), op: Operator::Eq, value: "1".into() }],
            ..Default::default()
        };
        assert!(src.query(&req, today()).is_err());
    }
}
