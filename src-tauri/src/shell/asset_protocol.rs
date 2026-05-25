// ctrl-asset:// Tauri 2 custom URI scheme handler.
//
// Per ADR-001 amendment 2026-05-25 (canonical keycap layout): every
// keycap-owned asset (icon.svg / icon.lottie / prompt.md / few-shots.json
// / system-prompt.md / tool-schema.json) lives inside the keycap's own
// directory under `~/.ctrl/keycaps/<id>/assets/`. The PWA cannot read
// arbitrary file system paths from the WebView, so we expose those
// assets through a custom URI scheme that the IconRenderer + Pool detail
// + viewer registry consume as `ctrl-asset://localhost/keycaps/<id>/assets/<path>`.
//
// daedalus has shipped the consumer side as a placeholder (`<img src="ctrl-asset://...">`)
// in PR #44 — this commit makes the scheme actually resolve.
//
// Security:
//   - Only paths matching `keycaps/<id>/(assets|skills)/...` are served.
//     <id> must be `[A-Za-z0-9_-]+` (no dots, no slashes).
//   - The resolved canonical path is checked to still live inside the
//     resolved keycap root (defeats `..` traversal even if the URI parser
//     normalized it).
//   - Read-only — the scheme handler never writes; user edits to keycap
//     assets go through Tauri commands (Config-tier adjustment writes
//     `~/.ctrl/keycaps/<id>/config.toml`; Patch-tier writes
//     `~/.ctrl/keycaps/<id>/patches/*.patch`).
//
// Cross-platform note: Tauri 2 exposes custom schemes as
//   - macOS / Linux: `ctrl-asset://localhost/...`
//   - Windows WebView2: `http://ctrl-asset.localhost/...`
// PWA's `convertFileSrc('keycaps/translate/assets/icon.svg', 'ctrl-asset')`
// (or equivalent helper) hides this difference.

use std::path::{Component, Path, PathBuf};
use tauri::http::{Request, Response, StatusCode};
use tauri::{UriSchemeContext, UriSchemeResponder};

/// Scheme name. Mirrored in tauri.conf.json CSP.
pub const SCHEME: &str = "ctrl-asset";

/// Resolve `~/.ctrl/keycaps/` once at handler registration. None when
/// HOME isn't resolvable (CI / very locked-down test environments) —
/// the handler then returns 503 for every request.
fn keycaps_root() -> Option<PathBuf> {
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"))?;
    Some(PathBuf::from(home).join(".ctrl").join("keycaps"))
}

/// Parse the incoming URI path. Returns Some((keycap_id, sub_path)) when
/// the path matches `/keycaps/<id>/<sub>` and the id is a safe identifier.
fn parse_keycap_path(uri_path: &str) -> Option<(String, PathBuf)> {
    // Tauri delivers the path component (`/keycaps/...`); strip leading `/`.
    let trimmed = uri_path.trim_start_matches('/');
    let mut segs = trimmed.splitn(3, '/');
    if segs.next()? != "keycaps" {
        return None;
    }
    let id = segs.next()?;
    let sub = segs.next()?;

    // id allow-list: [A-Za-z0-9_-]+
    if id.is_empty()
        || id
            .chars()
            .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
    {
        return None;
    }

    // sub must not be empty or contain absolute / parent components.
    let sub_path = PathBuf::from(sub);
    for c in sub_path.components() {
        match c {
            Component::Normal(_) => {}
            _ => return None, // Prefix / RootDir / CurDir / ParentDir all rejected
        }
    }

    Some((id.to_string(), sub_path))
}

fn content_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("ico") => "image/x-icon",
        Some("json") => "application/json; charset=utf-8",
        Some("md") | Some("markdown") => "text/markdown; charset=utf-8",
        Some("txt") => "text/plain; charset=utf-8",
        Some("toml") => "application/toml; charset=utf-8",
        Some("yaml") | Some("yml") => "application/yaml; charset=utf-8",
        Some("lottie") => "application/json; charset=utf-8", // .lottie = JSON
        _ => "application/octet-stream",
    }
}

fn error_response(status: StatusCode, body: &'static str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(body.as_bytes().to_vec())
        .expect("infallible response build")
}

/// The Tauri 2 protocol callback. Called from the WebView thread per
/// request; responder.respond(...) sends the response back asynchronously
/// so we don't block the WebView.
pub fn handle_request<R: tauri::Runtime>(
    _ctx: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let Some(root) = keycaps_root() else {
        responder.respond(error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "ctrl-asset: HOME / USERPROFILE not resolvable",
        ));
        return;
    };

    let uri = request.uri();
    let path = uri.path();

    let Some((keycap_id, sub_path)) = parse_keycap_path(path) else {
        responder.respond(error_response(
            StatusCode::BAD_REQUEST,
            "ctrl-asset: path must match /keycaps/<id>/<sub> with safe id and no ..",
        ));
        return;
    };

    let keycap_root = root.join(&keycap_id);
    let target = keycap_root.join(&sub_path);

    // Canonicalize both sides; if canonicalization fails (file missing),
    // return 404. If the resolved target escapes keycap_root, return 403.
    let canonical_target = match std::fs::canonicalize(&target) {
        Ok(p) => p,
        Err(_) => {
            responder.respond(error_response(
                StatusCode::NOT_FOUND,
                "ctrl-asset: file not found",
            ));
            return;
        }
    };
    let canonical_root = match std::fs::canonicalize(&keycap_root) {
        Ok(p) => p,
        Err(_) => {
            // Keycap not installed.
            responder.respond(error_response(
                StatusCode::NOT_FOUND,
                "ctrl-asset: keycap not installed",
            ));
            return;
        }
    };
    if !canonical_target.starts_with(&canonical_root) {
        responder.respond(error_response(
            StatusCode::FORBIDDEN,
            "ctrl-asset: resolved path escapes keycap root",
        ));
        return;
    }

    // Read + serve. Asset sizes are small (icons / prompts / json) so
    // sync read in a Tauri scheme callback is acceptable; switch to
    // tokio::spawn_blocking if any keycap ships big binary assets.
    let bytes = match std::fs::read(&canonical_target) {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(
                target: "ctrl_asset",
                ?canonical_target,
                error = %e,
                "ctrl-asset: read failed"
            );
            responder.respond(error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "ctrl-asset: read failed",
            ));
            return;
        }
    };

    let response = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", content_type(&canonical_target))
        // Aggressive cache — keycap assets are immutable per version; when
        // a keycap upgrades, its <id> stays but the version bumps, so the
        // PWA can include version in the URL query string for cache-bust
        // (Tauri scheme handlers ignore query, browsers honor it).
        .header("Cache-Control", "public, max-age=3600")
        .body(bytes)
        .expect("infallible response build");
    responder.respond(response);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_keycap_path() {
        let (id, sub) = parse_keycap_path("/keycaps/translate/assets/icon.svg").unwrap();
        assert_eq!(id, "translate");
        assert_eq!(sub, PathBuf::from("assets/icon.svg"));
    }

    #[test]
    fn parses_nested_sub_path() {
        let (id, sub) = parse_keycap_path("/keycaps/pi/skills/code-review/SKILL.md").unwrap();
        assert_eq!(id, "pi");
        assert_eq!(sub, PathBuf::from("skills/code-review/SKILL.md"));
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(parse_keycap_path("/keycaps/translate/../etc/passwd").is_none());
        assert!(parse_keycap_path("/keycaps/translate/assets/../../etc/passwd").is_none());
    }

    #[test]
    fn rejects_unsafe_id() {
        assert!(parse_keycap_path("/keycaps/../foo/assets/icon.svg").is_none());
        assert!(parse_keycap_path("/keycaps/foo bar/assets/icon.svg").is_none());
        assert!(parse_keycap_path("/keycaps/foo.bar/assets/icon.svg").is_none());
        assert!(parse_keycap_path("/keycaps//assets/icon.svg").is_none());
    }

    #[test]
    fn rejects_non_keycaps_prefix() {
        assert!(parse_keycap_path("/vault/notes/foo.md").is_none());
        assert!(parse_keycap_path("/keycaps").is_none());
        assert!(parse_keycap_path("/keycaps/translate").is_none());
    }

    #[test]
    fn content_type_by_extension() {
        assert_eq!(content_type(Path::new("a/b/icon.svg")), "image/svg+xml");
        assert_eq!(
            content_type(Path::new("prompt.md")),
            "text/markdown; charset=utf-8"
        );
        assert_eq!(
            content_type(Path::new("few-shots.json")),
            "application/json; charset=utf-8"
        );
        assert_eq!(
            content_type(Path::new("icon.lottie")),
            "application/json; charset=utf-8"
        );
        assert_eq!(content_type(Path::new("blob.bin")), "application/octet-stream");
    }
}
