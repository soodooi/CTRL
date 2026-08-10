//! Canonical Markdown note Resource owner.
//!
//! One ref addresses one actual Markdown file. Reads retain the stable handle
//! selected beneath the authorized vault root; no checked path is reopened.
//! (ADR-002 substrate §15 v83)

use super::{
    resource::{
        Feedback, FeedbackSeverity, Outcome, OutcomeEffect, OutcomeStagedChange, PresentationHints,
        ProduceOperationDescriptor, QueryContract, ResourceAccessContext, ResourceDegradation,
        ResourceDescriptor, ResourceError, ResourceFreshness, ResourceOwner, ResourceRef,
        ResourceUnavailableReason,
    },
    resource_fs::{OpenedMetadata, StableHandleError, StableRoot},
};
use async_trait::async_trait;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    io::{Read, Write},
    os::unix::fs::OpenOptionsExt,
    path::PathBuf,
    sync::Arc,
};

const MAX_MARKDOWN_BYTES: u64 = 16 * 1024 * 1024;
const REPLACE_CONTENT: &str = "replace_content";
/// Preview length for staged before/after. A review surface needs enough to
/// judge the change without the request carrying a whole document.
const STAGE_PREVIEW_BYTES: usize = 2000;

/// The one bounded write this owner accepts. (ADR-002 substrate §15.2 v87)
#[derive(Debug, Deserialize)]
struct ReplaceContent {
    kind: String,
    expected_revision: String,
    content: String,
}

pub struct MarkdownNoteOwner {
    root: Option<PathBuf>,
    /// Recovery points live beneath the kernel-managed derivative state root,
    /// never inside the user's content tree — a recovery file inside the vault
    /// would be addressable as an ordinary note and would pollute user content.
    /// (ADR-002 §15.2 v87 clause 3)
    recovery_root: Option<PathBuf>,
}

/// Kernel-managed derivative state root, outside any user content tree.
fn default_recovery_root() -> Option<PathBuf> {
    std::env::var_os("HOME").map(|home| {
        PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("note-recovery")
    })
}

impl MarkdownNoteOwner {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root: Some(root),
            recovery_root: default_recovery_root(),
        }
    }

    /// Explicit recovery root. Used by tests and by callers that place the
    /// derivative state root elsewhere; it must never point inside the vault.
    pub fn with_recovery_root(mut self, recovery_root: PathBuf) -> Self {
        self.recovery_root = Some(recovery_root);
        self
    }

    pub fn from_default_vault() -> Self {
        Self {
            root: super::vault::default_vault_root(),
            recovery_root: default_recovery_root(),
        }
    }

    /// The shared per-file lock. Keyed on file identity only: `Display` includes
    /// `?rev=`, so keying on the whole ref would give a pinned and an unpinned
    /// ref to the SAME file two different mutexes, and the registry is process-
    /// wide so legacy bespoke vault writes serialize against this one too.
    /// (ADR-002 §15.2 v87 clause 7)
    fn write_lock(&self, resource: &ResourceRef) -> Arc<tokio::sync::Mutex<()>> {
        super::vault_write_lock::for_path(&resource.id_segments().join("/"))
    }

    fn parse_replace(operation: serde_json::Value) -> Result<ReplaceContent, ResourceError> {
        let parsed: ReplaceContent =
            serde_json::from_value(operation).map_err(|error| ResourceError::InvalidPayload {
                message: error.to_string(),
            })?;
        if parsed.kind != REPLACE_CONTENT {
            return Err(ResourceError::UnsupportedOperation);
        }
        if parsed.content.len() as u64 > MAX_MARKDOWN_BYTES {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::PayloadTooLarge,
                retryable: false,
            });
        }
        Ok(parsed)
    }

    fn actual_path(&self, resource: &ResourceRef) -> Result<PathBuf, ResourceError> {
        let root = self.root.as_deref().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        // Resolution already happened through the stable-handle path in `read`;
        // this only rebuilds the location for the commit step, which re-verifies
        // the revision through a fresh handle before mutating.
        let mut path = root.to_path_buf();
        for segment in resource.id_segments() {
            path.push(segment);
        }
        Ok(path)
    }

    /// Durably capture the previous bytes before mutating. Failure aborts the
    /// write. (ADR-002 substrate §15.2 v87 clause 3)
    ///
    /// This delegates to the shared `record_write::RecoveryPoint` rather than
    /// keeping a second implementation: one recovery point serves every canonical
    /// write, and the copy this owner used to make was keyed on the ref alone. A
    /// ResourceRef names a note relative to a root, so two vault roots holding
    /// `Inbox.md` collided on one key — and the capture truncates, so the second
    /// write destroyed the first's only way back. The shared key includes the
    /// content root. (ADR-002 substrate §15.2 v90)
    fn write_recovery_point(
        &self,
        resource: &ResourceRef,
        previous: &str,
    ) -> Result<super::record_write::RecoveryPoint, ResourceError> {
        // The content root is the scope the ref is resolved against, so it is part
        // of the recovery key. (ADR-002 substrate §15.2 v90)
        let scope = self.root.as_deref().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        super::record_write::RecoveryPoint::capture(
            self.recovery_root.as_deref(),
            scope,
            resource,
            previous,
        )
    }

    /// Flushed temporary sibling renamed over the target, so a reader never
    /// observes a partial file. (ADR-002 §15.2 v87 clause 4)
    fn commit_atomically(path: &std::path::Path, content: &str) -> Result<(), ResourceError> {
        let unavailable = || ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: true,
        };
        let directory = path.parent().ok_or_else(unavailable)?;
        // A UNIQUE staging name. A fixed name plus `create_new` would mean one
        // crash mid-staging leaves a leftover file that blocks every later write
        // to this note forever.
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let temporary = directory.join(format!(
            ".{}.{unique}.ctrl-tmp",
            path.file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(unavailable)?
        ));
        // O_EXCL | O_NOFOLLOW: a pre-planted symlink or file at the staging name
        // must not redirect the write outside the authorized root, and a colliding
        // writer must fail rather than share the staging file.
        // (ADR-002 substrate §15.1 v82 no-follow discipline; §15.2 v87 clause 8)
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&temporary)
            .map_err(|_| unavailable())?;
        // Only now may this call unlink that path: cleaning up before a successful
        // create would delete a file another writer owns.
        let staged = (|| -> Result<(), ResourceError> {
            file.write_all(content.as_bytes())
                .map_err(|_| unavailable())?;
            file.sync_all().map_err(|_| unavailable())?;
            // rename(2) replaces the final component itself and never follows a
            // symlink there, so a swapped-in link is overwritten, not escaped.
            std::fs::rename(&temporary, path).map_err(|_| unavailable())
        })();
        if staged.is_err() {
            let _ = std::fs::remove_file(&temporary);
            return staged;
        }
        if let Ok(handle) = std::fs::File::open(directory) {
            let _ = handle.sync_all();
        }
        Ok(())
    }

    fn precondition_failed(resource: &ResourceRef, expected: &str, actual: &str) -> Outcome {
        Outcome {
            // A typed failure always names the real resource; a placeholder ref
            // would report a nonexistent object. (ADR-002 substrate §15.5 v86)
            resource: resource.clone(),
            target: None,
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: Some(Feedback {
                code: "precondition_failed".to_owned(),
                message: "the note changed since it was staged; nothing was written".to_owned(),
                severity: FeedbackSeverity::Error,
                field: Some("expected_revision".to_owned()),
                retryable: true,
                details: serde_json::Map::from_iter([
                    ("expected".to_owned(), json!(expected)),
                    ("actual".to_owned(), json!(actual)),
                ]),
            }),
            result: None,
        }
    }

    fn read(&self, resource: &ResourceRef) -> Result<OpenedNote, ResourceError> {
        if resource.authority() != super::resource::ResourceAuthority::Local
            || resource.kind() != "note"
            || !resource
                .id_segments()
                .last()
                .is_some_and(|segment| segment.ends_with(".md"))
        {
            return Err(ResourceError::OwnerNotFound);
        }

        let root_path = self.root.as_deref().ok_or(ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        let root = StableRoot::open(root_path, |metadata| metadata.is_directory)
            .map_err(map_handle_error)?;
        let opened = root
            .open_beneath(resource.id_segments(), authorize_regular_file)
            .map_err(map_handle_error)?;
        let metadata = opened.metadata().clone();
        if metadata.size > MAX_MARKDOWN_BYTES {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::PayloadTooLarge,
                retryable: false,
            });
        }
        let mut bytes = Vec::with_capacity(metadata.size as usize);
        opened
            .into_file()
            .take(MAX_MARKDOWN_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ResourceError::Unavailable {
                reason: ResourceUnavailableReason::OwnerUnavailable,
                retryable: true,
            })?;
        if bytes.len() as u64 > MAX_MARKDOWN_BYTES {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::PayloadTooLarge,
                retryable: false,
            });
        }
        let content = String::from_utf8(bytes).map_err(|_| ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        })?;
        let revision = format!("{:x}", Sha256::digest(content.as_bytes()));
        if resource
            .revision()
            .is_some_and(|expected| expected != revision)
        {
            return Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::RevisionUnavailable,
                retryable: false,
            });
        }
        Ok(OpenedNote {
            content,
            revision,
            size: metadata.size,
        })
    }
}

#[async_trait]
impl ResourceOwner for MarkdownNoteOwner {
    async fn describe(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
    ) -> Result<ResourceDescriptor, ResourceError> {
        authorize_context(context)?;
        let note = self.read(resource)?;
        Ok(ResourceDescriptor {
            protocol_version: "1.0.0".to_owned(),
            resource: resource.clone(),
            content_type: "text/markdown".to_owned(),
            provenance: Vec::new(),
            freshness: ResourceFreshness {
                observed_at: None,
                revision: Some(note.revision),
                stale: false,
            },
            degradation: None::<ResourceDegradation>,
            presentation: PresentationHints {
                viewer: Some("markdown".to_owned()),
                title: resource.id_segments().last().cloned(),
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
                    "required": ["resource", "revision", "content_type", "content", "size"],
                    "properties": {
                        "resource": { "type": "string" },
                        "revision": { "type": "string" },
                        "content_type": { "const": "text/markdown" },
                        "content": { "type": "string" },
                        "size": { "type": "integer", "minimum": 0 }
                    },
                    "additionalProperties": false
                }),
                watchable: false,
            },
            // One bounded whole-note replacement. Partial-range writes,
            // multi-file transactions, and durable effects stay unsupported.
            // (ADR-002 substrate §15.2 v87)
            produce: vec![ProduceOperationDescriptor {
                kind: REPLACE_CONTENT.to_owned(),
                input_schema: json!({
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "required": ["kind", "expected_revision", "content"],
                    "properties": {
                        "kind": { "const": REPLACE_CONTENT },
                        "expected_revision": { "type": "string", "minLength": 1 },
                        "content": { "type": "string" }
                    },
                    "additionalProperties": false
                }),
                result_schema: json!({
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
                }),
                review_required: true,
                recovery: super::resource::OperationRecoveryPolicy::RestartRecoveryUnsupported,
                retention_seconds: 0,
            }],
        })
    }

    async fn query(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        authorize_context(context)?;
        let note = self.read(resource)?;
        Ok(json!({
            "resource": resource,
            "revision": note.revision,
            "content_type": "text/markdown",
            "content": note.content,
            "size": note.size
        }))
    }

    /// Stage the replacement so approval facts exist before authorization.
    /// (ADR-002 substrate §15.2 v87 clause 1)
    async fn stage(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: serde_json::Value,
    ) -> Result<Outcome, ResourceError> {
        authorize_context(context)?;
        let requested = Self::parse_replace(operation)?;
        let note = self.read(resource)?;
        if requested.expected_revision != note.revision {
            return Ok(Self::precondition_failed(
                resource,
                &requested.expected_revision,
                &note.revision,
            ));
        }
        Ok(Outcome {
            resource: resource.clone(),
            target: resource.id_segments().last().cloned(),
            staged: Some(OutcomeStagedChange {
                before: preview(&note.content),
                after: preview(&requested.content),
            }),
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: None,
            feedback: None,
            result: None,
        }
        .with_precondition("Revision", note.revision))
    }

    /// Commit the replacement under the full §15.2 v87 write contract.
    async fn produce(
        &self,
        context: &ResourceAccessContext,
        resource: &ResourceRef,
        operation: serde_json::Value,
    ) -> Result<serde_json::Value, ResourceError> {
        authorize_context(context)?;
        let requested = Self::parse_replace(operation)?;

        // Recheck, commit, reread, and rollback are one critical section per
        // resource. Without it two writers can both pass the recheck and the
        // loser's rollback reverts content the winner already verified.
        // (ADR-002 substrate §15.2 v87 clauses 2/4/6)
        let lock = self.write_lock(resource);
        let _guard = lock.lock().await;

        // Clause 2: recheck the revision through a freshly resolved handle
        // immediately before mutating. Nothing is written on a mismatch.
        let current = self.read(resource)?;
        if requested.expected_revision != current.revision {
            let outcome = Self::precondition_failed(
                resource,
                &requested.expected_revision,
                &current.revision,
            );
            return serde_json::to_value(outcome).map_err(invalid_payload);
        }

        // Clause 3: durable recovery point before any mutation.
        let recovery = self.write_recovery_point(resource, &current.content)?;
        let path = self.actual_path(resource)?;
        let expected_revision = format!("{:x}", Sha256::digest(requested.content.as_bytes()));

        // Clause 4: atomic commit.
        Self::commit_atomically(&path, &requested.content)?;

        // Clause 5: post-write reread through a stable handle; success is only
        // ever reported from observed state.
        let committed = self.read(resource);
        let observed = match &committed {
            Ok(note) if note.revision == expected_revision => note.revision.clone(),
            _ => {
                // Clause 6: restore the recovery point and report the rollback
                // rather than claiming success. A copy that cannot be read back is
                // NOT an empty previous content: restoring that would destroy the
                // note instead of undoing the write, so it is a failed rollback.
                // (ADR-002 substrate §15.2 v87 clause 6)
                let restored = recovery
                    .previous()
                    .and_then(|previous| Self::commit_atomically(&path, &previous).ok())
                    .is_some();
                let feedback = if restored {
                    Feedback {
                        code: "write_rolled_back".to_owned(),
                        message: "the note did not match after writing, so the previous content was restored".to_owned(),
                        severity: FeedbackSeverity::Error,
                        field: None,
                        retryable: true,
                        details: serde_json::Map::from_iter([(
                            "expected_revision".to_owned(),
                            json!(expected_revision),
                        )]),
                    }
                } else {
                    // The one case the copy must outlive this call: the note holds
                    // a state the owner did not intend and could not undo, so the
                    // copy is the user's only way back and the reply names it.
                    // (ADR-002 substrate §15.2 v87 clause 6)
                    recovery.retain();
                    Feedback {
                        code: "rollback_failed".to_owned(),
                        message: "the note could not be verified or restored; the recovery point holds the previous content".to_owned(),
                        severity: FeedbackSeverity::Error,
                        field: None,
                        retryable: false,
                        details: serde_json::Map::from_iter([(
                            "recovery_point".to_owned(),
                            json!(recovery.location()),
                        )]),
                    }
                };
                let outcome = Outcome {
                    resource: resource.clone(),
                    target: resource.id_segments().last().cloned(),
                    staged: None,
                    preconditions: Vec::new(),
                    provenance: Vec::new(),
                    effect: None,
                    feedback: Some(feedback),
                    result: None,
                };
                return serde_json::to_value(outcome).map_err(invalid_payload);
            }
        };

        // The write is verified, so the copy has done its job. It is a verbatim
        // copy of the user's content sitting outside the tree they chose for it,
        // so keeping it past this point would leave their note duplicated in
        // cleartext under the state root indefinitely.
        // (ADR-002 substrate §15.2 v87 clause 3)
        recovery.discard();

        let outcome = Outcome {
            resource: resource.clone(),
            target: resource.id_segments().last().cloned(),
            staged: None,
            preconditions: Vec::new(),
            provenance: Vec::new(),
            effect: Some(OutcomeEffect {
                summary: "replaced the note content".to_owned(),
                verified_by: Some("post-write reread matched the expected revision".to_owned()),
            }),
            feedback: None,
            result: Some(json!({ "revision": observed })),
        }
        .with_precondition("Revision", requested.expected_revision);
        debug_assert!(outcome.is_verified_success());
        serde_json::to_value(outcome).map_err(invalid_payload)
    }
}

fn preview(content: &str) -> String {
    if content.len() <= STAGE_PREVIEW_BYTES {
        return content.to_owned();
    }
    let mut end = STAGE_PREVIEW_BYTES;
    while end > 0 && !content.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &content[..end])
}

fn invalid_payload(error: serde_json::Error) -> ResourceError {
    ResourceError::InvalidPayload {
        message: error.to_string(),
    }
}

struct OpenedNote {
    content: String,
    revision: String,
    size: u64,
}

fn authorize_context(context: &ResourceAccessContext) -> Result<(), ResourceError> {
    if context
        .capability_scope
        .iter()
        .any(|scope| matches!(scope.as_str(), "*" | "notes" | "vault"))
    {
        Ok(())
    } else {
        Err(ResourceError::Denied)
    }
}

fn authorize_regular_file(metadata: &OpenedMetadata) -> bool {
    metadata.is_regular_file
}

fn map_handle_error(error: StableHandleError) -> ResourceError {
    match error {
        StableHandleError::Denied => ResourceError::Denied,
        StableHandleError::Unavailable { reason } => ResourceError::Unavailable {
            reason,
            retryable: false,
        },
        StableHandleError::NotFound
        | StableHandleError::SymlinkRejected
        | StableHandleError::CrossDeviceMountRejected
        | StableHandleError::NotDirectory
        | StableHandleError::InvalidComponent
        | StableHandleError::Io { .. } => ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::resource::ResourceAuthority;
    use std::{fs, os::unix::fs::symlink};

    fn context() -> ResourceAccessContext {
        ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["notes".to_owned()],
        }
    }

    #[tokio::test]
    async fn describes_and_queries_one_markdown_file() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::create_dir(temporary.path().join("daily")).expect("create daily");
        fs::write(temporary.path().join("daily/today.md"), "# Today\n").expect("write note");
        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf());
        let resource: ResourceRef = "ctrl://local/note/daily/today.md".parse().unwrap();

        let descriptor = owner.describe(&context(), &resource).await.unwrap();
        assert_eq!(descriptor.resource, resource);
        assert_eq!(descriptor.content_type, "text/markdown");
        // v83's read-only assertion is superseded: one bounded, review-required
        // write is now advertised. (ADR-002 substrate §15.2 v87)
        assert_eq!(descriptor.produce.len(), 1);
        let result = owner.query(&context(), &resource, json!({})).await.unwrap();
        assert_eq!(result["content"], "# Today\n");
        assert_eq!(result["content_type"], "text/markdown");
    }

    #[tokio::test]
    async fn revision_is_checked_against_the_opened_content() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "first").expect("write note");
        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf());
        let base: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let descriptor = owner.describe(&context(), &base).await.unwrap();
        let revision = descriptor.freshness.revision.unwrap();
        let pinned: ResourceRef = format!("ctrl://local/note/note.md?rev={revision}")
            .parse()
            .unwrap();
        owner.query(&context(), &pinned, json!({})).await.unwrap();

        fs::write(temporary.path().join("note.md"), "second").expect("replace note");
        assert!(matches!(
            owner.query(&context(), &pinned, json!({})).await,
            Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::RevisionUnavailable,
                ..
            })
        ));
    }

    #[tokio::test]
    async fn rejects_symlink_and_non_markdown_resources_without_path_leaks() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("target.md"), "secret").expect("write target");
        symlink(
            temporary.path().join("target.md"),
            temporary.path().join("link.md"),
        )
        .expect("create link");
        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf());
        let linked: ResourceRef = "ctrl://local/note/link.md".parse().unwrap();
        assert!(owner.query(&context(), &linked, json!({})).await.is_err());

        let non_markdown: ResourceRef = "ctrl://local/note/target.txt".parse().unwrap();
        assert!(matches!(
            owner.query(&context(), &non_markdown, json!({})).await,
            Err(ResourceError::OwnerNotFound)
        ));
        assert_eq!(linked.authority(), ResourceAuthority::Local);
    }

    #[tokio::test]
    async fn rejects_special_files_before_reading() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        let temporary = tempfile::tempdir().expect("temporary vault");
        let fifo_path = temporary.path().join("pipe.md");
        let fifo = CString::new(fifo_path.as_os_str().as_bytes()).expect("FIFO path");
        // SAFETY: `fifo` is a live NUL-terminated path and mkfifo does not
        // retain the pointer.
        assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);

        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf());
        let resource: ResourceRef = "ctrl://local/note/pipe.md".parse().unwrap();
        assert!(matches!(
            owner.query(&context(), &resource, json!({})).await,
            Err(ResourceError::Denied)
        ));
    }

    // ── §15.2 v87 write contract ────────────────────────────────────────────

    fn write_owner(temporary: &tempfile::TempDir) -> (MarkdownNoteOwner, PathBuf) {
        let recovery = temporary.path().join("recovery-state");
        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf())
            .with_recovery_root(recovery.clone());
        (owner, recovery)
    }

    async fn current_revision(owner: &MarkdownNoteOwner, resource: &ResourceRef) -> String {
        owner
            .describe(&context(), resource)
            .await
            .expect("describe")
            .freshness
            .revision
            .expect("revision")
    }

    #[tokio::test]
    async fn advertises_exactly_one_bounded_write() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let descriptor = owner.describe(&context(), &resource).await.unwrap();
        let kinds: Vec<_> = descriptor
            .produce
            .iter()
            .map(|operation| operation.kind.as_str())
            .collect();
        assert_eq!(kinds, vec![REPLACE_CONTENT]);
        assert!(descriptor.produce[0].review_required);
    }

    #[tokio::test]
    async fn staging_returns_review_facts_before_any_write() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let revision = current_revision(&owner, &resource).await;

        let outcome = owner
            .stage(
                &context(),
                &resource,
                json!({
                    "kind": REPLACE_CONTENT,
                    "expected_revision": revision,
                    "content": "after"
                }),
            )
            .await
            .expect("stage");
        let facts = outcome.review_facts().expect("staged facts");
        assert_eq!(facts.before, "before");
        assert_eq!(facts.after, "after");
        assert_eq!(facts.preconditions.len(), 1);
        // Staging must not touch the file.
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "before"
        );
    }

    #[tokio::test]
    async fn a_moved_revision_writes_nothing_and_is_retryable() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let stale = current_revision(&owner, &resource).await;
        fs::write(temporary.path().join("note.md"), "changed elsewhere").expect("external edit");

        let value = owner
            .produce(
                &context(),
                &resource,
                json!({
                    "kind": REPLACE_CONTENT,
                    "expected_revision": stale,
                    "content": "mine"
                }),
            )
            .await
            .expect("typed outcome, not a transport error");
        assert_eq!(value["feedback"]["code"], "precondition_failed");
        assert_eq!(value["feedback"]["retryable"], true);
        assert!(value.get("effect").is_none());
        // The external edit survives; nothing was written.
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "changed elsewhere"
        );
    }

    #[tokio::test]
    async fn a_verified_write_commits_and_reports_its_verification() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, recovery) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let revision = current_revision(&owner, &resource).await;

        let value = owner
            .produce(
                &context(),
                &resource,
                json!({
                    "kind": REPLACE_CONTENT,
                    "expected_revision": revision,
                    "content": "after"
                }),
            )
            .await
            .expect("produce");
        assert!(value.get("feedback").is_none());
        assert_eq!(
            value["effect"]["verified_by"],
            "post-write reread matched the expected revision"
        );
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "after"
        );
        // A VERIFIED write leaves no copy behind. The recovery point exists to
        // make clause 6 possible, not to archive the user's content: it is a
        // verbatim cleartext copy sitting outside the tree they chose for it, so
        // once the write is verified it must be gone.
        // (ADR-002 substrate §15.2 v87 clause 3)
        let saved = fs::read_dir(&recovery)
            .map(|entries| entries.count())
            .unwrap_or(0);
        assert_eq!(saved, 0, "a verified write must not leave a copy behind");
        // No temporary sibling is left behind by the atomic commit.
        let leftovers = fs::read_dir(temporary.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("ctrl-tmp"))
            .count();
        assert_eq!(leftovers, 0);
    }

    /// Two vaults can each hold `Inbox.md`. A ResourceRef names a note RELATIVE
    /// to a root, so a recovery key built from the ref alone collides across
    /// roots — and the capture truncates, so the second write would destroy the
    /// first's only way back. The content root is part of the key.
    /// (ADR-002 substrate §15.2 v90)
    #[test]
    fn two_vaults_holding_the_same_relative_note_get_separate_recovery_points() {
        let shared_recovery = tempfile::tempdir().expect("recovery root");
        let first_vault = tempfile::tempdir().expect("first vault");
        let second_vault = tempfile::tempdir().expect("second vault");
        let resource: ResourceRef = "ctrl://local/note/Inbox.md".parse().unwrap();

        let first = MarkdownNoteOwner::new(first_vault.path().to_path_buf())
            .with_recovery_root(shared_recovery.path().to_path_buf());
        let second = MarkdownNoteOwner::new(second_vault.path().to_path_buf())
            .with_recovery_root(shared_recovery.path().to_path_buf());

        let first_point = first
            .write_recovery_point(&resource, "first vault content")
            .expect("capture first");
        let second_point = second
            .write_recovery_point(&resource, "second vault content")
            .expect("capture second");

        assert_ne!(
            first_point.location(),
            second_point.location(),
            "one recovery file for two different notes loses one of them"
        );
        assert_eq!(
            first_point.previous().as_deref(),
            Some("first vault content"),
            "the second capture must not have overwritten the first"
        );
        assert_eq!(
            second_point.previous().as_deref(),
            Some("second vault content")
        );
    }

    #[tokio::test]
    async fn the_recovery_root_is_never_inside_the_content_tree() {
        // A recovery file inside the vault would be addressable as an ordinary
        // note and would pollute user content. (ADR-002 §15.2 v87 clause 3)
        let temporary = tempfile::tempdir().expect("temporary vault");
        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf());
        let recovery = owner.recovery_root.clone().expect("recovery root");
        assert!(
            !recovery.starts_with(temporary.path()),
            "recovery root {recovery:?} must live outside the vault root"
        );
        assert!(recovery.ends_with("note-recovery"));
    }

    #[test]
    fn staging_refuses_an_existing_link_at_its_own_path() {
        // Direct check of the no-follow/exclusive guarantee: even if an attacker
        // guessed the staging name, the open must fail rather than write through
        // a link. (ADR-002 §15.2 v87 clause 8)
        let temporary = tempfile::tempdir().expect("temporary dir");
        let outside = tempfile::tempdir().expect("attacker dir");
        let escape = outside.path().join("escaped.md");
        let note = temporary.path().join("note.md");
        fs::write(&note, "before").expect("write note");

        // Reproduce the exact staging open the commit performs.
        symlink(&escape, temporary.path().join("staging")).expect("plant link");
        let opened = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .custom_flags(libc::O_NOFOLLOW)
            .open(temporary.path().join("staging"));
        assert!(opened.is_err(), "an existing link must not be opened");
        assert!(!escape.exists(), "nothing may be written outside the root");
    }

    #[tokio::test]
    async fn a_planted_link_at_a_predictable_name_cannot_capture_the_write() {
        // Staging names are unique, so a link planted at a guessed fixed name is
        // simply unused; the note still commits inside the root and nothing is
        // written through the link. (ADR-002 §15.2 v87 clause 8)
        let temporary = tempfile::tempdir().expect("temporary vault");
        let outside = tempfile::tempdir().expect("attacker directory");
        let escape = outside.path().join("escaped.md");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        symlink(&escape, temporary.path().join(".note.md.ctrl-tmp")).expect("plant link");

        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let revision = current_revision(&owner, &resource).await;
        let value = owner
            .produce(
                &context(),
                &resource,
                json!({
                    "kind": REPLACE_CONTENT,
                    "expected_revision": revision,
                    "content": "after"
                }),
            )
            .await
            .expect("produce");
        assert!(value["effect"]["verified_by"].is_string());
        assert!(!escape.exists(), "nothing may be written outside the root");
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "after"
        );
    }

    #[tokio::test]
    async fn staging_leaves_no_leftover_file_that_could_block_later_writes() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();

        for body in ["one", "two", "three"] {
            let revision = current_revision(&owner, &resource).await;
            owner
                .produce(
                    &context(),
                    &resource,
                    json!({
                        "kind": REPLACE_CONTENT,
                        "expected_revision": revision,
                        "content": body
                    }),
                )
                .await
                .expect("repeated writes must keep succeeding");
        }
        let leftovers = fs::read_dir(temporary.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains("ctrl-tmp"))
            .count();
        assert_eq!(leftovers, 0);
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "three"
        );
    }

    #[tokio::test]
    async fn concurrent_writers_do_not_interleave_recheck_and_commit() {
        // One writer wins on the revision; the other must fail its precondition
        // rather than commit or roll back over the winner.
        // (ADR-002 §15.2 v87 clause 7)
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let owner = Arc::new(owner);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let revision = current_revision(&owner, &resource).await;

        let mut handles = Vec::new();
        for body in ["first", "second"] {
            let owner = Arc::clone(&owner);
            let resource = resource.clone();
            let revision = revision.clone();
            handles.push(tokio::spawn(async move {
                owner
                    .produce(
                        &context(),
                        &resource,
                        json!({
                            "kind": REPLACE_CONTENT,
                            "expected_revision": revision,
                            "content": body
                        }),
                    )
                    .await
            }));
        }
        let mut verified = 0;
        let mut precondition_failures = 0;
        for handle in handles {
            let value = handle.await.expect("task").expect("typed outcome");
            if value.get("feedback").is_some() {
                assert_eq!(value["feedback"]["code"], "precondition_failed");
                precondition_failures += 1;
            } else {
                assert!(value["effect"]["verified_by"].is_string());
                verified += 1;
            }
        }
        assert_eq!(verified, 1, "exactly one writer may verify success");
        assert_eq!(precondition_failures, 1);
        let final_content = fs::read_to_string(temporary.path().join("note.md")).unwrap();
        assert!(
            final_content == "first" || final_content == "second",
            "the winner's content must survive, found {final_content:?}"
        );
    }

    #[tokio::test]
    async fn a_stale_stage_names_the_real_resource_in_its_failure() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let outcome = owner
            .stage(
                &context(),
                &resource,
                json!({
                    "kind": REPLACE_CONTENT,
                    "expected_revision": "0".repeat(64),
                    "content": "after"
                }),
            )
            .await
            .expect("stage returns a typed outcome");
        assert_eq!(outcome.resource, resource);
        assert!(outcome.review_facts().is_none());
    }

    #[tokio::test]
    async fn an_unwritable_recovery_point_aborts_before_mutating() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        // A regular file where the recovery directory must be makes create_dir_all fail.
        let blocked = temporary.path().join("blocked-recovery");
        fs::write(&blocked, "not a directory").expect("block recovery root");
        let owner =
            MarkdownNoteOwner::new(temporary.path().to_path_buf()).with_recovery_root(blocked);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let revision = current_revision(&owner, &resource).await;

        let error = owner
            .produce(
                &context(),
                &resource,
                json!({
                    "kind": REPLACE_CONTENT,
                    "expected_revision": revision,
                    "content": "after"
                }),
            )
            .await
            .expect_err("recovery failure aborts the write");
        assert!(matches!(error, ResourceError::Unavailable { .. }));
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "before",
            "the note must be untouched when no recovery point exists"
        );
    }

    #[tokio::test]
    async fn an_unknown_operation_is_unsupported_rather_than_a_silent_write() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let revision = current_revision(&owner, &resource).await;
        assert!(matches!(
            owner
                .produce(
                    &context(),
                    &resource,
                    json!({
                        "kind": "append_section",
                        "expected_revision": revision,
                        "content": "x"
                    }),
                )
                .await,
            Err(ResourceError::UnsupportedOperation)
        ));
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "before"
        );
    }

    #[tokio::test]
    async fn a_write_requires_capability_scope() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        fs::write(temporary.path().join("note.md"), "before").expect("write note");
        let (owner, _) = write_owner(&temporary);
        let resource: ResourceRef = "ctrl://local/note/note.md".parse().unwrap();
        let unscoped = ResourceAccessContext {
            caller: "test".to_owned(),
            capability_scope: vec!["registry".to_owned()],
        };
        assert!(matches!(
            owner
                .produce(
                    &unscoped,
                    &resource,
                    json!({
                        "kind": REPLACE_CONTENT,
                        "expected_revision": "x",
                        "content": "after"
                    }),
                )
                .await,
            Err(ResourceError::Denied)
        ));
        assert_eq!(
            fs::read_to_string(temporary.path().join("note.md")).unwrap(),
            "before"
        );
    }

    #[tokio::test]
    async fn rejects_oversized_notes_before_allocation() {
        let temporary = tempfile::tempdir().expect("temporary vault");
        let note_path = temporary.path().join("large.md");
        fs::File::create(&note_path)
            .expect("create sparse note")
            .set_len(MAX_MARKDOWN_BYTES + 1)
            .expect("extend sparse note");

        let owner = MarkdownNoteOwner::new(temporary.path().to_path_buf());
        let resource: ResourceRef = "ctrl://local/note/large.md".parse().unwrap();
        assert!(matches!(
            owner.query(&context(), &resource, json!({})).await,
            Err(ResourceError::Unavailable {
                reason: ResourceUnavailableReason::PayloadTooLarge,
                retryable: false,
            })
        ));
    }
}
