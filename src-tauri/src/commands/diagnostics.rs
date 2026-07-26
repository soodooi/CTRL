//! Typed first-party diagnostics controls.
//!
//! Capture and export preview remain Tauri-only; the gate receives only the
//! read-only status, smoke, and trace projection.
//! (ADR-003 frontend § diagnostics-surface v26)

use crate::kernel::diagnostics::{
    self, CaptureReply, DiagnosticsExportPreview, DiagnosticsModule, DiagnosticsSmoke,
    DiagnosticsStatus, DiagnosticsTrace,
};

#[tauri::command]
pub fn diagnostics_status(module: DiagnosticsModule) -> DiagnosticsStatus {
    diagnostics::status(module)
}

#[tauri::command]
pub fn diagnostics_smoke(module: DiagnosticsModule) -> DiagnosticsSmoke {
    diagnostics::smoke(module)
}

#[tauri::command]
pub fn diagnostics_trace(
    module: DiagnosticsModule,
    correlation_id: Option<String>,
    limit: Option<usize>,
) -> DiagnosticsTrace {
    diagnostics::trace(module, correlation_id.as_deref(), limit)
}

#[tauri::command]
pub fn diagnostics_capture_start(
    module: DiagnosticsModule,
    duration_seconds: u64,
) -> Result<CaptureReply, String> {
    diagnostics::capture_start(module, duration_seconds)
}

#[tauri::command]
pub fn diagnostics_capture_stop(module: DiagnosticsModule) -> CaptureReply {
    diagnostics::capture_stop(module)
}

#[tauri::command]
pub fn diagnostics_export_preview(
    module: DiagnosticsModule,
    correlation_id: Option<String>,
) -> DiagnosticsExportPreview {
    diagnostics::export_preview(module, correlation_id.as_deref())
}
