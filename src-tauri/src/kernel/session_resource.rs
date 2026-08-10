//! Canonical transcript Resource — `ctrl://local/session/<id>`.
//!
//! The transcript was frontend-only browser state, which made recovery
//! unverifiable and put the user's own history out of reach of ordinary tools.
//! This owner makes it a Resource like anything else: `describe` reports its
//! revision, `query` returns the parsed transcript, and `produce` appends a turn
//! under the same write contract the note owner uses — revision recheck, atomic
//! commit, post-write reread, typed Outcome.
//!
//! It stores nothing the frontend cannot rebuild from the file, so there is one
//! authority rather than two. (ADR-002 substrate §15.2 v87; ADR-005 irisy §11.2 v44)

use async_trait::async_trait;
use serde::Deserialize;
use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;

use super::resource::{
    Feedback, FeedbackSeverity, OperationRecoveryPolicy, Outcome,
    PresentationHints, ProduceOperationDescriptor, QueryContract, ResourceAccessContext,
    ResourceDegradation, ResourceDescriptor, ResourceError, ResourceFreshness, ResourceOwner,
    ResourceRef, ResourceUnavailableReason,
};
use super::transcript_format::{Transcript, TranscriptMessage};
use sha2::{Digest, Sha256};

const APPEND_MESSAGE: &str = "append_message";
const MAX_TRANSCRIPT_BYTES: u64 = 8 * 1024 * 1024;

/// One bounded write: add a turn. Rewriting or deleting history is not offered,
/// because a transcript is a record and losing it silently is the failure this
/// owner exists to prevent.
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum SessionOperation {
    AppendMessage {
        expected_revision: String,
        role: String,
        content: String,
        /// Metadata the session owns, refreshed on every append so the file stays
        /// the whole truth rather than a partial mirror.
        #[serde(default)]
        label: Option<String>,
        #[serde(default)]
        resources: Option<Vec<String>>,
        #[serde(default)]
        selected_fct: Option<String>,
    },
}

pub struct SessionResourceOwner {
    root: Option<PathBuf>,
    /// Recheck, commit, and reread are one critical section. Appends are small
    /// and rare, so serializing all transcript writes is cheaper than a
    /// per-session lock map and removes the interleaving entirely.
    /// (ADR-002 substrate §15.2 v87 clauses 2/4/5)
    write_lock: tokio::sync::Mutex<()>,
}

struct OpenedTranscript {
    transcript: Transcript,
    revision: String,
}

impl SessionResourceOwner {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: Some(root),
            write_lock: tokio::sync::Mutex::new(()),
        }
    }

    pub fn from_default_root() -> Self {
        Self {
            root: default_root(),
            write_lock: tokio::sync::Mutex::new(()),
        }
    }

    /// Every transcript on disk, newest activity first. The directory is the
    /// list, so a file dropped in by hand appears and a deleted one disappears;
    /// there is no separate index to fall out of step with it.
    pub fn list(&self) -> Result<Vec<Value>, ResourceError> {
        let Some(root) = self.root.as_ref() else {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::OwnerUnavailable,
                retryable: false,
            });
        };
        let entries = match std::fs::read_dir(root) {
            Ok(entries) => entries,
            // No directory yet is an empty history, not a failure.
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(_) => {
                return Err(ResourceError::Unavailable {
                    reason: ResourceUnavailableReason::OwnerUnavailable,
                    retryable: true,
                })
            }
        };
        let mut rows: Vec<(String, Value)> = Vec::new();
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            // Skip the atomic-write temp siblings; a half-written file is not a
            // session the user has.
            let Some(id) = name.strip_suffix(".md").filter(|_| !name.starts_with('.')) else {
                continue;
            };
            if !entry.metadata().is_ok_and(|meta| meta.is_file()) {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(entry.path()) else {
                continue;
            };
            let transcript = Transcript::parse(&text);
            let label = if transcript.label.is_empty() {
                id.to_owned()
            } else {
                transcript.label.clone()
            };
            rows.push((
                transcript.last_active_at.clone(),
                json!({
                    "id": id,
                    "resource": format!("ctrl://local/session/{id}"),
                    "label": label,
                    "created_at": transcript.created_at,
                    "last_active_at": transcript.last_active_at,
                    "turn_count": transcript.messages.len(),
                    "resources": transcript.resources,
                    "selected_fct": transcript.selected_fct,
                }),
            ));
        }
        // Timestamps are ISO-8601 UTC, so lexical order is chronological order.
        // A transcript with no timestamp sorts last rather than being hidden.
        rows.sort_by(|left, right| right.0.cmp(&left.0));
        Ok(rows.into_iter().map(|(_, row)| row).collect())
    }

    fn path_for(&self, resource: &ResourceRef) -> Result<PathBuf, ResourceError> {
        if resource.authority() != super::resource::ResourceAuthority::Local
            || resource.kind() != "session"
        {
            return Err(ResourceError::OwnerNotFound);
        }
        let segments = resource.id_segments();
        // One segment: a session id, never a path. Anything else could climb out
        // of the transcript directory.
        let [id] = segments else {
            return Err(ResourceError::InvalidPayload {
                message: "a session ref names exactly one session id".to_owned(),
            });
        };
        if id.is_empty() || id.contains('/') || id.contains('\\') || id == "." || id == ".." {
            return Err(ResourceError::InvalidPayload {
                message: "that session id does not name a single transcript".to_owned(),
            });
        }
        let root = self.root.as_ref().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        Ok(root.join(format!("{id}.md")))
    }

    /// Read the transcript. A session that does not exist yet reads as empty
    /// rather than as an error: the first append creates it.
    fn read(&self, resource: &ResourceRef) -> Result<OpenedTranscript, ResourceError> {
        let path = self.path_for(resource)?;
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
            Err(_) => {
                return Err(ResourceError::Unavailable {
                    reason: ResourceUnavailableReason::OwnerUnavailable,
                    retryable: true,
                })
            }
        };
        if text.len() as u64 > MAX_TRANSCRIPT_BYTES {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::PayloadTooLarge,
                retryable: false,
            });
        }
        let revision = format!("{:x}", Sha256::digest(text.as_bytes()));
        if resource
            .revision()
            .is_some_and(|expected| expected != revision)
        {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::RevisionUnavailable,
                retryable: false,
            });
        }
        let mut transcript = Transcript::parse(&text);
        if transcript.id.is_empty() {
            // A hand-created file may omit the id; the ref is the authority.
            transcript.id = resource.id_segments().join("/");
        }
        Ok(OpenedTranscript {
            transcript,
            revision,
        })
    }

    /// Atomic replace: flushed temp sibling renamed over the target, so no reader
    /// ever sees a partial transcript.
    fn commit(path: &std::path::Path, text: &str) -> Result<(), ResourceError> {
        let parent = path.parent().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        std::fs::create_dir_all(parent).map_err(|_| ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: true,
        })?;
        let temporary = parent.join(format!(
            ".{}.tmp",
            path.file_name().unwrap_or_default().to_string_lossy()
        ));
        {
            let mut handle =
                std::fs::File::create(&temporary).map_err(|_| ResourceError::Unavailable {
                    reason: ResourceUnavailableReason::OwnerUnavailable,
                    retryable: true,
                })?;
            handle
                .write_all(text.as_bytes())
                .and_then(|()| handle.sync_all())
                .map_err(|_| ResourceError::Unavailable {
                    reason: ResourceUnavailableReason::OwnerUnavailable,
                    retryable: true,
                })?;
        }
        std::fs::rename(&temporary, path).map_err(|_| {
            let _ = std::fs::remove_file(&temporary);
            ResourceError::Unavailable {
                reason: ResourceUnavailableReason::OwnerUnavailable,
                retryable: true,
            }
        })
    }

    fn target(transcript: &Transcript) -> Option<String> {
        (!transcript.label.is_empty()).then(|| transcript.label.clone())
    }

    /// What the reviewer sees: the turn being added and where it lands. The
    /// content itself is shown because approving a write to your own history
    /// without seeing it would be approving nothing.
    fn stage_append(
        resource: &ResourceRef,
        opened: &OpenedTranscript,
        role: &str,
        content: &str,
    ) -> Outcome {
        let turns = opened.transcript.messages.len();
        Outcome::staged(
            resource.clone(),
            Self::target(&opened.transcript).unwrap_or_else(|| "this conversation".to_owned()),
            format!("{turns} turns"),
            format!("{} turns, ending with {role}: {}", turns + 1, preview(content)),
        )
        .with_precondition("Revision", opened.revision.clone())
    }

    /// A stale revision is a real state, not a crash: someone else appended
    /// first. The caller is told the current revision so it can retry against
    /// what is actually there. (ADR-002 substrate §15.2 v87 clause 2)
    fn precondition_failed(resource: &ResourceRef, expected: &str, actual: &str) -> Outcome {
        Outcome {
            resource: resource.clone(),
            target: None,
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: Some(Feedback {
                code: "precondition_failed".to_owned(),
                message: "the conversation changed since it was read, so nothing was written"
                    .to_owned(),
                severity: FeedbackSeverity::Error,
                field: Some("expected_revision".to_owned()),
                retryable: true,
                details: serde_json::Map::from_iter([
                    ("expected_revision".to_owned(), json!(expected)),
                    ("current_revision".to_owned(), json!(actual)),
                ]),
            }),
            result: None,
        }
        .with_precondition("Revision", actual.to_owned())
    }
}

fn default_root() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .filter(|home| !home.is_empty())
        .map(|home| PathBuf::from(home).join(".ctrl").join("sessions"))
}

/// A transcript is the user's own content, so the vault/notes grant governs it
/// rather than a new domain. (ADR-002 substrate §17 v85)
fn authorize(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "vault" | "notes"))
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

const STAGE_PREVIEW_BYTES: usize = 240;

fn preview(content: &str) -> String {
    if content.len() <= STAGE_PREVIEW_BYTES {
        return content.to_owned();
    }
    let mut end = STAGE_PREVIEW_BYTES;
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    // State the real length so a truncated preview is never mistaken for the
    // whole turn being approved.
    format!("{}… ({} bytes total)", &content[..end], content.len())
}

fn append_input_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["kind", "expected_revision", "role", "content"],
        "properties": {
            "kind": { "const": APPEND_MESSAGE },
            "expected_revision": { "type": "string" },
            "role": { "type": "string", "minLength": 1 },
            "content": { "type": "string" },
            "label": { "type": "string" },
            "resources": { "type": "array", "items": { "type": "string" } },
            "selected_fct": { "type": "string" }
        },
        "additionalProperties": false
    })
}

fn outcome_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["resource"],
        "properties": {
            "resource": { "type": "string" },
            "target": { "type": "string" },
            "staged": { "type": "object" },
            "preconditions": { "type": "array" },
            "provenance": { "type": "array" },
            "effect": { "type": "object" },
            "feedback": { "type": "object" },
            "result": {}
        },
        "additionalProperties": false
    })
}

#[async_trait]
impl ResourceOwner for SessionResourceOwner {
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
            // The file really is Markdown; a transcript viewer is a rendering
            // preference, not a private format.
            content_type: "text/markdown".to_owned(),
            // The resources this conversation worked on are its provenance, so
            // drill-down from a transcript reaches them by canonical ref.
            provenance: opened
                .transcript
                .resources
                .iter()
                .filter_map(|reference| reference.parse::<ResourceRef>().ok())
                .collect(),
            freshness: ResourceFreshness {
                observed_at: None,
                revision: Some(opened.revision),
                stale: false,
            },
            degradation: None::<ResourceDegradation>,
            presentation: PresentationHints {
                viewer: Some("transcript".to_owned()),
                title: Self::target(&opened.transcript),
                preferred_columns: Vec::new(),
            },
            query: QueryContract {
                request_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": false
                }),
                result_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "required": ["resource", "revision", "transcript"],
                    "properties": {
                        "resource": { "type": "string" },
                        "revision": { "type": "string" },
                        "transcript": { "type": "object" }
                    },
                    "additionalProperties": false
                }),
                watchable: false,
            },
            // Appending a turn is the only write. Editing or deleting history is
            // deliberately absent: the file is the record, and the user already
            // has an editor for it. (ADR-002 substrate §15.2 v87)
            produce: vec![ProduceOperationDescriptor {
                kind: APPEND_MESSAGE.to_owned(),
                input_schema: append_input_schema(),
                result_schema: outcome_schema(),
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
            "transcript": opened.transcript,
        }))
    }

    /// Stage before authorizing, so the review request carries what will change
    /// rather than a tool name. (ADR-002 substrate §15.2 v87 clause 1)
    async fn stage(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Outcome, ResourceError> {
        authorize(context)?;
        let SessionOperation::AppendMessage {
            expected_revision,
            role,
            content,
            ..
        } = serde_json::from_value(operation).map_err(invalid)?;
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            return Ok(Self::precondition_failed(
                resource,
                &expected_revision,
                &opened.revision,
            ));
        }
        Ok(Self::stage_append(resource, &opened, &role, &content))
    }

    async fn produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: Value,
    ) -> Result<Value, ResourceError> {
        authorize(context)?;
        let SessionOperation::AppendMessage {
            expected_revision,
            role,
            content,
            label,
            resources,
            selected_fct,
        } = serde_json::from_value(operation).map_err(invalid)?;
        let path = self.path_for(resource)?;

        let _guard = self.write_lock.lock().await;

        // Clause 2: recheck immediately before mutating; nothing is written on a
        // mismatch, so a concurrent append is never silently overwritten.
        let opened = self.read(resource)?;
        if expected_revision != opened.revision {
            let outcome = Self::precondition_failed(resource, &expected_revision, &opened.revision);
            return serde_json::to_value(outcome).map_err(invalid);
        }

        let mut transcript = opened.transcript;
        if transcript.id.is_empty() {
            transcript.id = resource.id_segments().join("/");
        }
        if let Some(label) = label {
            transcript.label = label;
        }
        if let Some(resources) = resources {
            transcript.resources = resources;
        }
        // An absent selection means Auto, so only an explicit value is recorded.
        if let Some(fct) = selected_fct.filter(|value| !value.is_empty()) {
            transcript.selected_fct = Some(fct);
        }
        transcript.messages.push(TranscriptMessage {
            role: role.clone(),
            content,
        });
        let now = now_iso8601();
        if transcript.created_at.is_empty() {
            transcript.created_at = now.clone();
        }
        transcript.last_active_at = now;

        let rendered = transcript.render();
        let expected_next = format!("{:x}", Sha256::digest(rendered.as_bytes()));

        // Clause 4: atomic commit. The previous transcript is the recovery point
        // and stays in memory here, so a failed verify can restore it.
        let previous = rendered_previous(&opened.revision, &path);
        Self::commit(&path, &rendered)?;

        // Clause 5: reread before claiming anything. Success is only ever
        // reported from observed state.
        let committed = self.read(resource);
        let observed = match &committed {
            Ok(current) if current.revision == expected_next => current.revision.clone(),
            _ => {
                // Clause 6: restore what was there and report the rollback.
                let restored = previous
                    .as_deref()
                    .is_some_and(|text| Self::commit(&path, text).is_ok());
                let outcome = Outcome {
                    resource: resource.clone(),
                    target: None,
                    staged: None,
                    preconditions: Vec::new(),
                    provenance: Vec::new(),
                    effect: None,
                    feedback: Some(Feedback {
                        code: if restored {
                            "write_rolled_back".to_owned()
                        } else {
                            "rollback_failed".to_owned()
                        },
                        message: if restored {
                            "the conversation did not match after writing, so the previous transcript was restored".to_owned()
                        } else {
                            "the conversation could not be verified or restored".to_owned()
                        },
                        severity: FeedbackSeverity::Error,
                        field: None,
                        retryable: restored,
                        details: serde_json::Map::from_iter([(
                            "expected_revision".to_owned(),
                            json!(expected_next),
                        )]),
                    }),
                    result: None,
                };
                return serde_json::to_value(outcome).map_err(invalid);
            }
        };

        let outcome = Outcome {
            resource: resource.clone(),
            target: Self::target(&transcript),
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: Some(json!({
                "revision": observed,
                "turn_count": transcript.messages.len(),
                "last_active_at": transcript.last_active_at,
            })),
        }
        .with_precondition("Revision", expected_revision)
        .committed(
            format!("appended a {role} turn to the conversation"),
            Some("post-write reread matched the expected revision".to_owned()),
        );
        debug_assert!(outcome.is_verified_success());
        serde_json::to_value(outcome).map_err(invalid)
    }
}

/// The bytes to restore if verification fails. Read from disk rather than
/// re-rendered, because a hand-edited file must come back exactly as the user
/// left it, not as this module would have written it.
fn rendered_previous(revision: &str, path: &std::path::Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    // Only restore what we actually observed; otherwise leave the file alone.
    (format!("{:x}", Sha256::digest(text.as_bytes())) == revision).then_some(text)
}

/// UTC, second precision. Sortable as text, which is what `list` relies on.
fn now_iso8601() -> String {
    chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> (SessionResourceOwner, tempfile::TempDir) {
        let root = tempfile::tempdir().expect("temp dir");
        (SessionResourceOwner::new(root.path().to_path_buf()), root)
    }

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["vault".to_owned()],
        }
    }

    fn unauthorized() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["web".to_owned()],
        }
    }

    fn reference(id: &str) -> ResourceRef {
        format!("ctrl://local/session/{id}")
            .parse()
            .expect("valid ref")
    }

    fn append(revision: &str, role: &str, content: &str) -> Value {
        json!({
            "kind": APPEND_MESSAGE,
            "expected_revision": revision,
            "role": role,
            "content": content
        })
    }

    async fn revision_of(owner: &SessionResourceOwner, resource: &ResourceRef) -> String {
        owner
            .describe(&context(), resource)
            .await
            .expect("describe")
            .freshness
            .revision
            .expect("a revision")
    }

    /// A session that does not exist yet is empty, not broken: the first turn
    /// creates the file.
    #[tokio::test]
    async fn an_unwritten_session_describes_as_empty_rather_than_missing() {
        let (owner, _root) = owner();
        let descriptor = owner
            .describe(&context(), &reference("new"))
            .await
            .expect("describe");
        assert_eq!(descriptor.content_type, "text/markdown");
        assert_eq!(descriptor.presentation.viewer.as_deref(), Some("transcript"));
        assert_eq!(descriptor.produce.len(), 1);
        assert_eq!(descriptor.produce[0].kind, APPEND_MESSAGE);
        assert!(descriptor.produce[0].review_required);
    }

    #[tokio::test]
    async fn appending_a_turn_writes_a_readable_file_and_verifies_it() {
        let (owner, root) = owner();
        let resource = reference("chat");
        let revision = revision_of(&owner, &resource).await;
        let outcome = owner
            .produce(
                &context(),
                &resource,
                append(&revision, "user", "what did I decide?"),
            )
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(
            outcome.is_verified_success(),
            "success must come from a reread, not from the write returning"
        );
        assert_eq!(outcome.result.as_ref().unwrap()["turn_count"], json!(1));

        // The vim test: the file on disk is legible without CTRL.
        let text = std::fs::read_to_string(root.path().join("chat.md")).expect("file");
        assert!(text.contains("## user"));
        assert!(text.contains("what did I decide?"));
    }

    #[tokio::test]
    async fn turns_accumulate_across_appends_in_order() {
        let (owner, _root) = owner();
        let resource = reference("chat");
        for (role, content) in [("user", "first"), ("assistant", "second"), ("user", "third")] {
            let revision = revision_of(&owner, &resource).await;
            owner
                .produce(&context(), &resource, append(&revision, role, content))
                .await
                .expect("produce");
        }
        let result = owner
            .query(&context(), &resource, json!({}))
            .await
            .expect("query");
        let transcript: Transcript =
            serde_json::from_value(result["transcript"].clone()).expect("transcript");
        let contents: Vec<&str> = transcript
            .messages
            .iter()
            .map(|message| message.content.as_str())
            .collect();
        assert_eq!(contents, vec!["first", "second", "third"]);
        assert!(!transcript.created_at.is_empty());
        assert!(!transcript.last_active_at.is_empty());
    }

    /// A concurrent append must not be silently overwritten.
    #[tokio::test]
    async fn a_stale_revision_writes_nothing_and_reports_the_current_one() {
        let (owner, root) = owner();
        let resource = reference("chat");
        let stale = revision_of(&owner, &resource).await;
        owner
            .produce(&context(), &resource, append(&stale, "user", "first"))
            .await
            .expect("produce");

        let outcome = owner
            .produce(&context(), &resource, append(&stale, "user", "racing"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        let feedback = outcome.feedback.clone().expect("feedback");
        assert_eq!(feedback.code, "precondition_failed");
        assert!(feedback.retryable, "the caller can reread and retry");
        assert!(feedback.details.contains_key("current_revision"));
        assert!(!outcome.is_verified_success());

        let text = std::fs::read_to_string(root.path().join("chat.md")).expect("file");
        assert!(!text.contains("racing"), "nothing was written");
    }

    #[tokio::test]
    async fn staging_reports_the_turn_being_added_before_any_write() {
        let (owner, root) = owner();
        let resource = reference("chat");
        let revision = revision_of(&owner, &resource).await;
        let outcome = owner
            .stage(&context(), &resource, append(&revision, "user", "hello"))
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("review facts");
        assert_eq!(facts.before, "0 turns");
        assert!(facts.after.contains("hello"), "the reviewer sees the turn");
        assert!(facts
            .preconditions
            .iter()
            .any(|precondition| precondition.label == "Revision"));
        assert!(
            !root.path().join("chat.md").exists(),
            "staging must not write"
        );
    }

    #[tokio::test]
    async fn a_stale_stage_reports_the_precondition_instead_of_staging() {
        let (owner, _root) = owner();
        let resource = reference("chat");
        let outcome = owner
            .stage(&context(), &resource, append("not-the-revision", "user", "hi"))
            .await
            .expect("stage");
        assert!(outcome.staged.is_none());
        assert_eq!(outcome.feedback.expect("feedback").code, "precondition_failed");
    }

    /// A session id names one transcript; it can never reach outside the
    /// transcript directory.
    #[tokio::test]
    async fn a_traversing_session_id_is_refused() {
        let (owner, _root) = owner();
        for id in ["..", ".", "a/b", "a%2Fb"] {
            let Ok(resource) = format!("ctrl://local/session/{id}").parse::<ResourceRef>() else {
                continue;
            };
            let result = owner.describe(&context(), &resource).await;
            assert!(
                matches!(result, Err(ResourceError::InvalidPayload { .. })),
                "id {id:?} must be refused, got {:?}",
                result.map(|descriptor| descriptor.resource.to_string())
            );
        }
    }

    #[tokio::test]
    async fn a_caller_without_the_vault_grant_is_denied() {
        let (owner, _root) = owner();
        let resource = reference("chat");
        assert!(matches!(
            owner.describe(&unauthorized(), &resource).await,
            Err(ResourceError::Denied)
        ));
        assert!(matches!(
            owner.produce(&unauthorized(), &resource, append("x", "user", "hi")).await,
            Err(ResourceError::Denied)
        ));
    }

    /// The directory is the list, so a hand-placed file appears in history.
    #[tokio::test]
    async fn listing_reads_the_directory_and_includes_a_hand_written_transcript() {
        let (owner, root) = owner();
        assert!(owner.list().expect("list").is_empty(), "no sessions yet");

        std::fs::write(
            root.path().join("manual.md"),
            "---\nid: \"manual\"\nlabel: \"By hand\"\nlast_active_at: \"2026-01-01T00:00:00Z\"\nresources: []\n---\n\n## user\n\nhi\n",
        )
        .expect("write");
        // A temp sibling from an interrupted write is not a session.
        std::fs::write(root.path().join(".chat.md.tmp"), "partial").expect("write");

        let rows = owner.list().expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["label"], json!("By hand"));
        assert_eq!(rows[0]["turn_count"], json!(1));
        assert_eq!(rows[0]["resource"], json!("ctrl://local/session/manual"));
    }

    #[tokio::test]
    async fn listing_puts_the_most_recently_active_session_first() {
        let (owner, root) = owner();
        for (id, when) in [("old", "2026-01-01T00:00:00Z"), ("new", "2026-06-01T00:00:00Z")] {
            std::fs::write(
                root.path().join(format!("{id}.md")),
                format!("---\nid: \"{id}\"\nlabel: \"{id}\"\nlast_active_at: \"{when}\"\nresources: []\n---\n"),
            )
            .expect("write");
        }
        let rows = owner.list().expect("list");
        assert_eq!(rows[0]["id"], json!("new"));
        assert_eq!(rows[1]["id"], json!("old"));
    }

    /// Metadata the session owns travels with the turn, so the file stays the
    /// whole truth instead of half of it.
    #[tokio::test]
    async fn an_append_can_refresh_the_label_resources_and_fct() {
        let (owner, _root) = owner();
        let resource = reference("chat");
        let revision = revision_of(&owner, &resource).await;
        owner
            .produce(
                &context(),
                &resource,
                json!({
                    "kind": APPEND_MESSAGE,
                    "expected_revision": revision,
                    "role": "user",
                    "content": "look at the budget",
                    "label": "Budget work",
                    "resources": ["ctrl://local/note/Budget.md"],
                    "selected_fct": "pack:office"
                }),
            )
            .await
            .expect("produce");
        let descriptor = owner.describe(&context(), &resource).await.expect("describe");
        assert_eq!(descriptor.presentation.title.as_deref(), Some("Budget work"));
        // The resources worked on are reachable as provenance by canonical ref.
        assert_eq!(
            descriptor
                .provenance
                .iter()
                .map(|reference| reference.to_string())
                .collect::<Vec<_>>(),
            vec!["ctrl://local/note/Budget.md"]
        );
        let transcript: Transcript = serde_json::from_value(
            owner.query(&context(), &resource, json!({})).await.expect("query")["transcript"]
                .clone(),
        )
        .expect("transcript");
        assert_eq!(transcript.selected_fct.as_deref(), Some("pack:office"));
    }

    /// A hand-edited transcript must be appendable, which is the point of a
    /// tolerant format: the user's own edits do not lock them out.
    #[tokio::test]
    async fn a_hand_edited_transcript_can_still_be_appended_to() {
        let (owner, root) = owner();
        std::fs::write(
            root.path().join("chat.md"),
            "## user\n\nI edited this by hand\n",
        )
        .expect("write");
        let resource = reference("chat");
        let revision = revision_of(&owner, &resource).await;
        let outcome = owner
            .produce(&context(), &resource, append(&revision, "assistant", "noted"))
            .await
            .expect("produce");
        let outcome: Outcome = serde_json::from_value(outcome).expect("outcome");
        assert!(outcome.is_verified_success());
        let text = std::fs::read_to_string(root.path().join("chat.md")).expect("file");
        assert!(
            text.contains("I edited this by hand"),
            "hand-written history is preserved, not discarded"
        );
        assert!(text.contains("noted"));
    }

    #[tokio::test]
    async fn an_unknown_operation_kind_is_refused_rather_than_guessed() {
        let (owner, _root) = owner();
        assert!(matches!(
            owner
                .produce(
                    &context(),
                    &reference("chat"),
                    json!({ "kind": "delete_history" })
                )
                .await,
            Err(ResourceError::InvalidPayload { .. })
        ));
    }
}
