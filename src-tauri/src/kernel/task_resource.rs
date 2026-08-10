//! Canonical task Resource — `ctrl://local/task/<note path>`.
//!
//! Tasks were writable only through bespoke tools that returned a sentence:
//! "updated Inbox.md line 4 field status". A caller could not tell what the value
//! had been, what it became, whether the note had moved underneath it, or whether
//! the write was verified — so a surface either trusted it blindly or reprinted
//! the sentence. This owner makes a note's task list a Resource with the same
//! contract every other write has: staged before/after, revision precondition,
//! atomic commit, post-write reread, typed Outcome.
//!
//! One Resource is one note's tasks, because a task's real identity in Markdown
//! is its note plus its line — there is no id to address it by, and a task list
//! that spanned notes could not carry a single revision.
//! (ADR-002 substrate §15.2 v87; ADR-002 substrate §15.5 v86)

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;

use super::record_write;
use super::resource::{
    OperationRecoveryPolicy, Outcome, PresentationHints, ProduceOperationDescriptor, QueryContract,
    ResourceAccessContext, ResourceDegradation, ResourceDescriptor, ResourceError,
    ResourceFreshness, ResourceOwner, ResourceRef, ResourceUnavailableReason,
};
use super::tasks_source::{self, TaskItem};

const SET_FIELD: &str = "set_field";
/// The fields a checkbox line actually carries. Anything else is refused rather
/// than written as an unknown token the parser would not read back.
const FIELDS: [&str; 4] = ["status", "due", "title", "tags"];

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum TaskOperation {
    SetField {
        expected_revision: String,
        /// 0-based line index within the note, as reported by `query`.
        line: usize,
        field: String,
        value: String,
    },
}

pub struct TaskResourceOwner {
    root: Option<PathBuf>,
    /// Recovery points live beneath the kernel-managed derivative state root,
    /// never inside the user's content tree. Injectable so tests do not write to
    /// the developer's real state directory. (ADR-002 substrate §15.2 v87 clause 3)
    recovery_root: Option<PathBuf>,
}

struct OpenedTasks {
    note: String,
    revision: String,
    items: Vec<TaskItem>,
    /// The note's exact bytes as they were read. Held so a write that does not
    /// verify can be undone without reformatting anything.
    /// (ADR-002 substrate §15.2 v87 clause 6)
    raw: String,
}

impl TaskResourceOwner {
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

    /// Explicit recovery root; it must never point inside the vault.
    pub fn with_recovery_root(mut self, recovery_root: PathBuf) -> Self {
        self.recovery_root = Some(recovery_root);
        self
    }

    /// The note this ref addresses, as a vault-relative path.
    fn note_path(resource: &ResourceRef) -> Result<String, ResourceError> {
        if resource.authority() != super::resource::ResourceAuthority::Local
            || resource.kind() != "task"
        {
            return Err(ResourceError::OwnerNotFound);
        }
        let segments = resource.id_segments();
        if segments.is_empty() {
            return Err(ResourceError::InvalidPayload {
                message: "a task ref names the note holding the tasks".to_owned(),
            });
        }
        // No segment may climb out of the vault. The ref grammar already rejects
        // most of this; refusing here keeps the guarantee local to the owner.
        if segments
            .iter()
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        {
            return Err(ResourceError::InvalidPayload {
                message: "that task ref does not name a note inside the vault".to_owned(),
            });
        }
        Ok(segments.join("/"))
    }

    /// Serialize against note writes and the bespoke task tools through the same
    /// process-wide per-note lock, or a concurrent write loses an update.
    /// (ADR-002 substrate §15.2 v87 clause 7)
    fn write_lock(note: &str) -> Arc<tokio::sync::Mutex<()>> {
        super::vault_write_lock::for_path(note)
    }

    fn root(&self) -> Result<&std::path::Path, ResourceError> {
        self.root
            .as_deref()
            .ok_or(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::OwnerUnavailable,
                retryable: false,
            })
    }

    /// Read the note and the tasks in it. The revision covers the whole note,
    /// because any edit to it can move the line a task lives on.
    fn read(&self, resource: &ResourceRef) -> Result<OpenedTasks, ResourceError> {
        let note = Self::note_path(resource)?;
        // A note that is not there is a different answer from a vault that cannot
        // be read: reporting the first as retryable would tell the caller to keep
        // asking for something that does not exist.
        let unavailable = |missing: bool| ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: !missing,
        };
        let note_exists = self.root()?.join(&note).exists();
        let unavailable = move || unavailable(!note_exists);
        let entry = super::vault::read(self.root()?, &note).map_err(|_| unavailable())?;
        // The exact bytes are required, not best-effort: they are both the
        // revision and the only thing an undo can restore. Defaulting to an empty
        // string would let a note that vanished between the two reads produce an
        // empty recovery point and a rollback that truncates the file.
        let raw = super::vault::read_raw(self.root()?, &note).map_err(|_| unavailable())?;
        // Hash the whole note, not just the body: a frontmatter-only edit must
        // fail the precondition too, or the message "the note changed since it was
        // read" would be broader than what is actually checked.
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
        Ok(OpenedTasks {
            items: tasks_source::scan_tasks(&note, &entry.content),
            raw,
            note,
            revision,
        })
    }

    fn row(item: &TaskItem) -> Value {
        json!({
            "line": item.line,
            "title": item.title,
            "status": item.status,
            "due": item.due,
            "done": item.done,
            "tags": item.tags,
        })
    }

    /// The current value of the field being changed, as the reviewer needs to see
    /// it. Rendered through the shared display rule so an empty field reads the
    /// same here as in every other record write.
    fn field_value(item: &TaskItem, field: &str) -> String {
        record_write::display(&match field {
            "status" => item.status.clone(),
            "due" => item.due.clone(),
            "title" => item.title.clone(),
            "tags" => item.tags.join(" "),
            _ => String::new(),
        })
    }

    fn find<'a>(
        opened: &'a OpenedTasks,
        line: usize,
    ) -> Result<&'a TaskItem, ResourceError> {
        opened
            .items
            .iter()
            .find(|item| item.line == line)
            .ok_or_else(|| ResourceError::InvalidPayload {
                message: format!("line {line} of {} is not a task", opened.note),
            })
    }

    fn staged(
        resource: &ResourceRef,
        opened: &OpenedTasks,
        item: &TaskItem,
        field: &str,
        value: &str,
    ) -> Outcome {
        // The value as it will be STORED: the writer normalizes status synonyms and
        // tag lists, so showing the raw request would ask the reviewer to approve
        // something other than what lands. `parse` already refused anything that
        // cannot round-trip, so the fallback is unreachable in practice.
        let requested = record_write::display(
            &tasks_source::normalized_field_value(field, value).unwrap_or_else(|| value.to_owned()),
        );
        Outcome::staged(
            resource.clone(),
            item.title.clone(),
            format!("{field}: {}", Self::field_value(item, field)),
            format!("{field}: {requested}"),
        )
        .with_precondition("Revision", opened.revision.clone())
    }

    /// The note changed since it was read, so the line a task was on may no
    /// longer be that task. Nothing is written and the caller is told what the
    /// note is now. (ADR-002 substrate §15.2 v87 clause 2)
    fn precondition_failed(resource: &ResourceRef, expected: &str, actual: &str) -> Outcome {
        record_write::precondition_failed(resource, "note", expected, actual)
    }

    fn parse(operation: Value) -> Result<TaskOperation, ResourceError> {
        let parsed: TaskOperation =
            serde_json::from_value(operation).map_err(|error| ResourceError::InvalidPayload {
                message: error.to_string(),
            })?;
        let TaskOperation::SetField { field, value, .. } = &parsed;
        if !FIELDS.contains(&field.as_str()) {
            return Err(ResourceError::InvalidPayload {
                message: format!("a task has no {field} field; expected one of {FIELDS:?}"),
            });
        }
        // A value that does not survive being stored is refused up front rather
        // than written and rolled back. A checkbox line is whitespace-delimited, so
        // a due date or tag carrying a space leaks into the task's title: writing
        // it would corrupt the title, and the rollback that follows only undoes the
        // damage if the restore itself succeeds. An `InvalidPayload` the caller can
        // act on beats a retryable failure whose retry fails identically.
        if tasks_source::normalized_field_value(field, value).is_none() {
            return Err(ResourceError::InvalidPayload {
                message: format!(
                    "that {field} cannot be stored on a task line without changing another part \
                     of it: a checkbox line separates its title, due date, and tags with spaces, \
                     so {value:?} would read back differently from what was asked"
                ),
            });
        }
        Ok(parsed)
    }
}

/// Tasks live in the user's notes, so the vault grant governs them rather than a
/// new domain. (ADR-002 substrate §17 v85)
fn authorize(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "vault" | "notes" | "tasks"))
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
impl ResourceOwner for TaskResourceOwner {
    async fn describe(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError> {
        authorize(context)?;
        let opened = self.read(resource)?;
        Ok(ResourceDescriptor {
            protocol_version: "1.0.0".to_owned(),
            resource: resource.clone(),
            content_type: "application/json".to_owned(),
            // The note the tasks were read from, reachable as a canonical ref so a
            // surface can drill from a task to the text that defines it.
            provenance: format!("ctrl://local/note/{}", opened.note)
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
                viewer: Some("tasks".to_owned()),
                title: resource.id_segments().last().cloned(),
                preferred_columns: vec![
                    "title".to_owned(),
                    "status".to_owned(),
                    "due".to_owned(),
                    "tags".to_owned(),
                ],
            },
            query: QueryContract {
                request_schema: record_write::empty_request_schema(),
                result_schema: record_write::rows_result_schema(),
                watchable: false,
            },
            // One bounded field change on one task line. Bulk edits, moving a task
            // between notes, and deleting a line are not offered here: each would
            // need its own precondition and its own staged form.
            produce: vec![ProduceOperationDescriptor {
                kind: SET_FIELD.to_owned(),
                input_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "required": ["kind", "expected_revision", "line", "field", "value"],
                    "properties": {
                        "kind": { "const": SET_FIELD },
                        "expected_revision": { "type": "string", "minLength": 1 },
                        "line": { "type": "integer", "minimum": 0 },
                        "field": { "enum": FIELDS },
                        "value": {
                            "type": "string",
                            // The shapes the writer accepts, stated rather than
                            // left for a caller to discover through a conflict:
                            // status takes a word or its synonyms, tags take a
                            // comma-separated list with an optional `#`.
                            "description": "status: todo | doing | done (also x, complete, completed, any case). due: YYYY-MM-DD or empty to clear. title: text. tags: comma-separated, a leading # is optional."
                        }
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
        let rows: Vec<Value> = opened.items.iter().map(Self::row).collect();
        Ok(json!({
            "resource": resource,
            "revision": opened.revision,
            "match_count": rows.len(),
            "rows": rows,
        }))
    }

    /// Stage before authorizing, so review sees the actual field change.
    /// (ADR-002 substrate §15.2 v87 clause 1)
    async fn stage(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Outcome, ResourceError> {
        authorize(context)?;
        let TaskOperation::SetField {
            expected_revision,
            line,
            field,
            value,
        } = Self::parse(operation)?;
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            return Ok(Self::precondition_failed(
                resource,
                &expected_revision,
                &opened.revision,
            ));
        }
        let item = Self::find(&opened, line)?;
        Ok(Self::staged(resource, &opened, item, &field, &value))
    }

    async fn produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Value, ResourceError> {
        authorize(context)?;
        let TaskOperation::SetField {
            expected_revision,
            line,
            field,
            value,
        } = Self::parse(operation)?;
        let note = Self::note_path(resource)?;

        let lock = Self::write_lock(&note);
        let _guard = lock.lock().await;

        // Clause 2: recheck immediately before mutating. A moved line is exactly
        // what this catches — the task at line 4 may no longer be that task.
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            let outcome = Self::precondition_failed(resource, &expected_revision, &opened.revision);
            return serde_json::to_value(outcome).map_err(invalid);
        }
        let item = Self::find(&opened, line)?.clone();

        // Clause 3: the previous bytes go to disk before the note is touched, and
        // a recovery point that cannot be written aborts the operation instead of
        // proceeding with nothing to fall back on.
        let recovery = record_write::RecoveryPoint::capture(
            self.recovery_root.as_deref(),
            self.root()?,
            resource,
            &opened.raw,
        )?;

        // The bespoke update path is reused rather than reimplemented: it owns
        // checkbox rendering and the Obsidian-Tasks completion stamp, and a second
        // renderer here would drift from what the parser reads back.
        if let Err(error) = tasks_source::update(
            self.root()?,
            &note,
            line,
            &field,
            &value,
            chrono::Local::now().date_naive(),
        ) {
            // The note was never modified, so the copy protects nothing: keeping it
            // would leave the user's content in cleartext outside their tree with
            // nothing in the reply naming it.
            recovery.discard();
            // A vault that could not be written is not a bad argument. Typing it as
            // `InvalidPayload` would tell the caller to fix a request that was fine,
            // and would drop the retryability of a full disk or a locked file.
            return Err(match error {
                tasks_source::TaskError::Vault(_) => ResourceError::Unavailable {
                    reason: ResourceUnavailableReason::OwnerUnavailable,
                    retryable: true,
                },
                other => ResourceError::InvalidPayload {
                    message: other.to_string(),
                },
            });
        }

        // Clause 5: reread and confirm the task actually carries the new value.
        // Success is only ever reported from observed state.
        //
        // Read through an UNPINNED ref. `read` enforces the ref's own `?rev=` as a
        // precondition, which is right for the recheck above and wrong here: the
        // write has by definition moved the revision off any pin the caller sent,
        // so rereading through the pinned ref would fail its own precondition and
        // report a write that landed as unverified.
        //
        // A reread that fails is still not the same as a write that failed: the
        // change is already on disk. Reporting it as an unreadable resource would
        // hide that, so it is reported as written-but-unverified. Nothing is rolled
        // back, because the current state is unknown and undoing blindly could
        // destroy a write that actually landed.
        // The stored form, computed before the reread so both the unverified and the
        // rollback branch report the same ask. `parse` already refused anything that
        // cannot round-trip, so the fallback is unreachable in practice.
        let expected = record_write::display(
            &tasks_source::normalized_field_value(&field, &value).unwrap_or_else(|| value.clone()),
        );
        let unpinned = resource.without_revision();
        let committed = match self.read(&unpinned) {
            Ok(committed) => committed,
            Err(_) => {
                let mut outcome = record_write::write_unverified(
                    resource,
                    Some(item.title.clone()),
                    &field,
                    // The stored form, matching what the rollback branch reports:
                    // one operation must not describe its ask two different ways
                    // depending on which failure it hit.
                    &expected,
                    None,
                );
                // The change is on disk and unverifiable, so the copy is the only way
                // back to the previous content: keep it and say where it is.
                if let Some(feedback) = outcome.feedback.as_mut() {
                    recovery.retain();
                    feedback.details.insert(
                        "recovery_point".to_owned(),
                        json!(recovery.location()),
                    );
                }
                return serde_json::to_value(outcome).map_err(invalid);
            }
        };
        let observed = committed.items.iter().find(|current| current.line == line);
        // Verify against the value the source actually stores, not against the raw
        // request. The writer normalizes status synonyms and tag lists, so
        // comparing the request would report a correct write as a rolled-back
        // failure — `tags: "work, home"` stores `work home` and did exactly what
        // was asked. (ADR-002 substrate §15.5.2 v86)
        // `parse` already refused a value that cannot round-trip, so this is the
        // stored form.
        let expected = record_write::display(
            &tasks_source::normalized_field_value(&field, &value).unwrap_or_else(|| value.clone()),
        );
        let verified = observed.is_some_and(|current| {
            // Status is normalized on write (`done`, `todo`, `doing`), so compare
            // the field as the parser reads it rather than as it was requested.
            Self::field_value(current, &field) == expected
        });
        if !verified {
            // Clause 6: put the note back byte for byte, then report the rollback
            // rather than a success or a bare failure.
            let restored = super::vault::restore_raw(self.root()?, &note, &opened.raw).is_ok();
            let outcome = record_write::write_rolled_back(
                resource,
                Some(item.title.clone()),
                &field,
                &expected,
                observed.map(|current| Self::field_value(current, &field)),
                restored,
                Some(&recovery),
            );
            return serde_json::to_value(outcome).map_err(invalid);
        }

        let outcome = Outcome {
            resource: resource.clone(),
            target: Some(item.title.clone()),
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: Some(json!({
                "revision": committed.revision,
                "row": observed.map(Self::row),
            })),
        }
        .with_precondition("Revision", expected_revision)
        .committed(
            format!("set {field} on “{}”", item.title),
            Some("post-write reread returned the new value".to_owned()),
        );
        debug_assert!(outcome.is_verified_success());
        // Verified, so the fallback copy has done its job. Keeping it would leave
        // the user's content sitting in cleartext outside their own tree.
        recovery.discard();
        serde_json::to_value(outcome).map_err(invalid)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOTE: &str = "Inbox.md";

    fn owner(body: &str) -> (TaskResourceOwner, tempfile::TempDir) {
        let root = tempfile::tempdir().expect("temp dir");
        std::fs::write(root.path().join(NOTE), body).expect("write note");
        // Recovery points go to a temp root: a test must not write into the
        // developer's real state directory, and two test modules must not collide
        // on one recovery file.
        (
            TaskResourceOwner::new(root.path().to_path_buf())
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
        format!("ctrl://local/task/{NOTE}").parse().expect("valid ref")
    }

    fn set_field(revision: &str, line: usize, field: &str, value: &str) -> Value {
        json!({
            "kind": SET_FIELD,
            "expected_revision": revision,
            "line": line,
            "field": field,
            "value": value
        })
    }

    /// The line the first task lives on, as `query` reports it. Line indices are
    /// body-relative, so a test must ask rather than count file lines.
    async fn first_task_line(owner: &TaskResourceOwner) -> usize {
        let reply = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        reply["rows"][0]["line"].as_u64().expect("a line") as usize
    }

    async fn revision_of(owner: &TaskResourceOwner) -> String {
        owner
            .describe(&context(), &reference())
            .await
            .expect("describe")
            .freshness
            .revision
            .expect("a revision")
    }

    const TWO_TASKS: &str = "# Inbox\n\n- [ ] Pay the invoice 📅 2026-08-10\n- [x] Book the room\n";

    #[tokio::test]
    async fn describe_advertises_exactly_one_bounded_field_write() {
        let (owner, _root) = owner(TWO_TASKS);
        let descriptor = owner.describe(&context(), &reference()).await.expect("describe");
        assert_eq!(descriptor.produce.len(), 1);
        assert_eq!(descriptor.produce[0].kind, SET_FIELD);
        assert!(descriptor.produce[0].review_required);
        assert_eq!(descriptor.presentation.viewer.as_deref(), Some("tasks"));
        // The note is reachable from the task list, so a task can be traced to
        // the text that defines it.
        assert_eq!(
            descriptor
                .provenance
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>(),
            vec![format!("ctrl://local/note/{NOTE}")]
        );
    }

    #[tokio::test]
    async fn query_returns_each_task_with_the_line_it_lives_on() {
        let (owner, _root) = owner(TWO_TASKS);
        let reply = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        assert_eq!(reply["match_count"], json!(2));
        let rows = reply["rows"].as_array().expect("rows");
        assert_eq!(rows[0]["title"], json!("Pay the invoice"));
        assert_eq!(rows[0]["status"], json!("todo"));
        assert_eq!(rows[0]["due"], json!("2026-08-10"));
        assert_eq!(rows[1]["status"], json!("done"));
        // A line index is what `produce` addresses, so it must be reported.
        assert!(rows[0]["line"].is_number());
    }

    #[tokio::test]
    async fn completing_a_task_writes_it_in_place_and_verifies_the_new_value() {
        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let line = 2;
        let outcome = owner
            .produce(&context(), &reference(), set_field(&revision, line, "status", "done"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(
            outcome.is_verified_success(),
            "success must come from a reread, not from the write returning"
        );
        assert_eq!(outcome.target.as_deref(), Some("Pay the invoice"));

        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("- [x] Pay the invoice"), "got: {text}");
        // Every other line is preserved; a task write is not a note rewrite.
        assert!(text.contains("# Inbox"));
        assert!(text.contains("- [x] Book the room"));
    }

    /// The reviewer must see the actual field change, not a tool name.
    #[tokio::test]
    async fn staging_reports_the_field_before_and_after_without_writing() {
        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let outcome = owner
            .stage(&context(), &reference(), set_field(&revision, 2, "due", "2026-09-01"))
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("review facts");
        assert_eq!(facts.target.as_deref(), Some("Pay the invoice"));
        assert_eq!(facts.before, "due: 2026-08-10");
        assert_eq!(facts.after, "due: 2026-09-01");
        assert!(facts
            .preconditions
            .iter()
            .any(|precondition| precondition.label == "Revision"));
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("2026-08-10"), "staging must not write");
    }

    /// Clearing a field is a real change, so it must read as one.
    #[tokio::test]
    async fn clearing_a_field_stages_as_a_change_to_none() {
        let (owner, _root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let outcome = owner
            .stage(&context(), &reference(), set_field(&revision, 2, "due", ""))
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("review facts");
        assert_eq!(facts.after, "due: (none)");
    }

    /// The line a task was on may no longer be that task.
    #[tokio::test]
    async fn a_stale_revision_writes_nothing_and_reports_the_current_one() {
        let (owner, root) = owner(TWO_TASKS);
        let stale = revision_of(&owner).await;
        std::fs::write(
            root.path().join(NOTE),
            "# Inbox\n\n- [ ] Something else\n- [ ] Pay the invoice 📅 2026-08-10\n",
        )
        .expect("rewrite");

        let outcome = owner
            .produce(&context(), &reference(), set_field(&stale, 2, "status", "done"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        let feedback = outcome.feedback.clone().expect("feedback");
        assert_eq!(feedback.code, "precondition_failed");
        assert!(feedback.retryable);
        assert!(feedback.details.contains_key("current_revision"));
        assert!(!outcome.is_verified_success());

        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(!text.contains("- [x]"), "nothing was written");
    }

    /// The writer normalizes a tag list, so verifying against the raw request
    /// reported a correct write as a rolled-back failure. Several tags, and a `#`
    /// the user typed, must both land and verify.
    /// (ADR-002 substrate §15.5.2 v86)
    #[tokio::test]
    async fn a_multi_tag_write_verifies_instead_of_rolling_back() {
        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let outcome = owner
            .produce(
                &context(),
                &reference(),
                set_field(&revision, 2, "tags", "#work, home"),
            )
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(
            outcome.is_verified_success(),
            "a write the source normalized is still a correct write: {:?}",
            outcome.feedback
        );
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("#work"), "got: {text}");
        assert!(text.contains("#home"), "got: {text}");
    }

    /// The writer maps `x`, `complete`, and `completed` onto one status word.
    /// A reviewer must approve what will actually land. The writer normalizes, so
    /// staging the raw request would show something the note never holds.
    #[tokio::test]
    async fn staging_shows_the_value_as_it_will_be_stored() {
        let (owner, _root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let line = first_task_line(&owner).await;
        for (field, requested, stored) in [
            ("status", "x", "status: done"),
            ("status", "COMPLETED", "status: done"),
            ("tags", "#work, home", "tags: work home"),
        ] {
            let outcome = owner
                .stage(
                    &context(),
                    &reference(),
                    set_field(&revision, line, field, requested),
                )
                .await
                .expect("stage");
            assert_eq!(
                outcome.review_facts().expect("facts").after,
                stored,
                "{field}={requested:?} should stage as its stored form"
            );
        }
    }

    #[tokio::test]
    async fn a_status_synonym_verifies_instead_of_rolling_back() {
        for synonym in ["x", "complete", "completed", "DONE"] {
            let (owner, root) = owner(TWO_TASKS);
            let revision = revision_of(&owner).await;
            let outcome = owner
                .produce(
                    &context(),
                    &reference(),
                    set_field(&revision, 2, "status", synonym),
                )
                .await
                .expect("produce");
            let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
            assert!(
                outcome.is_verified_success(),
                "{synonym:?} should complete the task: {:?}",
                outcome.feedback
            );
            let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
            assert!(text.contains("- [x] Pay the invoice"), "{synonym:?}: {text}");
        }
    }

    /// A one-field task edit must not reformat the rest of the file. The
    /// frontmatter block keeps its exact bytes, comments included.
    #[tokio::test]
    async fn a_field_change_leaves_the_frontmatter_bytes_untouched() {
        let body = "---\ntitle: Inbox  # hand-written comment\nzz_last: 1\naa_first: 2\n---\n\n- [ ] Pay the invoice\n";
        let (owner, root) = owner(body);
        let revision = revision_of(&owner).await;
        // Line indices are body-relative, so ask rather than assume.
        let line = first_task_line(&owner).await;
        owner
            .produce(&context(), &reference(), set_field(&revision, line, "status", "done"))
            .await
            .expect("produce");
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("# hand-written comment"), "got: {text}");
        // Key order is the user's, not the serializer's.
        assert!(
            text.find("zz_last").unwrap() < text.find("aa_first").unwrap(),
            "got: {text}"
        );
        assert!(text.contains("- [x] Pay the invoice"));
    }

    /// A note with no frontmatter must not acquire one.
    #[tokio::test]
    async fn a_plain_note_does_not_gain_a_frontmatter_block() {
        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        owner
            .produce(&context(), &reference(), set_field(&revision, 2, "status", "done"))
            .await
            .expect("produce");
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(!text.starts_with("---"), "got: {text}");
        assert!(text.starts_with("# Inbox"), "got: {text}");
    }

    /// Changing one field must not rewrite every line ending in the file.
    #[tokio::test]
    async fn a_crlf_note_keeps_its_line_endings() {
        let (owner, root) = owner("# Inbox\r\n\r\n- [ ] Pay the invoice\r\n- [x] Book the room\r\n");
        let revision = revision_of(&owner).await;
        owner
            .produce(&context(), &reference(), set_field(&revision, 2, "status", "done"))
            .await
            .expect("produce");
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("- [x] Pay the invoice"), "got: {text:?}");
        assert!(text.contains("# Inbox\r\n"), "CRLF preserved: {text:?}");
        assert!(
            !text.contains("invoice\n- ") || text.contains("invoice\r\n"),
            "no line was silently converted to LF: {text:?}"
        );
    }

    /// A CRLF note that also carries frontmatter must come back byte-identical
    /// apart from the one line that changed — including the fence/body separator.
    #[tokio::test]
    async fn a_crlf_note_with_frontmatter_changes_only_the_addressed_line() {
        let before = "---\r\ntitle: Inbox\r\n---\r\n\r\n- [ ] Pay the invoice\r\n- [ ] Book the room\r\n";
        let (owner, root) = owner(before);
        let revision = revision_of(&owner).await;
        let line = first_task_line(&owner).await;
        let outcome = owner
            .produce(&context(), &reference(), set_field(&revision, line, "status", "done"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(outcome.is_verified_success(), "{:?}", outcome.feedback);

        let after = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        let (before_head, before_tail) = before.split_once("- [ ] Pay the invoice").expect("split");
        assert!(after.starts_with(before_head), "frontmatter and CRLF intact: {after:?}");
        assert!(after.ends_with(before_tail), "the rest of the note intact: {after:?}");
        assert!(after.contains("- [x] Pay the invoice"), "got {after:?}");
    }

    /// A note that mixes terminators must keep each line's own, rather than being
    /// normalized to whichever one appeared first.
    #[tokio::test]
    async fn a_note_with_mixed_line_endings_keeps_each_line_as_it_was() {
        let before = "# Inbox\n\r\n- [ ] Pay the invoice\r\n- [ ] Book the room\n";
        let (owner, root) = owner(before);
        let revision = revision_of(&owner).await;
        let line = first_task_line(&owner).await;
        owner
            .produce(&context(), &reference(), set_field(&revision, line, "status", "done"))
            .await
            .expect("produce");
        // Completing stamps the Obsidian-Tasks done date, so the addressed line
        // changes by more than the checkbox; every OTHER byte must be identical.
        let after = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        let (before_head, before_tail) = before.split_once("- [ ] Pay the invoice").expect("split");
        assert!(after.starts_with(before_head), "got {after:?}");
        assert!(after.ends_with(before_tail), "got {after:?}");
        assert!(after.contains("- [x] Pay the invoice"), "got {after:?}");
    }

    /// The rollback branch is defensive and is now UNREACHABLE through this owner:
    /// a value that would not read back as asked is refused by `parse` before
    /// anything is written (see
    /// `a_value_that_cannot_be_stored_is_refused_before_anything_is_written`), and
    /// a value that passes verifies. Reaching it needs the note to change between
    /// the commit and the reread, which no input can arrange.
    ///
    /// So this asserts the two halves the branch is built from, at the layers that
    /// own them: `record_write` decides the reply (`write_rolled_back`), and the
    /// vault restores the bytes. Byte fidelity is the part a re-render would break,
    /// so it is checked on a note carrying frontmatter comments and a hand-chosen
    /// key order. (ADR-002 substrate §15.2 v87 clause 6)
    #[tokio::test]
    async fn a_rollback_restores_the_exact_bytes_that_were_read() {
        let before = "---\ntitle: Inbox  # keep me\nzz_last: 1\naa_first: 2\n---\n\n- [ ] Pay the invoice 📅 2026-08-10\n";
        let (owner, root) = owner(before);
        let revision = revision_of(&owner).await;
        let line = first_task_line(&owner).await;

        // Commit a real change, so the restore has something to undo.
        let outcome = owner
            .produce(&context(), &reference(), set_field(&revision, line, "status", "done"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(outcome.is_verified_success());
        assert_ne!(
            std::fs::read_to_string(root.path().join(NOTE)).expect("note"),
            before
        );

        // The rollback path: the exact bytes the owner captured go back.
        super::super::vault::restore_raw(root.path(), NOTE, before).expect("restore ok");
        let after = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert_eq!(after, before, "an undo that reformats the file is not an undo");
        assert!(after.contains("# keep me"), "a frontmatter comment survives");
        assert!(
            after.find("zz_last").unwrap() < after.find("aa_first").unwrap(),
            "key order is the user's, not the serializer's"
        );
        // And the note reads as it did before the change.
        let rows = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        assert_eq!(rows["rows"][0]["status"], json!("todo"));
        assert_eq!(rows["rows"][0]["due"], json!("2026-08-10"));
    }

    #[tokio::test]
    async fn a_line_that_is_not_a_task_is_refused_rather_than_rewritten() {
        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let result = owner
            .produce(&context(), &reference(), set_field(&revision, 0, "status", "done"))
            .await;
        assert!(matches!(result, Err(ResourceError::InvalidPayload { .. })));
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.starts_with("# Inbox"), "the heading is untouched");
    }

    /// A caller may address the note with the revision it read (`?rev=…`). The write
    /// moves the revision off that pin by definition, so rereading through the
    /// pinned ref would fail its own precondition and report a landed write as
    /// unverified — telling the caller to retry something already done.
    /// (ADR-002 substrate §15.2 v87 clause 5)
    #[tokio::test]
    async fn a_revision_pinned_ref_still_verifies_its_own_write() {
        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let line = first_task_line(&owner).await;
        let pinned: ResourceRef = format!("ctrl://local/task/{NOTE}?rev={revision}")
            .parse()
            .expect("a pinned ref");
        assert_eq!(pinned.revision(), Some(revision.as_str()));

        let outcome = owner
            .produce(&context(), &pinned, set_field(&revision, line, "status", "done"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(
            outcome.is_verified_success(),
            "a pinned ref must not report its own successful write as unverified: {:?}",
            outcome.feedback
        );
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("- [x] Pay the invoice"), "got: {text}");
        // And no copy of the note is left behind on a success.
        let recovery = root.path().join("recovery");
        let leftovers = std::fs::read_dir(&recovery)
            .map(|entries| entries.flatten().count())
            .unwrap_or(0);
        assert_eq!(leftovers, 0, "a verified write leaves no recovery copy");
    }

    /// A vault that cannot be written is not a bad argument, and the note was never
    /// touched — so the recovery copy protects nothing and must not be left behind.
    /// (ADR-002 substrate §15.2 v87 clause 3)
    #[tokio::test]
    async fn a_commit_failure_is_reported_as_unavailable_and_leaves_no_copy() {
        use std::os::unix::fs::PermissionsExt;

        let (owner, root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let line = first_task_line(&owner).await;
        // The recovery root must stay writable, so that the capture succeeds and the
        // failure lands on the COMMIT — the window where a leaked copy was possible.
        std::fs::create_dir_all(root.path().join("recovery")).expect("recovery dir");
        // Read still works, the write cannot: no permission to replace the note.
        let notes = root.path().to_path_buf();
        std::fs::set_permissions(&notes, std::fs::Permissions::from_mode(0o500))
            .expect("chmod");

        let result = owner
            .produce(&context(), &reference(), set_field(&revision, line, "status", "done"))
            .await;

        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("restore chmod");

        match result {
            Err(ResourceError::Unavailable { retryable, .. }) => {
                assert!(retryable, "a full disk or locked file is worth retrying");
            }
            other => panic!("expected an unavailable owner, got {other:?}"),
        }
        let leftovers = std::fs::read_dir(root.path().join("recovery"))
            .map(|entries| entries.flatten().count())
            .unwrap_or(0);
        assert_eq!(
            leftovers, 0,
            "the note was never modified, so the copy protects nothing"
        );
    }

    /// A checkbox line separates its parts with spaces, so a due date carrying one
    /// would run into the task's title. Refusing up front beats writing it,
    /// corrupting the title, and depending on the rollback to undo the damage —
    /// especially since that failure would be reported as retryable and the retry
    /// would fail identically. (ADR-002 substrate §15.5.2 v86)
    #[tokio::test]
    async fn a_value_that_cannot_be_stored_is_refused_before_anything_is_written() {
        for (field, value) in [("due", "2026-08-10 maybe"), ("tags", "two words, ok")] {
            let (owner, root) = owner(TWO_TASKS);
            let before = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
            let revision = revision_of(&owner).await;
            let line = first_task_line(&owner).await;
            let result = owner
                .produce(
                    &context(),
                    &reference(),
                    set_field(&revision, line, field, value),
                )
                .await;
            match result {
                Err(ResourceError::InvalidPayload { message }) => {
                    assert!(message.contains(field), "names the field: {message}");
                }
                other => panic!("expected a refusal for {field}={value:?}, got {other:?}"),
            }
            assert_eq!(
                std::fs::read_to_string(root.path().join(NOTE)).expect("note"),
                before,
                "the note is untouched: no write, so no rollback to depend on"
            );
        }
    }

    #[tokio::test]
    async fn an_unknown_field_is_refused_with_the_valid_set() {
        let (owner, _root) = owner(TWO_TASKS);
        let revision = revision_of(&owner).await;
        let result = owner
            .stage(&context(), &reference(), set_field(&revision, 2, "priority", "high"))
            .await;
        match result {
            Err(ResourceError::InvalidPayload { message }) => {
                assert!(message.contains("priority"));
                assert!(message.contains("status"), "names what is valid: {message}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn an_unknown_operation_kind_is_refused() {
        let (owner, _root) = owner(TWO_TASKS);
        assert!(matches!(
            owner
                .produce(&context(), &reference(), json!({ "kind": "delete_row", "line": 2 }))
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
    }

    #[tokio::test]
    async fn a_caller_without_the_vault_grant_is_denied() {
        let (owner, _root) = owner(TWO_TASKS);
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
                .produce(&denied, &reference(), set_field("x", 2, "status", "done"))
                .await,
            Err(ResourceError::Denied)
        ));
    }

    #[tokio::test]
    async fn a_note_with_no_tasks_is_an_empty_list_not_a_failure() {
        let (owner, _root) = owner("# Just prose\n\nNothing to do here.\n");
        let reply = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        assert_eq!(reply["match_count"], json!(0));
    }

    #[tokio::test]
    async fn a_traversing_task_ref_is_refused() {
        let (owner, _root) = owner(TWO_TASKS);
        for id in ["..", "a/../../etc/passwd"] {
            let Ok(resource) = format!("ctrl://local/task/{id}").parse::<ResourceRef>() else {
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
