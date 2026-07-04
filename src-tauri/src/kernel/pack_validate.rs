//! Feature-pack evals — the review + evals phases of the pack-authoring pipeline
//! (Anthropic `mcp-builder` Phase 3 review / Phase 4 evals; research
//! `vault/ctrl/ai-native-feature-pack-research.md`: "Phase 4 evals is the step
//! home-grown pipelines skip" = the quality moat). The brain (hermes / Irisy /
//! BYO-CLI) authors a candidate manifest with its OWN model, then calls the gate
//! tool `mcp_pack_validate` to check it BEFORE install — getting structured,
//! machine-actionable feedback (§14.11 shape: field + severity + fix) it can
//! self-correct from, instead of installing a broken pack.
//!
//! Pure over a parsed manifest Value (no I/O), so it unit-tests exhaustively and
//! the gate tool is a thin wrapper. It validates the SHAPE a pack must have to be
//! product-grade (§7.5): it must DO something (actions or a §14 record_source),
//! and if it declares a record_source that source must be coherent enough for the
//! generic engine (`manifest_source`) to describe/query it.

use crate::kernel::manifest_source::{self, ManifestConnectorSource};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    /// Blocks install — the pack would not work.
    Error,
    /// Installs, but the author probably wants to fix it.
    Warn,
}

/// One machine-actionable finding (§14.11 error contract: what + where + how to
/// fix), so the authoring brain self-corrects rather than dumping a raw error.
#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub field: String,
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

impl Issue {
    fn error(field: &str, message: impl Into<String>, fix: &str) -> Issue {
        Issue { field: field.into(), severity: Severity::Error, message: message.into(), fix: Some(fix.into()) }
    }
    fn warn(field: &str, message: impl Into<String>, fix: &str) -> Issue {
        Issue { field: field.into(), severity: Severity::Warn, message: message.into(), fix: Some(fix.into()) }
    }
}

/// The evals report the gate returns to the authoring brain.
#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    /// True iff there are no `Error`-severity issues (warnings still allow install).
    pub ok: bool,
    pub issues: Vec<Issue>,
    /// When a coherent `record_source` is declared, the describe the generic
    /// engine would advertise — a positive eval (the §14 type layer resolves).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_source_fields: Option<usize>,
}

const ID_RE_HINT: &str = "id must be lowercase alphanumeric plus . - _ (e.g. ctrl-ghostfolio)";

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '.' | '-' | '_'))
}

/// Validate a candidate feature-pack manifest. Pure: same input → same report.
pub fn validate_manifest(manifest: &Value) -> ValidationReport {
    let mut issues = Vec::new();

    // ── id ────────────────────────────────────────────────────────────────
    match manifest.get("id").and_then(Value::as_str) {
        None => issues.push(Issue::error("id", "manifest has no id", ID_RE_HINT)),
        Some(id) if !valid_id(id) => {
            issues.push(Issue::error("id", format!("invalid id '{id}'"), ID_RE_HINT))
        }
        Some(_) => {}
    }

    // ── manifest_version ──────────────────────────────────────────────────
    if let Some(v) = manifest.get("manifest_version") {
        let ok = v.as_u64().map(|n| n == 1 || n == 2).unwrap_or(false);
        if !ok {
            issues.push(Issue::error(
                "manifest_version",
                "manifest_version must be 1 or 2",
                "set manifest_version to 2 for the current composition model",
            ));
        }
    }

    // ── a pack must DO something (§7.5 product-grade): actions or a source ──
    let has_actions = manifest
        .get("actions")
        .and_then(Value::as_array)
        .map(|a| !a.is_empty())
        .unwrap_or(false);
    let has_record_source = manifest.get("record_source").is_some();
    // A `server` block (mcp-server variant, ADR-002 §7 Pattern D) IS a
    // capability surface — its tools ARE what the pack does. A tools-only pack
    // (an Irisy-written service) must validate WITHOUT a fake action (bao
    // 2026-07-03: no hardcoded workaround to satisfy the validator).
    let has_server = manifest
        .get("server")
        .and_then(Value::as_object)
        .map(|o| o.get("command").and_then(Value::as_str).is_some_and(|c| !c.is_empty()))
        .unwrap_or(false);
    if !has_actions && !has_record_source && !has_server {
        issues.push(Issue::error(
            "actions",
            "a feature pack must declare a server (mcp-server tools), actions[], or a §14 record_source — otherwise it does nothing",
            "add a server{command,args} block, an actions[] entry, or a record_source declaration",
        ));
    }

    // ── §14 record_source coherence (the evals that make it product-grade) ──
    let mut record_source_fields = None;
    if has_record_source {
        match manifest_source::spec_from_manifest(manifest) {
            None => issues.push(Issue::error(
                "record_source",
                "record_source is present but could not be parsed (missing query/fields, or a bad type/operator enum)",
                "ensure query.endpoint + a non-empty fields[] with valid type/operator enum values",
            )),
            Some(spec) => {
                if spec.fields.is_empty() {
                    issues.push(Issue::error(
                        "record_source.fields",
                        "record_source declares no fields — the describe/query type layer would be empty",
                        "declare at least one field {key,label,type,from}",
                    ));
                }
                if spec.query.endpoint.trim().is_empty() {
                    issues.push(Issue::error(
                        "record_source.query.endpoint",
                        "record_source.query.endpoint is empty — nothing to fetch",
                        "set the read endpoint, e.g. /api/v1/portfolio/holdings",
                    ));
                }
                if let Some(p) = &spec.produce {
                    if p.body.is_empty() {
                        issues.push(Issue::error(
                            "record_source.produce.body",
                            "produce is declared with an empty body map — the write would send nothing",
                            "map at least one {field,from} into the request body",
                        ));
                    }
                }
                // Connector reads usually need auth — warn if none is declared.
                let has_auth = manifest.pointer("/auth/token_exchange").is_some()
                    || manifest.pointer("/auth/bootstrap").is_some()
                    || spec.token_exchange.is_some();
                if !has_auth {
                    issues.push(Issue::warn(
                        "auth",
                        "record_source has no auth (token_exchange/bootstrap) — a self-hosted connector usually needs one",
                        "add auth.token_exchange, or ignore if the endpoint is unauthenticated",
                    ));
                }
                // Positive eval: the §14 describe resolves (type layer coherent).
                if !spec.fields.is_empty() {
                    let describe = ManifestConnectorSource::describe_spec(&spec);
                    record_source_fields = Some(describe.fields.len());
                }
            }
        }
    }

    let ok = !issues.iter().any(|i| i.severity == Severity::Error);
    ValidationReport { ok, issues, record_source_fields }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ghostfolio_manifest() -> Value {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json"
        );
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    #[test]
    fn server_only_pack_validates_without_actions() {
        // A tools-only mcp-server pack (an Irisy-written service) is valid on
        // its server block alone — no fake action needed (bao 2026-07-03).
        let m = serde_json::json!({
            "id": "ctrl-stock-cn",
            "name": "A-Share Assistant",
            "version": "0.1.0",
            "server": { "command": "/x/uv", "args": ["run", "main.py"] }
        });
        let r = validate_manifest(&m);
        assert!(r.ok, "server-only pack should validate: {:?}", r.issues);
        // And a pack with none of {server, actions, record_source} still fails.
        let bare = serde_json::json!({"id": "ctrl-x", "name": "X", "version": "0.1.0"});
        assert!(!validate_manifest(&bare).ok);
    }

    #[test]
    fn real_ghostfolio_manifest_passes_with_a_positive_describe_eval() {
        let report = validate_manifest(&ghostfolio_manifest());
        assert!(report.ok, "shipped manifest should validate: {:?}", report.issues);
        // The §14 describe resolved to the six holding fields (positive eval).
        assert_eq!(report.record_source_fields, Some(6));
    }

    #[test]
    fn missing_id_and_no_action_or_source_are_errors() {
        let report = validate_manifest(&serde_json::json!({ "name": "x" }));
        assert!(!report.ok);
        assert!(report.issues.iter().any(|i| i.field == "id" && i.severity == Severity::Error));
        assert!(report.issues.iter().any(|i| i.field == "actions" && i.severity == Severity::Error));
    }

    #[test]
    fn bad_id_is_flagged() {
        let report = validate_manifest(&serde_json::json!({
            "id": "Not Valid ID", "actions": [{ "id": "a", "name": "A" }]
        }));
        assert!(!report.ok);
        assert!(report.issues.iter().any(|i| i.field == "id"));
    }

    #[test]
    fn actions_only_pack_is_valid() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-demo", "manifest_version": 2,
            "actions": [{ "id": "deploy", "name": "Deploy" }]
        }));
        assert!(report.ok, "issues: {:?}", report.issues);
        assert_eq!(report.record_source_fields, None);
    }

    #[test]
    fn record_source_without_fields_is_an_error() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-x", "manifest_version": 2,
            "record_source": { "query": { "endpoint": "/x" }, "fields": [] }
        }));
        assert!(!report.ok);
        // fields:[] parses to an empty Vec → trips the fields.is_empty() branch.
        assert!(report.issues.iter().any(|i| i.field.starts_with("record_source")));
    }

    #[test]
    fn record_source_without_auth_warns_but_still_ok() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-x", "manifest_version": 2,
            "record_source": {
                "query": { "endpoint": "/api/items", "array_at": "items" },
                "fields": [{ "key": "name", "label": "Name", "type": "text" }]
            }
        }));
        assert!(report.ok, "warnings should not block: {:?}", report.issues);
        assert!(report.issues.iter().any(|i| i.field == "auth" && i.severity == Severity::Warn));
        assert_eq!(report.record_source_fields, Some(1));
    }

    #[test]
    fn bad_operator_enum_fails_closed_as_a_record_source_error() {
        // 'bogus' is not a valid operator → serde parse fails → structured error,
        // never a silently-accepted manifest (§14.1 anti-hallucination).
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-x", "manifest_version": 2,
            "record_source": {
                "query": { "endpoint": "/x" },
                "operators": ["bogus"],
                "fields": [{ "key": "name", "label": "Name", "type": "text" }]
            }
        }));
        assert!(!report.ok);
        assert!(report.issues.iter().any(|i| i.field == "record_source"));
    }
}
