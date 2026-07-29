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
type PickerSender = tokio::sync::oneshot::Sender<Result<CodingAttachmentSelection, String>>;

#[cfg(target_os = "macos")]
fn send_once(
    sender: &std::sync::Arc<std::sync::Mutex<Option<PickerSender>>>,
    result: Result<CodingAttachmentSelection, String>,
) {
    let sender = sender
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .take();
    if let Some(sender) = sender {
        let _ = sender.send(result);
    }
}

#[cfg(target_os = "macos")]
fn selection_from_panel(
    panel: &objc2_app_kit::NSOpenPanel,
    response: objc2_app_kit::NSModalResponse,
) -> Result<CodingAttachmentSelection, String> {
    if response != 1 {
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

#[cfg(target_os = "macos")]
fn present_picker_sheet(
    app: &tauri::AppHandle,
    sender: std::sync::Arc<std::sync::Mutex<Option<PickerSender>>>,
) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::NSOpenPanel;
    use objc2_foundation::{MainThreadMarker, NSString};

    crate::shell::WindowController::begin_native_sheet(app).map_err(|error| error.to_string())?;
    let result = crate::shell::WindowController::with_main_native_window(app, |parent| {
        let marker = MainThreadMarker::new()
            .ok_or_else(|| "native picker must run on the macOS main thread".to_string())?;
        let panel = unsafe { NSOpenPanel::openPanel(marker) };
        unsafe {
            panel.setCanChooseFiles(true);
            panel.setCanChooseDirectories(true);
            panel.setAllowsMultipleSelection(true);
            panel.setTitle(Some(&NSString::from_str("Add files or folders")));
        }

        let panel_for_completion = panel.clone();
        let sender_for_completion = sender.clone();
        let completion = RcBlock::new(move |response| {
            let selection = selection_from_panel(&panel_for_completion, response);
            let ended = crate::shell::WindowController::end_native_sheet()
                .map_err(|error| error.to_string());
            let result = match (selection, ended) {
                (Ok(selection), Ok(())) => Ok(selection),
                (Err(error), _) | (_, Err(error)) => Err(error),
            };
            send_once(&sender_for_completion, result);
        });
        // A sheet stays ordered above its parent NSPanel, so the configured
        // Status-level launcher remains visible on the active full-screen
        // Space instead of obscuring or disappearing behind an independent
        // modal. (ADR-003 frontend §1.1 v29; §8.5 v37)
        unsafe { panel.beginSheetModalForWindow_completionHandler(parent, &completion) };
        Ok(())
    })
    .map_err(|error| error.to_string())?;

    if result.is_err() {
        let _ = crate::shell::WindowController::end_native_sheet();
    }
    result
}

/// Open one native picker that accepts files and directories together.
///
/// AppKit attaches the picker to CTRL's configured launcher NSPanel instead
/// of opening an independent modal. The launcher therefore remains visible in
/// the active full-screen Space while the native sheet owns selection input.
/// (ADR-003 frontend §1.1 v29; §8.5 v37)
#[tauri::command]
pub async fn pick_coding_attachments(
    app: tauri::AppHandle,
) -> Result<CodingAttachmentSelection, String> {
    #[cfg(target_os = "macos")]
    {
        let (send, receive) = tokio::sync::oneshot::channel();
        let sender = std::sync::Arc::new(std::sync::Mutex::new(Some(send)));
        let app_for_picker = app.clone();
        let sender_for_picker = sender.clone();
        app.run_on_main_thread(move || {
            if let Err(error) = present_picker_sheet(&app_for_picker, sender_for_picker.clone()) {
                send_once(&sender_for_picker, Err(error));
            }
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
