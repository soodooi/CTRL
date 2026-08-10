//! Shared shapes for record-source writes.
//!
//! Tasks, calendar events, and smart-table cells are three different sources with
//! the same write story: a bounded single-field change, conditioned on the
//! revision the caller read, reported as a typed Outcome. Their stale-precondition
//! reply and their staged before/after must be identical, because a surface reads
//! all three through the same decision rendering — three hand-written copies would
//! drift, and the first divergence would look like a different kind of failure to
//! the user. (ADR-002 substrate §15.2 v87; ADR-002 substrate §15.5 v86)

use serde_json::{json, Value};

use super::resource::{
    Feedback, FeedbackSeverity, Outcome, ResourceError, ResourceRef, ResourceUnavailableReason,
};

/// An empty field is a real state, so it reads as absent rather than as blank
/// space in a staged change.
pub fn display(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        "(none)".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// The source changed since it was read, so what the caller addressed may no
/// longer be what it meant. Nothing is written, and both revisions travel so the
/// caller can show a real conflict instead of a vague failure.
/// (ADR-002 substrate §15.2 v87 clause 2)
pub fn precondition_failed(
    resource: &ResourceRef,
    subject: &str,
    expected: &str,
    actual: &str,
) -> Outcome {
    Outcome {
        resource: resource.clone(),
        target: None,
        staged: None,
        preconditions: Vec::new(),
        provenance: Vec::new(),
        effect: None,
        feedback: Some(Feedback {
            code: "precondition_failed".to_owned(),
            message: format!("the {subject} changed since it was read, so nothing was written"),
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

/// The write committed but did not read back as requested. Reported instead of a
/// success claim, because an unverified write is not a write.
/// (ADR-002 substrate §15.5.2 v86)
pub fn write_unverified(
    resource: &ResourceRef,
    target: Option<String>,
    field: &str,
    expected: &str,
    observed: Option<String>,
) -> Outcome {
    Outcome {
        resource: resource.clone(),
        target,
        staged: None,
        preconditions: Vec::new(),
        provenance: Vec::new(),
        effect: None,
        feedback: Some(Feedback {
            code: "write_unverified".to_owned(),
            message: "the change did not read back with the new value".to_owned(),
            severity: FeedbackSeverity::Error,
            field: Some(field.to_owned()),
            retryable: true,
            details: serde_json::Map::from_iter([
                ("expected".to_owned(), json!(expected)),
                ("observed".to_owned(), json!(observed)),
            ]),
        }),
        result: None,
    }
}

/// The previous bytes, on disk, before anything is modified.
///
/// Holding them in memory is not enough: a crash between the commit and the
/// verifying reread would leave the only copy on a dropped stack, and a failed
/// rollback could not tell the user where their content went. It lives beneath
/// the kernel's derivative state root, never inside the vault, because a
/// recovery file inside the user's content tree would be addressable as an
/// ordinary note. (ADR-002 substrate §15.2 v87 clause 3)
pub struct RecoveryPoint {
    path: std::path::PathBuf,
    /// Whether the file must outlive this value. Only a failed rollback sets it:
    /// there the copy is the user's one way back, and the reply names its location.
    retain: std::cell::Cell<bool>,
}

/// Remove the copy unless it was deliberately retained.
///
/// This is a `Drop` rather than a call on each path because the paths that must
/// clean up are the ERROR paths — a commit that failed, an early return added
/// later — and those are exactly the ones a future edit forgets. Leaving a
/// verbatim copy of the user's note in cleartext outside their content tree is
/// the failure mode; making it unrepresentable beats remembering.
impl Drop for RecoveryPoint {
    fn drop(&mut self) {
        if !self.retain.get() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

/// Where recovery points live when the caller does not name a root.
pub fn default_recovery_root() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|home| {
        std::path::PathBuf::from(home)
            .join(".ctrl")
            .join("state")
            .join("record-recovery")
    })
}

impl RecoveryPoint {
    /// Capture the previous bytes. A recovery point that cannot be written aborts
    /// the operation rather than proceeding without one.
    ///
    /// `scope` is the content root the resource is resolved against. It is part of
    /// the key because a ResourceRef names a note RELATIVE to a root: without it,
    /// two roots holding `Inbox.md` would share one file, and the capture
    /// truncates, so the second write would destroy the first's only copy.
    pub fn capture(
        recovery_root: Option<&std::path::Path>,
        scope: &std::path::Path,
        resource: &ResourceRef,
        previous: &str,
    ) -> Result<Self, ResourceError> {
        use sha2::{Digest, Sha256};
        use std::io::Write;

        let unavailable = || ResourceError::Unavailable {
            reason: ResourceUnavailableReason::OwnerUnavailable,
            retryable: false,
        };
        let root = recovery_root
            .map(std::path::Path::to_path_buf)
            .or_else(default_recovery_root)
            .ok_or_else(unavailable)?;
        std::fs::create_dir_all(&root).map_err(|_| unavailable())?;
        // Owner-only directory, for the same reason as the files in it.
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700));
        }
        // `.bak`, not `.md`: a recovery file must never read as a note even if the
        // root is ever misconfigured.
        let key = format!(
            "{:x}",
            Sha256::digest(format!("{}\n{resource}", scope.display()).as_bytes())
        );
        let path = root.join(format!("{key}.bak"));
        // Owner-only: this file is a verbatim copy of the user's content sitting
        // outside the tree they chose for it, so it must not be more readable than
        // the note it copies.
        use std::os::unix::fs::OpenOptionsExt;
        let mut handle = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&path)
            .map_err(|_| unavailable())?;
        handle
            .write_all(previous.as_bytes())
            // Durability is the whole point, so flush before the source is touched.
            .and_then(|()| handle.sync_all())
            .map_err(|_| unavailable())?;
        // The file's bytes being durable is not enough: its DIRECTORY ENTRY must be
        // too, or a crash can leave a recovery point that cannot be found by name —
        // which is the only way clause 6 and the `rollback_failed` reply reach it.
        // (ADR-002 substrate §15.2 v87 clause 3)
        if let Ok(directory) = std::fs::File::open(&root) {
            let _ = directory.sync_all();
        }
        Ok(Self {
            path,
            retain: std::cell::Cell::new(false),
        })
    }

    pub fn location(&self) -> String {
        self.path.to_string_lossy().into_owned()
    }

    /// The captured bytes, for a caller performing clause 6 restoration.
    ///
    /// `None` means the copy could not be read back, which is exactly the
    /// `rollback_failed` case: it must never be reported as an empty previous
    /// content, because restoring that would destroy the source instead of
    /// undoing the write. (ADR-002 substrate §15.2 v87 clause 6)
    pub fn previous(&self) -> Option<String> {
        std::fs::read_to_string(&self.path).ok()
    }

    /// Drop the recovery point once the write is verified. Dropping the value is
    /// what removes the file, so this only makes the intent explicit at the call
    /// site; every other path removes it too, including the error paths.
    pub fn discard(self) {}

    /// Keep the file past this value's lifetime. Only for a failed rollback, where
    /// the source holds a state the owner did not intend and could not undo, so the
    /// copy is the user's only way back and the reply names where it is.
    pub fn retain(&self) {
        self.retain.set(true);
    }
}

/// The write did not read back as requested AND the previous content was put
/// back. Reported instead of leaving the source holding a value nobody asked
/// for. `restored` false means the source still holds the bad write, so the
/// caller is told plainly and pointed at the recovery point rather than shown a
/// retryable hiccup. (ADR-002 substrate §15.2 v87 clause 6)
pub fn write_rolled_back(
    resource: &ResourceRef,
    target: Option<String>,
    field: &str,
    expected: &str,
    observed: Option<String>,
    restored: bool,
    recovery: Option<&RecoveryPoint>,
) -> Outcome {
    let mut outcome = write_unverified(resource, target, field, expected, observed);
    if let Some(feedback) = outcome.feedback.as_mut() {
        if restored {
            feedback.code = "write_rolled_back".to_owned();
            feedback.message =
                "the change did not read back with the new value, so the previous content was restored"
                    .to_owned();
            feedback.retryable = true;
            // The source already holds these bytes again, so the copy has done its
            // job and its `Drop` removes it.
        } else {
            feedback.code = "rollback_failed".to_owned();
            feedback.message =
                "the change did not read back with the new value and the previous content could not be restored"
                    .to_owned();
            // Retrying cannot help: the source is in a state the owner did not
            // intend and could not undo. The previous content is still reachable,
            // so say where.
            feedback.retryable = false;
            if let Some(recovery) = recovery {
                // The one case the copy must survive: it is the only way back.
                recovery.retain();
                feedback
                    .details
                    .insert("recovery_point".to_owned(), json!(recovery.location()));
            }
        }
    }
    outcome
}

/// A read that takes no arguments.
pub fn empty_request_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": false
    })
}

/// Every canonical write replies with an Outcome, so its result schema is one
/// shape rather than a per-owner invention.
pub fn outcome_schema() -> Value {
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

/// The read reply every record Resource returns: the rows plus the revision a
/// write must be conditioned on.
pub fn rows_result_schema() -> Value {
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "required": ["resource", "revision", "rows", "match_count"],
        "properties": {
            "resource": { "type": "string" },
            "revision": { "type": "string" },
            "rows": { "type": "array" },
            "match_count": { "type": "integer", "minimum": 0 },
            "fields": { "type": "array" }
        },
        "additionalProperties": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference() -> ResourceRef {
        "ctrl://local/task/Inbox.md".parse().expect("valid ref")
    }

    #[test]
    fn an_empty_field_reads_as_absent_not_as_blank() {
        assert_eq!(display(""), "(none)");
        assert_eq!(display("   "), "(none)");
        assert_eq!(display(" 2026-08-10 "), "2026-08-10");
    }

    /// Both operands must travel, or the caller can only say "it failed".
    #[test]
    fn a_stale_precondition_carries_both_revisions_and_stays_retryable() {
        let outcome = precondition_failed(&reference(), "note", "aaa", "bbb");
        let feedback = outcome.feedback.as_ref().expect("feedback");
        assert_eq!(feedback.code, "precondition_failed");
        assert!(feedback.retryable);
        assert_eq!(feedback.details["expected_revision"], json!("aaa"));
        assert_eq!(feedback.details["current_revision"], json!("bbb"));
        assert!(feedback.message.contains("note"));
        assert!(!outcome.is_verified_success());
        assert!(outcome.staged.is_none(), "nothing was staged, nothing written");
    }

    /// A restored write is retryable; one that could not be restored is not,
    /// because the source is in a state the owner did not intend and retrying
    /// cannot undo. In that case the previous content must still be reachable.
    #[test]
    fn a_rollback_distinguishes_restored_from_not_restored() {
        let temp = tempfile::tempdir().expect("temp dir");
        let capture = || {
            RecoveryPoint::capture(
                Some(temp.path()),
                std::path::Path::new("/vault-a"),
                &reference(),
                "previous bytes\n",
            )
            .expect("a recovery point must be writable")
        };
        let recovery = capture();
        let restored = write_rolled_back(
            &reference(),
            Some("Pay the invoice".to_owned()),
            "status",
            "done",
            Some("todo".to_owned()),
            true,
            Some(&recovery),
        );
        let feedback = restored.feedback.as_ref().expect("feedback");
        assert_eq!(feedback.code, "write_rolled_back");
        assert!(feedback.retryable);
        assert!(feedback.message.contains("restored"));
        assert!(!restored.is_verified_success());

        // A fresh copy: the restored branch above consumed the previous one, which
        // is the behavior that branch is supposed to have.
        let recovery = capture();
        let stuck = write_rolled_back(
            &reference(),
            None,
            "status",
            "done",
            None,
            false,
            Some(&recovery),
        );
        let feedback = stuck.feedback.as_ref().expect("feedback");
        assert_eq!(feedback.code, "rollback_failed");
        assert!(
            !feedback.retryable,
            "retrying cannot undo a write that could not be restored"
        );
        assert!(!stuck.is_verified_success());
        // A non-retryable failure must at least say where the old content is, or
        // the user has no way back to it.
        let location = feedback.details["recovery_point"]
            .as_str()
            .expect("a recovery point location");
        assert_eq!(
            std::fs::read_to_string(location).expect("the recovery point exists"),
            "previous bytes\n"
        );
        assert!(location.ends_with(".bak"), "never addressable as a note");
    }

    /// A ResourceRef names a note RELATIVE to a root, so two roots holding the
    /// same relative path must not share one recovery file — the capture
    /// truncates, so sharing would destroy the other root's only copy.
    #[test]
    fn two_roots_holding_the_same_relative_note_get_separate_recovery_points() {
        let temp = tempfile::tempdir().expect("temp dir");
        let first = RecoveryPoint::capture(
            Some(temp.path()),
            std::path::Path::new("/vault-a"),
            &reference(),
            "content of a\n",
        )
        .expect("capture a");
        let second = RecoveryPoint::capture(
            Some(temp.path()),
            std::path::Path::new("/vault-b"),
            &reference(),
            "content of b\n",
        )
        .expect("capture b");
        assert_ne!(first.location(), second.location());
        assert_eq!(
            std::fs::read_to_string(first.location()).expect("a survives"),
            "content of a\n",
            "the second capture must not have overwritten the first"
        );
    }

    /// A restored rollback means the source holds those bytes again, so the copy
    /// has done its job and must not be left behind — nothing would report it and
    /// nothing would clean it up.
    #[test]
    fn a_restored_rollback_does_not_leave_the_copy_behind() {
        let temp = tempfile::tempdir().expect("temp dir");
        let recovery = RecoveryPoint::capture(
            Some(temp.path()),
            std::path::Path::new("/vault-a"),
            &reference(),
            "previous\n",
        )
        .expect("capture");
        let location = recovery.location();
        let outcome = write_rolled_back(
            &reference(),
            None,
            "status",
            "done",
            Some("todo".to_owned()),
            true,
            Some(&recovery),
        );
        assert_eq!(
            outcome.feedback.as_ref().expect("feedback").code,
            "write_rolled_back"
        );
        // The copy lives as long as the value that owns it; the point is that this
        // branch does not RETAIN it, so it goes when the owner's `produce` returns.
        drop(recovery);
        assert!(
            !std::path::Path::new(&location).exists(),
            "a restored rollback leaves no orphan copy of the user's content"
        );
    }

    /// The copy is the user's content sitting outside the tree they chose for it,
    /// so it must not be more readable than the note it copies.
    #[test]
    fn a_recovery_point_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let temp = tempfile::tempdir().expect("temp dir");
        let recovery = RecoveryPoint::capture(
            Some(&temp.path().join("nested")),
            std::path::Path::new("/vault-a"),
            &reference(),
            "previous\n",
        )
        .expect("capture");
        let mode = std::fs::metadata(recovery.location())
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600, "got {:o}", mode & 0o777);
        let directory = std::fs::metadata(temp.path().join("nested"))
            .expect("directory metadata")
            .permissions()
            .mode();
        assert_eq!(directory & 0o777, 0o700, "got {:o}", directory & 0o777);
    }

    /// Keeping the copy after a verified write would leave the user's content in
    /// cleartext outside their own tree.
    #[test]
    fn a_discarded_recovery_point_leaves_nothing_behind() {
        let temp = tempfile::tempdir().expect("temp dir");
        let recovery = RecoveryPoint::capture(
            Some(temp.path()),
            std::path::Path::new("/vault-a"),
            &reference(),
            "previous\n",
        )
        .expect("capture");
        let location = recovery.location();
        assert!(std::path::Path::new(&location).exists());
        recovery.discard();
        assert!(!std::path::Path::new(&location).exists());
    }

    #[test]
    fn an_unverified_write_is_never_a_success() {
        let outcome = write_unverified(
            &reference(),
            Some("Pay the invoice".to_owned()),
            "status",
            "done",
            Some("todo".to_owned()),
        );
        assert!(!outcome.is_verified_success());
        let feedback = outcome.feedback.as_ref().expect("feedback");
        assert_eq!(feedback.code, "write_unverified");
        assert_eq!(feedback.details["observed"], json!("todo"));
    }
}
