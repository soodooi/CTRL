//! Canonical smart-table Resource — `ctrl://local/table/<table note>`.
//!
//! A cell change went through `smart_table_produce`, which answers with
//! "produce set_cell on tables/x.md". A caller could not learn the previous
//! value, could not condition the write on the table it had read, and could not
//! tell a committed write from one that silently did nothing. This owner gives a
//! cell edit the same contract every other write has: staged before/after, a
//! revision precondition, and a verified effect.
//!
//! Only cell edits are offered here. Adding, retyping, and dropping a column
//! change the table's schema, which needs its own staged form and its own
//! frontmatter patch path; those stay on the existing tool until they get one.
//! (ADR-002 substrate §15.2 v87; ADR-002 substrate §15.5 v86)

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;

use super::query::{ProduceOp, QuerySource, RecordSink, Row};
use super::record_write;
use super::resource::{
    OperationRecoveryPolicy, Outcome, PresentationHints, ProduceOperationDescriptor, QueryContract,
    ResourceAccessContext, ResourceDegradation, ResourceDescriptor, ResourceError,
    ResourceFreshness, ResourceOwner, ResourceRef, ResourceUnavailableReason,
};
use super::vault_smart_table::SmartTable;

const SET_CELL: &str = "set_cell";

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TableOperation {
    SetCell {
        expected_revision: String,
        /// Row index in `query` order.
        row: usize,
        field: String,
        value: String,
    },
}

pub struct TableResourceOwner {
    root: Option<PathBuf>,
    /// Recovery points live outside the user's content tree; injectable so tests
    /// do not write to the real state directory.
    /// (ADR-002 substrate §15.2 v87 clause 3)
    recovery_root: Option<PathBuf>,
}

struct OpenedTable {
    path: String,
    revision: String,
    table: SmartTable,
    frontmatter: Value,
    /// The note's exact bytes as they were read, so an undo puts the table back
    /// rather than re-rendering its frontmatter schema.
    /// (ADR-002 substrate §15.2 v87 clause 6)
    raw: String,
}

impl TableResourceOwner {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: Some(root),
            recovery_root: record_write::default_recovery_root(),
        }
    }

    pub fn from_default_vault() -> Self {
        Self {
            root: super::vault::default_vault_root(),
            recovery_root: record_write::default_recovery_root(),
        }
    }

    pub fn with_recovery_root(mut self, recovery_root: PathBuf) -> Self {
        self.recovery_root = Some(recovery_root);
        self
    }

    fn root(&self) -> Result<&std::path::Path, ResourceError> {
        self.root.as_deref().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })
    }

    fn table_path(resource: &ResourceRef) -> Result<String, ResourceError> {
        if resource.authority() != super::resource::ResourceAuthority::Local
            || resource.kind() != "table"
        {
            return Err(ResourceError::OwnerNotFound);
        }
        let segments = resource.id_segments();
        if segments.is_empty()
            || segments
                .iter()
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        {
            return Err(ResourceError::InvalidPayload {
                message: "a table ref names one table note inside the vault".to_owned(),
            });
        }
        Ok(segments.join("/"))
    }

    /// Serialize against note writes and the bespoke table tool through the same
    /// per-note lock. (ADR-002 substrate §15.2 v87 clause 7)
    fn write_lock(path: &str) -> Arc<tokio::sync::Mutex<()>> {
        super::vault_write_lock::for_path(path)
    }

    fn read(&self, resource: &ResourceRef) -> Result<OpenedTable, ResourceError> {
        let path = Self::table_path(resource)?;
        let unavailable = || ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: true,
        };
        let entry = super::vault::read(self.root()?, &path).map_err(|_| unavailable())?;
        // A table lives in both halves of the note — the schema in frontmatter, the
        // rows in the body — so the revision is the whole file. These are also the
        // only bytes an undo can restore, so they are required, not best-effort.
        let raw = super::vault::read_raw(self.root()?, &path).map_err(|_| unavailable())?;
        let revision = format!("{:x}", Sha256::digest(raw.as_bytes()));
        if resource
            .revision()
            .is_some_and(|expected| expected != revision)
        {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::RevisionUnavailable,
                retryable: false,
            });
        }
        Ok(OpenedTable {
            table: SmartTable::parse(&entry.frontmatter, &entry.content),
            frontmatter: entry.frontmatter,
            raw,
            path,
            revision,
        })
    }

    fn cell(row: Option<&Row>, field: &str) -> String {
        record_write::display(
            row.and_then(|row| row.get(field))
                .map(String::as_str)
                .unwrap_or_default(),
        )
    }

    /// What the reviewer is told the change is happening to. A row's first text
    /// cell is the closest thing a table has to a name; falling back to the row
    /// number is honest rather than inventing a label.
    fn row_label(table: &SmartTable, index: usize) -> String {
        let Some(row) = table.rows().get(index) else {
            return format!("row {}", index + 1);
        };
        table
            .describe()
            .fields
            .iter()
            .find_map(|field| {
                row.get(&field.key)
                    .filter(|value| !value.trim().is_empty())
                    .cloned()
            })
            .unwrap_or_else(|| format!("row {}", index + 1))
    }

    fn parse(operation: Value) -> Result<TableOperation, ResourceError> {
        serde_json::from_value(operation).map_err(|error| ResourceError::InvalidPayload {
            message: error.to_string(),
        })
    }

    /// A markdown table row is one line, so a value carrying a newline truncates
    /// its cell and leaves the remainder as a stray line that corrupts the table.
    /// Refused before anything is written rather than written and rolled back.
    /// (ADR-002 substrate §15.5.2 v86)
    fn refuse_unstorable(
        table: &SmartTable,
        row: usize,
        field: &str,
        value: &str,
    ) -> Result<String, ResourceError> {
        table
            .normalized_cell_value(row, field, value)
            .ok_or_else(|| ResourceError::InvalidPayload {
                message: format!(
                    "that value cannot be stored in {field}: a table row is a single line with \
                     pipe-separated cells, so {value:?} would not read back as written"
                ),
            })
    }
}

/// Tables are notes in the user's vault, so the vault grant governs them.
/// (ADR-002 substrate §17 v85)
fn authorize(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "vault" | "notes" | "smart_table"))
    {
        Ok(())
    } else {
        Err(ResourceError::Denied)
    }
}

fn invalid(error: serde_json::Error) -> ResourceError {
    ResourceError::InvalidPayload {
        message: error.to_string(),
    }
}

#[async_trait]
impl ResourceOwner for TableResourceOwner {
    async fn describe(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError> {
        authorize(context)?;
        let opened = self.read(resource)?;
        let described = opened.table.describe();
        Ok(ResourceDescriptor {
            protocol_version: "1.0.0".to_owned(),
            resource: resource.clone(),
            content_type: "application/json".to_owned(),
            provenance: format!("ctrl://local/note/{}", opened.path)
                .parse::<ResourceRef>()
                .ok()
                .into_iter()
                .collect(),
            freshness: ResourceFreshness {
                observed_at: None,
                revision: Some(opened.revision),
                stale: false,
            },
            degradation: None::<ResourceDegradation>,
            presentation: PresentationHints {
                viewer: Some("smart-table".to_owned()),
                title: resource.id_segments().last().cloned(),
                preferred_columns: described
                    .fields
                    .iter()
                    .map(|field| field.key.clone())
                    .collect(),
            },
            query: QueryContract {
                request_schema: record_write::empty_request_schema(),
                result_schema: record_write::rows_result_schema(),
                watchable: false,
            },
            produce: vec![ProduceOperationDescriptor {
                kind: SET_CELL.to_owned(),
                input_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "required": ["kind", "expected_revision", "row", "field", "value"],
                    "properties": {
                        "kind": { "const": SET_CELL },
                        "expected_revision": { "type": "string", "minLength": 1 },
                        "row": { "type": "integer", "minimum": 0 },
                        "field": { "type": "string", "minLength": 1 },
                        "value": { "type": "string" }
                    },
                    "additionalProperties": false
                }),
                result_schema: record_write::outcome_schema(),
                review_required: true,
                recovery: OperationRecoveryPolicy::RestartRecoveryUnsupported,
                retention_seconds: 0,
            }],
        })
    }

    async fn query(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        _request: Value,
    ) -> Result<Value, ResourceError> {
        authorize(context)?;
        let opened = self.read(resource)?;
        let described = opened.table.describe();
        Ok(json!({
            "resource": resource,
            "revision": opened.revision,
            "match_count": opened.table.rows().len(),
            "rows": opened.table.rows(),
            "fields": described.fields,
        }))
    }

    async fn stage(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Outcome, ResourceError> {
        authorize(context)?;
        let TableOperation::SetCell {
            expected_revision,
            row,
            field,
            value,
        } = Self::parse(operation)?;
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            return Ok(record_write::precondition_failed(
                resource,
                "table",
                &expected_revision,
                &opened.revision,
            ));
        }
        if opened.table.rows().get(row).is_none() {
            return Err(ResourceError::InvalidPayload {
                message: format!(
                    "row {row} is past the end of this table ({} rows)",
                    opened.table.rows().len()
                ),
            });
        }
        Self::refuse_unstorable(&opened.table, row, &field, &value)?;
        // Stage the value as it will be STORED, so the reviewer approves what will
        // actually land rather than the raw request.
        let stored = Self::refuse_unstorable(&opened.table, row, &field, &value)?;
        Ok(Outcome::staged(
            resource.clone(),
            Self::row_label(&opened.table, row),
            format!("{field}: {}", Self::cell(opened.table.rows().get(row), &field)),
            format!("{field}: {}", record_write::display(&stored)),
        )
        .with_precondition("Revision", opened.revision))
    }

    async fn produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Value, ResourceError> {
        authorize(context)?;
        let TableOperation::SetCell {
            expected_revision,
            row,
            field,
            value,
        } = Self::parse(operation)?;
        let path = Self::table_path(resource)?;

        let lock = Self::write_lock(&path);
        let _guard = lock.lock().await;

        // Clause 2: recheck through a fresh read immediately before mutating. A row
        // index means a different row once the table has changed, which is exactly
        // what this catches.
        let mut opened = self.read(resource)?;
        if expected_revision != opened.revision {
            let outcome = record_write::precondition_failed(
                resource,
                "table",
                &expected_revision,
                &opened.revision,
            );
            return serde_json::to_value(outcome).map_err(invalid);
        }
        let target = Self::row_label(&opened.table, row);
        // Refuse a value the format cannot hold before writing anything. `stored` is
        // what actually goes in the cell; `expected` is only its rendering for
        // comparison and for the reply, where an empty value reads as "(none)".
        let stored = Self::refuse_unstorable(&opened.table, row, &field, &value)?;
        let expected = record_write::display(&stored);

        // Clause 3: previous bytes on disk before the table is touched.
        let recovery = record_write::RecoveryPoint::capture(
            self.recovery_root.as_deref(),
            self.root()?,
            resource,
            &opened.raw,
        )?;

        // The table validates the field and the row itself: a computed column is
        // read-only and an unknown key is refused, and reusing that keeps one
        // validator rather than a second that could disagree.
        opened
            .table
            .produce(ProduceOp::SetCell {
                row,
                field: field.clone(),
                // Store the form that was verified and staged, not the raw request:
                // a cell is trimmed on read, so writing the padding would leave the
                // file carrying bytes that no reader ever returns.
                value: stored.clone(),
            })
            .map_err(|error| ResourceError::InvalidPayload {
                message: error.to_string(),
            })?;

        // A cell edit touches rows only, so frontmatter is written back untouched
        // and every column keeps its render-level type and any extra keys.
        super::vault::write(
            self.root()?,
            &path,
            &opened.table.serialize_body(),
            &opened.frontmatter,
        )
        .map_err(|_| ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: true,
        })?;

        // Clause 5: reread and confirm the cell carries the new value. A reread
        // that fails is reported as written-but-unverified rather than as an
        // unreadable resource, because the change is already on disk; nothing is
        // rolled back, since the current state is unknown. `expected` is the STORED
        // form, computed above.
        //
        // Unpinned: the write has moved the revision off any `?rev=` the caller
        // sent, so rereading through the pinned ref would fail its own precondition
        // and report a write that landed as unverified.
        let unpinned = resource.without_revision();
        let committed = match self.read(&unpinned) {
            Ok(committed) => committed,
            Err(_) => {
                let mut outcome = record_write::write_unverified(
                    resource,
                    Some(target),
                    &field,
                    &expected,
                    None,
                );
                if let Some(feedback) = outcome.feedback.as_mut() {
                    // The change is on disk and unverifiable, so the copy is the only
                    // way back: keep it and say where it is.
                    recovery.retain();
                    feedback
                        .details
                        .insert("recovery_point".to_owned(), json!(recovery.location()));
                }
                return serde_json::to_value(outcome).map_err(invalid);
            }
        };
        let observed = Self::cell(committed.table.rows().get(row), &field);
        if observed != expected {
            // Clause 6: put the table back byte for byte, body and frontmatter
            // together, then report the rollback.
            let restored = super::vault::restore_raw(self.root()?, &path, &opened.raw).is_ok();
            let outcome = record_write::write_rolled_back(
                resource,
                Some(target),
                &field,
                &expected,
                Some(observed),
                restored,
                Some(&recovery),
            );
            return serde_json::to_value(outcome).map_err(invalid);
        }

        let outcome = Outcome {
            resource: resource.clone(),
            target: Some(target),
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: Some(json!({
                "revision": committed.revision,
                "row": committed.table.rows().get(row),
            })),
        }
        .with_precondition("Revision", expected_revision)
        .committed(
            format!("set {field} on this row"),
            Some("post-write reread returned the new value".to_owned()),
        );
        debug_assert!(outcome.is_verified_success());
        recovery.discard();
        serde_json::to_value(outcome).map_err(invalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PATH: &str = "tables/budget.md";

    /// A minimal smart table: schema in frontmatter, rows in the body.
    const TABLE: &str = "---\nschema:\n  - key: item\n    label: Item\n    type: text\n  - key: amount\n    label: Amount\n    type: number\n  - key: status\n    label: Status\n    type: select\n    options: [open, paid]\n---\n\n| Item | Amount | Status |\n| --- | --- | --- |\n| Rent | 1200 | open |\n| Coffee | 40 | paid |\n";

    fn owner() -> (TableResourceOwner, tempfile::TempDir) {
        let root = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(root.path().join("tables")).expect("tables dir");
        std::fs::write(root.path().join(PATH), TABLE).expect("write table");
        (
            TableResourceOwner::new(root.path().to_path_buf())
                .with_recovery_root(root.path().join("recovery")),
            root,
        )
    }

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["vault".to_owned()],
        }
    }

    fn reference() -> ResourceRef {
        format!("ctrl://local/table/{PATH}").parse().expect("valid ref")
    }

    fn set_cell(revision: &str, row: usize, field: &str, value: &str) -> Value {
        json!({
            "kind": SET_CELL,
            "expected_revision": revision,
            "row": row,
            "field": field,
            "value": value
        })
    }

    async fn revision_of(owner: &TableResourceOwner) -> String {
        owner
            .describe(&context(), &reference())
            .await
            .expect("describe")
            .freshness
            .revision
            .expect("a revision")
    }

    #[tokio::test]
    async fn describe_advertises_one_bounded_cell_write_and_the_table_columns() {
        let (owner, _root) = owner();
        let descriptor = owner.describe(&context(), &reference()).await.expect("describe");
        assert_eq!(descriptor.produce.len(), 1);
        assert_eq!(descriptor.produce[0].kind, SET_CELL);
        assert!(descriptor.produce[0].review_required);
        assert_eq!(descriptor.presentation.viewer.as_deref(), Some("smart-table"));
        assert!(descriptor
            .presentation
            .preferred_columns
            .contains(&"amount".to_owned()));
        assert_eq!(
            descriptor
                .provenance
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec![format!("ctrl://local/note/{PATH}")]
        );
    }

    #[tokio::test]
    async fn query_returns_the_rows_and_the_field_layer() {
        let (owner, _root) = owner();
        let reply = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        assert_eq!(reply["match_count"], json!(2));
        assert_eq!(reply["rows"][0]["item"], json!("Rent"));
        assert_eq!(reply["rows"][1]["status"], json!("paid"));
        // The type layer travels with the read, so a surface does not guess it.
        assert!(reply["fields"].as_array().expect("fields").len() >= 3);
    }

    #[tokio::test]
    async fn setting_a_cell_writes_it_and_verifies_the_new_value() {
        let (owner, root) = owner();
        let revision = revision_of(&owner).await;
        let outcome = owner
            .produce(&context(), &reference(), set_cell(&revision, 0, "status", "paid"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(outcome.is_verified_success());
        // The row is named by its own content, not by a bare index.
        assert_eq!(outcome.target.as_deref(), Some("Rent"));

        let text = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        assert!(text.contains("| Rent | 1200 | paid |"), "got: {text}");
        // The other row and the schema are untouched: a cell edit is not a
        // table rewrite.
        assert!(text.contains("| Coffee | 40 | paid |"));
        assert!(text.contains("key: amount"));
        assert!(text.contains("options: [open, paid]") || text.contains("- open"));
    }

    #[tokio::test]
    async fn staging_reports_the_cell_before_and_after_without_writing() {
        let (owner, root) = owner();
        let revision = revision_of(&owner).await;
        let outcome = owner
            .stage(&context(), &reference(), set_cell(&revision, 0, "amount", "1300"))
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("review facts");
        assert_eq!(facts.target.as_deref(), Some("Rent"));
        assert_eq!(facts.before, "amount: 1200");
        assert_eq!(facts.after, "amount: 1300");
        let text = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        assert!(text.contains("1200"), "staging must not write");
    }

    /// A row index means a different row once the table has changed.
    #[tokio::test]
    async fn a_stale_revision_writes_nothing_and_reports_the_current_one() {
        let (owner, root) = owner();
        let stale = revision_of(&owner).await;
        std::fs::write(
            root.path().join(PATH),
            TABLE.replace("| Rent | 1200 | open |", "| Insurance | 90 | open |\n| Rent | 1200 | open |"),
        )
        .expect("rewrite");

        let outcome = owner
            .produce(&context(), &reference(), set_cell(&stale, 0, "status", "paid"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert_eq!(
            outcome.feedback.clone().expect("feedback").code,
            "precondition_failed"
        );
        assert!(!outcome.is_verified_success());
        let text = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        assert!(
            text.contains("| Insurance | 90 | open |"),
            "the inserted row is untouched"
        );
        assert!(text.contains("| Rent | 1200 | open |"), "nothing was written");
    }

    #[tokio::test]
    async fn a_row_past_the_end_is_refused_with_the_real_row_count() {
        let (owner, _root) = owner();
        let revision = revision_of(&owner).await;
        match owner
            .stage(&context(), &reference(), set_cell(&revision, 9, "status", "paid"))
            .await
        {
            Err(ResourceError::InvalidPayload { message }) => {
                assert!(message.contains("2 rows"), "states the real count: {message}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    /// A table row is a single line, so a value carrying a newline would truncate
    /// its cell and leave the remainder as a stray line — corrupting the table, not
    /// just the cell. Refused before anything is written.
    /// (ADR-002 substrate §15.5.2 v86)
    #[tokio::test]
    async fn a_value_that_would_break_the_row_is_refused_before_anything_is_written() {
        let (owner, root) = owner();
        let before = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        let revision = revision_of(&owner).await;
        for value in ["multi\nline", "two\nrows\nhere"] {
            let result = owner
                .produce(&context(), &reference(), set_cell(&revision, 0, "item", value))
                .await;
            match result {
                Err(ResourceError::InvalidPayload { message }) => {
                    assert!(message.contains("item"), "names the column: {message}");
                }
                other => panic!("expected a refusal for {value:?}, got {other:?}"),
            }
        }
        assert_eq!(
            std::fs::read_to_string(root.path().join(PATH)).expect("table"),
            before,
            "the table is untouched"
        );
    }

    /// A cell is trimmed on read, so a padded value stores trimmed. That is a
    /// correct write, and staging must show what will actually land.
    #[tokio::test]
    async fn a_padded_value_stages_and_verifies_as_its_stored_form() {
        let (owner, root) = owner();
        let revision = revision_of(&owner).await;
        let staged = owner
            .stage(&context(), &reference(), set_cell(&revision, 0, "status", "  paid  "))
            .await
            .expect("stage");
        assert_eq!(
            staged.review_facts().expect("facts").after,
            "status: paid",
            "the reviewer sees the value that will actually be stored"
        );

        let outcome = owner
            .produce(&context(), &reference(), set_cell(&revision, 0, "status", "  paid  "))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(
            outcome.is_verified_success(),
            "a trimmed value is still what was asked for: {:?}",
            outcome.feedback
        );
        let text = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        assert!(text.contains("| Rent | 1200 | paid |"), "got: {text}");
    }

    /// A pipe is escaped on write and unescaped on read, so it round-trips and must
    /// not be refused — and it must not split the cell.
    #[tokio::test]
    async fn a_cell_value_containing_a_pipe_survives_the_round_trip() {
        let (owner, root) = owner();
        let revision = revision_of(&owner).await;
        let outcome = owner
            .produce(&context(), &reference(), set_cell(&revision, 0, "item", "Rent | June"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(outcome.is_verified_success(), "{:?}", outcome.feedback);

        let reply = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        assert_eq!(reply["rows"][0]["item"], json!("Rent | June"));
        // The neighbouring cells are intact: the pipe did not split the row.
        assert_eq!(reply["rows"][0]["amount"], json!("1200"));
        assert_eq!(reply["match_count"], json!(2), "still two rows");
        let text = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        assert!(text.contains(r"Rent \| June"), "escaped on disk: {text}");
    }

    #[tokio::test]
    async fn an_unknown_column_is_refused_rather_than_created_as_a_cell() {
        let (owner, root) = owner();
        let revision = revision_of(&owner).await;
        let result = owner
            .produce(&context(), &reference(), set_cell(&revision, 0, "vendor", "Acme"))
            .await;
        assert!(matches!(result, Err(ResourceError::InvalidPayload { .. })));
        let text = std::fs::read_to_string(root.path().join(PATH)).expect("table");
        assert!(!text.contains("Acme"), "nothing was written");
    }

    /// Schema changes are not offered here, so a column op must not slip through
    /// as if it were a cell edit.
    #[tokio::test]
    async fn a_column_operation_is_not_accepted_by_this_owner() {
        let (owner, _root) = owner();
        assert!(matches!(
            owner
                .produce(
                    &context(),
                    &reference(),
                    json!({ "kind": "add_field", "key": "vendor", "label": "Vendor", "type": "text" })
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
    }

    #[tokio::test]
    async fn a_caller_without_the_vault_grant_is_denied() {
        let (owner, _root) = owner();
        let denied = ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["web".to_owned()],
        };
        assert!(matches!(
            owner.describe(&denied, &reference()).await,
            Err(ResourceError::Denied)
        ));
        assert!(matches!(
            owner
                .produce(&denied, &reference(), set_cell("x", 0, "status", "paid"))
                .await,
            Err(ResourceError::Denied)
        ));
    }

    #[tokio::test]
    async fn a_traversing_table_ref_is_refused() {
        let (owner, _root) = owner();
        for id in ["..", "tables/../../etc/passwd"] {
            let Ok(resource) = format!("ctrl://local/table/{id}").parse::<ResourceRef>() else {
                continue;
            };
            assert!(
                matches!(
                    owner.describe(&context(), &resource).await,
                    Err(ResourceError::InvalidPayload { .. })
                ),
                "id {id:?} must be refused"
            );
        }
    }
}
