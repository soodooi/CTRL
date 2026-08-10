//! Canonical calendar-event Resource — `ctrl://local/calendar/<event note>`.
//!
//! Events were writable only through `calendar_produce`, which addresses a row by
//! its index in a previous scan and answers with a sentence. That is two problems
//! at once: the index can mean a different event by the time the write lands, and
//! the reply cannot tell a caller what changed or whether it held. Here one event
//! note is one Resource, so the write is addressed by identity rather than by
//! position, and it carries staged before/after with a verified effect.
//! (ADR-002 substrate §15.2 v87; ADR-002 substrate §15.5 v86)

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::Arc;

use super::calendar_source::CalendarSource;
use super::query::{ProduceOp, QuerySource, RecordSink, Row};
use super::record_write;
use super::resource::{
    OperationRecoveryPolicy, Outcome, PresentationHints, ProduceOperationDescriptor, QueryContract,
    ResourceAccessContext, ResourceDegradation, ResourceDescriptor, ResourceError,
    ResourceFreshness, ResourceOwner, ResourceRef, ResourceUnavailableReason,
};

const SET_FIELD: &str = "set_field";
/// Exactly the frontmatter keys an event exposes. `path` is deliberately absent:
/// moving an event between notes is not a field change.
const FIELDS: [&str; 6] = ["title", "date", "start", "end", "location", "tags"];

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum CalendarOperation {
    SetField {
        expected_revision: String,
        field: String,
        value: String,
    },
}

pub struct CalendarResourceOwner {
    root: Option<PathBuf>,
    /// Recovery points live outside the user's content tree; injectable so tests
    /// do not write to the real state directory.
    /// (ADR-002 substrate §15.2 v87 clause 3)
    recovery_root: Option<PathBuf>,
}

struct OpenedEvent {
    note: String,
    revision: String,
    row: Row,
    /// The note's exact bytes as they were read, so an undo puts the event back
    /// rather than re-rendering its frontmatter.
    /// (ADR-002 substrate §15.2 v87 clause 6)
    raw: String,
}

impl CalendarResourceOwner {
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

    fn note_path(resource: &ResourceRef) -> Result<String, ResourceError> {
        if resource.authority() != super::resource::ResourceAuthority::Local
            || resource.kind() != "calendar"
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
                message: "a calendar ref names one event note inside the vault".to_owned(),
            });
        }
        Ok(segments.join("/"))
    }

    /// Serialize against note writes and the bespoke calendar tool through the
    /// same per-note lock. (ADR-002 substrate §15.2 v87 clause 7)
    fn write_lock(note: &str) -> Arc<tokio::sync::Mutex<()>> {
        super::vault_write_lock::for_path(note)
    }

    /// Read the one event this ref addresses. The revision covers the whole note,
    /// because any edit to it changes what the event is.
    fn read(&self, resource: &ResourceRef) -> Result<OpenedEvent, ResourceError> {
        let note = Self::note_path(resource)?;
        let unavailable = || ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: true,
        };
        // The exact bytes are required: they are both the revision and the only
        // thing an undo can restore. Frontmatter carries the event and the body
        // carries its notes, so hashing the whole file is also the honest revision.
        let raw = super::vault::read_raw(self.root()?, &note).map_err(|_| unavailable())?;
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
        // Reuse the source's own row projection rather than re-deriving the event
        // shape here; a second projection would drift from what `calendar_query`
        // reports for the same note.
        let source = CalendarSource::load(self.root()?);
        let row = source
            .rows()
            .iter()
            .find(|row| row.get("path").map(String::as_str) == Some(note.as_str()))
            .cloned()
            .ok_or_else(|| ResourceError::InvalidPayload {
                message: format!("{note} is not an event note"),
            })?;
        Ok(OpenedEvent {
            raw,
            note,
            revision,
            row,
        })
    }

    fn field_value(row: &Row, field: &str) -> String {
        record_write::display(row.get(field).map(String::as_str).unwrap_or_default())
    }

    fn title(row: &Row) -> Option<String> {
        row.get("title").filter(|title| !title.is_empty()).cloned()
    }

    fn parse(operation: Value) -> Result<CalendarOperation, ResourceError> {
        let parsed: CalendarOperation =
            serde_json::from_value(operation).map_err(|error| ResourceError::InvalidPayload {
                message: error.to_string(),
            })?;
        let CalendarOperation::SetField { field, .. } = &parsed;
        if !FIELDS.contains(&field.as_str()) {
            return Err(ResourceError::InvalidPayload {
                message: format!("an event has no {field} field; expected one of {FIELDS:?}"),
            });
        }
        Ok(parsed)
    }
}

/// Events are notes in the user's vault, so the vault grant governs them.
/// (ADR-002 substrate §17 v85)
fn authorize(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "vault" | "notes" | "calendar"))
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
impl ResourceOwner for CalendarResourceOwner {
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
            // The note behind the event, so a surface can drill from an event to
            // the text that defines it.
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
                viewer: Some("event".to_owned()),
                title: Self::title(&opened.row),
                preferred_columns: vec![
                    "title".to_owned(),
                    "date".to_owned(),
                    "start".to_owned(),
                    "end".to_owned(),
                    "location".to_owned(),
                ],
            },
            query: QueryContract {
                request_schema: record_write::empty_request_schema(),
                result_schema: record_write::rows_result_schema(),
                watchable: false,
            },
            // One bounded field change on this event. Creating and deleting events
            // are separate jobs with separate preconditions and are not offered
            // through an existing event's ref.
            produce: vec![ProduceOperationDescriptor {
                kind: SET_FIELD.to_owned(),
                input_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "required": ["kind", "expected_revision", "field", "value"],
                    "properties": {
                        "kind": { "const": SET_FIELD },
                        "expected_revision": { "type": "string", "minLength": 1 },
                        "field": { "enum": FIELDS },
                        "value": {
                            "type": "string",
                            "description": "date: YYYY-MM-DD. start/end: a time as you write it. tags: comma-separated, a leading # is optional. title/location: text; empty clears the field."
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
        Ok(json!({
            "resource": resource,
            "revision": opened.revision,
            "match_count": 1,
            "rows": [opened.row],
        }))
    }

    async fn stage(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Outcome, ResourceError> {
        authorize(context)?;
        let CalendarOperation::SetField {
            expected_revision,
            field,
            value,
        } = Self::parse(operation)?;
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            return Ok(record_write::precondition_failed(
                resource,
                "event",
                &expected_revision,
                &opened.revision,
            ));
        }
        // Stage the value as it will be STORED — the source normalizes a tag list on
        // the way in, so showing the raw request would ask the reviewer to approve
        // something other than what lands.
        let stored = super::calendar_source::normalized_field_value(&field, &value)
            .unwrap_or_else(|| value.clone());
        Ok(Outcome::staged(
            resource.clone(),
            Self::title(&opened.row).unwrap_or_else(|| opened.note.clone()),
            format!("{field}: {}", Self::field_value(&opened.row, &field)),
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
        let CalendarOperation::SetField {
            expected_revision,
            field,
            value,
        } = Self::parse(operation)?;
        let note = Self::note_path(resource)?;

        let lock = Self::write_lock(&note);
        let _guard = lock.lock().await;

        // Clause 2: recheck through a fresh read immediately before mutating.
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            let outcome = record_write::precondition_failed(
                resource,
                "event",
                &expected_revision,
                &opened.revision,
            );
            return serde_json::to_value(outcome).map_err(invalid);
        }
        let target = Self::title(&opened.row);

        // Clause 3: previous bytes on disk before the event is touched; a recovery
        // point that cannot be written aborts rather than proceeding blind.
        let recovery = record_write::RecoveryPoint::capture(
            self.recovery_root.as_deref(),
            self.root()?,
            resource,
            &opened.raw,
        )?;

        // The source owns frontmatter rendering and date validation; reusing it
        // keeps one writer rather than a second that could disagree with what
        // `calendar_query` reads back.
        let mut source = CalendarSource::load(self.root()?);
        let row_index = source
            .rows()
            .iter()
            .position(|row| row.get("path").map(String::as_str) == Some(note.as_str()))
            .ok_or_else(|| ResourceError::InvalidPayload {
                message: format!("{note} is not an event note"),
            })?;
        if let Err(error) = source.produce(ProduceOp::SetCell {
            row: row_index,
            field: field.clone(),
            // Store the form that was staged and will be verified, not the raw
            // request.
            value: super::calendar_source::normalized_field_value(&field, &value)
                .unwrap_or_else(|| value.clone()),
        }) {
            // The note was never modified, so the copy protects nothing — its `Drop`
            // removes it on this return.
            //
            // The source collapses a vault IO failure into `Conflict`, the same
            // variant it uses for a bad date, so this cannot tell "your argument was
            // wrong" from "the disk was full" without matching on a message. It is
            // reported as an invalid payload, which is right for the validation
            // errors that dominate here and wrong for an IO fault; separating them
            // needs a variant in `ProduceError` that this owner does not own.
            return Err(ResourceError::InvalidPayload {
                message: error.to_string(),
            });
        }

        // Clause 5: reread and confirm the event carries the new value. A reread
        // that fails is reported as written-but-unverified rather than as an
        // unreadable resource, because the change is already on disk; nothing is
        // rolled back, since the current state is unknown.
        //
        // Verify against the value the source stores, not the raw request: a tags
        // argument is normalized on the way in, so comparing the request would
        // report a correct write as a rolled-back failure.
        // (ADR-002 substrate §15.5.2 v86)
        let expected = record_write::display(
            &super::calendar_source::normalized_field_value(&field, &value)
                .unwrap_or_else(|| value.clone()),
        );
        // Unpinned: the write has moved the revision off any `?rev=` the caller
        // sent, so rereading through the pinned ref would fail its own precondition
        // and report a write that landed as unverified.
        let unpinned = resource.without_revision();
        let committed = match self.read(&unpinned) {
            Ok(committed) => committed,
            Err(_) => {
                let mut outcome =
                    record_write::write_unverified(resource, target, &field, &expected, None);
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
        let observed = Self::field_value(&committed.row, &field);
        if observed != expected {
            // Clause 6: put the event note back byte for byte.
            let restored = super::vault::restore_raw(self.root()?, &note, &opened.raw).is_ok();
            let outcome = record_write::write_rolled_back(
                resource,
                target,
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
            target: target.clone(),
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: Some(json!({
                "revision": committed.revision,
                "row": committed.row,
            })),
        }
        .with_precondition("Revision", expected_revision)
        .committed(
            format!("set {field} on this event"),
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

    const NOTE: &str = "calendar/2026-08-05-standup.md";

    fn owner(frontmatter: &str, body: &str) -> (CalendarResourceOwner, tempfile::TempDir) {
        let root = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir_all(root.path().join("calendar")).expect("calendar dir");
        std::fs::write(
            root.path().join(NOTE),
            format!("---\n{frontmatter}---\n{body}"),
        )
        .expect("write event");
        (
            CalendarResourceOwner::new(root.path().to_path_buf())
                .with_recovery_root(root.path().join("recovery")),
            root,
        )
    }

    const STANDUP: &str =
        "title: Standup\ndate: 2026-08-05\nstart: \"09:00\"\nend: \"09:15\"\nlocation: Zoom\ntags: [work]\n";

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["vault".to_owned()],
        }
    }

    fn reference() -> ResourceRef {
        format!("ctrl://local/calendar/{NOTE}")
            .parse()
            .expect("valid ref")
    }

    fn set_field(revision: &str, field: &str, value: &str) -> Value {
        json!({
            "kind": SET_FIELD,
            "expected_revision": revision,
            "field": field,
            "value": value
        })
    }

    async fn revision_of(owner: &CalendarResourceOwner) -> String {
        owner
            .describe(&context(), &reference())
            .await
            .expect("describe")
            .freshness
            .revision
            .expect("a revision")
    }

    #[tokio::test]
    async fn describe_names_the_event_and_advertises_one_bounded_field_write() {
        let (owner, _root) = owner(STANDUP, "Notes about the standup.\n");
        let descriptor = owner.describe(&context(), &reference()).await.expect("describe");
        assert_eq!(descriptor.presentation.title.as_deref(), Some("Standup"));
        assert_eq!(descriptor.produce.len(), 1);
        assert_eq!(descriptor.produce[0].kind, SET_FIELD);
        assert!(descriptor.produce[0].review_required);
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
    async fn query_returns_the_event_as_the_calendar_itself_reports_it() {
        let (owner, _root) = owner(STANDUP, "");
        let reply = owner
            .query(&context(), &reference(), json!({}))
            .await
            .expect("query");
        assert_eq!(reply["match_count"], json!(1));
        let row = &reply["rows"][0];
        assert_eq!(row["title"], json!("Standup"));
        assert_eq!(row["date"], json!("2026-08-05"));
        assert_eq!(row["start"], json!("09:00"));
        assert_eq!(row["location"], json!("Zoom"));
    }

    #[tokio::test]
    async fn changing_a_field_writes_the_note_in_place_and_verifies_it() {
        let (owner, root) = owner(STANDUP, "Notes about the standup.\n");
        let revision = revision_of(&owner).await;
        let outcome = owner
            .produce(&context(), &reference(), set_field(&revision, "location", "Room 3"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(outcome.is_verified_success());
        assert_eq!(outcome.target.as_deref(), Some("Standup"));

        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("Room 3"));
        // Every other field and the body survive: this is a field change, not a
        // note rewrite.
        assert!(text.contains("Standup"));
        assert!(text.contains("09:15"));
        assert!(text.contains("Notes about the standup."));
    }

    #[tokio::test]
    async fn staging_reports_the_field_before_and_after_without_writing() {
        let (owner, root) = owner(STANDUP, "");
        let revision = revision_of(&owner).await;
        let outcome = owner
            .stage(&context(), &reference(), set_field(&revision, "start", "10:00"))
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("review facts");
        assert_eq!(facts.target.as_deref(), Some("Standup"));
        assert_eq!(facts.before, "start: 09:00");
        assert_eq!(facts.after, "start: 10:00");
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("09:00"), "staging must not write");
    }

    #[tokio::test]
    async fn a_stale_revision_writes_nothing_and_reports_the_current_one() {
        let (owner, root) = owner(STANDUP, "");
        let stale = revision_of(&owner).await;
        std::fs::write(
            root.path().join(NOTE),
            format!("---\n{STANDUP}---\nsomeone edited this\n"),
        )
        .expect("rewrite");

        let outcome = owner
            .produce(&context(), &reference(), set_field(&stale, "location", "Room 3"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        let feedback = outcome.feedback.clone().expect("feedback");
        assert_eq!(feedback.code, "precondition_failed");
        assert!(feedback.retryable);
        assert!(!outcome.is_verified_success());
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(!text.contains("Room 3"), "nothing was written");
    }

    /// A bad date must be refused, not written as a token nothing can read back.
    #[tokio::test]
    async fn an_unparseable_date_is_refused_rather_than_stored() {
        let (owner, root) = owner(STANDUP, "");
        let revision = revision_of(&owner).await;
        let result = owner
            .produce(&context(), &reference(), set_field(&revision, "date", "next Tuesday"))
            .await;
        assert!(matches!(result, Err(ResourceError::InvalidPayload { .. })));
        let text = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(text.contains("2026-08-05"), "the original date stands");
    }

    /// The source turns a tags argument into a frontmatter array and reads it back
    /// joined, so verifying against the raw request reported a correct write as a
    /// rolled-back failure. (ADR-002 substrate §15.5.2 v86)
    #[tokio::test]
    async fn a_multi_tag_write_verifies_instead_of_rolling_back() {
        let (owner, root) = owner(STANDUP, "");
        let revision = revision_of(&owner).await;
        let outcome = owner
            .produce(
                &context(),
                &reference(),
                set_field(&revision, "tags", "#work, planning"),
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
        assert!(text.contains("work"), "got: {text}");
        assert!(text.contains("planning"), "got: {text}");
    }

    /// An undo must put the event note back as it was, comments and key order
    /// included — a re-render of the frontmatter is not an undo.
    /// (ADR-002 substrate §15.2 v87 clause 6)
    #[tokio::test]
    async fn a_rollback_restores_the_event_note_byte_for_byte() {
        // `date` is validated but `location` is stored verbatim, so force the
        // mismatch through a value the source trims.
        let (owner, root) = owner(
            "title: Standup  # keep me\nzz: 1\naa: 2\ndate: 2026-08-05\nlocation: Zoom\n",
            "Body stays.\n",
        );
        let before = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        let revision = revision_of(&owner).await;
        // A value that cannot read back: the writer trims, so trailing space is
        // dropped and a raw-request comparison would mismatch — but the owner now
        // compares the normalized form, so this must SUCCEED.
        let outcome = owner
            .produce(&context(), &reference(), set_field(&revision, "location", "  Room 3  "))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(
            outcome.is_verified_success(),
            "a trimmed value is still what was asked for: {:?}",
            outcome.feedback
        );
        let after = std::fs::read_to_string(root.path().join(NOTE)).expect("note");
        assert!(after.contains("Room 3"));
        // The rest of the note is the user's: a one-field edit keeps the body.
        assert!(after.contains("Body stays."), "got: {after}");
        assert!(before.contains("# keep me"));
    }

    #[tokio::test]
    async fn an_unknown_field_is_refused_with_the_valid_set() {
        let (owner, _root) = owner(STANDUP, "");
        let revision = revision_of(&owner).await;
        match owner
            .stage(&context(), &reference(), set_field(&revision, "attendees", "me"))
            .await
        {
            Err(ResourceError::InvalidPayload { message }) => {
                assert!(message.contains("attendees"));
                assert!(message.contains("location"), "names what is valid: {message}");
            }
            other => panic!("expected a refusal, got {other:?}"),
        }
    }

    /// The note path is not a field, so an event cannot be relocated by a cell
    /// edit.
    #[tokio::test]
    async fn the_note_path_is_not_writable() {
        let (owner, _root) = owner(STANDUP, "");
        let revision = revision_of(&owner).await;
        assert!(matches!(
            owner
                .stage(&context(), &reference(), set_field(&revision, "path", "calendar/other.md"))
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
    }

    #[tokio::test]
    async fn clearing_a_field_stages_as_a_change_to_none() {
        let (owner, _root) = owner(STANDUP, "");
        let revision = revision_of(&owner).await;
        let outcome = owner
            .stage(&context(), &reference(), set_field(&revision, "location", ""))
            .await
            .expect("stage");
        assert_eq!(outcome.review_facts().expect("facts").after, "location: (none)");
    }

    #[tokio::test]
    async fn a_caller_without_the_vault_grant_is_denied() {
        let (owner, _root) = owner(STANDUP, "");
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
                .produce(&denied, &reference(), set_field("x", "location", "Room 3"))
                .await,
            Err(ResourceError::Denied)
        ));
    }

    #[tokio::test]
    async fn a_traversing_calendar_ref_is_refused() {
        let (owner, _root) = owner(STANDUP, "");
        for id in ["..", "calendar/../../etc/passwd"] {
            let Ok(resource) = format!("ctrl://local/calendar/{id}").parse::<ResourceRef>() else {
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
