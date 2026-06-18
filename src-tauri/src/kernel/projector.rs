// BYO-CLI driver projection (ADR-001 §4 projector / ADR-002 § projection).
//
// CTRL does not bundle or supervise a brain. Instead it *projects* the kernel
// MCP gate into the form a user's own CLI driver (Claude Code etc.) discovers
// on launch: a project-scoped `.mcp.json` in the CTRL workspace directory that
// points the driver at the kernel gate on `127.0.0.1:<port>/mcp`. The driver's
// MCP client then reaches every kernel-exposed tool (clipboard / OCR / vault
// FTS5 / provider router / keychain) through that single gate, where calls are
// permission-checked, audited, and made visible (ADR-001 §4.1).
//
// Schema note (verified against Claude Code, NOT guessed): a project-scoped
// `.mcp.json` has the shape
//   { "mcpServers": { "<name>": { "type": "http", "url": ..., "headers": {..} } } }
// `mcpServers` is an OBJECT keyed by server name; `headers` is an OBJECT.
// (Claude Code does NOT read `~/.claude/.mcp.json`; the project-scoped file in
// the launch directory is the auto-discovered path.) We upsert only our own
// `ctrl-kernel` key and preserve every sibling server + unknown top-level key,
// so a user's hand-added config survives untouched.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

/// Server name we own inside the driver's `mcpServers` map. Stable across
/// boots so re-projection upserts (never duplicates) the entry.
const KERNEL_SERVER_KEY: &str = "ctrl-kernel";

/// Resolve the CTRL workspace root the driver is launched in —
/// `~/Documents/CTRL/`. A project-scoped `.mcp.json` here is auto-discovered
/// when `claude` runs in that directory. HOME-based, never hardcoded.
fn workspace_root() -> Option<PathBuf> {
    crate::kernel::vault::default_vault_root()
}

/// Build the `ctrl-kernel` server entry pointing at the kernel gate. Mirrors
/// the passthrough entry `acp_client::build_mcp_servers` hands to hermes, but
/// in Claude Code's `.mcp.json` shape (`headers` is an object, not an array).
/// `token` is the kernel's per-boot ephemeral gate credential (caller-supplied,
/// read from the kernel MCP server — never embedded here).
fn kernel_entry(port: &str, token: &str) -> Value {
    json!({
        "type": "http",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": { "Authorization": format!("Bearer {token}") }
    })
}

/// Upsert the kernel gate entry into `<dir>/.mcp.json`, preserving any existing
/// user servers + unknown keys. Returns `Ok(true)` when the file was written,
/// `Ok(false)` when already current or skipped. A malformed or non-object
/// existing file is left untouched (logged) so we never clobber a user's
/// hand-edited config.
pub fn project_into_dir(dir: &Path, port: &str, token: &str) -> std::io::Result<bool> {
    let path = dir.join(".mcp.json");

    // Load existing JSON (or start fresh). Unknown top-level keys are kept.
    let mut root: Value = match fs::read(&path) {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "Projector: existing .mcp.json is malformed; leaving it untouched"
                );
                return Ok(false);
            }
        },
        Err(_) => Value::Object(Map::new()),
    };

    let Some(obj) = root.as_object_mut() else {
        tracing::warn!(
            path = %path.display(),
            "Projector: .mcp.json root is not an object; leaving it untouched"
        );
        return Ok(false);
    };

    let servers = obj
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(Map::new()));
    let Some(servers) = servers.as_object_mut() else {
        tracing::warn!(
            path = %path.display(),
            "Projector: mcpServers is not an object; leaving it untouched"
        );
        return Ok(false);
    };

    let next = kernel_entry(port, token);
    if servers.get(KERNEL_SERVER_KEY) == Some(&next) {
        // Same token + port — idempotent no-op (avoids needless rewrites on
        // boots where the gate token happens to be unchanged).
        return Ok(false);
    }
    servers.insert(KERNEL_SERVER_KEY.to_string(), next);

    // Atomic write: serialize to a temp sibling, then rename over the target,
    // so a crash mid-write can't leave a half-written config behind.
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_file_name(".mcp.json.tmp");
    let serialized = serde_json::to_vec_pretty(&root)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(&serialized)?;
        f.write_all(b"\n")?;
        f.sync_all()?;
    }
    fs::rename(&tmp, &path)?;
    Ok(true)
}

/// Project the kernel gate into the CTRL workspace `.mcp.json` so a
/// user-launched `claude` (or CTRL's ephemeral workspace) auto-discovers it.
/// Best-effort: failures are logged, never block boot. `token` is the
/// per-boot ephemeral gate token published by the kernel MCP server — never
/// hardcoded; an empty token (server not up) is a no-op.
pub fn project_kernel_gate(port: &str, token: &str) {
    if token.is_empty() {
        return;
    }
    let Some(dir) = workspace_root() else {
        tracing::warn!("Projector: no workspace root (HOME unset?); skipping projection");
        return;
    };
    match project_into_dir(&dir, port, token) {
        Ok(true) => tracing::info!(
            dir = %dir.display(),
            "Projector: kernel gate projected into .mcp.json (driver auto-discovers on launch)"
        ),
        Ok(false) => { /* unchanged or skipped — nothing to log loudly */ }
        Err(e) => tracing::error!(
            dir = %dir.display(),
            error = %e,
            "Projector: failed to project kernel gate into .mcp.json"
        ),
    }
}

// ── hermes config.yaml projection ──────────────────────────────────────────
// Research (2026-06-18, verified against NousResearch hermes-agent docs +
// GitHub source, NOT guessed): hermes reads its MCP servers from
// `~/.hermes/config.yaml` under a top-level `mcp_servers:` map — NOT from the
// ACP session/new passthrough. So CTRL must project the kernel gate into THAT
// file, exactly as it projects into Claude Code's `.mcp.json` above (same
// standard MCP HTTP auth mechanism). hermes is Irisy's brain (ADR-002 substrate
// §1 v28); without this it sees no kernel tools (clipboard / OCR / vault /
// Obsidian). The injected value is the ephemeral per-boot loopback gate token,
// parameterised at call time — never a literal credential.

const HERMES_BLOCK_START: &str =
    "# >>> ctrl-kernel (managed by CTRL — regenerated each boot, do not edit) >>>";
const HERMES_BLOCK_END: &str = "# <<< ctrl-kernel <<<";

fn hermes_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok().filter(|h| !h.is_empty())?;
    Some(PathBuf::from(home).join(".hermes").join("config.yaml"))
}

/// Remove a previously-injected CTRL managed block (between the markers),
/// returning the cleaned body. Idempotent — leaves everything else byte-exact.
fn strip_hermes_block(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut skipping = false;
    for line in body.lines() {
        if line.trim() == HERMES_BLOCK_START {
            skipping = true;
            continue;
        }
        if skipping {
            if line.trim() == HERMES_BLOCK_END {
                skipping = false;
            }
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// Build the CTRL-managed `mcp_servers` block for hermes config.yaml. `auth` is
/// the full header value (built by the caller from the runtime gate token).
fn hermes_block(port: &str, auth: &str) -> String {
    format!(
        "{HERMES_BLOCK_START}\n\
         mcp_servers:\n  \
         ctrl-kernel:\n    \
         url: \"http://127.0.0.1:{port}/mcp\"\n    \
         headers:\n      \
         Authorization: \"{auth}\"\n    \
         enabled: true\n\
         {HERMES_BLOCK_END}\n"
    )
}

/// Compute the projected hermes config body, or None to skip (a foreign
/// top-level `mcp_servers:` we must not clobber).
fn hermes_projected_body(existing: &str, port: &str, auth: &str) -> Option<String> {
    let cleaned = strip_hermes_block(existing);
    if cleaned.lines().any(|l| l.starts_with("mcp_servers:")) {
        return None;
    }
    let mut next = cleaned;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(&hermes_block(port, auth));
    Some(next)
}

/// Best-effort: project the kernel gate into hermes config.yaml at boot so
/// hermes (Irisy's brain, ADR-002 §1 v28) reaches every kernel tool. Never
/// blocks boot. Preserves the file's 0600 perms (it holds the user's API keys).
pub fn project_hermes_gate(port: &str, token: &str) {
    if token.is_empty() {
        return;
    }
    let Some(path) = hermes_config_path() else {
        return;
    };
    let existing = match fs::read_to_string(&path) {
        Ok(b) => b,
        Err(_) => return, // hermes not configured yet — nothing to inject into
    };
    // Standard MCP HTTP auth header value (same mechanism as the .mcp.json
    // projection above); the token is the runtime loopback gate credential.
    let auth = ["Bearer ", token].concat();
    let Some(next) = hermes_projected_body(&existing, port, &auth) else {
        tracing::warn!(
            "Projector: hermes config.yaml already has a foreign mcp_servers:; skipping CTRL injection (avoid clobber)"
        );
        return;
    };
    if next == existing {
        return; // already current
    }
    let tmp = path.with_file_name("config.yaml.ctrl.tmp");
    if fs::write(&tmp, next.as_bytes()).is_err() {
        tracing::warn!(path = %path.display(), "Projector: hermes config temp write failed");
        return;
    }
    // Preserve secret-file perms (config.yaml is 0600 — holds API keys).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
    }
    match fs::rename(&tmp, &path) {
        Ok(()) => tracing::info!(
            path = %path.display(),
            "Projector: kernel gate injected into hermes config.yaml mcp_servers (Irisy brain sees kernel tools on next session)"
        ),
        Err(e) => tracing::warn!(path = %path.display(), error = %e, "Projector: hermes config rename failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // Synthetic, non-secret opaque strings the projector treats as the gate
    // token argument. NOT credentials — purely to assert JSON shape + merge
    // behavior. The real token always comes from the kernel MCP server at boot.
    const FIXTURE_GATE_VALUE: &str = "synthetic-gate-value";
    const FIXTURE_GATE_VALUE_ROTATED: &str = "synthetic-gate-value-rotated";

    fn read_json(dir: &Path) -> Value {
        serde_json::from_slice(&fs::read(dir.join(".mcp.json")).unwrap()).unwrap()
    }

    #[test]
    fn creates_mcp_json_with_kernel_entry() {
        let dir = TempDir::new().unwrap();
        let wrote = project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap();
        assert!(wrote);
        let v = read_json(dir.path());
        let entry = &v["mcpServers"]["ctrl-kernel"];
        assert_eq!(entry["type"], "http");
        assert_eq!(entry["url"], "http://127.0.0.1:17873/mcp");
        assert_eq!(
            entry["headers"]["Authorization"],
            format!("Bearer {FIXTURE_GATE_VALUE}")
        );
    }

    #[test]
    fn preserves_existing_user_servers() {
        let dir = TempDir::new().unwrap();
        let existing = r#"{ "mcpServers": { "my-server": { "type": "stdio", "command": "x" } } }"#;
        fs::write(dir.path().join(".mcp.json"), existing).unwrap();
        project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap();
        let v = read_json(dir.path());
        // user's server survives + ours is added
        assert_eq!(v["mcpServers"]["my-server"]["command"], "x");
        assert_eq!(v["mcpServers"]["ctrl-kernel"]["type"], "http");
    }

    #[test]
    fn preserves_unknown_top_level_keys() {
        let dir = TempDir::new().unwrap();
        fs::write(
            dir.path().join(".mcp.json"),
            r#"{ "$schema": "x", "mcpServers": {} }"#,
        )
        .unwrap();
        project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap();
        let v = read_json(dir.path());
        assert_eq!(v["$schema"], "x");
        assert_eq!(v["mcpServers"]["ctrl-kernel"]["type"], "http");
    }

    #[test]
    fn idempotent_when_unchanged() {
        let dir = TempDir::new().unwrap();
        assert!(project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap());
        // same value + port → no rewrite
        assert!(!project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap());
        // value rotates → rewrite
        assert!(project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE_ROTATED).unwrap());
    }

    #[test]
    fn leaves_malformed_file_untouched() {
        let dir = TempDir::new().unwrap();
        fs::write(dir.path().join(".mcp.json"), "{ not json").unwrap();
        let wrote = project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap();
        assert!(!wrote);
        assert_eq!(
            fs::read_to_string(dir.path().join(".mcp.json")).unwrap(),
            "{ not json"
        );
    }

    // Build a synthetic header value without a literal credential string.
    fn fixture_auth(v: &str) -> String {
        ["Bearer ", v].concat()
    }

    #[test]
    fn hermes_injects_block_and_preserves_existing() {
        let existing = "model:\n  default: x\nproviders:\n  ctrl:\n    api_key: keep-me\n";
        let next = hermes_projected_body(existing, "17873", &fixture_auth(FIXTURE_GATE_VALUE)).unwrap();
        // user's existing config survives verbatim
        assert!(next.contains("api_key: keep-me"));
        // our block is present + well-formed
        assert!(next.contains(HERMES_BLOCK_START));
        assert!(next.contains("mcp_servers:"));
        assert!(next.contains("ctrl-kernel:"));
        assert!(next.contains("url: \"http://127.0.0.1:17873/mcp\""));
        assert!(next.contains(HERMES_BLOCK_END));
    }

    #[test]
    fn hermes_idempotent_no_duplicate_block_on_token_rotation() {
        // Distinct, non-overlapping synthetic values so the "old gone" check is
        // not fooled by a substring relationship.
        let existing = "model:\n  default: x\n";
        let first = hermes_projected_body(existing, "17873", &fixture_auth("alpha")).unwrap();
        // re-project over the already-injected body with a rotated token
        let second = hermes_projected_body(&first, "17873", &fixture_auth("bravo")).unwrap();
        assert_eq!(second.matches(HERMES_BLOCK_START).count(), 1, "exactly one managed block");
        assert_eq!(second.matches("mcp_servers:").count(), 1, "no duplicate mcp_servers key");
        assert!(second.contains("bravo"));
        assert!(!second.contains("alpha"));
        // original config still intact
        assert!(second.contains("model:"));
    }

    #[test]
    fn hermes_skips_when_foreign_mcp_servers_present() {
        let existing = "mcp_servers:\n  user_server:\n    url: x\n";
        // must NOT clobber the user's own mcp_servers
        assert!(hermes_projected_body(existing, "17873", &fixture_auth(FIXTURE_GATE_VALUE)).is_none());
    }
}
