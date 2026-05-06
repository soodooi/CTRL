use thiserror::Error;

#[derive(Debug, Error)]
pub enum SpikeError {
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("event tap failed: {0}")]
    EventTapFailed(String),

    #[error("capture failed: {0}")]
    CaptureFailed(String),

    #[error("clipboard failed: {0}")]
    ClipboardFailed(String),

    #[error("manifest error: {0}")]
    ManifestError(String),
}

pub type Result<T> = std::result::Result<T, SpikeError>;
