//! Shared dropped-file attachment reader for ACP-driven chat commands.
//!
//! Extracted from `coding_chat.rs` (ADR-002 substrate §1.8.6 v75) once Irisy's
//! own `irisy_chat.rs` needed the identical "read a dropped file path off
//! disk, classify it by extension, build the ACP-layer `Attachment`" logic
//! (ADR-005 irisy §8.7 v32) — the protocol layer (`AcpClient::prompt`'s
//! capability-negotiated ContentBlock construction) was already shared;
//! this closes the remaining duplication one level up. Both callers still
//! decide independently WHETHER to pass attachments and what they mean for
//! their surface (Coding = authoring reference material; Irisy = its own,
//! separately-scoped semantic) — only the disk-read mechanics are shared.

use serde::{Deserialize, Serialize};

/// One dropped file, over the wire from the frontend (ADR-002 substrate
/// §1.8.6 v75). CTRL's native drag-drop path hands the frontend an absolute
/// filesystem PATH, not file bytes — there is no `@tauri-apps/plugin-fs` in
/// this workspace and reading + base64-encoding on the Rust side avoids
/// adding one just for this. The kernel reads the file, classifies it, and
/// enforces the size ceiling before it ever reaches `AcpClient::prompt`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachmentWire {
    /// Absolute path to the dropped file. Read server-side; never trusted as
    /// pre-validated — `read_from_disk` re-canonicalizes it.
    pub path: String,
    /// Display name (defaults to the path's filename if omitted by the
    /// frontend, which it never is in practice — kept `Option` only so a
    /// malformed payload degrades gracefully instead of failing to deserialize).
    #[serde(default)]
    pub name: Option<String>,
}

/// Extensions treated as inline text for the `EmbeddedResource` path. Kept
/// small and explicit — an unrecognized extension falls through to the
/// binary/blob path rather than guessing at UTF-8 validity of arbitrary bytes.
const TEXT_ATTACHMENT_EXTENSIONS: &[&str] = &[
    "md", "markdown", "txt", "json", "yaml", "yml", "toml", "csv", "log", "ts", "tsx", "js", "jsx",
    "rs", "py", "html", "css", "xml",
];
const IMAGE_ATTACHMENT_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp"];

/// Hard ceiling on the RAW file size read from disk, applied before base64
/// encoding (which inflates size ~4/3) — a backstop against a multi-hundred-MB
/// drop turning into an enormous single stdio JSON-RPC line (ACP §1.8.1 has no
/// multipart framing to absorb it). `AcpClient::prompt`'s own base64-length
/// ceiling (`MAX_IMAGE_BASE64_CHARS`/`MAX_TEXT_RESOURCE_CHARS`) is the
/// SECOND, protocol-layer backstop — this one exists so a huge file never
/// even gets read into memory and encoded in the first place.
pub const MAX_ATTACHMENT_READ_BYTES: u64 = 12 * 1024 * 1024;

fn guess_mime_type(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "csv" => "text/csv",
        "html" => "text/html",
        "css" => "text/css",
        "xml" => "application/xml",
        "pdf" => "application/pdf",
        "txt" | "toml" | "log" | "ts" | "tsx" | "js" | "jsx" | "rs" | "py" => "text/plain",
        _ => "application/octet-stream",
    }
}

impl ChatAttachmentWire {
    /// Read the file from disk, classify it by extension, and build the
    /// ACP-layer `Attachment`. Returns a description of the outcome so the
    /// caller can tell the user WHY an attachment was dropped (too large /
    /// unreadable) rather than silently losing it — the same "never a silent
    /// drop" discipline `build_prompt_blocks` applies to unsupported
    /// capabilities.
    pub fn read_from_disk(self) -> Result<crate::shell::acp_client::Attachment, String> {
        use crate::shell::acp_client::{Attachment, AttachmentContent};
        use base64::Engine as _;
        let path = std::path::Path::new(&self.path);
        let canonical = std::fs::canonicalize(path)
            .map_err(|e| format!("cannot resolve attachment path: {e}"))?;
        let meta = std::fs::metadata(&canonical)
            .map_err(|e| format!("cannot read attachment metadata: {e}"))?;
        if !meta.is_file() {
            return Err("attachment path is not a file".to_string());
        }
        if meta.len() > MAX_ATTACHMENT_READ_BYTES {
            return Err(format!(
                "attachment exceeds the {}MB size limit",
                MAX_ATTACHMENT_READ_BYTES / (1024 * 1024)
            ));
        }
        let name = self.name.unwrap_or_else(|| {
            canonical
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| "attachment".to_string())
        });
        let ext = canonical
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_lowercase();
        let bytes =
            std::fs::read(&canonical).map_err(|e| format!("cannot read attachment: {e}"))?;
        let mime_type = guess_mime_type(&ext).to_string();
        let content = if IMAGE_ATTACHMENT_EXTENSIONS.contains(&ext.as_str()) {
            AttachmentContent::ImageBase64(base64::engine::general_purpose::STANDARD.encode(&bytes))
        } else if TEXT_ATTACHMENT_EXTENSIONS.contains(&ext.as_str()) {
            match String::from_utf8(bytes.clone()) {
                Ok(text) => AttachmentContent::Text(text),
                // Not actually valid UTF-8 despite the text-like extension —
                // fall back to the blob path rather than lossy-mangling it.
                Err(_) => AttachmentContent::BlobBase64(
                    base64::engine::general_purpose::STANDARD.encode(&bytes),
                ),
            }
        } else {
            AttachmentContent::BlobBase64(base64::engine::general_purpose::STANDARD.encode(&bytes))
        };
        Ok(Attachment {
            name,
            mime_type,
            content,
        })
    }
}

/// Read every attachment, dropping (and logging) any that fail rather than
/// failing the whole turn over one bad attachment — the user's text message
/// still goes through. `context` is a short tag (e.g. `"coding_chat"` /
/// `"irisy_chat"`) prefixing the log line so a dropped attachment is
/// attributable to its caller.
pub fn read_all(
    attachments: Vec<ChatAttachmentWire>,
    context: &str,
) -> Vec<crate::shell::acp_client::Attachment> {
    attachments
        .into_iter()
        .filter_map(|a| match a.read_from_disk() {
            Ok(att) => Some(att),
            Err(e) => {
                eprintln!("[{context}] dropping attachment: {e}");
                None
            }
        })
        .collect()
}

/// A UTF-8 source file selected for Irisy's local Markdown import.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSource {
    pub path: String,
    pub name: String,
    pub content: String,
}

/// Result of a file or top-level folder import. Unsupported/binary files are
/// reported instead of aborting a folder import, so one unrelated asset does
/// not hide the readable notes beside it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourcesReply {
    pub files: Vec<ImportedSource>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct ImportSourcesArgs {
    #[serde(default)]
    pub paths: Vec<String>,
    #[serde(default)]
    pub folder: Option<String>,
}

fn read_import_source(path: &std::path::Path) -> Result<ImportedSource, String> {
    let canonical =
        std::fs::canonicalize(path).map_err(|e| format!("cannot resolve source path: {e}"))?;
    let metadata =
        std::fs::metadata(&canonical).map_err(|e| format!("cannot read source metadata: {e}"))?;
    if !metadata.is_file() {
        return Err("source path is not a file".to_string());
    }
    if metadata.len() > MAX_ATTACHMENT_READ_BYTES {
        return Err(format!(
            "source exceeds the {}MB size limit",
            MAX_ATTACHMENT_READ_BYTES / (1024 * 1024)
        ));
    }
    let name = canonical
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "source".to_string());
    let bytes = std::fs::read(&canonical).map_err(|e| format!("cannot read source: {e}"))?;
    let content =
        String::from_utf8(bytes).map_err(|_| "source is not a UTF-8 text file".to_string())?;
    Ok(ImportedSource {
        path: canonical.to_string_lossy().into_owned(),
        name,
        content,
    })
}

/// Read explicitly selected files, or regular files directly inside one
/// selected folder. Folder traversal is intentionally non-recursive: the
/// picker is an input boundary, not a crawler.
#[tauri::command]
pub fn read_import_sources(args: ImportSourcesArgs) -> Result<ImportSourcesReply, String> {
    if args.paths.is_empty() && args.folder.is_none() {
        return Err("select at least one file or folder".to_string());
    }
    let mut candidates = args.paths;
    if let Some(folder) = args.folder {
        let canonical = std::fs::canonicalize(folder)
            .map_err(|e| format!("cannot resolve source folder: {e}"))?;
        let metadata = std::fs::metadata(&canonical)
            .map_err(|e| format!("cannot read source folder metadata: {e}"))?;
        if !metadata.is_dir() {
            return Err("source folder path is not a folder".to_string());
        }
        let mut entries = std::fs::read_dir(&canonical)
            .map_err(|e| format!("cannot list source folder: {e}"))?
            .filter_map(Result::ok)
            .filter_map(|entry| {
                entry
                    .file_type()
                    .ok()
                    .filter(|kind| kind.is_file())
                    .map(|_| entry.path())
            })
            .collect::<Vec<_>>();
        entries.sort();
        candidates.extend(
            entries
                .into_iter()
                .map(|path| path.to_string_lossy().into_owned()),
        );
    }

    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for candidate in candidates {
        match read_import_source(std::path::Path::new(&candidate)) {
            Ok(file) => files.push(file),
            Err(error) => skipped.push(format!("{candidate}: {error}")),
        }
    }
    Ok(ImportSourcesReply { files, skipped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::{tempdir, NamedTempFile};

    #[test]
    fn folder_import_reads_only_top_level_utf8_files() {
        let dir = tempdir().expect("tmp dir");
        let first = dir.path().join("first.md");
        let second = dir.path().join("second.txt");
        let nested = dir.path().join("nested");
        std::fs::create_dir(&nested).expect("nested");
        std::fs::write(&first, b"# first").expect("first");
        std::fs::write(&second, b"second").expect("second");
        std::fs::write(nested.join("hidden.md"), b"nested").expect("nested file");

        let result = read_import_sources(ImportSourcesArgs {
            paths: vec![],
            folder: Some(dir.path().to_string_lossy().into_owned()),
        })
        .expect("folder import");

        assert_eq!(result.files.len(), 2);
        assert!(result.skipped.is_empty());
        assert_eq!(result.files[0].name, "first.md");
        assert_eq!(result.files[1].name, "second.txt");
    }

    #[test]
    fn folder_import_reports_binary_files_without_aborting_text_files() {
        let dir = tempdir().expect("tmp dir");
        std::fs::write(dir.path().join("readme.md"), b"read me").expect("text");
        std::fs::write(dir.path().join("image.bin"), [0xff, 0xfe]).expect("binary");

        let result = read_import_sources(ImportSourcesArgs {
            paths: vec![],
            folder: Some(dir.path().to_string_lossy().into_owned()),
        })
        .expect("folder import");

        assert_eq!(result.files.len(), 1);
        assert_eq!(result.skipped.len(), 1);
        assert!(result.skipped[0].contains("UTF-8"));
    }
    #[test]
    fn image_extension_reads_as_image_base64() {
        use crate::shell::acp_client::AttachmentContent;
        let mut f = NamedTempFile::with_suffix(".png").expect("tmp");
        f.write_all(b"fake-png-bytes").expect("write");
        let att = ChatAttachmentWire {
            path: f.path().to_string_lossy().into_owned(),
            name: None,
        }
        .read_from_disk()
        .expect("reads");
        assert!(matches!(att.content, AttachmentContent::ImageBase64(_)));
        assert_eq!(att.mime_type, "image/png");
    }

    #[test]
    fn markdown_extension_reads_as_utf8_text() {
        use crate::shell::acp_client::AttachmentContent;
        let mut f = NamedTempFile::with_suffix(".md").expect("tmp");
        f.write_all(b"# competitor notes").expect("write");
        let att = ChatAttachmentWire {
            path: f.path().to_string_lossy().into_owned(),
            name: Some("notes.md".to_string()),
        }
        .read_from_disk()
        .expect("reads");
        assert_eq!(att.name, "notes.md");
        assert!(matches!(att.content, AttachmentContent::Text(ref t) if t == "# competitor notes"));
    }

    #[test]
    fn unknown_extension_falls_back_to_blob() {
        use crate::shell::acp_client::AttachmentContent;
        let mut f = NamedTempFile::with_suffix(".pdf").expect("tmp");
        f.write_all(b"%PDF-fake").expect("write");
        let att = ChatAttachmentWire {
            path: f.path().to_string_lossy().into_owned(),
            name: None,
        }
        .read_from_disk()
        .expect("reads");
        assert!(matches!(att.content, AttachmentContent::BlobBase64(_)));
        assert_eq!(att.mime_type, "application/pdf");
    }

    #[test]
    fn text_extension_with_non_utf8_bytes_falls_back_to_blob_not_panicking() {
        use crate::shell::acp_client::AttachmentContent;
        let mut f = NamedTempFile::with_suffix(".txt").expect("tmp");
        f.write_all(&[0xff, 0xfe, 0x00, 0x01]).expect("write");
        let att = ChatAttachmentWire {
            path: f.path().to_string_lossy().into_owned(),
            name: None,
        }
        .read_from_disk()
        .expect("reads");
        assert!(matches!(att.content, AttachmentContent::BlobBase64(_)));
    }

    #[test]
    fn missing_path_is_a_readable_error_not_a_panic() {
        let result = ChatAttachmentWire {
            path: "/nonexistent/does/not/exist.png".to_string(),
            name: None,
        }
        .read_from_disk();
        assert!(result.is_err());
    }

    #[test]
    fn oversized_file_is_rejected_before_reading_into_memory() {
        let mut f = NamedTempFile::with_suffix(".png").expect("tmp");
        f.as_file_mut()
            .set_len(MAX_ATTACHMENT_READ_BYTES + 1)
            .expect("set_len");
        let result = ChatAttachmentWire {
            path: f.path().to_string_lossy().into_owned(),
            name: None,
        }
        .read_from_disk();
        let err = result.expect_err("must reject oversized file");
        assert!(err.contains("size limit"));
    }

    #[test]
    fn read_all_drops_bad_attachments_and_keeps_good_ones() {
        let mut good = NamedTempFile::with_suffix(".md").expect("tmp");
        good.write_all(b"hello").expect("write");
        let wire = vec![
            ChatAttachmentWire {
                path: good.path().to_string_lossy().into_owned(),
                name: None,
            },
            ChatAttachmentWire {
                path: "/nonexistent.png".to_string(),
                name: None,
            },
        ];
        let out = read_all(wire, "test");
        assert_eq!(out.len(), 1);
    }
}
