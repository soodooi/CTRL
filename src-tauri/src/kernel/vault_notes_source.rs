//! Notes (knowledge base) as a RecordSource of the Unified Operation Interface
//! (ADR-002 §14). Each note becomes a row {path, title, tags, created,
//! modified} and is queried through the SAME shared kernel engine Irisy uses
//! for smart-tables — proving the contract generalizes past one source. This
//! is the metadata/record profile of the KB; full-text + semantic search stay
//! the TextSource profile (`vault.search` / `vault.semantic_search`).

use crate::kernel::query::{
    CellType, Describe, FieldSpec, Operator, QueryRequest, QueryResult, QuerySource, Row,
    SourceKind,
};
use crate::kernel::vault;
use serde_json::Value;
use std::path::Path;

/// The §14 **Text** profile of the vault (ADR-002 substrate §14, TextSource) —
/// full-text content search as a queryable source. Complements `NotesSource`
/// (the Record/metadata profile): together they make the vault a complete §14
/// read source. This is the §14 *target* surface for content search; the legacy
/// bespoke `vault_search` tool retires onto it once the frontend moves off it.
pub mod text {
    use super::*;

    /// What the vault Text source advertises via `describe`. A `Contains` filter
    /// on `content` is the full-text match; results carry `path`.
    pub fn describe() -> Describe {
        Describe {
            source_kind: SourceKind::Text,
            fields: vec![
                field("content", "Content", CellType::Text),
                field("path", "Path", CellType::Text),
            ],
            operators: vec![Operator::Contains],
        }
    }

    /// Run a §14 text query: the `Contains` filter's value is the full-text
    /// needle (FTS5 when indexed, substring fallback — same engine the bespoke
    /// `vault_search` uses). Returns one row `{path}` per hit, in the uniform
    /// `QueryResult` shape, so AI/clients query vault content the same way they
    /// query smart-tables and the KB.
    pub fn query(vault_root: &Path, req: &QueryRequest) -> Result<QueryResult, vault::VaultError> {
        let needle = req
            .filters
            .iter()
            .find(|f| f.op == Operator::Contains)
            .map(|f| f.value.clone())
            .unwrap_or_default();
        let limit = req.limit.unwrap_or(20);
        let paths = if needle.trim().is_empty() {
            Vec::new()
        } else {
            vault::search(vault_root, &needle, limit)?
        };
        let match_count = paths.len();
        let rows = paths
            .into_iter()
            .map(|p| {
                let mut row = Row::new();
                row.insert("path".into(), p);
                row
            })
            .collect();
        Ok(QueryResult { rows, match_count })
    }
}

pub struct NotesSource {
    rows: Vec<Row>,
}

impl NotesSource {
    /// Build from the vault by reading each note's frontmatter. `subdir`
    /// scopes the scan (None = whole vault).
    pub fn load(vault_root: &Path, subdir: Option<&str>) -> Result<NotesSource, vault::VaultError> {
        let paths = vault::list(vault_root, subdir)?;
        let mut rows = Vec::with_capacity(paths.len());
        for path in paths {
            // A note that fails to read is skipped, not fatal (read-only scan).
            if let Ok(entry) = vault::read(vault_root, &path) {
                rows.push(note_to_row(&path, &entry.frontmatter));
            }
        }
        Ok(NotesSource { rows })
    }

    /// The stable schema a notes RecordSource advertises via `describe`.
    pub fn fields() -> Vec<FieldSpec> {
        vec![
            field("path", "Path", CellType::Text),
            field("title", "Title", CellType::Text),
            field("tags", "Tags", CellType::Tags),
            field("created", "Created", CellType::Date),
            field("modified", "Modified", CellType::Date),
        ]
    }
}

impl QuerySource for NotesSource {
    fn describe(&self) -> Describe {
        Describe {
            source_kind: SourceKind::Record,
            fields: Self::fields(),
            operators: record_operators(),
        }
    }

    fn rows(&self) -> &[Row] {
        &self.rows
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

fn record_operators() -> Vec<Operator> {
    use Operator::*;
    vec![Eq, Neq, Contains, Before, After, Within, HasTag]
}

/// Project one note (path + parsed frontmatter) into a queryable row.
fn note_to_row(path: &str, frontmatter: &Value) -> Row {
    let mut row = Row::new();
    row.insert("path".into(), path.to_string());
    row.insert("title".into(), title_of(path, frontmatter));
    row.insert("tags".into(), tags_of(frontmatter));
    row.insert("created".into(), fm_str(frontmatter, "created"));
    row.insert("modified".into(), fm_str(frontmatter, "modified"));
    row
}

fn title_of(path: &str, fm: &Value) -> String {
    if let Some(t) = fm.get("title").and_then(Value::as_str) {
        return t.to_string();
    }
    // Fall back to the file stem.
    Path::new(path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

/// Join frontmatter `tags` (array or scalar) into the comma form the Tags
/// operator (`has_tag`) understands.
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
    fm.get(key)
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{run_query, Filter, Operator, QueryRequest};
    use chrono::NaiveDate;

    #[test]
    fn text_profile_describes_as_text_with_contains() {
        let d = text::describe();
        assert_eq!(d.source_kind, SourceKind::Text);
        assert!(d.operators.contains(&Operator::Contains));
        assert!(d.fields.iter().any(|f| f.key == "content"));
    }

    #[test]
    fn text_query_returns_matching_note_paths() {
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        // substring_search_scan (test mode) matches file CONTENT, case-insensitive.
        vault::write(root, "acme.md", "Acme Corporation deal", &serde_json::json!({})).unwrap();
        vault::write(root, "beta.md", "unrelated note", &serde_json::json!({})).unwrap();
        let req = QueryRequest {
            filters: vec![Filter {
                field: "content".into(),
                op: Operator::Contains,
                value: "Acme".into(),
            }],
            ..Default::default()
        };
        let res = text::query(root, &req).unwrap();
        assert_eq!(res.match_count, res.rows.len());
        assert!(res.rows.iter().any(|r| r.get("path").is_some_and(|p| p.contains("acme"))));
        assert!(!res.rows.iter().any(|r| r.get("path").is_some_and(|p| p.contains("beta"))));
        // No Contains filter / empty needle → empty result (deterministic).
        let empty = text::query(root, &QueryRequest::default()).unwrap();
        assert_eq!(empty.match_count, 0);
    }

    fn rows() -> Vec<Row> {
        vec![
            note_to_row(
                "crm/acme.md",
                &serde_json::json!({ "title": "Acme", "tags": ["crm", "vip"], "modified": "2026-06-18" }),
            ),
            note_to_row(
                "notes/idea.md",
                &serde_json::json!({ "tags": "draft", "modified": "2026-05-01" }),
            ),
        ]
    }

    #[test]
    fn title_falls_back_to_stem() {
        assert_eq!(rows()[1]["title"], "idea");
        assert_eq!(rows()[0]["title"], "Acme");
    }

    #[test]
    fn tags_array_and_scalar_both_join() {
        assert_eq!(rows()[0]["tags"], "crm, vip");
        assert_eq!(rows()[1]["tags"], "draft");
    }

    #[test]
    fn query_notes_by_tag_and_recency() {
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let req = QueryRequest {
            filters: vec![
                Filter { field: "tags".into(), op: Operator::HasTag, value: "crm".into() },
                Filter { field: "modified".into(), op: Operator::Within, value: "this_month".into() },
            ],
            ..Default::default()
        };
        let out = run_query(&NotesSource::fields(), &rows(), &req, now).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["title"], "Acme");
    }

    #[test]
    fn unknown_field_rejected() {
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let req = QueryRequest {
            filters: vec![Filter { field: "bogus".into(), op: Operator::Eq, value: "x".into() }],
            ..Default::default()
        };
        assert!(run_query(&NotesSource::fields(), &rows(), &req, now).is_err());
    }
}
