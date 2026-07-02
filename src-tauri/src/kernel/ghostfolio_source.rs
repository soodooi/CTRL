//! Ghostfolio as a §14 RecordSource (ADR-002 §14) — the first seed proving the
//! feature-pack thesis: take a self-hosted open-source app (Ghostfolio, a
//! finance/portfolio tracker) and make it AI-native through CTRL's :17873 gate,
//! governing `vault/ctrl/ai-native-feature-pack-research.md`.
//!
//! The research's moat insight (Anthropic "writing tools for agents"): merely
//! wrapping REST endpoints one-tool-per-endpoint is NOT agent-native. So instead
//! of surfacing Ghostfolio's raw API, CTRL lifts its portfolio into the SAME
//! uniform describe/query contract Irisy uses for smart-tables, notes, and
//! tasks — one high-signal shape the agent already understands. Holdings are
//! read-only market state (query); writes (add transaction) are a separate
//! `produce` through the review gate (next slice).
//!
//! The kernel fetches Ghostfolio's REST directly (it is trusted kernel code, not
//! an arbitrary pack shell), with the base URL + bearer token resolved from the
//! credential store — the token never reaches the LLM (ADR-006 secrets policy).

use crate::kernel::query::{
    CellType, Describe, FieldSpec, Operator, QuerySource, Row, SourceKind,
};
use serde_json::Value;

/// A queryable view over a Ghostfolio account's current holdings (the Record
/// profile of the Ghostfolio source).
pub struct GhostfolioSource {
    rows: Vec<Row>,
}

impl GhostfolioSource {
    /// Build from a parsed Ghostfolio holdings response. Tolerant of the two
    /// shapes the API/community-MCP return: `{ "holdings": [...] }` or a bare
    /// `[...]` array. Unknown/missing fields are skipped, never fatal.
    pub fn from_json(body: &Value) -> GhostfolioSource {
        let items = holdings_array(body);
        let rows = items.iter().map(holding_to_row).collect();
        GhostfolioSource { rows }
    }

    /// The stable schema a Ghostfolio holdings source advertises via `describe`.
    /// Aligned to Ghostfolio's holdings shape (symbol/name/quantity/value/
    /// allocation/currency); verify field names against a live instance.
    pub fn fields() -> Vec<FieldSpec> {
        vec![
            field("symbol", "Symbol", CellType::Text),
            field("name", "Name", CellType::Text),
            field("quantity", "Quantity", CellType::Number),
            field("value", "Value", CellType::Number),
            field("allocation", "Allocation %", CellType::Number),
            field("currency", "Currency", CellType::Text),
        ]
    }

    pub fn operators() -> Vec<Operator> {
        use Operator::*;
        vec![Eq, Neq, Contains, Gt, Lt, Gte, Lte]
    }
}

impl QuerySource for GhostfolioSource {
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

/// The `describe` the gate advertises without a live fetch (the type layer Irisy
/// reads before querying).
pub fn describe() -> Describe {
    Describe {
        source_kind: SourceKind::Record,
        fields: GhostfolioSource::fields(),
        operators: GhostfolioSource::operators(),
    }
}

/// Fetch the current holdings from a self-hosted Ghostfolio instance and build a
/// §14 source. `base_url` + `token` come from the credential store (never the
/// LLM). Kernel-internal reqwest (not the caller-facing `http_get` tool, so it
/// is not subject to the SSRF egress-guard that denies loopback — a self-hosted
/// connector legitimately targets loopback/LAN).
pub async fn fetch(base_url: &str, token: &str) -> Result<GhostfolioSource, GhostfolioError> {
    let url = format!("{}/api/v1/portfolio/holdings", base_url.trim_end_matches('/'));
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| GhostfolioError::Http(e.to_string()))?;
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| GhostfolioError::Http(e.to_string()))?;
    if !resp.status().is_success() {
        return Err(GhostfolioError::Status(resp.status().as_u16()));
    }
    let body: Value = resp
        .json()
        .await
        .map_err(|e| GhostfolioError::Parse(e.to_string()))?;
    Ok(GhostfolioSource::from_json(&body))
}

#[derive(Debug)]
pub enum GhostfolioError {
    Http(String),
    Status(u16),
    Parse(String),
}

impl std::fmt::Display for GhostfolioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GhostfolioError::Http(e) => write!(f, "ghostfolio request failed: {e}"),
            GhostfolioError::Status(c) => write!(f, "ghostfolio returned HTTP {c}"),
            GhostfolioError::Parse(e) => write!(f, "ghostfolio response parse failed: {e}"),
        }
    }
}

// ─── internals ──────────────────────────────────────────────────────────────

/// Extract the holdings array from either `{ "holdings": [...] }` or `[...]`.
fn holdings_array(body: &Value) -> Vec<Value> {
    match body {
        Value::Array(a) => a.clone(),
        Value::Object(o) => o
            .get("holdings")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Project one Ghostfolio holding into a queryable row. Numbers are stringified
/// (rows are plain text, typed by the schema at compare time — §14 convention).
fn holding_to_row(h: &Value) -> Row {
    let mut row = Row::new();
    row.insert("symbol".into(), str_field(h, &["symbol", "SymbolProfile.symbol"]));
    row.insert("name".into(), str_field(h, &["name", "SymbolProfile.name"]));
    row.insert("quantity".into(), num_field(h, &["quantity"]));
    row.insert("value".into(), num_field(h, &["valueInBaseCurrency", "value"]));
    row.insert(
        "allocation".into(),
        num_field(h, &["allocationInPercentage", "allocationInPercentage"]),
    );
    row.insert("currency".into(), str_field(h, &["currency"]));
    row
}

/// Read the first present string key (supports a dotted path for nested objects).
fn str_field(h: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = dig(h, k) {
            if let Some(s) = v.as_str() {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// Read the first present numeric key as a plain-text number.
fn num_field(h: &Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = dig(h, k) {
            if let Some(n) = v.as_f64() {
                // Trim a trailing `.0` so integers stay clean for display/compare.
                return if n.fract() == 0.0 {
                    format!("{}", n as i64)
                } else {
                    format!("{n}")
                };
            }
            if let Some(s) = v.as_str() {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// Resolve a dotted path (`SymbolProfile.symbol`) against a JSON object.
fn dig<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = v;
    for seg in path.split('.') {
        cur = cur.get(seg)?;
    }
    Some(cur)
}

fn field(key: &str, label: &str, cell_type: CellType) -> FieldSpec {
    FieldSpec { key: key.to_string(), label: label.to_string(), cell_type, options: None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{Filter, Operator, QueryRequest, QuerySource};
    use chrono::NaiveDate;

    fn now() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()
    }

    // A holdings payload shaped like Ghostfolio's response (object-wrapped, with
    // both flat and nested SymbolProfile fields to prove the tolerant reader).
    fn sample() -> Value {
        serde_json::json!({
            "holdings": [
                { "symbol": "AAPL", "name": "Apple Inc.", "quantity": 10,
                  "valueInBaseCurrency": 1900.5, "allocationInPercentage": 62.3, "currency": "USD" },
                { "SymbolProfile": { "symbol": "VEU", "name": "Vanguard EU" },
                  "quantity": 5, "value": 500, "allocationInPercentage": 16.4, "currency": "EUR" },
                { "symbol": "BTC", "name": "Bitcoin", "quantity": 0.25,
                  "valueInBaseCurrency": 650, "allocationInPercentage": 21.3, "currency": "USD" }
            ]
        })
    }

    #[test]
    fn describe_is_record_with_holding_fields() {
        let d = describe();
        assert_eq!(d.source_kind, SourceKind::Record);
        assert!(d.fields.iter().any(|f| f.key == "symbol"));
        let val = d.fields.iter().find(|f| f.key == "value").unwrap();
        assert_eq!(val.cell_type, CellType::Number);
    }

    #[test]
    fn parses_object_wrapped_and_nested_shapes() {
        let src = GhostfolioSource::from_json(&sample());
        assert_eq!(src.rows().len(), 3);
        assert_eq!(src.rows()[0]["symbol"], "AAPL");
        assert_eq!(src.rows()[0]["value"], "1900.5");
        assert_eq!(src.rows()[0]["quantity"], "10"); // integer stays clean
        // Nested SymbolProfile.symbol is read when the flat key is absent.
        assert_eq!(src.rows()[1]["symbol"], "VEU");
        assert_eq!(src.rows()[1]["value"], "500");
    }

    #[test]
    fn parses_bare_array_shape() {
        let bare = serde_json::json!([{ "symbol": "AAPL", "value": 100 }]);
        let src = GhostfolioSource::from_json(&bare);
        assert_eq!(src.rows().len(), 1);
        assert_eq!(src.rows()[0]["symbol"], "AAPL");
    }

    #[test]
    fn query_filters_holdings_by_value() {
        let src = GhostfolioSource::from_json(&sample());
        // Holdings worth more than 600 (the §14 uniform contract, shared engine).
        let req = QueryRequest {
            filters: vec![Filter { field: "value".into(), op: Operator::Gt, value: "600".into() }],
            ..Default::default()
        };
        let out = src.query(&req, now()).unwrap();
        assert_eq!(out.match_count, 2); // AAPL 1900.5 + BTC 650, not the 500 one
        assert!(out.rows.iter().all(|r| r["symbol"] == "AAPL" || r["symbol"] == "BTC"));
    }

    #[test]
    fn unknown_field_query_rejected() {
        let src = GhostfolioSource::from_json(&sample());
        let req = QueryRequest {
            filters: vec![Filter { field: "bogus".into(), op: Operator::Eq, value: "x".into() }],
            ..Default::default()
        };
        assert!(src.query(&req, now()).is_err());
    }

    #[test]
    fn empty_or_garbage_body_is_empty_source() {
        assert_eq!(GhostfolioSource::from_json(&serde_json::json!({})).rows().len(), 0);
        assert_eq!(GhostfolioSource::from_json(&serde_json::json!("nope")).rows().len(), 0);
    }
}
