// Screenshot OCR — the Quicker-style "grab a region, get its text" loop.
//
// Capture: the built-in macOS `screencapture -i` (interactive crosshair region
// select) writes a PNG to a temp file — same UX a Quicker user expects, with no
// extra dependency. Recognize: the on-device Vision framework (ADR-002 substrate
// § OCR = local Vision, never cloud). The recognized text flows back to the PWA,
// which drops it into the composer so the user can act on it immediately.
//
// macOS-only for now; the Windows Vision (Windows.Media.Ocr) path is a follow-up.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct ScreenshotOcrReply {
    /// Recognized text, lines joined top-to-bottom. Empty when nothing matched.
    pub text: String,
    pub char_count: usize,
    /// True when the user dismissed the region selector (Esc) — not an error.
    pub cancelled: bool,
}

#[tauri::command]
pub async fn capture_screen_and_ocr() -> Result<ScreenshotOcrReply, String> {
    #[cfg(target_os = "macos")]
    {
        tokio::task::spawn_blocking(macos::capture_and_ocr)
            .await
            .map_err(|e| format!("ocr task join: {e}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Screenshot OCR is macOS-only for now (Windows Vision path pending).".to_string())
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::ScreenshotOcrReply;
    use std::process::Command;

    pub fn capture_and_ocr() -> Result<ScreenshotOcrReply, String> {
        let mut path = std::env::temp_dir();
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        path.push(format!("ctrl-ocr-{}-{}.png", std::process::id(), stamp));

        // -i interactive region, -o no window shadow, -x no capture sound.
        let status = Command::new("/usr/sbin/screencapture")
            .args(["-i", "-o", "-x"])
            .arg(&path)
            .status()
            .map_err(|e| format!("launch screencapture: {e}"))?;
        if !status.success() {
            return Err(format!("screencapture exited with {status}"));
        }
        // Esc during selection writes no file — a clean cancel, not a failure.
        if !path.exists() {
            return Ok(ScreenshotOcrReply { text: String::new(), char_count: 0, cancelled: true });
        }

        let bytes = std::fs::read(&path).map_err(|e| format!("read capture: {e}"))?;
        let _ = std::fs::remove_file(&path);

        let text = ocr_png(&bytes)?;
        Ok(ScreenshotOcrReply { char_count: text.chars().count(), text, cancelled: false })
    }

    fn ocr_png(bytes: &[u8]) -> Result<String, String> {
        use objc2::runtime::AnyObject;
        use objc2::ClassType;
        use objc2_foundation::{NSArray, NSData, NSDictionary, NSString};
        use objc2_vision::{
            VNImageRequestHandler, VNRecognizeTextRequest, VNRequest,
            VNRequestTextRecognitionLevel,
        };

        unsafe {
            let data = NSData::with_bytes(bytes);
            let options = NSDictionary::<NSString, AnyObject>::new();
            let handler = VNImageRequestHandler::initWithData_options(
                VNImageRequestHandler::alloc(),
                &data,
                &options,
            );

            let request = VNRecognizeTextRequest::new();
            request.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
            request.setUsesLanguageCorrection(true);
            // Chinese + English cover the common capture case (UI, docs, chat).
            let langs = NSArray::from_vec(vec![
                NSString::from_str("zh-Hans"),
                NSString::from_str("en-US"),
            ]);
            request.setRecognitionLanguages(&langs);

            // VNRecognizeTextRequest -> VNImageBasedRequest -> VNRequest.
            let req_ref: &VNRequest = &***request;
            let requests = NSArray::from_slice(&[req_ref]);
            handler
                .performRequests_error(&requests)
                .map_err(|e| format!("Vision OCR failed: {e:?}"))?;

            // results() is already typed NSArray<VNRecognizedTextObservation>, so
            // each element exposes topCandidates directly — no downcast needed.
            let mut lines: Vec<String> = Vec::new();
            if let Some(results) = request.results() {
                for i in 0..results.len() {
                    let Some(obs) = results.get_retained(i) else { continue };
                    let candidates = obs.topCandidates(1);
                    if let Some(best) = candidates.first() {
                        lines.push(best.string().to_string());
                    }
                }
            }
            Ok(lines.join("\n"))
        }
    }
}
