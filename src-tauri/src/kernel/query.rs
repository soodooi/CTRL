//! Unified query contract — the read half of the Unified Operation Interface
//! (ADR-002 substrate §14). A `QuerySource` self-describes its fields plus the
//! operators it supports (`describe`), and answers a structured `QueryRequest`
//! (`query`). The filter/sort/group engine in this module is the shared kernel
//! query service: every RecordSource reuses it instead of re-implementing
//! filtering, so a new source becomes Irisy-operable with zero bespoke logic.
//!
//! Anti-hallucination (ADR-003 §6.5): callers fill a parameter object, never a
//! free-form query string; `Operator` is a fixed compile-time set; a `field`
//! that is not in the source's schema is rejected at query time with the list
//! of valid fields so the caller self-corrects.

use chrono::{Datelike, Duration, NaiveDate};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;

/// A row = ordered field-key → raw cell text. Cells stay plain text on disk
/// (vim test) and are typed by the schema's `CellType` only at compare time.
pub type Row = BTreeMap<String, String>;

/// Which operation profile a source exposes (ADR-002 §14.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Record,
    Text,
    Blob,
}

/// Cell types a RecordSource field can carry. On disk all cells are strings;
/// this drives type-aware comparison (number < / date within / tags membership).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CellType {
    Text,
    Number,
    Date,
    Checkbox,
    Tags,
    Select,
    Url,
}

impl CellType {
    pub fn parse(s: &str) -> CellType {
        // Render-level types collapse to a small set of SEMANTIC base types:
        // currency / rating / progress filter + sort as numbers; multiline /
        // email / phone as text. Kept in sync with the front end's
        // baseCellType (lib/smart-table.ts).
        match s {
            "number" | "currency" | "rating" | "progress" | "percent" | "duration"
            | "auto_number" => CellType::Number,
            "date" | "created_at" | "modified_at" => CellType::Date,
            "checkbox" => CellType::Checkbox,
            "tags" => CellType::Tags,
            "select" => CellType::Select,
            "url" => CellType::Url,
            _ => CellType::Text,
        }
    }
}

/// One field of a source's schema (the type layer Irisy reads via `describe`).
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct FieldSpec {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub cell_type: CellType,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub options: Option<Vec<String>>,
}

/// Table-INDEPENDENT operator set — a genuine compile-time enum (ADR-002 §14.1).
/// Only the `field` of a `Filter` is a validated string; the operator never is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum Operator {
    Eq,
    Neq,
    Contains,
    Gt,
    Lt,
    Gte,
    Lte,
    Before,
    After,
    Within,
    Is,
    HasTag,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct Filter {
    pub field: String,
    pub op: Operator,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct SortKey {
    pub field: String,
    #[serde(default)]
    pub desc: bool,
}

/// How a request's filters combine — table-independent, a genuine enum (never a
/// caller string). `And` (default) keeps the original semantics; `Or` passes a
/// row that satisfies any filter (an empty filter set always passes, both ways).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum Conjunction {
    #[default]
    And,
    Or,
}

/// A structured read request — the parameter object Irisy fills (never a query
/// string). All field references are validated against the source's schema.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
pub struct QueryRequest {
    #[serde(default)]
    pub filters: Vec<Filter>,
    /// How `filters` combine (default And). Lets the caller express OR queries.
    #[serde(default)]
    pub conjunction: Conjunction,
    #[serde(default)]
    pub sort: Vec<SortKey>,
    /// Group keys applied in order (first is the primary level); equal-valued
    /// rows are made contiguous. Empty = no grouping. Multi-level grouping.
    #[serde(default)]
    pub group_by: Vec<String>,
    #[serde(default)]
    pub limit: Option<usize>,
}

/// What `describe` returns: the source kind, its fields, and the operators it
/// supports — the semantic layer Irisy reads before composing a query.
#[derive(Debug, Clone, Serialize, JsonSchema)]
pub struct Describe {
    pub source_kind: SourceKind,
    pub fields: Vec<FieldSpec>,
    pub operators: Vec<Operator>,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub rows: Vec<Row>,
    pub match_count: usize,
}

/// Rejected query — currently only an unknown field reference (anti-hallucination
/// feedback: returns the valid set so the caller fixes its next call).
#[derive(Debug, Clone)]
pub enum QueryError {
    UnknownField { field: String, valid: Vec<String> },
}

impl std::fmt::Display for QueryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            QueryError::UnknownField { field, valid } => {
                write!(f, "field_not_found: '{field}' (valid: {})", valid.join(", "))
            }
        }
    }
}

/// The read half of ADR-002 §14. Implemented by every RecordSource (smart-table
/// first; notes / connectors / registries follow the same shape).
pub trait QuerySource {
    fn describe(&self) -> Describe;
    fn rows(&self) -> &[Row];

    fn query(&self, req: &QueryRequest, now: NaiveDate) -> Result<QueryResult, QueryError> {
        let desc = self.describe();
        run_query(&desc.fields, self.rows(), req, now)
    }
}

/// Shared kernel query engine: validate → filter → sort → group → limit over
/// typed string rows. The single place filtering lives (ADR-002 §14.1).
pub fn run_query(
    fields: &[FieldSpec],
    rows: &[Row],
    req: &QueryRequest,
    now: NaiveDate,
) -> Result<QueryResult, QueryError> {
    let valid: Vec<String> = fields.iter().map(|f| f.key.clone()).collect();
    let type_of = |key: &str| -> Option<CellType> {
        fields.iter().find(|f| f.key == key).map(|f| f.cell_type)
    };
    let unknown = |field: &str| QueryError::UnknownField {
        field: field.to_string(),
        valid: valid.clone(),
    };

    // Validate every field reference up front (reject hallucinated fields).
    for f in &req.filters {
        if type_of(&f.field).is_none() {
            return Err(unknown(&f.field));
        }
    }
    for s in &req.sort {
        if type_of(&s.field).is_none() {
            return Err(unknown(&s.field));
        }
    }
    for g in &req.group_by {
        if type_of(g).is_none() {
            return Err(unknown(g));
        }
    }

    // Filter — a row passes per the request's conjunction (And = every filter,
    // Or = any). An empty filter set always passes, regardless of conjunction.
    let mut out: Vec<Row> = rows
        .iter()
        .filter(|row| {
            if req.filters.is_empty() {
                return true;
            }
            let eval = |f: &Filter| {
                let ct = type_of(&f.field).unwrap_or(CellType::Text);
                let cell = row.get(&f.field).map(String::as_str).unwrap_or("");
                apply_filter(cell, ct, f.op, &f.value, now)
            };
            match req.conjunction {
                Conjunction::And => req.filters.iter().all(eval),
                Conjunction::Or => req.filters.iter().any(eval),
            }
        })
        .cloned()
        .collect();

    // Sort — stable, multi-key; apply keys in reverse so the first key wins.
    for key in req.sort.iter().rev() {
        let ct = type_of(&key.field).unwrap_or(CellType::Text);
        out.sort_by(|a, b| {
            let av = a.get(&key.field).map(String::as_str).unwrap_or("");
            let bv = b.get(&key.field).map(String::as_str).unwrap_or("");
            let ord = compare_cells(av, bv, ct);
            if key.desc {
                ord.reverse()
            } else {
                ord
            }
        });
    }

    // Group — stable partition so rows sharing the group keys are contiguous.
    // Multi-level: compare keys in order; the sort is stable, so the prior sort
    // is preserved within the deepest group.
    if !req.group_by.is_empty() {
        out.sort_by(|a, b| {
            for g in &req.group_by {
                let av = a.get(g).map(String::as_str).unwrap_or("");
                let bv = b.get(g).map(String::as_str).unwrap_or("");
                match av.cmp(bv) {
                    std::cmp::Ordering::Equal => continue,
                    ord => return ord,
                }
            }
            std::cmp::Ordering::Equal
        });
    }

    let match_count = out.len();
    if let Some(lim) = req.limit {
        out.truncate(lim);
    }
    Ok(QueryResult { rows: out, match_count })
}

/// Evaluate one filter against one cell, typed by the field's `CellType`.
fn apply_filter(cell: &str, ct: CellType, op: Operator, value: &str, now: NaiveDate) -> bool {
    match ct {
        CellType::Number => {
            let (Some(c), Some(v)) = (parse_num(cell), parse_num(value)) else {
                return false;
            };
            match op {
                Operator::Eq => nums_eq(c, v),
                Operator::Neq => !nums_eq(c, v),
                Operator::Gt => c > v,
                Operator::Lt => c < v,
                Operator::Gte => c >= v,
                Operator::Lte => c <= v,
                _ => false,
            }
        }
        CellType::Date => {
            let Some(c) = parse_date(cell) else { return false };
            if op == Operator::Within {
                return within(c, value, now);
            }
            let Some(v) = parse_date(value) else { return false };
            match op {
                Operator::Eq => c == v,
                Operator::Before | Operator::Lt => c < v,
                Operator::After | Operator::Gt => c > v,
                Operator::Lte => c <= v,
                Operator::Gte => c >= v,
                _ => false,
            }
        }
        CellType::Checkbox => {
            let truthy = is_truthy(cell);
            let want = is_truthy(value);
            matches!(op, Operator::Is | Operator::Eq) && truthy == want
        }
        CellType::Tags => {
            let want = value.trim();
            let hit = cell
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .any(|t| t.eq_ignore_ascii_case(want));
            match op {
                Operator::HasTag | Operator::Contains | Operator::Eq => hit,
                Operator::Neq => !hit,
                _ => false,
            }
        }
        // text / select / url — case-insensitive string operators.
        _ => {
            let c = cell.trim();
            let v = value.trim();
            match op {
                Operator::Eq => c.eq_ignore_ascii_case(v),
                Operator::Neq => !c.eq_ignore_ascii_case(v),
                Operator::Contains => c.to_lowercase().contains(&v.to_lowercase()),
                _ => false,
            }
        }
    }
}

fn compare_cells(a: &str, b: &str, ct: CellType) -> Ordering {
    match ct {
        CellType::Number => parse_num(a)
            .unwrap_or(f64::NEG_INFINITY)
            .partial_cmp(&parse_num(b).unwrap_or(f64::NEG_INFINITY))
            .unwrap_or(Ordering::Equal),
        CellType::Date => parse_date(a).cmp(&parse_date(b)),
        _ => a.to_lowercase().cmp(&b.to_lowercase()),
    }
}

fn parse_num(s: &str) -> Option<f64> {
    // Reject inf / NaN / 1e400 so they cannot poison sort order or compare as
    // a bogus value (full-review P2).
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

/// Relative-epsilon equality. `f64::EPSILON` is machine precision near 1.0 —
/// far too tight for large integers (currency / counts), where two equal
/// parsed values can differ by more than it. Scale the tolerance to magnitude
/// (full-review P2).
fn nums_eq(a: f64, b: f64) -> bool {
    (a - b).abs() <= f64::EPSILON * a.abs().max(b.abs()).max(1.0)
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y-%m-%d").ok()
}

fn is_truthy(s: &str) -> bool {
    matches!(s.trim(), "x" | "X" | "true" | "yes" | "1" | "✓")
}

/// Relative-date ranges for the `within` operator. `now` is injected (the tool
/// passes today's date; tests pass a fixed date) — deterministic, testable.
fn within(d: NaiveDate, range: &str, now: NaiveDate) -> bool {
    match range {
        "today" => d == now,
        "this_week" => {
            let start = now - Duration::days(now.weekday().num_days_from_monday() as i64);
            d >= start && d <= start + Duration::days(6)
        }
        "this_month" => d.year() == now.year() && d.month() == now.month(),
        "past_7_days" => d <= now && d >= now - Duration::days(7),
        "past_30_days" => d <= now && d >= now - Duration::days(30),
        "future" => d > now,
        "past" => d < now,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fields() -> Vec<FieldSpec> {
        vec![
            FieldSpec { key: "name".into(), label: "Name".into(), cell_type: CellType::Text, options: None },
            FieldSpec { key: "amount".into(), label: "Amount".into(), cell_type: CellType::Number, options: None },
            FieldSpec { key: "due".into(), label: "Due".into(), cell_type: CellType::Date, options: None },
            FieldSpec { key: "done".into(), label: "Done".into(), cell_type: CellType::Checkbox, options: None },
            FieldSpec { key: "tags".into(), label: "Tags".into(), cell_type: CellType::Tags, options: None },
        ]
    }

    fn row(pairs: &[(&str, &str)]) -> Row {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    fn sample() -> Vec<Row> {
        vec![
            row(&[("name", "Acme"), ("amount", "100"), ("due", "2026-06-20"), ("done", "x"), ("tags", "crm, vip")]),
            row(&[("name", "Beta"), ("amount", "50"), ("due", "2026-07-01"), ("done", ""), ("tags", "crm")]),
            row(&[("name", "Cobalt"), ("amount", "250"), ("due", "2026-06-18"), ("done", ""), ("tags", "lead")]),
        ]
    }

    fn now() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, 19).unwrap()
    }

    fn req() -> QueryRequest {
        QueryRequest::default()
    }

    #[test]
    fn filter_number_gt() {
        let r = QueryRequest { filters: vec![Filter { field: "amount".into(), op: Operator::Gt, value: "80".into() }], ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 2);
        assert!(out.rows.iter().all(|row| row["name"] == "Acme" || row["name"] == "Cobalt"));
    }

    #[test]
    fn filter_text_contains_case_insensitive() {
        let r = QueryRequest { filters: vec![Filter { field: "name".into(), op: Operator::Contains, value: " co".into() }], ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["name"], "Cobalt");
    }

    #[test]
    fn filter_checkbox_is() {
        let r = QueryRequest { filters: vec![Filter { field: "done".into(), op: Operator::Is, value: "true".into() }], ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["name"], "Acme");
    }

    #[test]
    fn filter_tags_has_tag() {
        let r = QueryRequest { filters: vec![Filter { field: "tags".into(), op: Operator::HasTag, value: "crm".into() }], ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 2);
    }

    #[test]
    fn filter_date_within_this_week() {
        // week of 2026-06-19 (Fri) = Mon 2026-06-15 .. Sun 2026-06-21.
        let r = QueryRequest { filters: vec![Filter { field: "due".into(), op: Operator::Within, value: "this_week".into() }], ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 2); // 06-20 and 06-18, not 07-01
    }

    #[test]
    fn sort_number_desc_then_limit() {
        let r = QueryRequest { sort: vec![SortKey { field: "amount".into(), desc: true }], limit: Some(2), ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 3); // count before limit
        assert_eq!(out.rows.len(), 2);
        assert_eq!(out.rows[0]["name"], "Cobalt"); // 250
        assert_eq!(out.rows[1]["name"], "Acme"); // 100
    }

    #[test]
    fn unknown_field_rejected_with_valid_set() {
        let r = QueryRequest { filters: vec![Filter { field: "nope".into(), op: Operator::Eq, value: "x".into() }], ..req() };
        let err = run_query(&fields(), &sample(), &r, now()).unwrap_err();
        match err {
            QueryError::UnknownField { field, valid } => {
                assert_eq!(field, "nope");
                assert!(valid.contains(&"amount".to_string()));
            }
        }
    }

    #[test]
    fn filter_or_passes_either() {
        // amount < 80 (Beta) OR tags has 'lead' (Cobalt) → two distinct rows.
        let r = QueryRequest {
            filters: vec![
                Filter { field: "amount".into(), op: Operator::Lt, value: "80".into() },
                Filter { field: "tags".into(), op: Operator::HasTag, value: "lead".into() },
            ],
            conjunction: Conjunction::Or,
            ..req()
        };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 2);
        assert!(out.rows.iter().any(|row| row["name"] == "Beta"));
        assert!(out.rows.iter().any(|row| row["name"] == "Cobalt"));
    }

    #[test]
    fn filter_and_is_the_default() {
        // Same two filters AND'd match nothing (no row is both <80 and 'lead').
        let r = QueryRequest {
            filters: vec![
                Filter { field: "amount".into(), op: Operator::Lt, value: "80".into() },
                Filter { field: "tags".into(), op: Operator::HasTag, value: "lead".into() },
            ],
            ..req()
        };
        assert_eq!(req().conjunction, Conjunction::And);
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 0);
    }

    #[test]
    fn empty_filters_pass_under_or() {
        let r = QueryRequest { conjunction: Conjunction::Or, ..req() };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        assert_eq!(out.match_count, 3);
    }

    #[test]
    fn multi_level_group_is_contiguous() {
        // Group by done, then name — rows sharing `done` cluster, ordered by name
        // within. done="" → (Beta, Cobalt) contiguous; done="x" → (Acme).
        let r = QueryRequest {
            group_by: vec!["done".into(), "name".into()],
            ..req()
        };
        let out = run_query(&fields(), &sample(), &r, now()).unwrap();
        let order: Vec<&str> = out.rows.iter().map(|row| row["name"].as_str()).collect();
        assert_eq!(order, vec!["Beta", "Cobalt", "Acme"]);
    }
}
