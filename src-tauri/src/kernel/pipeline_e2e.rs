//! Real end-to-end pipeline tests for the smart-table module (ADR-002 §14).
//!
//! Every function runs through the REAL pipeline — a real `.md` file on disk →
//! `vault::read` → `SmartTable::parse` → describe / query / produce → `vault::write`
//! → re-read — and asserts the ACTUAL output at each stage. No mocks, no in-memory
//! shortcuts: this is the same code path the `:17873` gate handlers execute.
//!
//! See the human-readable pipeline report (actual outputs printed) with:
//!   cargo test -p ctrl --lib kernel::pipeline_e2e -- --nocapture --test-threads=1

use super::query::{Conjunction, Filter, Operator, QueryRequest, QuerySource, SortKey};
use super::vault;
use super::vault_smart_table::SmartTable;
use chrono::NaiveDate;
use serde_json::json;
use std::path::Path;
use tempfile::TempDir;

fn now() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 6, 19).unwrap()
}

/// Write a realistic CRM smart table to a fresh temp vault; return (dir, path).
fn seed() -> (TempDir, String) {
    let dir = TempDir::new().unwrap();
    let frontmatter = json!({
        "title": "CRM",
        "schema": [
            { "key": "name",   "label": "Name",   "type": "text" },
            { "key": "amount", "label": "Amount", "type": "number" },
            { "key": "stage",  "label": "Stage",  "type": "select", "options": ["new", "qualified", "won", "lost"] },
            { "key": "due",    "label": "Due",    "type": "date" },
            { "key": "done",   "label": "Done",   "type": "checkbox" },
            { "key": "tags",   "label": "Tags",   "type": "tags" },
        ]
    });
    let body = "\
| Name | Amount | Stage | Due | Done | Tags |
|---|---|---|---|---|---|
| Acme | 12000 | qualified | 2026-06-20 | x | crm, vip |
| Beta | 4500 | new | 2026-07-01 |  | crm |
| Cobalt | 28000 | won | 2026-06-18 |  | lead, vip |
| Delta | 800 | lost | 2026-05-15 | x | crm |
| Echo | 15500 | qualified | 2026-06-21 |  | lead |
";
    vault::write(dir.path(), "tables/crm.md", body, &frontmatter).unwrap();
    (dir, "tables/crm.md".to_string())
}

/// The real read→parse stage every operation starts from.
fn load(root: &Path, path: &str) -> SmartTable {
    let entry = vault::read(root, path).unwrap();
    SmartTable::parse(&entry.frontmatter, &entry.content)
}

fn names(rows: &[super::query::Row]) -> Vec<String> {
    rows.iter().map(|r| r.get("name").cloned().unwrap_or_default()).collect()
}

#[test]
fn pipeline_parse_from_disk() {
    let (dir, path) = seed();
    let table = load(dir.path(), &path);
    println!("\n[parse] {path}: {} fields, {} rows", table.fields.len(), table.rows.len());
    for f in &table.fields {
        println!("  field {:<7} type={:?}", f.key, f.cell_type);
    }
    println!("  rows: {:?}", names(&table.rows));
    assert_eq!(table.fields.len(), 6);
    assert_eq!(table.rows.len(), 5);
    assert_eq!(names(&table.rows), ["Acme", "Beta", "Cobalt", "Delta", "Echo"]);
}

#[test]
fn pipeline_describe() {
    let (dir, path) = seed();
    let d = load(dir.path(), &path).describe();
    println!("\n[describe] source_kind={:?}", d.source_kind);
    println!("  fields: {:?}", d.fields.iter().map(|f| &f.key).collect::<Vec<_>>());
    println!("  operators: {:?}", d.operators);
    assert_eq!(d.fields.len(), 6);
    assert!(!d.operators.is_empty());
}

#[test]
fn pipeline_query_filters() {
    let (dir, path) = seed();
    let table = load(dir.path(), &path);
    let run = |label: &str, f: Filter| {
        let req = QueryRequest { filters: vec![f], ..Default::default() };
        let res = table.query(&req, now()).unwrap();
        println!("[query/filter] {label} -> {:?} (match_count={})", names(&res.rows), res.match_count);
        res
    };
    let gt = run("amount > 10000", Filter { field: "amount".into(), op: Operator::Gt, value: "10000".into() });
    assert_eq!(names(&gt.rows), ["Acme", "Cobalt", "Echo"]);
    let contains = run("name contains 'co'", Filter { field: "name".into(), op: Operator::Contains, value: "co".into() });
    assert_eq!(names(&contains.rows), ["Cobalt"]);
    let within = run("due within this_week", Filter { field: "due".into(), op: Operator::Within, value: "this_week".into() });
    // now()=Fri 2026-06-19 → week Mon 06-15..Sun 06-21: Acme 06-20, Cobalt 06-18, Echo 06-21.
    assert_eq!(names(&within.rows), ["Acme", "Cobalt", "Echo"]);
    let tag = run("tags has_tag 'vip'", Filter { field: "tags".into(), op: Operator::HasTag, value: "vip".into() });
    assert_eq!(names(&tag.rows), ["Acme", "Cobalt"]);
}

#[test]
fn pipeline_query_or_conjunction() {
    let (dir, path) = seed();
    let table = load(dir.path(), &path);
    let req = QueryRequest {
        filters: vec![
            Filter { field: "amount".into(), op: Operator::Lt, value: "1000".into() },
            Filter { field: "tags".into(), op: Operator::HasTag, value: "lead".into() },
        ],
        conjunction: Conjunction::Or,
        ..Default::default()
    };
    let res = table.query(&req, now()).unwrap();
    println!("\n[query/OR] amount<1000 OR tags~lead -> {:?}", names(&res.rows));
    // Delta (800) + Cobalt (lead) + Echo (lead).
    assert_eq!(res.match_count, 3);
    assert!(names(&res.rows).contains(&"Delta".to_string()));
}

#[test]
fn pipeline_query_sort_and_multigroup() {
    let (dir, path) = seed();
    let table = load(dir.path(), &path);

    let sorted = table
        .query(&QueryRequest { sort: vec![SortKey { field: "amount".into(), desc: true }], ..Default::default() }, now())
        .unwrap();
    println!("\n[query/sort] amount desc -> {:?}", names(&sorted.rows));
    assert_eq!(names(&sorted.rows), ["Cobalt", "Echo", "Acme", "Beta", "Delta"]);

    let grouped = table
        .query(&QueryRequest { group_by: vec!["stage".into(), "name".into()], ..Default::default() }, now())
        .unwrap();
    println!("[query/group] by stage,name -> {:?}", names(&grouped.rows));
    // Groups contiguous, alpha by stage then name: lost, new, qualified×2, won.
    assert_eq!(names(&grouped.rows), ["Delta", "Beta", "Acme", "Echo", "Cobalt"]);
}

#[test]
fn pipeline_produce_update_cell_to_disk() {
    let (dir, path) = seed();

    // Produce: read fresh → update_cell → serialize → write back (gate handler path).
    let mut table = load(dir.path(), &path);
    let entry = vault::read(dir.path(), &path).unwrap();
    assert!(table.update_cell(3, "stage", "won")); // Delta: lost -> won
    vault::write(dir.path(), &path, &table.serialize_body(), &entry.frontmatter).unwrap();

    // Verify the ACTUAL on-disk file changed.
    let raw = std::fs::read_to_string(dir.path().join("tables/crm.md")).unwrap();
    println!("\n[produce/update_cell] on-disk file after Delta.stage = won:\n{raw}");
    assert!(raw.contains("| Delta | 800 | won |"));

    // Re-read through the pipeline → the change is visible to a fresh query.
    let reread = load(dir.path(), &path);
    let won = reread
        .query(&QueryRequest { filters: vec![Filter { field: "stage".into(), op: Operator::Eq, value: "won".into() }], ..Default::default() }, now())
        .unwrap();
    println!("  re-query stage=won -> {:?}", names(&won.rows));
    assert_eq!(names(&won.rows), ["Cobalt", "Delta"]);
}

#[test]
fn pipeline_produce_append_row_to_disk() {
    let (dir, path) = seed();

    let mut table = load(dir.path(), &path);
    let entry = vault::read(dir.path(), &path).unwrap();
    let mut values = super::query::Row::new();
    values.insert("name".into(), "Foxtrot".into());
    values.insert("amount".into(), "9000".into());
    values.insert("stage".into(), "new".into());
    table.append_row(values);
    vault::write(dir.path(), &path, &table.serialize_body(), &entry.frontmatter).unwrap();

    let raw = std::fs::read_to_string(dir.path().join("tables/crm.md")).unwrap();
    println!("\n[produce/append_row] on-disk file after appending Foxtrot:\n{raw}");
    assert!(raw.contains("| Foxtrot | 9000 | new |"));

    let reread = load(dir.path(), &path);
    println!("  re-parsed rows: {:?}", names(&reread.rows));
    assert_eq!(reread.rows.len(), 6);
    assert_eq!(reread.rows.last().unwrap().get("name").unwrap(), "Foxtrot");
}
