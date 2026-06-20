//! Runtime registries as RecordSources of the Unified Operation Interface
//! (ADR-002 §14): the installed-MCP registry and the provider catalogue. They
//! are queried through the SAME shared kernel engine + describe/query verbs
//! Irisy uses for smart-tables and the KB — proving the contract generalizes
//! past vault files to live runtime state. Rows are built in the gate tools
//! (the data is fetched from the running kernel); this module owns the schemas.

use crate::kernel::query::{CellType, FieldSpec, Operator};

/// Schema for the installed-MCP registry RecordSource.
pub fn mcp_fields() -> Vec<FieldSpec> {
    vec![
        field("id", "Id", CellType::Text),
        field("name", "Name", CellType::Text),
        field("version", "Version", CellType::Text),
        field("description", "Description", CellType::Text),
        field("tools", "Tools", CellType::Number),
    ]
}

/// Schema for the provider-catalogue RecordSource.
pub fn provider_fields() -> Vec<FieldSpec> {
    vec![
        field("id", "Id", CellType::Text),
        field("label", "Label", CellType::Text),
        field("kind", "Kind", CellType::Text),
        field("models", "Models", CellType::Number),
        field("ready", "Ready", CellType::Checkbox),
        field("capabilities", "Capabilities", CellType::Tags),
    ]
}

pub fn record_operators() -> Vec<Operator> {
    use Operator::*;
    vec![Eq, Neq, Contains, Gt, Lt, Gte, Lte, HasTag, Is]
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
    use crate::kernel::query::{run_query, Filter, Operator, QueryRequest, Row};
    use chrono::NaiveDate;

    fn now() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 6, 19).unwrap()
    }

    fn mcp_rows() -> Vec<Row> {
        let mk = |id: &str, name: &str, tools: &str| {
            let mut r = Row::new();
            r.insert("id".into(), id.into());
            r.insert("name".into(), name.into());
            r.insert("tools".into(), tools.into());
            r
        };
        vec![mk("obsidian", "Obsidian", "16"), mk("clip", "Clipboard", "0")]
    }

    #[test]
    fn query_mcps_with_tools_reuses_shared_engine() {
        let req = QueryRequest {
            filters: vec![Filter { field: "tools".into(), op: Operator::Gt, value: "0".into() }],
            ..Default::default()
        };
        let out = run_query(&mcp_fields(), &mcp_rows(), &req, now()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["id"], "obsidian");
    }

    fn provider_rows() -> Vec<Row> {
        let mk = |id: &str, ready: &str, caps: &str| {
            let mut r = Row::new();
            r.insert("id".into(), id.into());
            r.insert("ready".into(), ready.into());
            r.insert("capabilities".into(), caps.into());
            r
        };
        vec![mk("volc", "x", "text.chat, embed"), mk("anthropic", "", "text.chat")]
    }

    #[test]
    fn query_ready_providers_and_capability() {
        let req = QueryRequest {
            filters: vec![
                Filter { field: "ready".into(), op: Operator::Is, value: "true".into() },
                Filter { field: "capabilities".into(), op: Operator::HasTag, value: "embed".into() },
            ],
            ..Default::default()
        };
        let out = run_query(&provider_fields(), &provider_rows(), &req, now()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["id"], "volc");
    }
}
