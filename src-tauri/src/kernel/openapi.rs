//! OpenAPI -> §14 record_source scaffold (ADR-002 §7.4 AutoMCP posture). The
//! research (`vault/ctrl/ai-native-feature-pack-research.md`): automatic
//! OpenAPI->MCP codegen is largely solved (AutoMCP ~76.5% out of the box) and the
//! REAL bottleneck is SPEC QUALITY, not codegen. So this produces a best-effort
//! `record_source` DRAFT from one OpenAPI read operation plus spec-repair NOTES
//! (what was inferred / is missing), which the author refines (edit-JSON) and
//! evals (`pack_validate`) before install — it does not pretend to be perfect.
//!
//! Pure over a parsed OpenAPI Value: no I/O, so it unit-tests exhaustively.
//! Resolves local `#/components/schemas/...` refs; handles the two common list
//! shapes (a bare array response, or an object with a named array property).

use serde_json::{json, Value};

/// A scaffolded `record_source` draft + the spec-repair notes for the author.
#[derive(Debug, Clone)]
pub struct Scaffold {
    /// A `record_source` object ready to drop into a manifest (query + fields;
    /// produce/auth are left to the author since a read op does not describe them).
    pub record_source: Value,
    /// Human-readable hints: what was inferred, and what the author must add.
    pub notes: Vec<String>,
}

/// Scaffold a `record_source` from an OpenAPI operation (`GET path`). Returns
/// None only when the operation itself cannot be found; a thin/awkward spec still
/// yields a draft plus notes (spec-repair posture).
pub fn record_source_from_openapi(spec: &Value, path: &str, method: &str) -> Option<Scaffold> {
    let op = spec.pointer(&format!(
        "/paths/{}/{}",
        escape_ptr(path),
        method.to_lowercase()
    ))?;
    let mut notes = Vec::new();

    let schema = response_schema(spec, op).unwrap_or_else(|| {
        notes.push("no JSON response schema found — declare fields by hand".into());
        Value::Null
    });
    let (array_at, item) = array_location(spec, &schema, &mut notes);
    let fields = fields_from_schema(spec, &item, &mut notes);

    if fields.as_array().map(|a| a.is_empty()).unwrap_or(true) {
        notes.push("no fields inferred — add fields[] (key/label/type/from) by hand".into());
    }
    if spec.pointer("/components/securitySchemes").is_some() {
        notes.push(
            "spec declares security — add auth.token_exchange (or auth.bootstrap) so the connector authenticates".into(),
        );
    }

    let record_source = json!({
        "kind": "record",
        "query": { "endpoint": path, "method": method.to_uppercase(), "array_at": array_at },
        "fields": fields,
    });
    Some(Scaffold { record_source, notes })
}

// --- internals ---------------------------------------------------------------

/// RFC-6901 pointer escaping for a path segment (`/` -> `~1`, `~` -> `~0`).
fn escape_ptr(s: &str) -> String {
    s.replace('~', "~0").replace('/', "~1")
}

/// Resolve a local `$ref` (`#/components/schemas/X`) one hop; return the value
/// as-is if it is not a ref. Non-local refs are left unresolved (returns the ref
/// object) so the caller degrades gracefully.
fn deref<'a>(spec: &'a Value, schema: &'a Value) -> &'a Value {
    if let Some(r) = schema.get("$ref").and_then(Value::as_str) {
        if let Some(rest) = r.strip_prefix("#/") {
            let ptr = format!("/{}", rest);
            if let Some(target) = spec.pointer(&ptr) {
                return target;
            }
        }
    }
    schema
}

/// The JSON response schema for an operation: the 200 (or first 2xx) response's
/// `application/json` schema, deref'd.
fn response_schema(spec: &Value, op: &Value) -> Option<Value> {
    let responses = op.get("responses")?.as_object()?;
    let resp = responses
        .get("200")
        .or_else(|| responses.get("201"))
        .or_else(|| responses.values().find(|_| true))?;
    let schema = resp.pointer("/content/application~1json/schema")?;
    Some(deref(spec, schema).clone())
}

/// Locate the row array + the item schema. Handles: a bare array response
/// (`array_at` = ""), or an object with a named array property (`array_at` =
/// that property). Falls back to treating the object itself as a single item.
fn array_location(spec: &Value, schema: &Value, notes: &mut Vec<String>) -> (String, Value) {
    let schema = deref(spec, schema);
    match schema.get("type").and_then(Value::as_str) {
        Some("array") => {
            let item = schema.get("items").map(|i| deref(spec, i).clone()).unwrap_or(Value::Null);
            (String::new(), item)
        }
        Some("object") => {
            // First property whose schema is an array -> the row list.
            if let Some(props) = schema.get("properties").and_then(Value::as_object) {
                for (name, prop) in props {
                    let prop = deref(spec, prop);
                    if prop.get("type").and_then(Value::as_str) == Some("array") {
                        let item =
                            prop.get("items").map(|i| deref(spec, i).clone()).unwrap_or(Value::Null);
                        return (name.clone(), item);
                    }
                }
            }
            notes.push(
                "response is an object with no array property — assumed a single record; set array_at if the list is nested".into(),
            );
            (String::new(), schema.clone())
        }
        _ => {
            notes.push("could not determine the response shape — verify query.array_at".into());
            (String::new(), schema.clone())
        }
    }
}

/// Build `fields[]` from an item schema's `properties`. Each property -> a field
/// {key, label, type, from:[key]} with the OpenAPI type mapped to a §14 CellType.
fn fields_from_schema(spec: &Value, item: &Value, notes: &mut Vec<String>) -> Value {
    let item = deref(spec, item);
    let Some(props) = item.get("properties").and_then(Value::as_object) else {
        return Value::Array(vec![]);
    };
    let mut fields = Vec::new();
    for (name, prop) in props {
        let prop = deref(spec, prop);
        let ty = cell_type(prop);
        if ty == "unknown" {
            notes.push(format!("field '{name}': unrecognized type — defaulted to text"));
        }
        let cell = if ty == "unknown" { "text" } else { ty };
        fields.push(json!({
            "key": name,
            "label": title_case(name),
            "type": cell,
            "from": [name],
        }));
    }
    Value::Array(fields)
}

/// Map an OpenAPI property schema to a §14 CellType enum value.
fn cell_type(prop: &Value) -> &'static str {
    let ty = prop.get("type").and_then(Value::as_str).unwrap_or("");
    let fmt = prop.get("format").and_then(Value::as_str).unwrap_or("");
    match ty {
        "integer" | "number" => "number",
        "boolean" => "checkbox",
        "array" => "tags",
        "string" => match fmt {
            "date" | "date-time" => "date",
            "uri" | "url" => "url",
            _ => "text",
        },
        _ => "unknown",
    }
}

/// `valueInBaseCurrency` -> `Value In Base Currency`; `symbol` -> `Symbol`.
/// Splits camelCase + snake_case, capitalizes each word.
fn title_case(key: &str) -> String {
    let mut out = String::new();
    let mut prev_lower = false;
    for ch in key.chars() {
        if ch == '_' || ch == '-' {
            out.push(' ');
            prev_lower = false;
            continue;
        }
        if ch.is_uppercase() && prev_lower {
            out.push(' ');
        }
        out.push(ch);
        prev_lower = ch.is_lowercase() || ch.is_numeric();
    }
    // Capitalize the first letter of each space-separated word.
    out.split(' ')
        .filter(|w| !w.is_empty())
        .map(|w| {
            let mut c = w.chars();
            match c.next() {
                Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    // A minimal OpenAPI 3 spec: GET /holdings -> { holdings: [ {symbol,...} ] },
    // the item schema behind a $ref, plus a securityScheme (auth hint).
    fn spec() -> Value {
        json!({
            "openapi": "3.0.0",
            "components": {
                "securitySchemes": { "bearer": { "type": "http", "scheme": "bearer" } },
                "schemas": {
                    "Holding": {
                        "type": "object",
                        "properties": {
                            "symbol": { "type": "string" },
                            "quantity": { "type": "number" },
                            "boughtAt": { "type": "string", "format": "date" },
                            "active": { "type": "boolean" }
                        }
                    }
                }
            },
            "paths": {
                "/holdings": {
                    "get": {
                        "responses": {
                            "200": {
                                "content": {
                                    "application/json": {
                                        "schema": {
                                            "type": "object",
                                            "properties": {
                                                "holdings": {
                                                    "type": "array",
                                                    "items": { "$ref": "#/components/schemas/Holding" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        })
    }

    #[test]
    fn scaffolds_endpoint_array_location_and_fields_from_a_ref() {
        let s = record_source_from_openapi(&spec(), "/holdings", "GET").unwrap();
        let rs = &s.record_source;
        assert_eq!(rs["query"]["endpoint"], "/holdings");
        assert_eq!(rs["query"]["method"], "GET");
        assert_eq!(rs["query"]["array_at"], "holdings");
        let fields = rs["fields"].as_array().unwrap();
        assert_eq!(fields.len(), 4);
        let by = |k: &str| fields.iter().find(|f| f["key"] == k).unwrap().clone();
        assert_eq!(by("quantity")["type"], "number");
        assert_eq!(by("boughtAt")["type"], "date");
        assert_eq!(by("boughtAt")["label"], "Bought At"); // camelCase -> Title Case
        assert_eq!(by("active")["type"], "checkbox");
        assert_eq!(by("symbol")["from"], json!(["symbol"]));
    }

    #[test]
    fn notes_flag_security_so_the_author_adds_auth() {
        let s = record_source_from_openapi(&spec(), "/holdings", "GET").unwrap();
        assert!(s.notes.iter().any(|n| n.contains("auth")));
    }

    #[test]
    fn bare_array_response_has_empty_array_at() {
        let spec = json!({
            "paths": { "/items": { "get": { "responses": { "200": { "content": {
                "application/json": { "schema": {
                    "type": "array",
                    "items": { "type": "object", "properties": { "id": { "type": "string" } } }
                }}
            }}}}}}
        });
        let s = record_source_from_openapi(&spec, "/items", "GET").unwrap();
        assert_eq!(s.record_source["query"]["array_at"], "");
        assert_eq!(s.record_source["fields"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn unknown_operation_returns_none() {
        assert!(record_source_from_openapi(&spec(), "/nope", "GET").is_none());
    }

    #[test]
    fn missing_response_schema_still_drafts_with_a_note() {
        let spec = json!({ "paths": { "/x": { "get": { "responses": { "200": {} } } } } });
        let s = record_source_from_openapi(&spec, "/x", "GET").unwrap();
        assert_eq!(s.record_source["query"]["endpoint"], "/x");
        assert!(s.record_source["fields"].as_array().unwrap().is_empty());
        assert!(s.notes.iter().any(|n| n.contains("response schema") || n.contains("fields")));
    }

    #[test]
    fn title_case_handles_camel_snake_and_acronym_tail() {
        assert_eq!(title_case("valueInBaseCurrency"), "Value In Base Currency");
        assert_eq!(title_case("allocation_in_percentage"), "Allocation In Percentage");
        assert_eq!(title_case("symbol"), "Symbol");
    }
}
