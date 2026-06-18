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

}
