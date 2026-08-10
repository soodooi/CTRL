//! Stable-handle filesystem resolution for filesystem-backed resource owners.
//!
//! Resolution anchors an authorized directory handle and never reopens a
//! canonicalized path after checking it. Callers retain the returned handle.
//! (ADR-002 substrate §15 v83)

use super::resource::ResourceUnavailableReason;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenedMetadata {
    pub device: u64,
    pub inode: u64,
    pub mode: u32,
    pub size: u64,
    pub is_directory: bool,
    pub is_regular_file: bool,
}

#[derive(Debug, Error)]
pub enum StableHandleError {
    #[error("resource path component is invalid")]
    InvalidComponent,
    #[error("resource does not exist")]
    NotFound,
    #[error("resource traversal rejected a symbolic link")]
    SymlinkRejected,
    #[error("resource traversal rejected a cross-device mount boundary")]
    CrossDeviceMountRejected,
    #[error("resource traversal requires a directory")]
    NotDirectory,
    #[error("resource access was denied")]
    Denied,
    #[error("resource platform primitive is unavailable: {reason:?}")]
    Unavailable { reason: ResourceUnavailableReason },
    #[error("resource handle operation failed during {operation}: {kind:?}")]
    Io {
        operation: &'static str,
        kind: std::io::ErrorKind,
    },
}

fn enforce_mount_boundary(
    root: &OpenedMetadata,
    opened: &OpenedMetadata,
) -> Result<(), StableHandleError> {
    if opened.device != root.device {
        return Err(StableHandleError::CrossDeviceMountRejected);
    }
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod platform {
    use super::{
        enforce_mount_boundary, OpenedMetadata, ResourceUnavailableReason, StableHandleError,
    };
    use std::{
        ffi::CString,
        fs::File,
        io,
        os::{
            fd::{AsRawFd, FromRawFd, OwnedFd},
            unix::ffi::OsStrExt,
        },
        path::Path,
    };
    use unicode_normalization::UnicodeNormalization;

    #[derive(Debug)]
    pub struct StableRoot {
        handle: OwnedFd,
        metadata: OpenedMetadata,
    }

    #[derive(Debug)]
    pub struct OpenedResource {
        handle: OwnedFd,
        metadata: OpenedMetadata,
    }

    impl StableRoot {
        pub fn open<F>(root: &Path, authorize: F) -> Result<Self, StableHandleError>
        where
            F: FnOnce(&OpenedMetadata) -> bool,
        {
            let root = CString::new(root.as_os_str().as_bytes())
                .map_err(|_| StableHandleError::InvalidComponent)?;
            let flags = libc::O_RDONLY
                | libc::O_CLOEXEC
                | libc::O_DIRECTORY
                | libc::O_NOFOLLOW
                | libc::O_NONBLOCK;
            // SAFETY: `root` is a NUL-terminated C string and `open` does not
            // retain the pointer. A successful descriptor is immediately owned.
            let raw = unsafe { libc::open(root.as_ptr(), flags) };
            if raw < 0 {
                return Err(map_open_error(io::Error::last_os_error(), "open_root"));
            }
            // SAFETY: `raw` is a fresh descriptor returned by successful open.
            let handle = unsafe { OwnedFd::from_raw_fd(raw) };
            let metadata = metadata_for(&handle, "inspect_root")?;
            if !metadata.is_directory {
                return Err(StableHandleError::NotDirectory);
            }
            if !authorize(&metadata) {
                return Err(StableHandleError::Denied);
            }
            Ok(Self { handle, metadata })
        }

        pub fn metadata(&self) -> &OpenedMetadata {
            &self.metadata
        }

        pub fn open_beneath<F>(
            &self,
            components: &[String],
            authorize: F,
        ) -> Result<OpenedResource, StableHandleError>
        where
            F: FnOnce(&OpenedMetadata) -> bool,
        {
            if components.is_empty() || components.len() > 32 {
                return Err(StableHandleError::InvalidComponent);
            }
            for component in components {
                validate_component(component)?;
            }

            let mut parent: Option<OwnedFd> = None;
            for (index, component) in components.iter().enumerate() {
                let is_final = index + 1 == components.len();
                let parent_fd = parent
                    .as_ref()
                    .map_or(self.handle.as_raw_fd(), AsRawFd::as_raw_fd);
                let component = CString::new(component.as_bytes())
                    .map_err(|_| StableHandleError::InvalidComponent)?;
                let mut flags =
                    libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK;
                if !is_final {
                    flags |= libc::O_DIRECTORY;
                }
                // SAFETY: `parent_fd` remains open for this call and `component`
                // is a NUL-terminated single path component. The pointer is not
                // retained. A successful descriptor is immediately owned.
                let raw = unsafe { libc::openat(parent_fd, component.as_ptr(), flags) };
                if raw < 0 {
                    return Err(map_open_error(
                        io::Error::last_os_error(),
                        if is_final {
                            "open_leaf"
                        } else {
                            "open_directory"
                        },
                    ));
                }
                // SAFETY: `raw` is a fresh descriptor returned by openat.
                let opened = unsafe { OwnedFd::from_raw_fd(raw) };
                let metadata = metadata_for(&opened, "inspect_component")?;
                enforce_mount_boundary(&self.metadata, &metadata)?;
                if !is_final && !metadata.is_directory {
                    return Err(StableHandleError::NotDirectory);
                }
                if is_final {
                    if !authorize(&metadata) {
                        return Err(StableHandleError::Denied);
                    }
                    return Ok(OpenedResource {
                        handle: opened,
                        metadata,
                    });
                }
                parent = Some(opened);
            }

            Err(StableHandleError::Unavailable {
                reason: ResourceUnavailableReason::OwnerUnavailable,
            })
        }
    }

    impl OpenedResource {
        pub fn metadata(&self) -> &OpenedMetadata {
            &self.metadata
        }

        pub fn into_file(self) -> File {
            File::from(self.handle)
        }
    }

    fn validate_component(component: &str) -> Result<(), StableHandleError> {
        if component.is_empty()
            || component.len() > 255
            || matches!(component, "." | "..")
            || component.contains('/')
            || component.contains('\\')
            || component.chars().any(char::is_control)
            || component.nfc().collect::<String>() != component
        {
            return Err(StableHandleError::InvalidComponent);
        }
        Ok(())
    }

    fn metadata_for(
        handle: &OwnedFd,
        operation: &'static str,
    ) -> Result<OpenedMetadata, StableHandleError> {
        // SAFETY: zero is a valid initial bit pattern for libc::stat, and fstat
        // initializes it before any field is read when it returns success.
        let mut stat: libc::stat = unsafe { std::mem::zeroed() };
        // SAFETY: the descriptor is live and the stat pointer is valid/writable.
        if unsafe { libc::fstat(handle.as_raw_fd(), &mut stat) } != 0 {
            return Err(StableHandleError::Io {
                operation,
                kind: io::Error::last_os_error().kind(),
            });
        }
        Ok(OpenedMetadata {
            device: stat.st_dev as u64,
            inode: stat.st_ino as u64,
            mode: stat.st_mode as u32,
            size: stat.st_size.max(0) as u64,
            is_directory: stat.st_mode & libc::S_IFMT == libc::S_IFDIR,
            is_regular_file: stat.st_mode & libc::S_IFMT == libc::S_IFREG,
        })
    }

    fn map_open_error(error: io::Error, operation: &'static str) -> StableHandleError {
        match error.raw_os_error() {
            Some(libc::ENOENT) => StableHandleError::NotFound,
            Some(libc::ELOOP) => StableHandleError::SymlinkRejected,
            Some(libc::ENOTDIR) => StableHandleError::NotDirectory,
            Some(code) if code == libc::EACCES || code == libc::EPERM => StableHandleError::Denied,
            _ => StableHandleError::Io {
                operation,
                kind: error.kind(),
            },
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod platform {
    use super::{OpenedMetadata, ResourceUnavailableReason, StableHandleError};
    use std::path::Path;

    pub struct StableRoot;
    pub struct OpenedResource;

    impl StableRoot {
        pub fn open<F>(_root: &Path, _authorize: F) -> Result<Self, StableHandleError>
        where
            F: FnOnce(&OpenedMetadata) -> bool,
        {
            Err(StableHandleError::Unavailable {
                reason: ResourceUnavailableReason::PlatformPrimitiveUnavailable,
            })
        }

        pub fn open_beneath<F>(
            &self,
            _components: &[String],
            _authorize: F,
        ) -> Result<OpenedResource, StableHandleError>
        where
            F: FnOnce(&OpenedMetadata) -> bool,
        {
            Err(StableHandleError::Unavailable {
                reason: ResourceUnavailableReason::PlatformPrimitiveUnavailable,
            })
        }
    }
}

pub use platform::{OpenedResource, StableRoot};

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::{fs, io::Read, os::unix::fs::symlink};
    use tempfile::tempdir;

    fn allow_all(_: &OpenedMetadata) -> bool {
        true
    }

    #[test]
    fn opens_components_beneath_the_authorized_root() {
        let temporary = tempdir().expect("temporary directory");
        fs::create_dir(temporary.path().join("notes")).expect("create notes");
        fs::write(temporary.path().join("notes/item.md"), "anchored").expect("write resource");

        let root = StableRoot::open(temporary.path(), allow_all).expect("open root");
        let opened = root
            .open_beneath(&["notes".to_owned(), "item.md".to_owned()], allow_all)
            .expect("open resource");
        assert!(!opened.metadata().is_directory);
        let mut content = String::new();
        opened
            .into_file()
            .read_to_string(&mut content)
            .expect("read opened resource");
        assert_eq!(content, "anchored");
    }

    #[test]
    fn rejects_root_intermediate_and_final_symlinks() {
        let temporary = tempdir().expect("temporary directory");
        let real_root = temporary.path().join("real");
        fs::create_dir(&real_root).expect("create real root");
        fs::write(real_root.join("item"), "value").expect("write item");
        symlink(&real_root, temporary.path().join("root-link")).expect("link root");
        assert!(StableRoot::open(&temporary.path().join("root-link"), allow_all).is_err());

        let root = StableRoot::open(&real_root, allow_all).expect("open root");
        fs::create_dir(real_root.join("directory")).expect("create directory");
        symlink(
            real_root.join("directory"),
            real_root.join("directory-link"),
        )
        .expect("link directory");
        assert!(root
            .open_beneath(
                &["directory-link".to_owned(), "child".to_owned()],
                allow_all,
            )
            .is_err());

        symlink(real_root.join("item"), real_root.join("item-link")).expect("link item");
        assert!(root
            .open_beneath(&["item-link".to_owned()], allow_all)
            .is_err());
    }

    #[test]
    fn root_replacement_does_not_retarget_the_anchored_handle() {
        let temporary = tempdir().expect("temporary directory");
        let root_path = temporary.path().join("root");
        let moved_path = temporary.path().join("moved");
        fs::create_dir(&root_path).expect("create root");
        fs::write(root_path.join("item"), "original").expect("write original");

        let root = StableRoot::open(&root_path, allow_all).expect("open root");
        fs::rename(&root_path, &moved_path).expect("move root");
        fs::create_dir(&root_path).expect("create replacement root");
        fs::write(root_path.join("item"), "replacement").expect("write replacement");

        let opened = root
            .open_beneath(&["item".to_owned()], allow_all)
            .expect("open through anchored root");
        let mut content = String::new();
        opened
            .into_file()
            .read_to_string(&mut content)
            .expect("read anchored file");
        assert_eq!(content, "original");
    }

    #[test]
    fn entry_replacement_does_not_change_an_opened_resource() {
        let temporary = tempdir().expect("temporary directory");
        let item = temporary.path().join("item");
        fs::write(&item, "original").expect("write original");
        let root = StableRoot::open(temporary.path(), allow_all).expect("open root");
        let opened = root
            .open_beneath(&["item".to_owned()], allow_all)
            .expect("open original");

        fs::rename(&item, temporary.path().join("old-item")).expect("move original");
        fs::write(&item, "replacement").expect("write replacement");

        let mut content = String::new();
        opened
            .into_file()
            .read_to_string(&mut content)
            .expect("read retained handle");
        assert_eq!(content, "original");
    }

    #[test]
    fn authorization_observes_the_opened_handle_metadata() {
        let temporary = tempdir().expect("temporary directory");
        fs::write(temporary.path().join("item"), "value").expect("write item");
        let root = StableRoot::open(temporary.path(), |metadata| metadata.is_directory)
            .expect("authorize directory root");
        let error = root
            .open_beneath(&["item".to_owned()], |metadata| metadata.is_directory)
            .expect_err("deny non-directory leaf");
        assert!(matches!(error, StableHandleError::Denied));
    }

    #[test]
    fn cross_device_mount_identity_is_rejected_before_authorization() {
        let root = OpenedMetadata {
            device: 10,
            inode: 1,
            mode: 0,
            size: 0,
            is_directory: true,
            is_regular_file: false,
        };
        let mounted = OpenedMetadata {
            device: 11,
            inode: 2,
            mode: 0,
            size: 0,
            is_directory: true,
            is_regular_file: false,
        };

        assert!(matches!(
            enforce_mount_boundary(&root, &mounted),
            Err(StableHandleError::CrossDeviceMountRejected)
        ));
    }
}
