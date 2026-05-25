// ctrl-asset:// Tauri custom URI scheme — serves keycap-bundled assets to the
// PWA without invoke() round-trips or base64 inlining.
//
// URL contract (locked by ADR-001 amendment 2026-05-25, decision D2):
//   ctrl-asset://keycaps/<keycap-id>/<relative-path>
//     → file at ~/.ctrl/keycaps/<keycap-id>/<relative-path>
//
// Concrete examples the PWA uses:
//   ctrl-asset://keycaps/translate/assets/icon.svg
//   ctrl-asset://keycaps/translate/assets/prompt.md
//   ctrl-asset://keycaps/pi/keycap.md
//
// Security:
//   * Only files under `~/.ctrl/keycaps/` are reachable. Path traversal
//     (`..`, absolute path components) is rejected with 403.
//   * Symlinks are resolved and re-checked — a symlink that escapes the
//     keycap root is rejected.
//   * Read-only — no PUT / POST / DELETE handling (browser won't issue
//     those for `<img>` / `fetch()` GETs, but we still bail loud).
//
// Future v1.x adds `ctrl-asset://vault/...` for read-only access to the
// user's vault attachments (gated by capability). v1.0 keeps the surface
// to keycap-bundled assets only.

use std::path::{Path, PathBuf};
use tauri::http::{Response, StatusCode};
use tauri::{Builder, Runtime, UriSchemeContext};

const SCHEME: &str = "ctrl-asset";
const ROOT_NAMESPACE: &str = "keycaps";

pub fn register<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.register_uri_scheme_protocol(SCHEME, handle)
}

fn handle<R: Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() != tauri::http::Method::GET {
        return error_response(StatusCode::METHOD_NOT_ALLOWED, "GET only");
    }

    let uri = request.uri();
    let host = uri.host().unwrap_or("");
    let raw_path = uri.path();

    // Two URL shapes possible depending on how the OS/webview parses the
    // custom scheme:
    //   ctrl-asset://keycaps/<id>/<rest>  → host = "keycaps", path = "/<id>/<rest>"
    //   ctrl-asset://keycaps/<id>/<rest>  → host = "",         path = "/keycaps/<id>/<rest>"
    // Accept either; reject everything else.
    let segments: Vec<&str> = if host == ROOT_NAMESPACE {
        raw_path.trim_start_matches('/').split('/').collect()
    } else if host.is_empty() {
        let trimmed = raw_path.trim_start_matches('/');
        let mut parts = trimmed.splitn(2, '/');
        if parts.next() != Some(ROOT_NAMESPACE) {
            return error_response(
                StatusCode::NOT_FOUND,
                "ctrl-asset:// only serves `keycaps/<id>/...` in v1.0",
            );
        }
        parts.next().unwrap_or("").split('/').collect()
    } else {
        return error_response(
            StatusCode::NOT_FOUND,
            "ctrl-asset:// only serves `keycaps/<id>/...` in v1.0",
        );
    };

    if segments.len() < 2 || segments[0].is_empty() {
        return error_response(
            StatusCode::BAD_REQUEST,
            "URL must look like ctrl-asset://keycaps/<id>/<file>",
        );
    }

    let keycap_id = segments[0];
    let relative = segments[1..].join("/");

    let keycap_root = match resolved_keycap_root(keycap_id) {
        Ok(p) => p,
        Err(e) => return error_response(StatusCode::NOT_FOUND, &e),
    };

    let resolved = match safe_resolve(&keycap_root, &relative) {
        Ok(p) => p,
        Err(e) => return error_response(StatusCode::FORBIDDEN, &e),
    };

    match std::fs::read(&resolved) {
        Ok(bytes) => {
            let mime = guess_mime(&resolved);
            Response::builder()
                .status(StatusCode::OK)
                .header("Content-Type", mime)
                .header("Cache-Control", "no-cache")
                .body(bytes)
                .unwrap_or_else(|_| error_response(StatusCode::INTERNAL_SERVER_ERROR, "build"))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            error_response(StatusCode::NOT_FOUND, "file not found")
        }
        Err(e) => error_response(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("read failed: {e}"),
        ),
    }
}

fn resolved_keycap_root(keycap_id: &str) -> Result<PathBuf, String> {
    if keycap_id.contains('/')
        || keycap_id.contains('\\')
        || keycap_id == "."
        || keycap_id == ".."
        || keycap_id.is_empty()
    {
        return Err("invalid keycap id".to_string());
    }
    let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
    let root = PathBuf::from(home).join(".ctrl").join("keycaps").join(keycap_id);
    // canonicalize fails if the dir doesn't exist — surface as 404 rather
    // than 500 (a missing keycap is a user-visible state, not a bug).
    root.canonicalize()
        .map_err(|_| format!("keycap '{keycap_id}' is not installed"))
}

fn safe_resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("missing file path".to_string());
    }
    // Reject obvious traversal before touching the filesystem.
    for part in relative.split('/') {
        if part == ".." || part == "." || part.is_empty() {
            return Err("path traversal rejected".to_string());
        }
        if part.contains('\\') || part.starts_with('/') {
            return Err("absolute / windows path components rejected".to_string());
        }
    }
    let candidate = root.join(relative);
    let canon = candidate
        .canonicalize()
        .map_err(|_| "file not found".to_string())?;
    // Final guard: canonical result must remain inside the keycap root even
    // if a symlink dragged us out.
    if !canon.starts_with(root) {
        return Err("symlink escaped keycap root".to_string());
    }
    Ok(canon)
}

fn guess_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("md") => "text/markdown; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("json") => "application/json; charset=utf-8",
        Some("toml") => "application/toml; charset=utf-8",
        Some("yaml") | Some("yml") => "application/yaml; charset=utf-8",
        Some("js") | Some("mjs") => "application/javascript; charset=utf-8",
        Some("ts") => "application/typescript; charset=utf-8",
        Some("html") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("lottie") | Some("json5") => "application/json; charset=utf-8",
        Some("pdf") => "application/pdf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

fn error_response(status: StatusCode, msg: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(msg.as_bytes().to_vec())
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap()
        })
}
