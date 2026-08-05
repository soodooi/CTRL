//! Feature-pack review and evals for the pack-authoring pipeline.
//!
//! Structural validation is compiled from the shipped draft-2020-12 schema.
//! This module adds only product/install semantics after that schema succeeds:
//! a pack must do something, a declared record source must project a positive
//! describe, and migration/auth concerns are surfaced as warnings.
//! (ADR-002 substrate § 7 v73)

// Manifest protocol: (ADR-002 substrate § 7 v73)
use crate::kernel::manifest_source::{self, ManifestConnectorSource};
use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;

// Manifest protocol: (ADR-002 substrate § 7 v73)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Error,
    Warn,
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
/// One machine-actionable finding (§14.11 error contract: what, where, and fix).
#[derive(Debug, Clone, Serialize)]
pub struct Issue {
    pub field: String,
    pub severity: Severity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
impl Issue {
    fn error(field: &str, message: impl Into<String>, fix: &str) -> Issue {
        Issue {
            field: field.into(),
            severity: Severity::Error,
            message: message.into(),
            fix: Some(fix.into()),
        }
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    fn warn(field: &str, message: impl Into<String>, fix: &str) -> Issue {
        Issue {
            field: field.into(),
            severity: Severity::Warn,
            message: message.into(),
            fix: Some(fix.into()),
        }
    }
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
#[derive(Debug, Clone, Serialize)]
pub struct ValidationReport {
    pub ok: bool,
    pub issues: Vec<Issue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record_source_fields: Option<usize>,
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
const MANIFEST_SCHEMA: &str =
    include_str!("../../../packages/ctrl-mcp-sdk/schema/manifest-v2.schema.json");

// Manifest protocol: (ADR-002 substrate § 7 v73)
fn manifest_validator() -> Result<&'static jsonschema::Validator, String> {
    static VALIDATOR: OnceLock<Result<jsonschema::Validator, String>> = OnceLock::new();
    VALIDATOR
        .get_or_init(|| {
            let schema: Value = serde_json::from_str(MANIFEST_SCHEMA)
                .map_err(|error| format!("embedded manifest schema is invalid JSON: {error}"))?;
            jsonschema::options()
                .with_draft(jsonschema::Draft::Draft202012)
                .build(&schema)
                .map_err(|error| format!("embedded manifest schema could not compile: {error}"))
        })
        .as_ref()
        .map_err(Clone::clone)
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
fn pointer_to_field(pointer: &str) -> String {
    pointer
        .trim_start_matches('/')
        .split('/')
        .filter(|part| !part.is_empty())
        .map(|part| part.replace("~1", "/").replace("~0", "~"))
        .collect::<Vec<_>>()
        .join(".")
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
fn required_property(message: &str) -> Option<&str> {
    message
        .strip_prefix('"')?
        .split_once("\" is a required property")
        .map(|(property, _)| property)
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
/// Apply only the shared structural protocol contract. Consumers may format
/// errors, but may not add field-shape rejection rules.
/// (ADR-002 substrate § 7 v73)
fn validate_schema(manifest: &Value) -> Vec<Issue> {
    let validator = match manifest_validator() {
        Ok(validator) => validator,
        Err(message) => {
            return vec![Issue::error(
                "$schema",
                message,
                "restore the shipped manifest schema and rebuild CTRL",
            )]
        }
    };

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    validator
        .iter_errors(manifest)
        .map(|error| {
            let message = error.to_string();
            let pointer = error.instance_path.to_string();
            let field = if pointer.is_empty() {
                required_property(&message).unwrap_or("$").to_owned()
            } else {
                pointer_to_field(&pointer)
            };
            Issue::error(
                &field,
                message,
                "make this value conform to manifest-v2.schema.json",
            )
        })
        .collect()
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
fn compatibility_warnings(manifest: &Value) -> Vec<Issue> {
    let mut warnings = Vec::new();
    if manifest.get("variant").and_then(Value::as_str) == Some("stss-publisher") {
        warnings.push(Issue::warn(
            "variant",
            "stss-publisher is retired compatibility data and has no live executor",
            "migrate the pack to a current variant or disable it",
        ));
    }
    if manifest.get("pattern").and_then(Value::as_str) == Some("F") {
        warnings.push(Issue::warn(
            "pattern",
            "Pattern F/ST-SS is retired compatibility data and has no live executor",
            "migrate the pack to a current execution pattern or disable it",
        ));
    }
    warnings
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
/// Validate a candidate manifest. Shared structure runs first and fails closed;
/// product semantics run only for structurally valid data.
pub fn validate_manifest(manifest: &Value) -> ValidationReport {
    let schema_issues = validate_schema(manifest);
    if !schema_issues.is_empty() {
        return ValidationReport {
            ok: false,
            issues: schema_issues,
            record_source_fields: None,
        };
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    let mut issues = compatibility_warnings(manifest);
    let has_actions = manifest.get("actions").is_some();
    let has_record_source = manifest.get("record_source").is_some();
    let has_server = manifest.get("server").is_some();

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    if !has_actions && !has_record_source && !has_server {
        issues.push(Issue::error(
            "actions",
            "a feature pack must declare a server, actions[], or a §14 record_source",
            "add a server block, an actions[] entry, or a record_source declaration",
        ));
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    let mut record_source_fields = None;
    if has_record_source {
        match manifest_source::spec_from_manifest(manifest) {
            None => issues.push(Issue::error(
                "record_source",
                "record_source is structurally valid but cannot project a connector describe",
                "align the connector projection with the governing manifest schema",
            )),
            Some(spec) => {
                let has_auth = manifest.pointer("/auth/token_exchange").is_some()
                    || manifest.pointer("/auth/bootstrap").is_some()
                    || spec.token_exchange.is_some();
                let is_http = matches!(
                    spec.query.transport(),
                    Ok(manifest_source::QueryTransport::Http(_))
                );
                if is_http && !has_auth {
                    issues.push(Issue::warn(
                        "auth",
                        "record_source has no auth declaration; a connector usually needs one",
                        "add auth.token_exchange, or ignore this warning for an unauthenticated endpoint",
                    ));
                }

                // Manifest protocol: (ADR-002 substrate § 7 v73)
                let describe = ManifestConnectorSource::describe_spec(&spec);
                if describe.fields.is_empty() {
                    issues.push(Issue::error(
                        "record_source.fields",
                        "record_source produced an empty connector describe",
                        "declare fields that project into the generic describe contract",
                    ));
                } else {
                    record_source_fields = Some(describe.fields.len());
                }
            }
        }
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    let ok = !issues.iter().any(|issue| issue.severity == Severity::Error);
    ValidationReport {
        ok,
        issues,
        record_source_fields,
    }
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
/// Reuse the same schema-first eval report at every install boundary.
/// (ADR-002 substrate § 7 v73)
pub fn validate_for_install(manifest: &Value) -> Result<(), ValidationReport> {
    let mut report = validate_manifest(manifest);
    let retired_variant = manifest.get("variant").and_then(Value::as_str) == Some("stss-publisher");
    let retired_pattern = manifest.get("pattern").and_then(Value::as_str) == Some("F");

    // Retired values remain readable for migration, but installation must not
    // make their actions reachable through the variant-agnostic runner.
    // (ADR-002 substrate § 7 v73)
    if report.ok && (retired_variant || retired_pattern) {
        report.ok = false;
        report.issues.push(Issue::error(
            if retired_variant {
                "variant"
            } else {
                "pattern"
            },
            "retired ST-SS manifests cannot be installed or executed",
            "migrate the manifest to a current variant and execution pattern",
        ));
    }

    if report.ok {
        Ok(())
    } else {
        Err(report)
    }
}

// Manifest protocol: (ADR-002 substrate § 7 v73)
#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;
    use std::path::PathBuf;

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ConformanceCase {
        name: String,
        file: Option<String>,
        input: Option<Value>,
        valid: bool,
        #[serde(default)]
        warning_paths: Vec<String>,
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[derive(Deserialize)]
    struct ConformanceCorpus {
        cases: Vec<ConformanceCase>,
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    fn repository_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .to_path_buf()
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    fn ghostfolio_manifest() -> Value {
        let path =
            repository_root().join("packages/ctrl-mcps/builtin/ctrl-ghostfolio/manifest.json");
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn shared_conformance_corpus_matches_the_embedded_schema() {
        let path = repository_root().join("packages/ctrl-mcp-sdk/schema/manifest-conformance.json");
        let corpus: ConformanceCorpus =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();

        // Manifest protocol: (ADR-002 substrate § 7 v73)
        for test_case in corpus.cases {
            let input = match (test_case.file, test_case.input) {
                (Some(file), _) => {
                    serde_json::from_slice(&std::fs::read(repository_root().join(file)).unwrap())
                        .unwrap()
                }
                (None, Some(input)) => input,
                (None, None) => panic!("conformance case has no input: {}", test_case.name),
            };
            let schema_issues = validate_schema(&input);
            assert_eq!(
                schema_issues.is_empty(),
                test_case.valid,
                "conformance mismatch for {}: {:?}",
                test_case.name,
                schema_issues
            );
            if test_case.valid {
                let warning_paths = compatibility_warnings(&input)
                    .into_iter()
                    .map(|issue| issue.field)
                    .collect::<Vec<_>>();
                assert_eq!(warning_paths, test_case.warning_paths, "{}", test_case.name);
            }
        }
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn server_only_pack_validates_without_actions() {
        let manifest = serde_json::json!({
            "id": "ctrl-stock-cn",
            "name": "A-Share Assistant",
            "version": "0.1.0",
            "variant": "mcp-server",
            "server": { "type": "local", "command": "/x/uv", "args": ["run", "main.py"] }
        });
        let report = validate_manifest(&manifest);
        assert!(
            report.ok,
            "server-only pack should validate: {:?}",
            report.issues
        );
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn legacy_server_forms_remain_readable() {
        let implicit_local = serde_json::json!({
            "id": "ctrl-legacy", "variant": "mcp-server",
            "server": { "command": "uv", "args": ["run"] }
        });
        assert!(validate_manifest(&implicit_local).ok);

        // Manifest protocol: (ADR-002 substrate § 7 v73)
        let code_backed = serde_json::json!({
            "id": "ctrl-legacy-code", "variant": "mcp-server",
            "actions": [{ "id": "a", "name": "A" }]
        });
        assert!(validate_manifest(&code_backed).ok);
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn real_ghostfolio_manifest_passes_with_a_positive_describe_eval() {
        let report = validate_manifest(&ghostfolio_manifest());
        assert!(
            report.ok,
            "shipped manifest should validate: {:?}",
            report.issues
        );
        assert_eq!(report.record_source_fields, Some(6));
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn missing_id_fails_shared_schema_validation() {
        let report = validate_manifest(&serde_json::json!({ "name": "x" }));
        assert!(!report.ok);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.severity == Severity::Error));
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn actions_only_pack_is_valid() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-demo", "manifest_version": 2,
            "actions": [{ "id": "deploy", "name": "Deploy" }]
        }));
        assert!(report.ok, "issues: {:?}", report.issues);
        assert_eq!(report.record_source_fields, None);
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn bare_pack_fails_product_semantics() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-x", "name": "X", "version": "0.1.0"
        }));
        assert!(!report.ok);
        assert!(report.issues.iter().any(|issue| issue.field == "actions"));
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn record_source_without_auth_warns_but_still_passes() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-x", "manifest_version": 2,
            "record_source": {
                "query": { "endpoint": "/api/items", "array_at": "items" },
                "fields": [{ "key": "name", "label": "Name", "type": "text" }]
            }
        }));
        assert!(report.ok, "warnings should not block: {:?}", report.issues);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.field == "auth" && issue.severity == Severity::Warn));
        assert_eq!(report.record_source_fields, Some(1));
    }

    #[test]
    fn local_mcp_record_source_does_not_require_http_auth() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-libreoffice",
            "manifest_version": 2,
            "variant": "mcp-server",
            "server": { "command": "node", "args": ["${PACK_DIR}/server.mjs"] },
            "record_source": {
                "query": { "mcp_tool": "read_selected_context", "array_at": "rows" },
                "fields": [{ "key": "content", "label": "Content", "type": "text" }]
            }
        }));
        assert!(report.ok, "issues: {:?}", report.issues);
        assert!(!report.issues.iter().any(|issue| issue.field == "auth"));
        assert_eq!(report.record_source_fields, Some(1));
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn retired_values_warn_without_restoring_an_executor() {
        let report = validate_manifest(&serde_json::json!({
            "id": "ctrl-retired", "variant": "stss-publisher", "pattern": "F",
            "actions": [{ "id": "inspect", "name": "Inspect" }]
        }));
        assert!(report.ok);
        assert!(report.issues.iter().any(|issue| issue.field == "variant"));
        assert!(report.issues.iter().any(|issue| issue.field == "pattern"));
    }

    // Manifest protocol: (ADR-002 substrate § 7 v73)
    #[test]
    fn retired_values_are_blocked_at_the_install_boundary() {
        let manifest = serde_json::json!({
            "id": "ctrl-retired", "variant": "stss-publisher", "pattern": "F",
            "actions": [{ "id": "inspect", "name": "Inspect" }]
        });
        let report = validate_for_install(&manifest).unwrap_err();
        assert!(!report.ok);
        assert!(report.issues.iter().any(|issue| {
            issue.severity == Severity::Error && issue.message.contains("cannot be installed")
        }));
    }
}
