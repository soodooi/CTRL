//! User-owned enable/disable state for installed capabilities.
//!
//! Before this module `installed` was the only state a capability could reach:
//! the only way to stop one from being offered was to uninstall it, which throws
//! away its files and any local configuration with them. That made "stop using
//! this for now" and "remove this" the same irreversible action.
//!
//! The state lives in `~/.ctrl/capabilities.toml` as a plain list of disabled
//! refs rather than in SQLite, so it passes the vim test: a user can read why a
//! capability stopped appearing, and re-enable it with a text editor if CTRL
//! will not start. Absence of the file means everything installed is enabled,
//! which is also what a fresh install means.
//!
//! Plain text here is a decision, not a convenience: ADR-001's plain-text
//! invariants apply to user-owned state, and this is user-owned state.
//! (ADR-002 substrate §15.4.1 v88)

use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Path, PathBuf};

const FILE_NAME: &str = "capabilities.toml";

/// The disabled set, read from disk. Unknown or malformed content is reported
/// rather than silently treated as "nothing disabled", because quietly
/// re-enabling capabilities the user turned off is the worse failure.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CapabilityState {
    disabled: BTreeSet<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum CapabilityStateError {
    #[error("capability state is unreadable: {0}")]
    Io(String),
    #[error("capability state is malformed: {0}")]
    Malformed(String),
}

impl CapabilityState {
    pub fn is_disabled(&self, capability_ref: &str) -> bool {
        self.disabled.contains(capability_ref)
    }

    pub fn disabled_refs(&self) -> impl Iterator<Item = &str> {
        self.disabled.iter().map(String::as_str)
    }

    /// Read the state for a CTRL root (`~/.ctrl`). A missing file is the empty
    /// state; a present but unparseable file is an error.
    pub fn load(root: &Path) -> Result<Self, CapabilityStateError> {
        let path = root.join(FILE_NAME);
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Self::default());
            }
            Err(error) => return Err(CapabilityStateError::Io(error.to_string())),
        };
        Self::parse(&text)
    }

    fn parse(text: &str) -> Result<Self, CapabilityStateError> {
        let document: toml::Value =
            toml::from_str(text).map_err(|error| CapabilityStateError::Malformed(error.to_string()))?;
        let Some(entries) = document.get("disabled") else {
            return Ok(Self::default());
        };
        let array = entries
            .as_array()
            .ok_or_else(|| CapabilityStateError::Malformed("`disabled` must be an array".to_owned()))?;
        let mut disabled = BTreeSet::new();
        for entry in array {
            let value = entry.as_str().ok_or_else(|| {
                CapabilityStateError::Malformed("`disabled` entries must be strings".to_owned())
            })?;
            if value.is_empty() {
                return Err(CapabilityStateError::Malformed(
                    "`disabled` entries must not be empty".to_owned(),
                ));
            }
            disabled.insert(value.to_owned());
        }
        Ok(Self { disabled })
    }

    fn render(&self) -> String {
        let mut text = String::from(
            "# CTRL capability state. Refs listed here stay installed but are not\n\
             # offered to Irisy or the composer. Remove a line to re-enable it.\n\
             disabled = [\n",
        );
        for entry in &self.disabled {
            // Refs are `pack:<id>` / `skill:<name>`; TOML-escape defensively so a
            // hand-edited exotic name cannot produce a file we then refuse to read.
            text.push_str(&format!("  {},\n", toml_string(entry)));
        }
        text.push_str("]\n");
        text
    }

    /// Flip one ref and persist. Returns whether the stored set actually changed,
    /// so a caller can report "already disabled" instead of a fake mutation.
    pub fn set_disabled(
        root: &Path,
        capability_ref: &str,
        disabled: bool,
    ) -> Result<(Self, bool), CapabilityStateError> {
        if capability_ref.is_empty() {
            return Err(CapabilityStateError::Malformed(
                "a capability ref is required".to_owned(),
            ));
        }
        let mut state = Self::load(root)?;
        let changed = if disabled {
            state.disabled.insert(capability_ref.to_owned())
        } else {
            state.disabled.remove(capability_ref)
        };
        if changed {
            state.write(root)?;
        }
        Ok((state, changed))
    }

    /// Atomic replace: write a sibling temp file, fsync it, then rename. A
    /// crash mid-write leaves the previous state intact rather than a truncated
    /// file that would read as "nothing disabled".
    fn write(&self, root: &Path) -> Result<(), CapabilityStateError> {
        std::fs::create_dir_all(root).map_err(|error| CapabilityStateError::Io(error.to_string()))?;
        let final_path = root.join(FILE_NAME);
        let temporary = root.join(format!(".{FILE_NAME}.tmp"));
        {
            let mut handle = std::fs::File::create(&temporary)
                .map_err(|error| CapabilityStateError::Io(error.to_string()))?;
            handle
                .write_all(self.render().as_bytes())
                .map_err(|error| CapabilityStateError::Io(error.to_string()))?;
            handle
                .sync_all()
                .map_err(|error| CapabilityStateError::Io(error.to_string()))?;
        }
        std::fs::rename(&temporary, &final_path).map_err(|error| {
            let _ = std::fs::remove_file(&temporary);
            CapabilityStateError::Io(error.to_string())
        })
    }
}

fn toml_string(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{escaped}\"")
}

/// `~/.ctrl`, when a home directory is known.
pub fn default_root() -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|home| PathBuf::from(home).join(".ctrl"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_file_means_everything_installed_is_enabled() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let state = CapabilityState::load(temporary.path()).expect("load");
        assert!(!state.is_disabled("pack:anything"));
        assert_eq!(state.disabled_refs().count(), 0);
    }

    #[test]
    fn a_disabled_ref_round_trips_through_a_readable_file() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let (state, changed) =
            CapabilityState::set_disabled(temporary.path(), "pack:office", true).expect("disable");
        assert!(changed);
        assert!(state.is_disabled("pack:office"));

        let text = std::fs::read_to_string(temporary.path().join(FILE_NAME)).expect("read");
        // The vim test: the user can see the ref and the instruction to undo it.
        assert!(text.contains("\"pack:office\""));
        assert!(text.contains("Remove a line to re-enable"));

        let reloaded = CapabilityState::load(temporary.path()).expect("reload");
        assert_eq!(reloaded, state);
    }

    #[test]
    fn re_disabling_reports_no_change_rather_than_a_fake_mutation() {
        let temporary = tempfile::tempdir().expect("temporary root");
        CapabilityState::set_disabled(temporary.path(), "skill:office", true).expect("disable");
        let (_, changed) =
            CapabilityState::set_disabled(temporary.path(), "skill:office", true).expect("again");
        assert!(!changed);
    }

    #[test]
    fn enabling_removes_only_the_named_ref() {
        let temporary = tempfile::tempdir().expect("temporary root");
        CapabilityState::set_disabled(temporary.path(), "pack:a", true).expect("disable a");
        CapabilityState::set_disabled(temporary.path(), "pack:b", true).expect("disable b");
        let (state, changed) =
            CapabilityState::set_disabled(temporary.path(), "pack:a", false).expect("enable a");
        assert!(changed);
        assert!(!state.is_disabled("pack:a"));
        assert!(state.is_disabled("pack:b"));
    }

    #[test]
    fn enabling_something_already_enabled_changes_nothing() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let (_, changed) =
            CapabilityState::set_disabled(temporary.path(), "pack:a", false).expect("enable");
        assert!(!changed);
        assert!(!temporary.path().join(FILE_NAME).exists());
    }

    #[test]
    fn a_malformed_file_is_reported_instead_of_silently_re_enabling() {
        let temporary = tempfile::tempdir().expect("temporary root");
        std::fs::write(temporary.path().join(FILE_NAME), "disabled = \"pack:a\"\n")
            .expect("write bad state");
        assert!(matches!(
            CapabilityState::load(temporary.path()),
            Err(CapabilityStateError::Malformed(_))
        ));

        std::fs::write(temporary.path().join(FILE_NAME), "disabled = [1]\n").expect("write bad");
        assert!(matches!(
            CapabilityState::load(temporary.path()),
            Err(CapabilityStateError::Malformed(_))
        ));
    }

    #[test]
    fn a_file_without_the_key_is_the_empty_state() {
        let temporary = tempfile::tempdir().expect("temporary root");
        std::fs::write(temporary.path().join(FILE_NAME), "# nothing here\n").expect("write");
        assert_eq!(
            CapabilityState::load(temporary.path()).expect("load"),
            CapabilityState::default()
        );
    }

    #[test]
    fn an_empty_ref_is_refused_rather_than_stored() {
        let temporary = tempfile::tempdir().expect("temporary root");
        assert!(matches!(
            CapabilityState::set_disabled(temporary.path(), "", true),
            Err(CapabilityStateError::Malformed(_))
        ));
    }

    #[test]
    fn a_hand_edited_exotic_ref_survives_a_rewrite() {
        let temporary = tempfile::tempdir().expect("temporary root");
        let exotic = "pack:say \"hi\"";
        CapabilityState::set_disabled(temporary.path(), exotic, true).expect("disable");
        let state = CapabilityState::load(temporary.path()).expect("reload");
        assert!(state.is_disabled(exotic));
    }
}
