//! Generic manifest-driven §14 connector source (ADR-002 §14.12). A REST
//! connector's §14 shape — its schema, its JSON→Row mapping, its read endpoint,
//! its write body — is declared as manifest DATA (`record_source`), and this ONE
//! runtime source reproduces what a hand-coded connector (`ghostfolio_source.rs`)
//! did. Adding a REST connector becomes pure manifest data, zero Rust — closing
//! the gap §14.6 promised but per-source code broke (§7.4 manifest=data /
//! §7.5 product-grade packs are zero-code to add).
//!
//! The shared `run_query` engine (query.rs) and the silent-auth engine
//! (pack_auth.rs) are REUSED unchanged; this module is only the missing
//! data-declaration + generic-fetch/produce layer. Secrets stay kernel-side and
//! never reach the LLM (ADR-006 decision 0004); `produce` is routed through the
//! review gate by the caller (§14.9), same as any write.

use crate::kernel::query::{CellType, Describe, FieldSpec, Operator, QuerySource, Row, SourceKind};
use serde::Deserialize;
use serde_json::{Map, Value};

/// The `record_source` manifest declaration, deserialized. Everything a generic
/// connector needs to be Irisy-operable without bespoke code.
#[derive(Debug, Clone, Deserialize)]
pub struct RecordSourceSpec {
    #[serde(default = "default_kind")]
    pub kind: SourceKind,
    pub query: QuerySpec,
    pub fields: Vec<FieldMap>,
    /// Operators the source advertises via `describe`. Absent → the default set
    /// for the kind (records get the full comparison + membership set).
    #[serde(default)]
    pub operators: Option<Vec<Operator>>,
    /// How to mint a per-call bearer from the stored security token (reuses the
    /// v40 `auth.token_exchange` shape). Absent → the stored token is sent as the
    /// bearer directly (a connector that issues a usable long-lived token).
    #[serde(default)]
    pub token_exchange: Option<TokenExchangeSpec>,
    /// The write verb (`produce`) — absent for read-only sources.
    #[serde(default)]
    pub produce: Option<ProduceSpec>,
}

/// Where and how to read the row array.
#[derive(Debug, Clone, Deserialize)]
pub struct QuerySpec {
    pub endpoint: String,
    #[serde(default = "default_get")]
    pub method: String,
    /// Key or dotted path to the array in the response (`"holdings"` /
    /// `"data.items"`); `""` = the response body IS the array.
    #[serde(default)]
    pub array_at: String,
}

/// One field's schema + how to read it out of a response item.
#[derive(Debug, Clone, Deserialize)]
pub struct FieldMap {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub cell_type: CellType,
    /// JSON paths (dotted, nested-aware) tried in order; first present wins.
    /// Empty → `[key]`.
    #[serde(default)]
    pub from: Vec<String>,
}

/// `auth.token_exchange` params, generic over field/pointer names.
#[derive(Debug, Clone, Deserialize)]
pub struct TokenExchangeSpec {
    pub path: String,
    pub as_body_field: String,
    pub capture_pointer: String,
}

/// The write verb: endpoint + body field mapping from the caller's input map.
#[derive(Debug, Clone, Deserialize)]
pub struct ProduceSpec {
    pub endpoint: String,
    #[serde(default = "default_post")]
    pub method: String,
    /// High-signal label for the write ("Record a trade") — §14 produce is an
    /// atom, not a raw endpoint mirror.
    #[serde(default)]
    pub label: String,
    pub body: Vec<BodyField>,
}

/// One entry in the produce body map: take input[`from`], optionally transform,
/// write it to the request body as `field`.
#[derive(Debug, Clone, Deserialize)]
pub struct BodyField {
    /// Target key in the outgoing request body.
    pub field: String,
    /// Source key in the caller's input map.
    pub from: String,
    /// `uppercase` (string) — extend as connectors need.
    #[serde(default)]
    pub transform: Option<String>,
    /// `number` → coerce a string input to a JSON number before sending.
    #[serde(rename = "type", default)]
    pub value_type: Option<String>,
}

fn default_kind() -> SourceKind {
    SourceKind::Record
}
fn default_get() -> String {
    "GET".into()
}
fn default_post() -> String {
    "POST".into()
}

/// A queryable §14 source built generically from a `record_source` spec + a
/// fetched response body. Reuses the shared `run_query` engine via `QuerySource`.
#[derive(Debug)]
pub struct ManifestConnectorSource {
    kind: SourceKind,
    fields: Vec<FieldSpec>,
    operators: Vec<Operator>,
    rows: Vec<Row>,
}

impl ManifestConnectorSource {
    /// Build rows from a response body per the spec's array location + field map.
    /// Tolerant: a missing/garbage body yields an empty source, never a panic
    /// (§14 convention, mirrors the hand-coded reader).
    pub fn from_json(spec: &RecordSourceSpec, body: &Value) -> ManifestConnectorSource {
        let items = array_at(body, &spec.query.array_at);
        let rows = items.iter().map(|it| item_to_row(&spec.fields, it)).collect();
        ManifestConnectorSource {
            kind: spec.kind,
            fields: field_specs(&spec.fields),
            operators: operators_for(spec),
            rows,
        }
    }

    /// The `describe` a source advertises without a live fetch (the type layer
    /// Irisy reads before querying).
    pub fn describe_spec(spec: &RecordSourceSpec) -> Describe {
        Describe {
            source_kind: spec.kind,
            fields: field_specs(&spec.fields),
            operators: operators_for(spec),
        }
    }
}

impl QuerySource for ManifestConnectorSource {
    fn describe(&self) -> Describe {
        Describe {
            source_kind: self.kind,
            fields: self.fields.clone(),
            operators: self.operators.clone(),
        }
    }

    fn rows(&self) -> &[Row] {
        &self.rows
    }
}

// ─── generic fetch / produce over the connector's own instance ────────────────

#[derive(Debug)]
pub enum SourceError {
    Http(String),
    Status(u16),
    Parse(String),
    /// The spec declares no `produce` but a write was attempted.
    NoProduce,
}

impl std::fmt::Display for SourceError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SourceError::Http(e) => write!(f, "connector request failed: {e}"),
            SourceError::Status(c) => write!(f, "connector returned HTTP {c}"),
            SourceError::Parse(e) => write!(f, "connector response parse failed: {e}"),
            SourceError::NoProduce => write!(f, "this source declares no produce (write) verb"),
        }
    }
}

fn http_client() -> Result<reqwest::Client, SourceError> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|_| SourceError::Http("could not build http client".into()))
}

/// Resolve the per-call bearer: mint via the declared token-exchange, or send the
/// stored token directly when no exchange is declared. Secret stays kernel-side.
async fn bearer(
    client: &reqwest::Client,
    spec: &RecordSourceSpec,
    base_url: &str,
    security_token: &str,
) -> Result<String, SourceError> {
    match &spec.token_exchange {
        Some(tx) => crate::kernel::pack_auth::mint_bearer(
            client,
            base_url,
            &tx.path,
            &tx.as_body_field,
            security_token,
            &tx.capture_pointer,
        )
        .await
        .map_err(map_auth_err),
        None => Ok(security_token.to_string()),
    }
}

fn map_auth_err(e: crate::kernel::pack_auth::AuthError) -> SourceError {
    use crate::kernel::pack_auth::AuthError;
    match e {
        AuthError::Status(c) => SourceError::Status(c),
        AuthError::Parse(m) => SourceError::Parse(m),
        AuthError::Http(m) => SourceError::Http(m),
    }
}

/// Fetch the connector's records and build a §14 source — the generic read path.
/// Kernel-internal reqwest against the user's own provisioned instance (not the
/// egress-guarded `http_get` tool, since a self-hosted connector legitimately
/// targets loopback/LAN and the URL is kernel/user-sourced, not LLM-controlled).
pub async fn fetch(
    spec: &RecordSourceSpec,
    base_url: &str,
    security_token: &str,
) -> Result<ManifestConnectorSource, SourceError> {
    let client = http_client()?;
    let jwt = bearer(&client, spec, base_url, security_token).await?;
    let url = join(base_url, &spec.query.endpoint);
    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .send()
        .await
        .map_err(|_| SourceError::Http("could not reach the connector instance".into()))?;
    if !resp.status().is_success() {
        return Err(SourceError::Status(resp.status().as_u16()));
    }
    let body: Value = resp.json().await.map_err(|e| SourceError::Parse(e.to_string()))?;
    Ok(ManifestConnectorSource::from_json(spec, &body))
}

/// Write a record via the connector's `produce` endpoint — the generic §14 write
/// path. The body is built from the spec's field map over the caller's `input`.
/// Returns the created resource JSON. Routed through the review gate by the
/// caller (§14.9). Token stays kernel-side.
pub async fn produce(
    spec: &RecordSourceSpec,
    base_url: &str,
    security_token: &str,
    input: &Map<String, Value>,
) -> Result<Value, SourceError> {
    let ps = spec.produce.as_ref().ok_or(SourceError::NoProduce)?;
    let body = build_produce_body(&ps.body, input);
    let client = http_client()?;
    let jwt = bearer(&client, spec, base_url, security_token).await?;
    let url = join(base_url, &ps.endpoint);
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {jwt}"))
        .json(&Value::Object(body))
        .send()
        .await
        .map_err(|_| SourceError::Http("could not reach the connector instance".into()))?;
    if !resp.status().is_success() {
        return Err(SourceError::Status(resp.status().as_u16()));
    }
    resp.json().await.map_err(|e| SourceError::Parse(e.to_string()))
}

/// Build a full `RecordSourceSpec` from an installed manifest: the `record_source`
/// declaration + the `auth.token_exchange` (reused, NOT re-declared in
/// record_source — the manifest's auth field names are mapped onto the spec's).
/// Returns None if the manifest declares no `record_source`.
pub fn spec_from_manifest(manifest: &Value) -> Option<RecordSourceSpec> {
    let mut spec: RecordSourceSpec = serde_json::from_value(manifest.get("record_source")?.clone()).ok()?;
    // Reuse auth.token_exchange (manifest: path / as_body_field / capture_bearer)
    // → the generic source's token_exchange (path / as_body_field / capture_pointer).
    if let Some(tx) = manifest.pointer("/auth/token_exchange") {
        if let (Some(path), Some(field), Some(ptr)) = (
            tx.get("path").and_then(Value::as_str),
            tx.get("as_body_field").and_then(Value::as_str),
            tx.get("capture_bearer").and_then(Value::as_str),
        ) {
            spec.token_exchange = Some(TokenExchangeSpec {
                path: path.to_string(),
                as_body_field: field.to_string(),
                capture_pointer: ptr.to_string(),
            });
        }
    }
    Some(spec)
}

/// The credential name a manifest stores its long-lived security token under
/// (`auth.token_exchange.send_secret`), so the gate resolves `mcp:<id>:<here>`.
pub fn send_secret_of(manifest: &Value) -> Option<String> {
    manifest
        .pointer("/auth/token_exchange/send_secret")
        .and_then(Value::as_str)
        .map(str::to_string)
}

// ─── internals ────────────────────────────────────────────────────────────────

fn join(base_url: &str, path: &str) -> String {
    format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'))
}

fn field_specs(fields: &[FieldMap]) -> Vec<FieldSpec> {
    fields
        .iter()
        .map(|f| FieldSpec {
            key: f.key.clone(),
            label: f.label.clone(),
            cell_type: f.cell_type,
            options: None,
        })
        .collect()
}

/// Default operator set for a source kind when the manifest omits `operators`.
fn operators_for(spec: &RecordSourceSpec) -> Vec<Operator> {
    use Operator::*;
    spec.operators.clone().unwrap_or_else(|| match spec.kind {
        SourceKind::Record => vec![Eq, Neq, Contains, Gt, Lt, Gte, Lte, HasTag, Is],
        SourceKind::Text | SourceKind::Blob => vec![Contains],
    })
}

/// Extract the row array from the body at `array_at` (key or dotted path);
/// `""` = the body is itself the array.
fn array_at(body: &Value, at: &str) -> Vec<Value> {
    let target = if at.is_empty() { Some(body) } else { dig(body, at) };
    match target {
        Some(Value::Array(a)) => a.clone(),
        _ => Vec::new(),
    }
}

/// Project one response item into a queryable row per the field map. Numbers are
/// stringified (rows are plain text, typed by the schema at compare time).
fn item_to_row(fields: &[FieldMap], item: &Value) -> Row {
    let mut row = Row::new();
    for f in fields {
        let paths: Vec<&str> = if f.from.is_empty() {
            vec![f.key.as_str()]
        } else {
            f.from.iter().map(String::as_str).collect()
        };
        let cell = match f.cell_type {
            CellType::Number => read_num(item, &paths),
            _ => read_str(item, &paths),
        };
        row.insert(f.key.clone(), cell);
    }
    row
}

/// First present string path (numbers coerced to string).
fn read_str(item: &Value, paths: &[&str]) -> String {
    for p in paths {
        if let Some(v) = dig(item, p) {
            if let Some(s) = v.as_str() {
                return s.to_string();
            }
            if let Some(n) = v.as_f64() {
                return fmt_num(n);
            }
        }
    }
    String::new()
}

/// First present numeric path as clean plain-text (string numbers accepted).
fn read_num(item: &Value, paths: &[&str]) -> String {
    for p in paths {
        if let Some(v) = dig(item, p) {
            if let Some(n) = v.as_f64() {
                return fmt_num(n);
            }
            if let Some(s) = v.as_str() {
                return s.to_string();
            }
        }
    }
    String::new()
}

/// Trim a trailing `.0` so integers stay clean for display/compare.
fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

/// Resolve a dotted path (`SymbolProfile.symbol`) against a JSON object.
fn dig<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    let mut cur = v;
    for seg in path.split('.') {
        cur = cur.get(seg)?;
    }
    Some(cur)
}

/// Build the produce request body from the field map over the caller's input.
fn build_produce_body(map: &[BodyField], input: &Map<String, Value>) -> Map<String, Value> {
    let mut body = Map::new();
    for bf in map {
        let Some(raw) = input.get(&bf.from) else { continue };
        let mut v = raw.clone();
        if bf.transform.as_deref() == Some("uppercase") {
            if let Some(s) = v.as_str() {
                v = Value::String(s.to_uppercase());
            }
        }
        if bf.value_type.as_deref() == Some("number") {
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.parse::<f64>() {
                    v = serde_json::json!(n);
                }
            }
        }
        body.insert(bf.field.clone(), v);
    }
    body
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::query::{Filter, QueryRequest};
    use chrono::NaiveDate;

    fn now() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 7, 1).unwrap()
    }

    /// The ghostfolio §14 shape expressed as PURE MANIFEST DATA — the proof that a
    /// connector needs no Rust. Mirrors `ghostfolio_source.rs` exactly.
    fn ghostfolio_spec() -> RecordSourceSpec {
        serde_json::from_value(serde_json::json!({
            "kind": "record",
            "query": { "endpoint": "/api/v1/portfolio/holdings", "array_at": "holdings" },
            "operators": ["eq", "neq", "contains", "gt", "lt", "gte", "lte"],
            "token_exchange": {
                "path": "/api/v1/auth/anonymous",
                "as_body_field": "accessToken",
                "capture_pointer": "/authToken"
            },
            "fields": [
                { "key": "symbol",     "label": "Symbol",       "type": "text",   "from": ["symbol", "SymbolProfile.symbol"] },
                { "key": "name",       "label": "Name",         "type": "text",   "from": ["name", "SymbolProfile.name"] },
                { "key": "quantity",   "label": "Quantity",     "type": "number", "from": ["quantity"] },
                { "key": "value",      "label": "Value",        "type": "number", "from": ["valueInBaseCurrency", "value"] },
                { "key": "allocation", "label": "Allocation %", "type": "number", "from": ["allocationInPercentage", "allocation"] },
                { "key": "currency",   "label": "Currency",     "type": "text",   "from": ["currency"] }
            ],
            "produce": {
                "endpoint": "/api/v1/order",
                "label": "Record a trade",
                "body": [
                    { "field": "symbol",    "from": "symbol" },
                    { "field": "type",      "from": "kind",      "transform": "uppercase" },
                    { "field": "quantity",  "from": "quantity",  "type": "number" },
                    { "field": "unitPrice", "from": "unitPrice", "type": "number" },
                    { "field": "currency",  "from": "currency" },
                    { "field": "date",      "from": "date" },
                    { "field": "dataSource","from": "dataSource" }
                ]
            }
        }))
        .unwrap()
    }

    // Same payload shape ghostfolio_source.rs tests use (object-wrapped, mixed flat
    // + nested SymbolProfile) to prove the generic reader reproduces it.
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
    fn describe_from_spec_is_record_with_typed_fields() {
        let d = ManifestConnectorSource::describe_spec(&ghostfolio_spec());
        assert_eq!(d.source_kind, SourceKind::Record);
        assert!(d.fields.iter().any(|f| f.key == "symbol"));
        let val = d.fields.iter().find(|f| f.key == "value").unwrap();
        assert_eq!(val.cell_type, CellType::Number);
    }

    /// EQUIVALENCE: the generic source + ghostfolio-shaped manifest reproduces
    /// EXACTLY the rows the hand-coded `GhostfolioSource` produced (§14.12 proof).
    #[test]
    fn generic_source_reproduces_ghostfolio_rows() {
        let src = ManifestConnectorSource::from_json(&ghostfolio_spec(), &sample());
        assert_eq!(src.rows().len(), 3);
        assert_eq!(src.rows()[0]["symbol"], "AAPL");
        assert_eq!(src.rows()[0]["value"], "1900.5");
        assert_eq!(src.rows()[0]["quantity"], "10"); // integer stays clean
        // Nested SymbolProfile.symbol read when the flat key is absent.
        assert_eq!(src.rows()[1]["symbol"], "VEU");
        assert_eq!(src.rows()[1]["value"], "500");
    }

    #[test]
    fn bare_array_and_missing_fields_are_tolerant() {
        let mut spec = ghostfolio_spec();
        spec.query.array_at = String::new(); // bare array response
        let bare = serde_json::json!([{ "symbol": "AAPL", "value": 100 }]);
        let src = ManifestConnectorSource::from_json(&spec, &bare);
        assert_eq!(src.rows().len(), 1);
        assert_eq!(src.rows()[0]["symbol"], "AAPL");
        assert_eq!(src.rows()[0]["name"], ""); // missing field → empty, not fatal
        // Garbage body → empty source.
        assert_eq!(ManifestConnectorSource::from_json(&spec, &serde_json::json!("no")).rows().len(), 0);
    }

    #[test]
    fn query_over_generic_source_reuses_shared_engine() {
        let src = ManifestConnectorSource::from_json(&ghostfolio_spec(), &sample());
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
        let src = ManifestConnectorSource::from_json(&ghostfolio_spec(), &sample());
        let req = QueryRequest {
            filters: vec![Filter { field: "bogus".into(), op: Operator::Eq, value: "x".into() }],
            ..Default::default()
        };
        assert!(src.query(&req, now()).is_err());
    }

    #[test]
    fn produce_body_maps_and_transforms() {
        let spec = ghostfolio_spec();
        let mut input = Map::new();
        input.insert("symbol".into(), serde_json::json!("AAPL"));
        input.insert("kind".into(), serde_json::json!("buy")); // → BUY
        input.insert("quantity".into(), serde_json::json!("10")); // string → number
        input.insert("unitPrice".into(), serde_json::json!("190"));
        input.insert("currency".into(), serde_json::json!("USD"));
        let body = build_produce_body(&spec.produce.unwrap().body, &input);
        assert_eq!(body["symbol"], "AAPL");
        assert_eq!(body["type"], "BUY"); // uppercase transform
        assert_eq!(body["quantity"], 10.0); // coerced to JSON number
        assert_eq!(body["unitPrice"], 190.0);
    }

    // End-to-end over real HTTP: a mock instance speaking the declared auth flow →
    // generic fetch() → §14 rows. Proves the full self-hosted-app → AI-native path
    // is driven entirely by manifest data (no ghostfolio-specific code).
    #[tokio::test]
    async fn generic_fetch_over_http_maps_rows() {
        use axum::{routing::{get, post}, Json, Router};
        let app = Router::new()
            .route(
                "/api/v1/auth/anonymous",
                post(|| async { Json(serde_json::json!({ "authToken": "jwt-xyz" })) }),
            )
            .route(
                "/api/v1/portfolio/holdings",
                get(|| async {
                    Json(serde_json::json!({ "holdings": [
                        { "symbol": "AAPL", "name": "Apple", "quantity": 5,
                          "valueInBaseCurrency": 1000, "allocationInPercentage": 80, "currency": "USD" },
                        { "symbol": "BTC", "name": "Bitcoin", "quantity": 0.1,
                          "valueInBaseCurrency": 250, "allocationInPercentage": 20, "currency": "USD" }
                    ]}))
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let src = fetch(&ghostfolio_spec(), &format!("http://{addr}"), "test-token").await.unwrap();
        assert_eq!(src.rows().len(), 2);
        assert_eq!(src.rows()[0]["symbol"], "AAPL");
        assert_eq!(src.rows()[0]["value"], "1000");

        let req = QueryRequest {
            filters: vec![Filter { field: "value".into(), op: Operator::Gt, value: "500".into() }],
            ..Default::default()
        };
        let out = src.query(&req, now()).unwrap();
        assert_eq!(out.match_count, 1);
        assert_eq!(out.rows[0]["symbol"], "AAPL");
    }

    #[tokio::test]
    async fn generic_produce_posts_mapped_body() {
        use axum::{routing::post, Json, Router};
        let app = Router::new()
            .route(
                "/api/v1/auth/anonymous",
                post(|| async { Json(serde_json::json!({ "authToken": "jwt-xyz" })) }),
            )
            .route(
                "/api/v1/order",
                post(|Json(body): Json<Value>| async move { Json(body) }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        let mut input = Map::new();
        input.insert("symbol".into(), serde_json::json!("AAPL"));
        input.insert("kind".into(), serde_json::json!("buy"));
        input.insert("quantity".into(), serde_json::json!("10"));
        input.insert("unitPrice".into(), serde_json::json!("190"));
        input.insert("currency".into(), serde_json::json!("USD"));
        input.insert("date".into(), serde_json::json!("2026-07-01"));
        input.insert("dataSource".into(), serde_json::json!("YAHOO"));

        let created = produce(&ghostfolio_spec(), &format!("http://{addr}"), "test-token", &input)
            .await
            .unwrap();
        assert_eq!(created["symbol"], "AAPL");
        assert_eq!(created["type"], "BUY");
        assert_eq!(created["quantity"], 10.0);
        assert_eq!(created["unitPrice"], 190.0);
    }

    // The REAL shipped ctrl-ghostfolio manifest → spec: proves the whole data
    // path (manifest file → record_source + reused auth.token_exchange → spec →
    // §14 rows) with zero ghostfolio-specific Rust. This is the seed the ADR
    // §14.12 thesis rests on.
    #[test]
    fn spec_from_real_ghostfolio_manifest_maps_auth_and_produce() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json"
        );
        let bytes = std::fs::read(path).expect("read shipped ghostfolio manifest");
        let manifest: Value = serde_json::from_slice(&bytes).unwrap();
        let spec = spec_from_manifest(&manifest).expect("record_source present");

        assert_eq!(spec.query.endpoint, "/api/v1/portfolio/holdings");
        assert_eq!(spec.query.array_at, "holdings");
        assert_eq!(spec.fields.len(), 6);
        // token_exchange reused from auth (manifest field names mapped over).
        let tx = spec.token_exchange.clone().expect("token_exchange from auth");
        assert_eq!(tx.path, "/api/v1/auth/anonymous");
        assert_eq!(tx.as_body_field, "accessToken");
        assert_eq!(tx.capture_pointer, "/authToken");
        assert_eq!(send_secret_of(&manifest).as_deref(), Some("ghostfolio_token"));
        assert!(spec.produce.is_some(), "produce (record a trade) declared");

        // The generic source over the REAL manifest spec reproduces holdings rows,
        // incl. the nested SymbolProfile.symbol fallback declared in the manifest.
        let src = ManifestConnectorSource::from_json(&spec, &sample());
        assert_eq!(src.rows().len(), 3);
        assert_eq!(src.rows()[1]["symbol"], "VEU");
    }

    #[test]
    fn spec_from_manifest_none_without_record_source() {
        assert!(spec_from_manifest(&serde_json::json!({ "id": "x" })).is_none());
    }

    #[tokio::test]
    async fn fetch_bad_auth_is_typed_error() {
        use axum::{http::StatusCode, routing::post, Router};
        let app = Router::new()
            .route("/api/v1/auth/anonymous", post(|| async { StatusCode::UNAUTHORIZED }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        let err = fetch(&ghostfolio_spec(), &format!("http://{addr}"), "bad").await.unwrap_err();
        assert!(matches!(err, SourceError::Status(401)));
    }
}
