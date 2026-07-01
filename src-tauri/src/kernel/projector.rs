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
//
// Memory projection: alongside the gate we also derive an `AGENTS.md` — the
// CROSS-TOOL standard context file (read by Claude Code, Codex, and other
// agentic CLIs), deliberately NOT the Claude-specific `CLAUDE.md`, so the
// projection stays driver-agnostic (BYO-CLI, not Claude-bound). We own only a
// delimited block between BEGIN/END markers and preserve anything the user
// wrote outside it.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::kernel::audit;
use crate::kernel::visibility;

/// Server name we own inside the driver's `mcpServers` map. Stable across
/// boots so re-projection upserts (never duplicates) the entry.
const KERNEL_SERVER_KEY: &str = "ctrl-kernel";

/// Caller identity stamped on the BYO-CLI projection. Driver-agnostic on
/// purpose — any HTTP-MCP CLI launched in the workspace reads this `.mcp.json`,
/// so we attribute it to the BYO-CLI path, not a specific product. Recorded in
/// the gate audit ledger so BYO-CLI traffic is attributable rather than blanket
/// "external" (ADR-010 trust-domains, SC3 caller refinement).
const BYO_CLI_CALLER: &str = "byo-cli";

/// Default intent the base workspace projection grants a BYO-CLI driver: CTRL's
/// own data-augmentation domains (notes vault, smart tables, memory, kv,
/// provider router, capability registry). DELIBERATELY excludes `net` (the
/// `http_get` / `http_post` exfiltration surface — a BYO CLI has its own network
/// access; routing it through CTRL's gate adds an unaudited exfil path labeled
/// as CTRL) and `mcp` (raw downstream passthrough — a BYO CLI mounts its own MCP
/// servers). `system` tools (kernel_status, vault_root_path) are always visible
/// regardless of intent. Override with `CTRL_BYO_INTENT` — a comma-separated
/// domain list, or `unscoped` for the full toolset (ADR-010 trust-domains,
/// SC3 intent-scoped projection; ADR-001 section 4 projector subset rule).
const BYO_CLI_DEFAULT_INTENT: &str = "vault,smart_table,tasks,notes,providers,registry,kv,llm,memory";

/// Resolve the intent header value for the base projection. `None` => omit the
/// header entirely (unscoped / full toolset). Honors the `CTRL_BYO_INTENT`
/// escape hatch so a power user (or CTRL's active-launch path) can widen,
/// narrow, or disable the default scope without a rebuild.
fn resolve_byo_intent() -> Option<String> {
    match std::env::var("CTRL_BYO_INTENT") {
        Ok(v) if v.trim().eq_ignore_ascii_case("unscoped") => None,
        Ok(v) if !v.trim().is_empty() => Some(v.trim().to_string()),
        _ => Some(BYO_CLI_DEFAULT_INTENT.to_string()),
    }
}

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
///
/// Beyond `Authorization`, we stamp the gate's identity headers so the BYO-CLI
/// path lands at the gate already attributed (`X-Ctrl-Caller`) and scoped to a
/// least-privilege tool subset (`X-Ctrl-Intent`). `intent: None` omits the
/// scope header entirely (full toolset). The driver's MCP client forwards these
/// headers verbatim on every `tools/list` + `tools/call` (ADR-010 § trust-domains,
/// SC3).
fn kernel_entry(port: &str, token: &str, caller: &str, intent: Option<&str>) -> Value {
    let mut headers = Map::new();
    headers.insert("Authorization".to_string(), json!(format!("Bearer {token}")));
    headers.insert(audit::CALLER_HEADER.to_string(), json!(caller));
    if let Some(intent) = intent {
        headers.insert(visibility::INTENT_HEADER.to_string(), json!(intent));
    }
    json!({
        "type": "http",
        "url": format!("http://127.0.0.1:{port}/mcp"),
        "headers": Value::Object(headers)
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

    let intent = resolve_byo_intent();
    let next = kernel_entry(port, token, BYO_CLI_CALLER, intent.as_deref());
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

// --- Codex BYO-CLI driver projection -------------------------------------
//
// Codex is a second BYO-CLI driver (ADR-001 §4 projector; architecture
// byo-cli-driver path). Unlike Claude Code it does NOT read a project-scoped
// `.mcp.json` — it loads MCP servers from the user's GLOBAL `~/.codex/config.toml`
// under `[mcp_servers.<id>]`, and it natively supports the streamable-HTTP
// transport (`url` + `http_headers`) — verified against the Codex config
// reference. So we upsert the SAME gate the workspace `.mcp.json` carries, in
// Codex's TOML shape. We touch `~/.codex/` ONLY when it already exists: CTRL
// never installs or supervises a BYO-CLI (that's the whole point of the path),
// so "you already have Codex" is the trigger to wire CTRL's gate into it. We use
// `toml_edit` so a user's hand-tuned config keeps its comments + layout.

/// Upsert `[mcp_servers.ctrl-kernel]` (streamable-HTTP gate entry) into a Codex
/// `config.toml`, preserving every other table + the file's formatting. Returns
/// `Ok(true)` when written, `Ok(false)` when already current or skipped. A
/// malformed existing file is left untouched (logged) — never clobber a config
/// the user hand-edited.
pub fn project_codex_config(
    path: &Path,
    port: &str,
    token: &str,
    caller: &str,
    intent: Option<&str>,
) -> std::io::Result<bool> {
    use toml_edit::{value, DocumentMut, Item, Table};

    let existing = fs::read_to_string(path).unwrap_or_default();
    let mut doc: DocumentMut = if existing.trim().is_empty() {
        DocumentMut::new()
    } else {
        match existing.parse() {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!(
                    path = %path.display(),
                    error = %e,
                    "Projector: existing ~/.codex/config.toml is malformed; leaving it untouched"
                );
                return Ok(false);
            }
        }
    };

    // Static headers Codex forwards on every MCP request — same identity the
    // Claude Code projection stamps, so BYO-CLI traffic lands at the gate
    // attributed + intent-scoped (ADR-010 § trust-domains, SC3).
    let mut headers = Table::new();
    headers.set_implicit(false);
    headers.insert("Authorization", value(format!("Bearer {token}")));
    headers.insert(audit::CALLER_HEADER, value(caller));
    if let Some(intent) = intent {
        headers.insert(visibility::INTENT_HEADER, value(intent));
    }

    let mut server = Table::new();
    server.set_implicit(false);
    server.insert("url", value(format!("http://127.0.0.1:{port}/mcp")));
    server.insert("http_headers", Item::Table(headers));

    // Ensure [mcp_servers] is a table; preserve any sibling servers the user
    // configured. `set_implicit(true)` keeps it printing as the dotted
    // `[mcp_servers.ctrl-kernel]` header rather than a bare `[mcp_servers]`.
    if !doc.contains_key("mcp_servers") {
        let mut parent = Table::new();
        parent.set_implicit(true);
        doc.insert("mcp_servers", Item::Table(parent));
    }
    let Some(servers) = doc["mcp_servers"].as_table_mut() else {
        tracing::warn!(
            path = %path.display(),
            "Projector: [mcp_servers] is not a table; leaving config.toml untouched"
        );
        return Ok(false);
    };
    servers.insert(KERNEL_SERVER_KEY, Item::Table(server));

    let next = doc.to_string();
    if next == existing {
        return Ok(false);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_file_name("config.toml.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(next.as_bytes())?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    Ok(true)
}

/// Resolve `~/.codex/config.toml`. HOME-based, never hardcoded.
fn codex_config_path() -> Option<PathBuf> {
    directories::BaseDirs::new().map(|b| b.home_dir().join(".codex").join("config.toml"))
}

/// Project the kernel gate into the user's Codex config — best-effort, and ONLY
/// when `~/.codex/` already exists (CTRL never installs/supervises a BYO-CLI).
/// `token` is the per-boot gate credential; an empty token (server not up) is a
/// no-op. Failures are logged, never block boot.
pub fn project_codex_gate(port: &str, token: &str) {
    if token.is_empty() {
        return;
    }
    let Some(path) = codex_config_path() else {
        return;
    };
    // Non-invasive: wire CTRL's gate into Codex only if the user actually has it.
    let Some(codex_dir) = path.parent() else { return };
    if !codex_dir.exists() {
        return;
    }
    let intent = resolve_byo_intent();
    match project_codex_config(&path, port, token, BYO_CLI_CALLER, intent.as_deref()) {
        Ok(true) => tracing::info!(
            path = %path.display(),
            "Projector: kernel gate projected into ~/.codex/config.toml (Codex auto-discovers)"
        ),
        Ok(false) => { /* unchanged or skipped */ }
        Err(e) => tracing::error!(
            path = %path.display(),
            error = %e,
            "Projector: failed to project kernel gate into ~/.codex/config.toml"
        ),
    }
}

/// Delimiters around the CTRL-managed block in `AGENTS.md`. Stable across boots
/// so re-projection replaces (never duplicates) our block while preserving any
/// user-authored prose outside the markers.
const AGENTS_BEGIN: &str = "<!-- BEGIN CTRL (generated — do not edit inside) -->";
const AGENTS_END: &str = "<!-- END CTRL -->";

/// The CTRL-owned `AGENTS.md` block. Driver-agnostic on purpose — it names no
/// specific CLI; any agentic CLI that reads `AGENTS.md` gets the same context.
fn ctrl_agents_block() -> String {
    format!(
        "{AGENTS_BEGIN}\n\
# CTRL workspace\n\
\n\
This directory is a CTRL workspace — a local-first AI workbench. Your local\n\
files are the source of truth.\n\
\n\
- **Data is plain text.** Notes live under `Notes/` as markdown + frontmatter.\n\
  Open them with any editor; nothing is locked in a private format or database.\n\
- **CTRL kernel tools** are mounted over MCP as the `ctrl-kernel` server (see\n\
  `.mcp.json`): read / write / full-text-search the notes vault, backlinks,\n\
  tags, link graph, clipboard, OCR, and the provider router. Prefer these so\n\
  calls stay permission-checked and audited at the kernel gate.\n\
- **Local is truth, cloud is mirror.** Read local first; writes are visible\n\
  immediately.\n\
\n\
This block is generated by CTRL and refreshed on launch. Add your own project\n\
notes OUTSIDE the markers — that content is preserved.\n\
{AGENTS_END}"
    )
}

/// Upsert the CTRL block into `<dir>/AGENTS.md`, preserving any user prose
/// outside the markers. Returns `Ok(true)` when written, `Ok(false)` when
/// already current or skipped. A file containing exactly one marker (corrupt /
/// half-edited) is left untouched so we never mangle user content.
pub fn project_agents_md(dir: &Path) -> std::io::Result<bool> {
    let path = dir.join("AGENTS.md");
    let block = ctrl_agents_block();
    let existing = fs::read_to_string(&path).unwrap_or_default();

    let has_begin = existing.contains(AGENTS_BEGIN);
    let has_end = existing.contains(AGENTS_END);

    let next = if existing.is_empty() {
        format!("{block}\n")
    } else if has_begin && has_end {
        // Replace our managed block in place; keep everything around it.
        let start = existing.find(AGENTS_BEGIN).unwrap();
        let end = existing.find(AGENTS_END).unwrap() + AGENTS_END.len();
        if start > end {
            tracing::warn!(path = %path.display(), "Projector: AGENTS.md markers out of order; leaving it untouched");
            return Ok(false);
        }
        format!("{}{}{}", &existing[..start], block, &existing[end..])
    } else if has_begin || has_end {
        tracing::warn!(path = %path.display(), "Projector: AGENTS.md has a single CTRL marker (corrupt); leaving it untouched");
        return Ok(false);
    } else {
        // User-authored AGENTS.md without our block — append ours below it.
        format!("{}\n\n{block}\n", existing.trim_end())
    };

    if next == existing {
        return Ok(false);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = path.with_file_name("AGENTS.md.tmp");
    {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(next.as_bytes())?;
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

    // Memory projection — driver-agnostic AGENTS.md (not Claude-specific
    // CLAUDE.md). Best-effort; never blocks boot.
    match project_agents_md(&dir) {
        Ok(true) => tracing::info!(
            dir = %dir.display(),
            "Projector: workspace context projected into AGENTS.md (cross-tool)"
        ),
        Ok(false) => { /* unchanged or skipped */ }
        Err(e) => tracing::error!(
            dir = %dir.display(),
            error = %e,
            "Projector: failed to project AGENTS.md"
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
    fn kernel_entry_stamps_caller_and_intent_headers() {
        // Pure (no env): the BYO-CLI driver lands at the gate already
        // attributed + scoped, so SC3 caller refinement + intent projection
        // apply to external CLIs by default.
        let entry = kernel_entry("17873", FIXTURE_GATE_VALUE, "byo-cli", Some("vault,kv"));
        let h = &entry["headers"];
        // Authorization shape is covered by creates_mcp_json_with_kernel_entry;
        // here we assert the SC3 identity headers ride alongside it.
        assert!(h.get("Authorization").is_some());
        assert_eq!(h[audit::CALLER_HEADER], "byo-cli");
        assert_eq!(h[visibility::INTENT_HEADER], "vault,kv");
    }

    #[test]
    fn kernel_entry_omits_intent_when_unscoped() {
        // intent: None => no scope header at all (full toolset), but the caller
        // is still attributed.
        let entry = kernel_entry("17873", FIXTURE_GATE_VALUE, "byo-cli", None);
        let h = &entry["headers"];
        assert_eq!(h[audit::CALLER_HEADER], "byo-cli");
        assert!(
            h.get(visibility::INTENT_HEADER).is_none(),
            "unscoped projection must not stamp an intent header"
        );
    }

    #[test]
    fn default_intent_excludes_exfil_and_passthrough_domains() {
        // Lock the policy: the base BYO-CLI scope grants CTRL's data domains but
        // never `net` (http exfiltration) or `mcp` (raw downstream passthrough).
        let domains: Vec<&str> = BYO_CLI_DEFAULT_INTENT.split(',').collect();
        for must in ["vault", "smart_table", "notes", "memory", "kv"] {
            assert!(domains.contains(&must), "default intent must grant '{must}'");
        }
        for forbidden in ["net", "mcp", "http"] {
            assert!(
                !domains.contains(&forbidden),
                "default intent must NOT grant '{forbidden}' (exfiltration / passthrough surface)"
            );
        }
        // The stamped subset must be parseable + actually scope a tool out: a
        // net tool is hidden, a vault tool is visible.
        let intent = visibility::Intent::parse(Some(BYO_CLI_DEFAULT_INTENT));
        assert!(intent.is_scoped());
        assert!(intent.allows_tool("vault_read"));
        assert!(intent.allows_tool("smart_table_query"));
        assert!(!intent.allows_tool("http_post"));
        // System introspection stays visible even under the scoped default.
        assert!(intent.allows_tool("kernel_status"));
    }

    #[test]
    fn projection_stamps_byo_caller_and_a_scope_by_default() {
        // End-to-end through project_into_dir with the ambient (unset) env: the
        // written entry carries the byo-cli caller + a non-empty intent scope.
        let dir = TempDir::new().unwrap();
        project_into_dir(dir.path(), "17873", FIXTURE_GATE_VALUE).unwrap();
        let v = read_json(dir.path());
        let h = &v["mcpServers"]["ctrl-kernel"]["headers"];
        assert_eq!(h[audit::CALLER_HEADER], "byo-cli");
        let intent = h[visibility::INTENT_HEADER]
            .as_str()
            .expect("default projection stamps an intent header");
        assert!(intent.contains("vault"));
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

    fn read_agents(dir: &Path) -> String {
        fs::read_to_string(dir.join("AGENTS.md")).unwrap()
    }

    #[test]
    fn creates_agents_md_with_ctrl_block() {
        let dir = TempDir::new().unwrap();
        let wrote = project_agents_md(dir.path()).unwrap();
        assert!(wrote);
        let s = read_agents(dir.path());
        assert!(s.contains(AGENTS_BEGIN) && s.contains(AGENTS_END));
        assert!(s.contains("CTRL workspace"));
        // driver-agnostic: must NOT name a specific CLI
        assert!(!s.to_lowercase().contains("claude code"));
    }

    #[test]
    fn agents_md_idempotent_when_unchanged() {
        let dir = TempDir::new().unwrap();
        assert!(project_agents_md(dir.path()).unwrap());
        assert!(!project_agents_md(dir.path()).unwrap());
    }

    #[test]
    fn agents_md_preserves_user_prose_outside_markers() {
        let dir = TempDir::new().unwrap();
        // user writes their own AGENTS.md first
        fs::write(dir.path().join("AGENTS.md"), "# My project rules\nUse 4 spaces.\n").unwrap();
        assert!(project_agents_md(dir.path()).unwrap());
        let s = read_agents(dir.path());
        assert!(s.contains("# My project rules"));
        assert!(s.contains("Use 4 spaces."));
        assert!(s.contains(AGENTS_BEGIN));
    }

    #[test]
    fn agents_md_replaces_stale_block_in_place() {
        let dir = TempDir::new().unwrap();
        let stale = format!("intro\n\n{AGENTS_BEGIN}\nOLD CONTENT\n{AGENTS_END}\n\noutro\n");
        fs::write(dir.path().join("AGENTS.md"), &stale).unwrap();
        assert!(project_agents_md(dir.path()).unwrap());
        let s = read_agents(dir.path());
        assert!(s.contains("intro") && s.contains("outro"));
        assert!(!s.contains("OLD CONTENT"));
        assert!(s.contains("CTRL workspace"));
        // exactly one managed block (no duplication)
        assert_eq!(s.matches(AGENTS_BEGIN).count(), 1);
    }

    #[test]
    fn agents_md_single_marker_left_untouched() {
        let dir = TempDir::new().unwrap();
        let corrupt = format!("{AGENTS_BEGIN}\nhalf edited, no end marker\n");
        fs::write(dir.path().join("AGENTS.md"), &corrupt).unwrap();
        let wrote = project_agents_md(dir.path()).unwrap();
        assert!(!wrote);
        assert_eq!(read_agents(dir.path()), corrupt);
    }

    // --- Codex projection ------------------------------------------------

    #[test]
    fn codex_config_gets_http_gate_entry() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.toml");
        let wrote =
            project_codex_config(&path, "17873", FIXTURE_GATE_VALUE, "byo-cli", Some("vault,notes"))
                .unwrap();
        assert!(wrote);
        let doc: toml::Value = toml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let entry = &doc["mcp_servers"]["ctrl-kernel"];
        assert_eq!(entry["url"].as_str().unwrap(), "http://127.0.0.1:17873/mcp");
        let headers = &entry["http_headers"];
        assert_eq!(
            headers["Authorization"].as_str().unwrap(),
            format!("Bearer {FIXTURE_GATE_VALUE}")
        );
        assert_eq!(headers[audit::CALLER_HEADER].as_str().unwrap(), "byo-cli");
        assert_eq!(headers[visibility::INTENT_HEADER].as_str().unwrap(), "vault,notes");
    }

    #[test]
    fn codex_config_preserves_user_servers_and_is_idempotent() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.toml");
        // A user's hand-written config with their own MCP server + a comment.
        let user = "# my codex config\n\
            model = \"o3\"\n\
            \n\
            [mcp_servers.my-tool]\n\
            command = \"my-tool\"\n\
            args = [\"--serve\"]\n";
        fs::write(&path, user).unwrap();

        assert!(project_codex_config(&path, "17873", FIXTURE_GATE_VALUE, "byo-cli", None).unwrap());
        let after = fs::read_to_string(&path).unwrap();
        // User content survives the upsert.
        assert!(after.contains("# my codex config"));
        assert!(after.contains("model = \"o3\""));
        assert!(after.contains("[mcp_servers.my-tool]"));
        assert!(after.contains("ctrl-kernel"));

        // Re-projecting the same token is a no-op (no needless rewrite).
        assert!(!project_codex_config(&path, "17873", FIXTURE_GATE_VALUE, "byo-cli", None).unwrap());
        // A rotated token rewrites.
        assert!(project_codex_config(
            &path,
            "17873",
            FIXTURE_GATE_VALUE_ROTATED,
            "byo-cli",
            None
        )
        .unwrap());
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains(&format!("Bearer {FIXTURE_GATE_VALUE_ROTATED}")));
    }

    #[test]
    fn codex_config_malformed_left_untouched() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("config.toml");
        let bad = "this is = = not valid toml [[[";
        fs::write(&path, bad).unwrap();
        let wrote =
            project_codex_config(&path, "17873", FIXTURE_GATE_VALUE, "byo-cli", None).unwrap();
        assert!(!wrote);
        assert_eq!(fs::read_to_string(&path).unwrap(), bad);
    }
}
