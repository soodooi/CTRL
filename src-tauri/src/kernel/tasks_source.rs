//! Tasks as a first-class RecordSource of the Unified Operation Interface
//! (ADR-002 §14) — the first slice of the LifeOS layer (GOAL Phase 1,
//! governing `vault/ctrl/lifeos-layer-restructure.md`).
//!
//! **Storage substrate = inline `- [ ]` checkboxes inside notes**, not a file
//! per task. Deep research (`lifeos-layer-restructure.md` §1) showed the
//! LifeOS/Obsidian world models tasks as checkbox lines living in daily /
//! periodic / project notes (Obsidian Tasks style), surfaced by query — that
//! is how the user actually captures a task (`vim` today's daily note, type
//! `- [ ] call bob 📅 2026-07-05 #work`) and how Aino's inbox works. This
//! source scans those lines across the vault into queryable rows; `produce`
//! appends a checkbox line to a target note (default: today's daily note) and
//! rewrites one in place to complete / edit it. The §14 contract, the gate
//! tools, and the query engine are all shared and unchanged — only the on-disk
//! substrate is inline markdown, which passes the vim test by construction.

use crate::kernel::query::{
    CellType, Describe, FieldSpec, Operator, QuerySource, Row, SourceKind,
};
use crate::kernel::vault;
use chrono::NaiveDate;
use std::path::Path;

/// Obsidian-Tasks style due marker: `📅 2026-07-05` (space optional).
const DUE_MARKER: char = '📅';

/// Checkbox lifecycle: `[ ]` todo, `[/]` doing, `[x]`/`[X]` done.
pub const STATUS_TODO: &str = "todo";
pub const STATUS_DOING: &str = "doing";
pub const STATUS_DONE: &str = "done";

/// One parsed task line and where it lives (note path + 0-based line index).
#[derive(Debug, Clone, PartialEq)]
pub struct TaskItem {
    pub path: String,
    pub line: usize,
    pub title: String,
    pub status: String,
    pub due: String,
    pub tags: Vec<String>,
}

/// A queryable view over every checkbox task in the vault (the Record profile
/// of the LifeOS Task source).
pub struct TaskSource {
    rows: Vec<Row>,
}

impl TaskSource {
    /// Scan the vault for checkbox task lines. `subdir` scopes the scan (None =
    /// whole vault). Notes that fail to read are skipped (read-only scan); a
    /// vault with no tasks yet is an empty source, not an error.
    pub fn load(vault_root: &Path, subdir: Option<&str>) -> TaskSource {
        let paths = vault::list(vault_root, subdir).unwrap_or_default();
        let mut rows = Vec::new();
        for path in paths {
            let Ok(entry) = vault::read(vault_root, &path) else { continue };
            for item in scan_tasks(&path, &entry.content) {
                rows.push(item_to_row(&item));
            }
        }
        TaskSource { rows }
    }

    /// The stable schema a task RecordSource advertises via `describe`. `status`
    /// is a Select over the fixed lifecycle so Irisy filters it as an enum;
    /// `line` locates the checkbox for `produce` (read-only to the caller).
    pub fn fields() -> Vec<FieldSpec> {
        vec![
            field("path", "Note", CellType::Text),
            field("line", "Line", CellType::Number),
            field("title", "Title", CellType::Text),
            select("status", "Status", &[STATUS_TODO, STATUS_DOING, STATUS_DONE]),
            field("due", "Due", CellType::Date),
            field("tags", "Tags", CellType::Tags),
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

/// The `describe` a task source advertises without scanning any note (the
/// gate's `task_describe` returns this — the type layer Irisy reads first).
pub fn describe() -> Describe {
    Describe {
        source_kind: SourceKind::Record,
        fields: TaskSource::fields(),
        operators: TaskSource::operators(),
    }
}

/// Produce (create) a task: append a `- [ ] <title>` checkbox line to a note
/// (ADR-002 §14 `produce`). `note` is the target vault path; None routes to
/// today's daily note (`daily/{YYYY}-{MM}-{DD}.md`), created empty if missing.
/// `due`/`tags` become inline `📅`/`#tag` tokens. Returns the note path.
pub fn create(
    vault_root: &Path,
    note: Option<&str>,
    title: &str,
    due: Option<&str>,
    tags: &[String],
    today: NaiveDate,
) -> Result<String, TaskError> {
    let title = title.trim();
    if title.is_empty() {
        return Err(TaskError::MissingTitle);
    }
    let rel = note
        .map(str::to_string)
        .unwrap_or_else(|| daily_note_path(today));

    // Read the note if it exists (append), else start a fresh body. Frontmatter
    // is preserved on existing notes; a new daily note gets a minimal one. A
    // note with no (or empty) frontmatter reads back as non-object — coerce to
    // an empty object so the write layer accepts it.
    let (mut body, frontmatter) = match vault::read(vault_root, &rel) {
        Ok(entry) => (entry.content, object_or_empty(entry.frontmatter)),
        Err(_) => (String::new(), serde_json::json!({ "type": "journal", "tags": ["daily"] })),
    };

    let line = render_task_line(title, due, tags);
    if !body.is_empty() && !body.ends_with('\n') {
        body.push('\n');
    }
    body.push_str(&line);
    body.push('\n');

    vault::write(vault_root, &rel, &body, &frontmatter).map_err(TaskError::Vault)?;
    Ok(rel)
}

/// Produce (update) one field of a task in place (ADR-002 §14 `produce`):
/// rewrite the checkbox line at `note`:`line`. `field` ∈ {status, due, tags,
/// title}; completing a task = `update(.., "status", "done", ..)`. Read-modify-
/// write through the same vault layer, preserving every other line.
pub fn update(
    vault_root: &Path,
    note: &str,
    line: usize,
    field: &str,
    value: &str,
) -> Result<(), TaskError> {
    let entry = vault::read(vault_root, note).map_err(TaskError::Vault)?;
    let mut lines: Vec<String> = entry.content.lines().map(str::to_string).collect();
    let target = lines.get(line).ok_or(TaskError::LineOutOfRange(line))?;
    let mut item = parse_task_line(note, line, target).ok_or(TaskError::NotATask(line))?;

    match field {
        "status" => item.status = normalize_status_word(value),
        "due" => item.due = value.trim().to_string(),
        "title" => {
            let t = value.trim();
            if t.is_empty() {
                return Err(TaskError::MissingTitle);
            }
            item.title = t.to_string();
        }
        "tags" => {
            item.tags = value
                .split(',')
                .map(|s| s.trim().trim_start_matches('#').to_string())
                .filter(|s| !s.is_empty())
                .collect();
        }
        other => return Err(TaskError::UnknownField(other.to_string())),
    }

    let indent = leading_ws(target);
    lines[line] = format!("{indent}{}", render_item(&item));
    let mut body = lines.join("\n");
    if entry.content.ends_with('\n') {
        body.push('\n');
    }
    vault::write(vault_root, note, &body, &object_or_empty(entry.frontmatter))
        .map_err(TaskError::Vault)?;
    Ok(())
}

/// Errors a task `produce` can return.
#[derive(Debug)]
pub enum TaskError {
    MissingTitle,
    LineOutOfRange(usize),
    NotATask(usize),
    UnknownField(String),
    Vault(vault::VaultError),
}

impl std::fmt::Display for TaskError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TaskError::MissingTitle => write!(f, "task requires a non-empty title"),
            TaskError::LineOutOfRange(n) => write!(f, "line {n} is out of range"),
            TaskError::NotATask(n) => write!(f, "line {n} is not a checkbox task"),
            TaskError::UnknownField(k) => {
                write!(f, "field '{k}' is not updatable (use status/due/title/tags)")
            }
            TaskError::Vault(e) => write!(f, "{e:?}"),
        }
    }
}

// ─── parsing / rendering ─────────────────────────────────────────────────────

/// Extract every checkbox task from a note body.
pub fn scan_tasks(path: &str, body: &str) -> Vec<TaskItem> {
    body.lines()
        .enumerate()
        .filter_map(|(i, l)| parse_task_line(path, i, l))
        .collect()
}

/// Parse one line into a task if it is a `- [ ]` / `- [x]` / `- [/]` checkbox.
/// Recognizes the Obsidian-Tasks `📅 <date>` due marker and `#tag` tokens; the
/// remaining text (tokens stripped) is the title used to match on update.
pub fn parse_task_line(path: &str, line: usize, raw: &str) -> Option<TaskItem> {
    let trimmed = raw.trim_start();
    let rest = trimmed.strip_prefix("- [").or_else(|| trimmed.strip_prefix("* ["))?;
    let mark = rest.chars().next()?;
    let after = rest.strip_prefix(mark)?.strip_prefix(']')?;
    let status = match mark {
        ' ' => STATUS_TODO,
        '/' => STATUS_DOING,
        'x' | 'X' => STATUS_DONE,
        _ => return None,
    }
    .to_string();

    let content = after.trim();
    let mut due = String::new();
    let mut tags = Vec::new();
    let mut title_tokens = Vec::new();

    let mut toks = content.split_whitespace().peekable();
    while let Some(tok) = toks.next() {
        if tok.starts_with(DUE_MARKER) {
            // `📅2026-07-05` (glued) or `📅` then the next token is the date.
            let inline = tok.trim_start_matches(DUE_MARKER).trim();
            if !inline.is_empty() {
                due = inline.to_string();
            } else if let Some(next) = toks.peek() {
                due = next.to_string();
                toks.next();
            }
        } else if let Some(tag) = tok.strip_prefix('#') {
            if !tag.is_empty() {
                tags.push(tag.to_string());
            }
        } else {
            title_tokens.push(tok);
        }
    }

    let title = title_tokens.join(" ");
    if title.is_empty() {
        return None;
    }
    Some(TaskItem { path: path.to_string(), line, title, status, due, tags })
}

/// Render a full checkbox line (no leading indent) from an item.
fn render_item(item: &TaskItem) -> String {
    render_task_line_status(&item.title, &item.status, opt(&item.due), &item.tags)
}

/// Render a fresh `- [ ] ...` line for `create` (always todo).
fn render_task_line(title: &str, due: Option<&str>, tags: &[String]) -> String {
    render_task_line_status(title, STATUS_TODO, due, tags)
}

fn render_task_line_status(title: &str, status: &str, due: Option<&str>, tags: &[String]) -> String {
    let mark = match status {
        STATUS_DOING => "/",
        STATUS_DONE => "x",
        _ => " ",
    };
    let mut s = format!("- [{mark}] {}", title.trim());
    if let Some(d) = due.map(str::trim).filter(|d| !d.is_empty()) {
        s.push_str(&format!(" {DUE_MARKER} {d}"));
    }
    for tag in tags {
        let t = tag.trim().trim_start_matches('#');
        if !t.is_empty() {
            s.push_str(&format!(" #{t}"));
        }
    }
    s
}

fn item_to_row(item: &TaskItem) -> Row {
    let mut row = Row::new();
    row.insert("path".into(), item.path.clone());
    row.insert("line".into(), item.line.to_string());
    row.insert("title".into(), item.title.clone());
    row.insert("status".into(), item.status.clone());
    row.insert("due".into(), item.due.clone());
    row.insert("tags".into(), item.tags.join(", "));
    row
}

/// Map any incoming status word / checkbox onto the known lifecycle.
fn normalize_status_word(raw: &str) -> String {
    match raw.trim().to_lowercase().as_str() {
        STATUS_DOING | "/" => STATUS_DOING,
        STATUS_DONE | "x" | "complete" | "completed" => STATUS_DONE,
        _ => STATUS_TODO,
    }
    .to_string()
}

fn daily_note_path(today: NaiveDate) -> String {
    // Matches the seeded daily-notes.yaml path_template (`daily/{YYYY}-{MM}-{DD}.md`).
    format!("daily/{}.md", today.format("%Y-%m-%d"))
}

fn leading_ws(s: &str) -> String {
    s.chars().take_while(|c| c.is_whitespace()).collect()
}

fn opt(s: &str) -> Option<&str> {
    if s.trim().is_empty() {
        None
    } else {
        Some(s)
    }
}

/// Coerce a read-back frontmatter value into a writable JSON object. A note with
/// no (or empty) frontmatter parses to null; the vault write layer requires an
/// object, so default to empty.
fn object_or_empty(v: serde_json::Value) -> serde_json::Value {
    if v.is_object() {
        v
    } else {
        serde_json::json!({})
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{Filter, Operator, QueryRequest, QuerySource};

    fn today() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, 30).unwrap()
    }

    #[test]
    fn describe_is_record_with_status_select() {
        let d = describe();
        assert_eq!(d.source_kind, SourceKind::Record);
        let status = d.fields.iter().find(|f| f.key == "status").unwrap();
        assert_eq!(status.cell_type, CellType::Select);
        assert!(d.operators.contains(&Operator::HasTag));
    }

    #[test]
    fn parse_recognizes_checkbox_states_due_and_tags() {
        let t = parse_task_line("daily/x.md", 3, "  - [ ] Call Bob 📅 2026-07-05 #work #p1").unwrap();
        assert_eq!(t.title, "Call Bob");
        assert_eq!(t.status, "todo");
        assert_eq!(t.due, "2026-07-05");
        assert_eq!(t.tags, vec!["work", "p1"]);
        assert_eq!(t.line, 3);

        assert_eq!(parse_task_line("n.md", 0, "- [x] done one").unwrap().status, "done");
        assert_eq!(parse_task_line("n.md", 0, "- [/] wip").unwrap().status, "doing");
        // Not a task.
        assert!(parse_task_line("n.md", 0, "just a bullet - point").is_none());
        assert!(parse_task_line("n.md", 0, "- [ ]   ").is_none());
    }

    #[test]
    fn create_appends_plain_checkbox_that_vim_can_read() {
        // vim test: the created task is a plain `- [ ]` line in a real note.
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        let rel = create(root, None, "Ship the LifeOS layer", Some("2026-07-05"), &["ctrl".into()], today()).unwrap();
        assert_eq!(rel, "daily/2026-06-30.md");
        let raw = std::fs::read_to_string(root.join(&rel)).unwrap();
        assert!(raw.contains("- [ ] Ship the LifeOS layer 📅 2026-07-05 #ctrl"));
    }

    #[test]
    fn create_appends_to_existing_note_preserving_content() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        vault::write(root, "projects/acme.md", "# Acme\n\n- [ ] existing", &serde_json::json!({})).unwrap();
        create(root, Some("projects/acme.md"), "New task", None, &[], today()).unwrap();
        let raw = std::fs::read_to_string(root.join("projects/acme.md")).unwrap();
        assert!(raw.contains("- [ ] existing"));
        assert!(raw.contains("- [ ] New task"));
    }

    #[test]
    fn create_requires_title() {
        let dir = tempfile::TempDir::new().unwrap();
        assert!(matches!(
            create(dir.path(), None, "   ", None, &[], today()),
            Err(TaskError::MissingTitle)
        ));
    }

    #[test]
    fn load_and_query_across_notes() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        vault::write(root, "daily/2026-06-30.md", "# Today\n- [ ] Due today 📅 2026-06-30 #a\n- [x] Done thing", &serde_json::json!({})).unwrap();
        vault::write(root, "projects/p.md", "- [ ] Later 📅 2026-12-01", &serde_json::json!({})).unwrap();

        let src = TaskSource::load(root, None);
        // 3 tasks scanned across 2 notes.
        assert_eq!(src.rows().len(), 3);

        // Open (todo) tasks only.
        let req = QueryRequest {
            filters: vec![Filter { field: "status".into(), op: Operator::Eq, value: "todo".into() }],
            ..Default::default()
        };
        let out = src.query(&req, today()).unwrap();
        assert_eq!(out.match_count, 2);

        // Due within today.
        let req = QueryRequest {
            filters: vec![Filter { field: "due".into(), op: Operator::Within, value: "today".into() }],
            ..Default::default()
        };
        let out = src.query(&req, today()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["title"], "Due today");
    }

    #[test]
    fn update_toggles_and_edits_by_line() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        vault::write(root, "daily/d.md", "# Head\n- [ ] one\n- [ ] two 📅 2026-07-01 #x\nplain tail", &serde_json::json!({})).unwrap();
        update(root, "daily/d.md", 2, "status", "done").unwrap();
        let raw = std::fs::read_to_string(root.join("daily/d.md")).unwrap();
        assert!(raw.contains("- [x] two 📅 2026-07-01 #x")); // completed, tokens kept
        assert!(raw.contains("- [ ] one")); // sibling untouched
        assert!(raw.contains("plain tail")); // non-task line untouched
        assert!(raw.contains("# Head")); // header untouched

        // Reschedule the due date.
        update(root, "daily/d.md", 2, "due", "2026-08-15").unwrap();
        let raw = std::fs::read_to_string(root.join("daily/d.md")).unwrap();
        assert!(raw.contains("📅 2026-08-15"));
    }

    #[test]
    fn update_rejects_non_task_line_and_bad_field() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        vault::write(root, "n.md", "- [ ] real\nnot a task", &serde_json::json!({})).unwrap();
        assert!(matches!(update(root, "n.md", 1, "status", "done"), Err(TaskError::NotATask(_))));
        assert!(matches!(update(root, "n.md", 0, "bogus", "x"), Err(TaskError::UnknownField(_))));
        assert!(matches!(update(root, "n.md", 99, "status", "done"), Err(TaskError::LineOutOfRange(_))));
    }

    #[test]
    fn unknown_field_query_rejected() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        vault::write(root, "n.md", "- [ ] x", &serde_json::json!({})).unwrap();
        let src = TaskSource::load(root, None);
        let req = QueryRequest {
            filters: vec![Filter { field: "nope".into(), op: Operator::Eq, value: "1".into() }],
            ..Default::default()
        };
        assert!(src.query(&req, today()).is_err());
    }
}
