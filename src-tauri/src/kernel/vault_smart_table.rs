//! Smart-table = the first RecordSource of the Unified Operation Interface
//! (ADR-002 §14 / ADR-003 §6). On disk it is plain markdown — a YAML
//! frontmatter `schema:` block plus a pipe table (vim test passes). Here we
//! parse it into (fields, rows) and expose it through the `QuerySource`
//! contract so Irisy can `describe` + `query` it via the :17873 gate, reusing
//! the shared kernel query engine in `query.rs`.

use crate::kernel::query::{CellType, Describe, FieldSpec, Operator, QuerySource, Row, SourceKind};
use serde_json::Value;

pub struct SmartTable {
    pub title: Option<String>,
    pub fields: Vec<FieldSpec>,
    pub rows: Vec<Row>,
}

impl SmartTable {
    /// Parse from a vault entry's already-parsed frontmatter (`vault::read`
    /// returns frontmatter as JSON) plus the markdown body.
    pub fn parse(frontmatter: &Value, body: &str) -> SmartTable {
        let fields = parse_schema(frontmatter);
        let title = frontmatter
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string);
        let rows = parse_table(body, &fields);
        SmartTable { title, fields, rows }
    }

    /// Serialize back to a markdown pipe-table body (header + separator + rows,
    /// columns in schema order). Frontmatter is written separately by
    /// `vault::write`, which preserves the schema block. Round-trips the table
    /// structure (ADR-003 §6.1). `|` in cells is escaped.
    pub fn serialize_body(&self) -> String {
        if self.fields.is_empty() {
            return String::new();
        }
        let mut out = String::new();
        let header = self
            .fields
            .iter()
            .map(|f| f.label.as_str())
            .collect::<Vec<_>>()
            .join(" | ");
        out.push_str(&format!("| {header} |\n"));
        let sep = self.fields.iter().map(|_| "---").collect::<Vec<_>>().join("|");
        out.push_str(&format!("|{sep}|\n"));
        for row in &self.rows {
            let cells = self
                .fields
                .iter()
                .map(|f| row.get(&f.key).cloned().unwrap_or_default().replace('|', "\\|"))
                .collect::<Vec<_>>()
                .join(" | ");
            out.push_str(&format!("| {cells} |\n"));
        }
        out
    }

    /// Append a row (cells keyed by schema key; missing keys become empty).
    pub fn append_row(&mut self, values: Row) {
        let mut row = Row::new();
        for f in &self.fields {
            row.insert(f.key.clone(), values.get(&f.key).cloned().unwrap_or_default());
        }
        self.rows.push(row);
    }

    /// Set a single cell by row index + field key. Returns false if the index
    /// or field is out of range (the caller surfaces a structured error).
    pub fn update_cell(&mut self, row_index: usize, field: &str, value: &str) -> bool {
        if !self.fields.iter().any(|f| f.key == field) {
            return false;
        }
        match self.rows.get_mut(row_index) {
            Some(row) => {
                row.insert(field.to_string(), value.to_string());
                true
            }
            None => false,
        }
    }
}

impl QuerySource for SmartTable {
    fn describe(&self) -> Describe {
        Describe {
            source_kind: SourceKind::Record,
            fields: self.fields.clone(),
            operators: record_operators(),
        }
    }

    fn rows(&self) -> &[Row] {
        &self.rows
    }
}

/// Operators a RecordSource advertises (ADR-002 §14.3 — the record profile).
fn record_operators() -> Vec<Operator> {
    use Operator::*;
    vec![Eq, Neq, Contains, Gt, Lt, Gte, Lte, Before, After, Within, Is, HasTag]
}

/// Extract the `schema:` block (a list of `{key,label,type,options}` objects)
/// from the parsed frontmatter into typed `FieldSpec`s.
fn parse_schema(frontmatter: &Value) -> Vec<FieldSpec> {
    let Some(arr) = frontmatter.get("schema").and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let key = item.get("key").and_then(Value::as_str)?.to_string();
            let label = item
                .get("label")
                .and_then(Value::as_str)
                .unwrap_or(&key)
                .to_string();
            let cell_type = CellType::parse(
                item.get("type").and_then(Value::as_str).unwrap_or("text"),
            );
            let options = item.get("options").and_then(Value::as_array).map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            });
            Some(FieldSpec { key, label, cell_type, options })
        })
        .collect()
}

/// Parse the first markdown pipe table in `body` into rows keyed by schema key.
/// Columns are matched to fields by header label first, then by key.
fn parse_table(body: &str, fields: &[FieldSpec]) -> Vec<Row> {
    if fields.is_empty() {
        return Vec::new();
    }
    let lines: Vec<&str> = body.lines().collect();
    let Some(header_idx) = lines.iter().position(|l| l.trim_start().starts_with('|')) else {
        return Vec::new();
    };
    let header = split_row(lines[header_idx]);
    let idx_to_key: Vec<Option<String>> = header
        .iter()
        .map(|h| {
            fields
                .iter()
                .find(|f| f.label == *h)
                .or_else(|| fields.iter().find(|f| f.key == *h))
                .map(|f| f.key.clone())
        })
        .collect();

    let mut rows = Vec::new();
    // Skip header + separator row.
    for line in lines.iter().skip(header_idx + 2) {
        if !line.trim_start().starts_with('|') {
            break;
        }
        let cells = split_row(line);
        let mut row = Row::new();
        for (ci, cell) in cells.iter().enumerate() {
            if let Some(Some(key)) = idx_to_key.get(ci) {
                row.insert(key.clone(), cell.clone());
            }
        }
        rows.push(row);
    }
    rows
}

fn split_row(line: &str) -> Vec<String> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let t = t.strip_suffix('|').unwrap_or(t);
    t.split('|').map(|c| c.trim().to_string()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{Filter, Operator, QueryRequest};
    use chrono::NaiveDate;

    const BODY: &str = "\n| Name | Amount | Tags |\n|---|---|---|\n| Acme | 100 | crm, vip |\n| Beta | 50 | crm |\n";

    fn frontmatter() -> Value {
        serde_json::json!({
            "title": "Leads",
            "schema": [
                { "key": "name", "label": "Name", "type": "text" },
                { "key": "amount", "label": "Amount", "type": "number" },
                { "key": "tags", "label": "Tags", "type": "tags" }
            ]
        })
    }

    #[test]
    fn parses_schema_and_rows() {
        let t = SmartTable::parse(&frontmatter(), BODY);
        assert_eq!(t.title.as_deref(), Some("Leads"));
        assert_eq!(t.fields.len(), 3);
        assert_eq!(t.fields[1].cell_type, CellType::Number);
        assert_eq!(t.rows.len(), 2);
        assert_eq!(t.rows[0]["name"], "Acme");
        assert_eq!(t.rows[0]["amount"], "100");
    }

    #[test]
    fn describe_advertises_record_kind_and_operators() {
        let t = SmartTable::parse(&frontmatter(), BODY);
        let d = t.describe();
        assert_eq!(d.source_kind, SourceKind::Record);
        assert_eq!(d.fields.len(), 3);
        assert!(d.operators.contains(&Operator::Contains));
    }

    #[test]
    fn query_through_the_shared_engine() {
        let t = SmartTable::parse(&frontmatter(), BODY);
        let req = QueryRequest {
            filters: vec![Filter { field: "amount".into(), op: Operator::Gt, value: "60".into() }],
            ..Default::default()
        };
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let out = t.query(&req, now).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["name"], "Acme");
    }

    #[test]
    fn empty_schema_yields_no_rows() {
        let t = SmartTable::parse(&serde_json::json!({}), BODY);
        assert!(t.fields.is_empty());
        assert!(t.rows.is_empty());
    }

    #[test]
    fn serialize_round_trips_through_parse() {
        let t = SmartTable::parse(&frontmatter(), BODY);
        let body = t.serialize_body();
        let t2 = SmartTable::parse(&frontmatter(), &body);
        assert_eq!(t2.rows.len(), 2);
        assert_eq!(t2.rows[0]["name"], "Acme");
        assert_eq!(t2.rows[1]["amount"], "50");
    }

    #[test]
    fn append_row_then_serialize() {
        let mut t = SmartTable::parse(&frontmatter(), BODY);
        let mut new = Row::new();
        new.insert("name".into(), "Delta".into());
        new.insert("amount".into(), "999".into());
        t.append_row(new);
        assert_eq!(t.rows.len(), 3);
        let reparsed = SmartTable::parse(&frontmatter(), &t.serialize_body());
        assert_eq!(reparsed.rows[2]["name"], "Delta");
        assert_eq!(reparsed.rows[2]["amount"], "999");
    }

    #[test]
    fn update_cell_in_range_and_out_of_range() {
        let mut t = SmartTable::parse(&frontmatter(), BODY);
        assert!(t.update_cell(0, "amount", "111"));
        assert_eq!(t.rows[0]["amount"], "111");
        assert!(!t.update_cell(99, "amount", "1")); // bad index
        assert!(!t.update_cell(0, "nope", "1")); // bad field
    }
}
