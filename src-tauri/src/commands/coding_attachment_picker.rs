//! Native macOS mixed file and directory picker for Coding's composer.
//!
//! The picker only classifies user-selected local paths. File bytes continue
//! through the shared ACP attachment reader; directories stay explicit OpenCode
//! references rather than becoming an implicit recursive import.
//! (ADR-002 substrate §1.8.6 v75; ADR-003 frontend §8.5 v37)

use serde::Serialize;

/// Paths selected from Coding's one native attachment picker.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingAttachmentSelection {
    /// Regular files that the frontend sends through the existing ACP attachment path.
    pub files: Vec<String>,
    /// Directories retained as explicit OpenCode path references.
    pub directories: Vec<String>,
}

#[cfg(target_os = "macos")]
fn pick_paths() -> Result<CodingAttachmentSelection, String> {
    use objc2_app_kit::NSOpenPanel;
    use objc2_foundation::{MainThreadMarker, NSString};

    let marker = MainThreadMarker::new()
        .ok_or_else(|| "native picker must run on the macOS main thread".to_string())?;
    let panel = unsafe { NSOpenPanel::openPanel(marker) };
    unsafe {
        panel.setCanChooseFiles(true);
        panel.setCanChooseDirectories(true);
        panel.setAllowsMultipleSelection(true);
        panel.setTitle(Some(&NSString::from_str("Add files or folders")));
    }

    // NSModalResponseOK is the documented AppKit response value (1). objc2
    // exposes NSModalResponse as its Objective-C integer type in this version.
    if unsafe { panel.runModal() } != 1 {
        return Ok(CodingAttachmentSelection {
            files: Vec::new(),
            directories: Vec::new(),
        });
    }

    let mut files = Vec::new();
    let mut directories = Vec::new();
    let urls = unsafe { panel.URLs() };
    for index in 0..urls.count() {
        let url = unsafe { urls.objectAtIndex(index) };
        let Some(path) = (unsafe { url.path() }) else {
            continue;
        };
        let path = path.to_string();
        match std::fs::metadata(&path) {
            Ok(metadata) if metadata.is_file() => files.push(path),
            Ok(metadata) if metadata.is_dir() => directories.push(path),
            _ => {}
        }
    }
    files.sort();
    files.dedup();
    directories.sort();
    directories.dedup();
    Ok(CodingAttachmentSelection { files, directories })
}

/// Open one native picker that accepts files and directories together.
///
/// The Status-level launcher must yield while AppKit runs its modal chooser;
/// otherwise the nonactivating NSPanel stays above the selection UI and makes
/// the app look frozen. Both transitions remain in WindowController so the
/// launcher resumes through its sole NSPanel presentation path. (ADR-003 frontend §1.1 v29; §8.5 v37)
#[tauri::command]
pub async fn pick_coding_attachments(
    app: tauri::AppHandle,
) -> Result<CodingAttachmentSelection, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let app_for_picker = app.clone();
        app.run_on_main_thread(move || {
            let result = match crate::shell::WindowController::begin_native_modal(&app_for_picker)
            {
                Ok(()) => {
                    let selection = pick_paths();
                    let restored = crate::shell::WindowController::end_native_modal(&app_for_picker)
                        .map_err(|error| error.to_string());
                    match (selection, restored) {
                        (Ok(selection), Ok(())) => Ok(selection),
                        (Err(error), _) | (_, Err(error)) => Err(error),
                    }
                }
                Err(error) => Err(error.to_string()),
            };
            let _ = send.send(result);
        })
        .map_err(|error| format!("cannot schedule native picker: {error}"))?;
        receive
            .await
            .map_err(|_| "native picker closed before returning a selection".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("mixed file and folder selection is currently available on macOS only".to_string())
    }
}
