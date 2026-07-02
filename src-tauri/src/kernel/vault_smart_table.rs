//! Smart-table = the first RecordSource of the Unified Operation Interface
//! (ADR-002 §14 / ADR-003 §6). On disk it is plain markdown — a YAML
//! frontmatter `schema:` block plus a pipe table (vim test passes). Here we
//! parse it into (fields, rows) and expose it through the `QuerySource`
//! contract so Irisy can `describe` + `query` it via the :17873 gate, reusing
//! the shared kernel query engine in `query.rs`.

use crate::kernel::query::{
    run_query, CellType, Describe, FieldSpec, Operator, QueryError, QueryRequest, QueryResult,
    QuerySource, Row, SourceKind,
};
use crate::kernel::smart_table_index::{table_id_for, SmartTableIndex, StIndexError};
use crate::kernel::vault_embeddings::content_hash;
use chrono::NaiveDate;
use serde_json::Value;

pub struct SmartTable {
    pub title: Option<String>,
    pub fields: Vec<FieldSpec>,
    pub rows: Vec<Row>,
    /// Computed relational columns (slice 4): Reference / Lookup / Rollup
    /// metadata parsed from the same `schema:` block. The columns also appear in
    /// `fields` (base type) so they filter/sort; `relations` is the extra info
    /// the index needs to compute them and `describe` advertises to Irisy.
    pub relations: Vec<RelationField>,
}

/// A computed relational column's kind + parameters (ADR-002 §14 v30 / design
/// §D). Reference is a stored, writable cell (link tokens); Lookup / Rollup are
/// pure derivatives (read-only, computed over the index, never written back).
#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RelationKind {
    Reference { target_table: String, display: String },
    Lookup { via: String, target: String },
    Rollup { via: String, target: String, func: String },
    /// A cross-field arithmetic formula (slice 5). `expr` references other
    /// columns by `{field}` or bare name and combines them with + - * / ( ).
    /// Computed per row at query time; read-only, never written to markdown.
    Formula { expr: String },
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
pub struct RelationField {
    pub field_key: String,
    #[serde(flatten)]
    pub kind: RelationKind,
}

impl RelationField {
    /// Read-only derivatives (Lookup / Rollup) can't be written by a produce
    /// verb — only the underlying Reference cell is editable. The gate rejects a
    /// write to one of these (ADR-002 §14: query never mutates, produce gated).
    pub fn is_read_only(&self) -> bool {
        matches!(
            self.kind,
            RelationKind::Lookup { .. } | RelationKind::Rollup { .. } | RelationKind::Formula { .. }
        )
    }
}

impl SmartTable {
    /// Parse from a vault entry's already-parsed frontmatter (`vault::read`
    /// returns frontmatter as JSON) plus the markdown body.
    pub fn parse(frontmatter: &Value, body: &str) -> SmartTable {
        let fields = parse_schema(frontmatter);
        let relations = parse_relations(frontmatter);
        let title = frontmatter
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_string);
        let rows = parse_table(body, &fields);
        SmartTable { title, fields, rows, relations }
    }

    /// Is `field` a read-only computed column (Lookup / Rollup)? The gate uses
    /// this to reject a produce write to a derived field (design §D).
    pub fn is_read_only_field(&self, field: &str) -> bool {
        self.relations
            .iter()
            .any(|r| r.field_key == field && r.is_read_only())
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

    /// Delete a row by index (the §14 produce delete verb — Bitable record delete
    /// parity). Returns false if the index is out of range.
    pub fn delete_row(&mut self, row_index: usize) -> bool {
        if row_index >= self.rows.len() {
            return false;
        }
        self.rows.remove(row_index);
        true
    }

    /// Append many rows in one shot (Bitable batchCreate parity). Returns how many
    /// were appended.
    pub fn append_rows(&mut self, rows: Vec<Row>) -> usize {
        let n = rows.len();
        for values in rows {
            self.append_row(values);
        }
        n
    }

    /// Delete many rows by index in one shot (Bitable batchDelete parity). Removes
    /// in descending order so earlier removals don't shift later indices;
    /// out-of-range + duplicate indices are ignored. Returns how many were deleted.
    pub fn delete_rows(&mut self, indices: &[usize]) -> usize {
        let mut idx: Vec<usize> = indices.iter().copied().filter(|&i| i < self.rows.len()).collect();
        idx.sort_unstable_by(|a, b| b.cmp(a)); // descending
        idx.dedup();
        let n = idx.len();
        for i in idx {
            self.rows.remove(i);
        }
        n
    }

    /// True if a field (column) with this key exists.
    pub fn has_field(&self, key: &str) -> bool {
        self.fields.iter().any(|f| f.key == key)
    }

    /// Add a plain field (column) — Bitable field-create parity. Appends it to the
    /// schema + an empty cell to every row (so `serialize_body` emits the column).
    /// The gate tool also appends the matching item to the frontmatter schema.
    pub fn add_field(&mut self, spec: FieldSpec) {
        let key = spec.key.clone();
        self.fields.push(spec);
        for row in &mut self.rows {
            row.entry(key.clone()).or_default();
        }
    }

    /// Delete a field (column) by key — Bitable field-delete parity. Drops it from
    /// the schema, its relational metadata, and every row. Returns false if there
    /// is no such field.
    pub fn delete_field(&mut self, key: &str) -> bool {
        let before = self.fields.len();
        self.fields.retain(|f| f.key != key);
        if self.fields.len() == before {
            return false;
        }
        for row in &mut self.rows {
            row.remove(key);
        }
        self.relations.retain(|r| r.field_key != key);
        true
    }
}

/// Extract the `key` of a schema item (a JSON object OR an inline flow-mapping
/// string) — lets a gate tool add/remove a field in the frontmatter `schema`
/// array without losing sibling items (incl. relational fields' metadata).
pub fn schema_item_key(item: &Value) -> Option<String> {
    item_fields(item)?.get("key").cloned()
}

/// Build the frontmatter + markdown body for a NEW empty table (Bitable App-create
/// parity). Pure: `title` + fields → (`{title, schema}` frontmatter, a header +
/// separator pipe table with no data rows). The gate tool resolves a free path
/// and writes these. Round-trips through `parse` (0 rows).
pub fn seed_table(title: &str, fields: &[FieldSpec]) -> (Value, String) {
    let schema: Vec<Value> = fields
        .iter()
        .map(|f| {
            let mut item = serde_json::Map::new();
            item.insert("key".into(), Value::String(f.key.clone()));
            item.insert("label".into(), Value::String(f.label.clone()));
            item.insert("type".into(), serde_json::to_value(f.cell_type).unwrap_or(Value::Null));
            if let Some(opts) = &f.options {
                item.insert("options".into(), serde_json::json!(opts));
            }
            Value::Object(item)
        })
        .collect();
    let frontmatter = serde_json::json!({ "title": title, "schema": schema });
    let header = fields.iter().map(|f| f.label.as_str()).collect::<Vec<_>>().join(" | ");
    let sep = fields.iter().map(|_| "---").collect::<Vec<_>>().join("|");
    let body = format!("| {header} |\n|{sep}|\n");
    (frontmatter, body)
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

/// Rows above this size read through the SQLite index; smaller tables stay on
/// the zero-dependency in-memory engine where the index setup cost dominates.
/// Correctness is identical either way (the index path has run_query parity),
/// so this is purely a performance knob (design §C).
pub const INDEX_QUERY_THRESHOLD: usize = 500;

impl SmartTable {
    /// Write-through: rebuild this table's derived SQLite index after a produce
    /// verb wrote markdown. Best-effort — an index error is swallowed because
    /// markdown is the source of truth and reads degrade to `run_query` when the
    /// index is stale or absent. Keyed by content hash (mtime stays 0 on the gate
    /// path; the hash fully captures content, mtime is for the future watch path).
    pub fn reindex_into(&self, index: &SmartTableIndex, path: &str) {
        let hash = content_hash(&self.serialize_body());
        let _ = index.reindex_table(path, self.title.as_deref(), &self.fields, &self.rows, 0, &hash);
    }

    /// Read through the SQLite index when the table is large enough, else the
    /// in-memory engine. The index is a pure accelerator: it is (re)built from
    /// THIS just-parsed table when stale (markdown always wins) and ANY index db
    /// error falls back to `run_query`. The result is identical to `self.query()`
    /// (the parity invariant proven in smart_table_index tests); an unknown-field
    /// rejection surfaces the same `QueryError` either way.
    pub fn query_via_index(
        &self,
        index: Option<&SmartTableIndex>,
        path: &str,
        req: &QueryRequest,
        now: NaiveDate,
    ) -> Result<QueryResult, QueryError> {
        let idx = match index {
            Some(i) if self.rows.len() > INDEX_QUERY_THRESHOLD => i,
            _ => return run_query(&self.fields, &self.rows, req, now),
        };
        let hash = content_hash(&self.serialize_body());
        if !idx.is_fresh(path, 0, &hash).unwrap_or(false)
            && idx
                .reindex_table(path, self.title.as_deref(), &self.fields, &self.rows, 0, &hash)
                .is_err()
        {
            return run_query(&self.fields, &self.rows, req, now);
        }
        match idx.query_indexed(&table_id_for(path), &self.fields, req, now) {
            Ok(r) => Ok(r),
            Err(StIndexError::Query(qe)) => Err(qe),
            Err(_) => run_query(&self.fields, &self.rows, req, now),
        }
    }
}

/// Operators a RecordSource advertises (ADR-002 §14.3 — the record profile).
fn record_operators() -> Vec<Operator> {
    use Operator::*;
    vec![Eq, Neq, Contains, Gt, Lt, Gte, Lte, Before, After, Within, Is, HasTag]
}

/// A formula token: a resolved numeric value, an operator, or a paren. Field
/// references are resolved to `Num` during tokenization.
enum FTok {
    Num(f64),
    Op(char),
    LParen,
    RParen,
}

/// Evaluate a Formula column over a row (slice 5). Supports `{field}` / bare
/// field references (→ the cell's numeric value), numeric literals, and
/// `+ - * / ( )`. Returns None if it can't parse or a referenced cell isn't
/// numeric — a bad formula renders blank, never a wrong number. Deliberately
/// arithmetic-only (no arbitrary eval): mirrors the fixed-operator,
/// anti-hallucination stance of the query engine.
pub fn eval_formula(expr: &str, row: &Row) -> Option<f64> {
    let tokens = tokenize_formula(expr, row)?;
    let mut p = FormulaParser { tokens: &tokens, pos: 0 };
    let v = p.parse_expr()?;
    if p.pos == p.tokens.len() {
        Some(v)
    } else {
        None
    }
}

fn tokenize_formula(expr: &str, row: &Row) -> Option<Vec<FTok>> {
    let chars: Vec<char> = expr.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    let resolve = |name: &str| -> Option<f64> {
        row.get(name.trim())
            .and_then(|v| v.trim().parse::<f64>().ok())
            .filter(|n| n.is_finite())
    };
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c == '(' {
            out.push(FTok::LParen);
            i += 1;
        } else if c == ')' {
            out.push(FTok::RParen);
            i += 1;
        } else if matches!(c, '+' | '-' | '*' | '/') {
            out.push(FTok::Op(c));
            i += 1;
        } else if c == '{' {
            let end = chars[i..].iter().position(|&x| x == '}')? + i;
            let name: String = chars[i + 1..end].iter().collect();
            out.push(FTok::Num(resolve(&name)?));
            i = end + 1;
        } else if c.is_ascii_digit() || c == '.' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            let lit: String = chars[start..i].iter().collect();
            out.push(FTok::Num(lit.parse::<f64>().ok()?));
        } else if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            let name: String = chars[start..i].iter().collect();
            out.push(FTok::Num(resolve(&name)?));
        } else {
            return None; // unknown char → reject (blank, not wrong)
        }
    }
    Some(out)
}

struct FormulaParser<'a> {
    tokens: &'a [FTok],
    pos: usize,
}

impl FormulaParser<'_> {
    // expr = term (('+' | '-') term)*
    fn parse_expr(&mut self) -> Option<f64> {
        let mut v = self.parse_term()?;
        while let Some(FTok::Op(op @ ('+' | '-'))) = self.tokens.get(self.pos) {
            let op = *op;
            self.pos += 1;
            let rhs = self.parse_term()?;
            v = if op == '+' { v + rhs } else { v - rhs };
        }
        Some(v)
    }
    // term = factor (('*' | '/') factor)*
    fn parse_term(&mut self) -> Option<f64> {
        let mut v = self.parse_factor()?;
        while let Some(FTok::Op(op @ ('*' | '/'))) = self.tokens.get(self.pos) {
            let op = *op;
            self.pos += 1;
            let rhs = self.parse_factor()?;
            if op == '*' {
                v *= rhs;
            } else {
                if rhs == 0.0 {
                    return None; // division by zero → blank
                }
                v /= rhs;
            }
        }
        Some(v)
    }
    // factor = Num | '(' expr ')' | '-' factor
    fn parse_factor(&mut self) -> Option<f64> {
        match self.tokens.get(self.pos) {
            Some(FTok::Num(n)) => {
                self.pos += 1;
                Some(*n)
            }
            Some(FTok::LParen) => {
                self.pos += 1;
                let v = self.parse_expr()?;
                matches!(self.tokens.get(self.pos), Some(FTok::RParen)).then(|| {
                    self.pos += 1;
                    v
                })
            }
            Some(FTok::Op('-')) => {
                self.pos += 1;
                Some(-self.parse_factor()?)
            }
            _ => None,
        }
    }
}

/// Extract the `schema:` block into typed `FieldSpec`s. Each item may arrive
/// EITHER as a JSON object (structured frontmatter) OR as a string of YAML flow
/// form `{ key: x, label: y, type: z, options: [..] }` — which is what
/// `vault::read`'s lightweight YAML parser actually yields for a block sequence
/// of inline mappings (it parses each `- {...}` item as a scalar string). Both
/// are handled so the gate tools work on real on-disk tables, not just
/// hand-built JSON.
fn parse_schema(frontmatter: &Value) -> Vec<FieldSpec> {
    let Some(arr) = frontmatter.get("schema").and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| match item {
            Value::Object(_) => parse_object_field(item),
            Value::String(s) => parse_inline_field(s),
            _ => None,
        })
        .collect()
}

/// Extract computed relational columns (Reference / Lookup / Rollup) from the
/// same `schema:` block. Reads both structured-object and inline-flow-string
/// items. The canonical frontmatter shape (design §D):
///   - { key: contact,  type: reference, table: contacts.md, display: name }
///   - { key: c_email,  type: lookup,    via: contact, target: email }
///   - { key: c_total,  type: rollup,    via: contact, target: spend, fn: sum }
fn parse_relations(frontmatter: &Value) -> Vec<RelationField> {
    let Some(arr) = frontmatter.get("schema").and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let m = item_fields(item)?;
            let key = m.get("key")?.clone();
            let get = |k: &str| m.get(k).cloned().unwrap_or_default();
            let kind = match m.get("type").map(String::as_str) {
                Some("reference") => RelationKind::Reference {
                    target_table: get("table"),
                    display: {
                        let d = get("display");
                        if d.is_empty() { "name".to_string() } else { d }
                    },
                },
                Some("lookup") => RelationKind::Lookup { via: get("via"), target: get("target") },
                Some("rollup") => RelationKind::Rollup {
                    via: get("via"),
                    target: get("target"),
                    func: {
                        let f = get("fn");
                        if f.is_empty() { "count".to_string() } else { f }
                    },
                },
                Some("formula") => RelationKind::Formula { expr: get("expr") },
                _ => return None,
            };
            Some(RelationField { field_key: key, kind })
        })
        .collect()
}

/// Read a schema item's string-valued keys into a map, handling both the
/// structured-object and inline-flow-string forms (mirrors `parse_schema`'s
/// dual-form handling). Array values (e.g. `options`) are skipped.
fn item_fields(item: &Value) -> Option<std::collections::HashMap<String, String>> {
    match item {
        Value::Object(o) => Some(
            o.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                .collect(),
        ),
        Value::String(s) => {
            let inner = s.trim().strip_prefix('{')?.strip_suffix('}')?;
            let mut m = std::collections::HashMap::new();
            for pair in split_top_level(inner, ',') {
                let Some(colon) = pair.find(':') else { continue };
                let k = unquote(pair[..colon].trim()).to_string();
                let v = pair[colon + 1..].trim();
                // Skip list values; relations only use scalar params.
                if v.starts_with('[') {
                    continue;
                }
                m.insert(k, unquote(v).to_string());
            }
            Some(m)
        }
        _ => None,
    }
}

/// Field from a structured JSON object.
fn parse_object_field(item: &Value) -> Option<FieldSpec> {
    let key = item.get("key").and_then(Value::as_str)?.to_string();
    let label = item.get("label").and_then(Value::as_str).unwrap_or(&key).to_string();
    let cell_type = CellType::parse(item.get("type").and_then(Value::as_str).unwrap_or("text"));
    let options = item.get("options").and_then(Value::as_array).map(|a| {
        a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()
    });
    Some(FieldSpec { key, label, cell_type, options })
}

/// Field from a YAML flow-mapping string `{ key: x, label: y, type: z, options: [a, b] }`.
fn parse_inline_field(s: &str) -> Option<FieldSpec> {
    let inner = s.trim().strip_prefix('{')?.strip_suffix('}')?;
    let mut key: Option<String> = None;
    let mut label: Option<String> = None;
    let mut cell_type = CellType::Text;
    let mut options: Option<Vec<String>> = None;
    for pair in split_top_level(inner, ',') {
        let Some(colon) = pair.find(':') else { continue };
        // Keys may be bare (`key:` from hand-written YAML flow) or quoted
        // (`"key":` from the emitter's JSON Display of an object) — unquote both.
        let k = unquote(pair[..colon].trim());
        let v = pair[colon + 1..].trim();
        match k {
            "key" => key = Some(unquote(v).to_string()),
            "label" => label = Some(unquote(v).to_string()),
            "type" => cell_type = CellType::parse(unquote(v)),
            "options" => {
                if let Some(list) = v.trim().strip_prefix('[').and_then(|r| r.strip_suffix(']')) {
                    options = Some(
                        split_top_level(list, ',')
                            .iter()
                            .map(|o| unquote(o.trim()).to_string())
                            .filter(|o| !o.is_empty())
                            .collect(),
                    );
                }
            }
            _ => {}
        }
    }
    let key = key?;
    let label = label.unwrap_or_else(|| key.clone());
    Some(FieldSpec { key, label, cell_type, options })
}

fn unquote(s: &str) -> &str {
    let s = s.trim();
    s.strip_prefix('"')
        .and_then(|r| r.strip_suffix('"'))
        .or_else(|| s.strip_prefix('\'').and_then(|r| r.strip_suffix('\'')))
        .unwrap_or(s)
}

/// Split at top-level separators only — ignores separators inside `[]`, `{}`,
/// or quotes (so `options: [a, b]` is not split on its inner comma).
fn split_top_level(s: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut in_quote: Option<char> = None;
    let mut buf = String::new();
    for ch in s.chars() {
        match in_quote {
            Some(q) => {
                buf.push(ch);
                if ch == q {
                    in_quote = None;
                }
            }
            None => match ch {
                '"' | '\'' => {
                    in_quote = Some(ch);
                    buf.push(ch);
                }
                '[' | '{' => {
                    depth += 1;
                    buf.push(ch);
                }
                ']' | '}' => {
                    depth -= 1;
                    buf.push(ch);
                }
                c if c == sep && depth == 0 => {
                    if !buf.trim().is_empty() {
                        out.push(buf.trim().to_string());
                    }
                    buf.clear();
                }
                c => buf.push(c),
            },
        }
    }
    if !buf.trim().is_empty() {
        out.push(buf.trim().to_string());
    }
    out
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
    // Split on UNescaped `|` only, then unescape `\|` back to `|`.
    // Mirrors `serialize_body`, which escapes `|` -> `\|` (a naive
    // `split('|')` here corrupts any cell containing a pipe).
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut chars = t.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                cur.push('|');
                chars.next();
            }
            '|' => {
                cells.push(cur.trim().to_string());
                cur.clear();
            }
            other => cur.push(other),
        }
    }
    cells.push(cur.trim().to_string());
    cells
}

/// The ONE authoritative §14 smart-table query path: read the markdown, parse
/// the table, run the index-backed query (which guarantees byte-parity with the
/// in-memory engine and falls back for small tables / no index). Both the MCP
/// tool and the Tauri command call this, so the two transport surfaces can no
/// longer drift — they HAD diverged (the MCP path used `query_via_index`, the
/// Tauri/PWA path used the plain in-memory `query`, so the frontend silently
/// missed the SQLite index acceleration). SC5 dual-surface collapse onto one
/// impl (ADR-010 § endpoint-spec v6).
///
/// Returns the parsed table alongside the result so a caller that also wants
/// query-time relational columns (Lookup/Rollup) can augment afterwards — that
/// augmentation is deliberately a caller-side post-step, not part of this core,
/// because the PWA computes relations client-side today.
pub fn query_smart_table(
    index: Option<&SmartTableIndex>,
    root: &std::path::Path,
    path: &str,
    req: &QueryRequest,
    now: NaiveDate,
) -> Result<(SmartTable, QueryResult), String> {
    let entry = crate::kernel::vault::read(root, path).map_err(|e| e.to_string())?;
    let table = SmartTable::parse(&entry.frontmatter, &entry.content);
    let result = table
        .query_via_index(index, path, req, now)
        .map_err(|e| e.to_string())?;
    Ok((table, result))
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
    fn parses_relations_and_marks_computed_read_only() {
        let fm = serde_json::json!({
            "schema": [
                { "key": "title", "label": "Title", "type": "text" },
                { "key": "contact", "label": "Contact", "type": "reference", "table": "contacts.md", "display": "name" },
                { "key": "c_email", "label": "Email", "type": "lookup", "via": "contact", "target": "email" },
                { "key": "c_total", "label": "Total", "type": "rollup", "via": "contact", "target": "spend", "fn": "sum" }
            ]
        });
        let t = SmartTable::parse(&fm, "");
        assert_eq!(t.relations.len(), 3);
        // Reference is a stored, writable cell; Lookup / Rollup are read-only.
        assert!(!t.is_read_only_field("contact"));
        assert!(t.is_read_only_field("c_email"));
        assert!(t.is_read_only_field("c_total"));
        assert!(!t.is_read_only_field("title"));
        // The rollup carries its aggregate fn.
        let rollup = t.relations.iter().find(|r| r.field_key == "c_total").unwrap();
        assert_eq!(
            rollup.kind,
            RelationKind::Rollup { via: "contact".into(), target: "spend".into(), func: "sum".into() }
        );
        // Computed columns still appear as fields (so they filter/sort) — 4 cols.
        assert_eq!(t.fields.len(), 4);
    }

    #[test]
    fn parses_relations_from_inline_flow_strings() {
        // vault::read's lightweight YAML yields inline-mapping strings.
        let fm = serde_json::json!({
            "schema": [
                "{ key: contact, label: Contact, type: reference, table: contacts.md, display: name }",
                "{ key: c_email, label: Email, type: lookup, via: contact, target: email }"
            ]
        });
        let t = SmartTable::parse(&fm, "");
        assert_eq!(t.relations.len(), 2);
        assert!(t.is_read_only_field("c_email"));
        match &t.relations[0].kind {
            RelationKind::Reference { target_table, display } => {
                assert_eq!(target_table, "contacts.md");
                assert_eq!(display, "name");
            }
            other => panic!("expected reference, got {other:?}"),
        }
    }

    #[test]
    fn eval_formula_arithmetic_and_field_refs() {
        let r = row(&[("amount", "100"), ("cost", "30"), ("qty", "4")]);
        // bare refs + braces + precedence + parens.
        assert_eq!(eval_formula("amount - cost", &r), Some(70.0));
        assert_eq!(eval_formula("{amount} - {cost}", &r), Some(70.0));
        assert_eq!(eval_formula("amount - cost * 2", &r), Some(40.0)); // precedence
        assert_eq!(eval_formula("(amount - cost) * 2", &r), Some(140.0));
        assert_eq!(eval_formula("amount / qty", &r), Some(25.0));
        assert_eq!(eval_formula("-cost + amount", &r), Some(70.0)); // unary minus
        // bad inputs render blank (None), never a wrong number.
        assert_eq!(eval_formula("amount / 0", &r), None); // div by zero
        assert_eq!(eval_formula("amount + missing", &r), None); // unknown field
        assert_eq!(eval_formula("amount +", &r), None); // trailing op
    }

    fn row(pairs: &[(&str, &str)]) -> Row {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
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

    // --- Slice 3: index-or-memory selection (write-through + read path) ---

    use crate::kernel::smart_table_index::SmartTableIndex;

    fn temp_index(label: &str) -> (std::path::PathBuf, SmartTableIndex) {
        let mut p = std::env::temp_dir();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.subsec_nanos())
            .unwrap_or(0);
        p.push(format!("ctrl-st-vt-{label}-{}-{nanos}.db", std::process::id()));
        let idx = SmartTableIndex::open(&p).expect("open index");
        (p, idx)
    }

    /// A table with `n` rows so it crosses INDEX_QUERY_THRESHOLD.
    fn big_table(n: usize) -> SmartTable {
        let fields = vec![
            FieldSpec { key: "name".into(), label: "Name".into(), cell_type: CellType::Text, options: None },
            FieldSpec { key: "amount".into(), label: "Amount".into(), cell_type: CellType::Number, options: None },
        ];
        let rows = (0..n)
            .map(|i| {
                [("name".to_string(), format!("r{i}")), ("amount".to_string(), (i % 200).to_string())]
                    .into_iter()
                    .collect::<Row>()
            })
            .collect();
        SmartTable { title: Some("Big".into()), fields, rows, relations: Vec::new() }
    }

    #[test]
    fn query_via_index_matches_memory_above_threshold() {
        let (path, idx) = temp_index("parity");
        let t = big_table(INDEX_QUERY_THRESHOLD + 50); // crosses the threshold
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let req = QueryRequest {
            filters: vec![Filter { field: "amount".into(), op: Operator::Gte, value: "150".into() }],
            sort: vec![crate::kernel::query::SortKey { field: "amount".into(), desc: true }],
            limit: Some(10),
            ..Default::default()
        };
        let mem = t.query(&req, now).unwrap();
        let via = t.query_via_index(Some(&idx), "tables/big.md", &req, now).unwrap();
        assert_eq!(via.match_count, mem.match_count);
        assert_eq!(via.rows, mem.rows);
        // The index was built by the read (stale → reindex), so it now exists.
        assert_eq!(idx.table_count().unwrap(), 1);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn small_table_and_no_index_use_memory() {
        let (path, idx) = temp_index("small");
        let t = SmartTable::parse(&frontmatter(), BODY); // 2 rows, below threshold
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let req = QueryRequest {
            filters: vec![Filter { field: "amount".into(), op: Operator::Gt, value: "60".into() }],
            ..Default::default()
        };
        // Below threshold: index untouched, memory result correct.
        let via = t.query_via_index(Some(&idx), "tables/leads.md", &req, now).unwrap();
        assert_eq!(via.rows[0]["name"], "Acme");
        assert_eq!(idx.table_count().unwrap(), 0);
        // No index at all → memory.
        let none = t.query_via_index(None, "tables/leads.md", &req, now).unwrap();
        assert_eq!(none.rows[0]["name"], "Acme");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn query_smart_table_core_matches_in_memory() {
        // The shared §14 core (called by BOTH the MCP tool and the Tauri
        // command after the SC5 dual-surface collapse) must return exactly what
        // the in-memory engine returns — proving the collapse removed the drift
        // without changing behavior.
        let dir = tempfile::TempDir::new().unwrap();
        let root = dir.path();
        crate::kernel::vault::write(root, "leads.md", BODY, &frontmatter()).unwrap();
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let req = QueryRequest {
            filters: vec![Filter { field: "amount".into(), op: Operator::Gt, value: "60".into() }],
            ..Default::default()
        };
        let (table, via_core) = query_smart_table(None, root, "leads.md", &req, now).unwrap();
        let mem = table.query(&req, now).unwrap();
        assert_eq!(via_core.rows, mem.rows);
        assert_eq!(via_core.match_count, mem.match_count);
        assert_eq!(via_core.rows[0]["name"], "Acme");
    }

    #[test]
    fn reindex_into_then_fresh_skips_rebuild() {
        let (path, idx) = temp_index("write-through");
        let t = big_table(INDEX_QUERY_THRESHOLD + 1);
        // Write-through after a produce verb.
        t.reindex_into(&idx, "tables/big.md");
        assert_eq!(idx.table_count().unwrap(), 1);
        // A subsequent read finds it fresh (same content hash) and still matches.
        let now = NaiveDate::from_ymd_opt(2026, 6, 19).unwrap();
        let req = QueryRequest::default();
        let via = t.query_via_index(Some(&idx), "tables/big.md", &req, now).unwrap();
        assert_eq!(via.match_count, t.rows.len());
        let _ = std::fs::remove_file(&path);
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
    fn cell_with_pipe_round_trips_without_corruption() {
        let mut t = SmartTable::parse(&frontmatter(), BODY);
        // A cell containing `|` (URL / formula / markdown) must survive a
        // serialize -> parse cycle intact (regression: split_row used to
        // naively split on `|`, corrupting the row).
        assert!(t.update_cell(0, "name", "a|b|c"));
        assert!(t.update_cell(0, "tags", "x | y"));
        let reparsed = SmartTable::parse(&frontmatter(), &t.serialize_body());
        assert_eq!(reparsed.rows.len(), 2);
        assert_eq!(reparsed.rows[0]["name"], "a|b|c");
        assert_eq!(reparsed.rows[0]["tags"], "x | y");
        assert_eq!(reparsed.rows[0]["amount"], "100");
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

    #[test]
    fn delete_row_in_range_and_out_of_range() {
        let mut t = SmartTable::parse(&frontmatter(), BODY);
        let before = t.rows.len();
        assert!(before >= 2);
        let second = t.rows[1].clone();
        // Deleting row 0 removes it; the old row 1 shifts into slot 0.
        assert!(t.delete_row(0));
        assert_eq!(t.rows.len(), before - 1);
        assert_eq!(t.rows[0], second);
        assert!(!t.delete_row(99)); // out of range → false, no change
        assert_eq!(t.rows.len(), before - 1);
        // Round-trips: re-parse the serialized body yields the same rows.
        let back = SmartTable::parse(&frontmatter(), &t.serialize_body());
        assert_eq!(back.rows.len(), before - 1);
    }

    #[test]
    fn batch_append_and_delete_rows() {
        let mut t = SmartTable::parse(&frontmatter(), BODY);
        let base = t.rows.len();
        // Append 3 more rows in one shot.
        let added = t.append_rows(vec![
            row(&[("name", "R1"), ("amount", "1")]),
            row(&[("name", "R2"), ("amount", "2")]),
            row(&[("name", "R3"), ("amount", "3")]),
        ]);
        assert_eq!(added, 3);
        assert_eq!(t.rows.len(), base + 3);
        let names_before: Vec<String> = t.rows.iter().map(|r| r["name"].clone()).collect();
        // Delete indices 0 and (base+2) — out-of-desc-order + one at the end;
        // descending removal must not shift the wrong rows.
        let last = t.rows.len() - 1;
        let deleted = t.delete_rows(&[last, 0, last, 999]); // dup + out-of-range ignored
        assert_eq!(deleted, 2); // last + 0 (999 out of range, dup last collapsed)
        assert_eq!(t.rows.len(), base + 3 - 2);
        // The surviving middle rows kept their identity (row 0 and last gone).
        assert_eq!(t.rows.first().unwrap()["name"], names_before[1]);
        assert_eq!(t.rows.last().unwrap()["name"], names_before[names_before.len() - 2]);
    }

    #[test]
    fn add_field_appends_column_and_empty_cells() {
        let mut t = SmartTable::parse(&frontmatter(), BODY);
        let rows_before = t.rows.len();
        assert!(!t.has_field("stage"));
        t.add_field(FieldSpec {
            key: "stage".into(),
            label: "Stage".into(),
            cell_type: CellType::Select,
            options: Some(vec!["lead".into(), "won".into()]),
        });
        assert!(t.has_field("stage"));
        // Every existing row got an empty cell for the new column.
        assert_eq!(t.rows.len(), rows_before);
        assert!(t.rows.iter().all(|r| r.get("stage").map(String::as_str) == Some("")));
        // serialize_body now emits the new column (last, schema order).
        assert!(t.fields.last().unwrap().key == "stage");
    }

    #[test]
    fn delete_field_drops_column_and_preserves_unrelated_relations() {
        // A table with a plain field + a relational (reference) field.
        let fm = serde_json::json!({
            "schema": [
                { "key": "name", "label": "Name", "type": "text" },
                "{ key: contact, label: Contact, type: reference, table: contacts.md, display: name }"
            ]
        });
        let mut t = SmartTable::parse(&fm, "| name | contact |\n|---|---|\n| Acme | [[contacts/acme]] |\n");
        assert!(t.has_field("name") && t.has_field("contact"));
        assert_eq!(t.relations.len(), 1);
        // Delete the PLAIN field — the relational field + its metadata survive.
        assert!(t.delete_field("name"));
        assert!(!t.has_field("name"));
        assert!(t.rows.iter().all(|r| !r.contains_key("name")));
        assert!(t.has_field("contact"));
        assert_eq!(t.relations.len(), 1, "unrelated relation preserved");
        // Deleting a relational field also drops its relation metadata.
        assert!(t.delete_field("contact"));
        assert_eq!(t.relations.len(), 0);
        assert!(!t.delete_field("nope")); // no such field → false
    }

    #[test]
    fn seed_table_round_trips_to_empty_table_with_schema() {
        let fields = vec![
            FieldSpec { key: "name".into(), label: "Name".into(), cell_type: CellType::Text, options: None },
            FieldSpec { key: "amount".into(), label: "Amount".into(), cell_type: CellType::Number, options: None },
        ];
        let (fm, body) = seed_table("My CRM", &fields);
        assert_eq!(fm["title"], "My CRM");
        assert_eq!(fm["schema"].as_array().unwrap().len(), 2);
        assert_eq!(fm["schema"][1]["type"], "number");
        // Parse the seed back: same fields, zero data rows.
        let t = SmartTable::parse(&fm, &body);
        assert_eq!(t.fields.len(), 2);
        assert!(t.has_field("name") && t.has_field("amount"));
        assert_eq!(t.rows.len(), 0);
    }

    #[test]
    fn schema_item_key_reads_object_and_flow_string() {
        let obj = serde_json::json!({ "key": "amount", "label": "Amount", "type": "number" });
        assert_eq!(schema_item_key(&obj).as_deref(), Some("amount"));
        let flow = serde_json::json!("{ key: contact, type: reference, table: c.md }");
        assert_eq!(schema_item_key(&flow).as_deref(), Some("contact"));
        assert_eq!(schema_item_key(&serde_json::json!(42)), None);
    }

    #[test]
    fn parses_schema_from_inline_flow_strings() {
        // This is what vault::read's YAML parser actually yields: each schema
        // item is a flow-mapping STRING, not a JSON object. Was silently
        // dropped before the dual-form fix → empty schema → broken tools.
        let fm = serde_json::json!({
            "schema": [
                "{ key: name, label: Name, type: text }",
                "{ key: amount, label: Amount, type: number }",
                "{ key: stage, label: Stage, type: select, options: [new, won, lost] }"
            ]
        });
        let t = SmartTable::parse(&fm, BODY);
        assert_eq!(t.fields.len(), 3);
        assert_eq!(t.fields[0].key, "name");
        assert_eq!(t.fields[1].cell_type, CellType::Number);
        assert_eq!(
            t.fields[2].options.as_deref(),
            Some(["new".to_string(), "won".to_string(), "lost".to_string()].as_slice())
        );
    }

    #[test]
    fn full_vault_write_read_round_trip_preserves_schema_and_edits() {
        use crate::kernel::vault;
        let dir = std::env::temp_dir().join(format!("ctrl-st-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let rel = "leads.md";

        // Seed a real on-disk smart-table via vault::write (object frontmatter).
        vault::write(&dir, rel, BODY, &frontmatter()).unwrap();

        // Read it back the way the gate tools do, edit a cell, write, re-read.
        let entry = vault::read(&dir, rel).unwrap();
        let mut t = SmartTable::parse(&entry.frontmatter, &entry.content);
        assert_eq!(t.fields.len(), 3, "schema survives the YAML round-trip");
        assert!(t.update_cell(0, "amount", "777"));
        vault::write(&dir, rel, &t.serialize_body(), &entry.frontmatter).unwrap();

        let entry2 = vault::read(&dir, rel).unwrap();
        let t2 = SmartTable::parse(&entry2.frontmatter, &entry2.content);
        assert_eq!(t2.fields.len(), 3, "schema still intact after a produce write");
        assert_eq!(t2.rows[0]["amount"], "777");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
