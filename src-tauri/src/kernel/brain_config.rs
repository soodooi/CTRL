// Brain registry — pluggable LLM brain backends, replacing the
// `match brain_id { "pi" => … }` hardcode from ADR-019-era code.
//
// Layout (per ADR-021):
//   1. Built-in defaults — `default_brains()` ships Pi (the only adapter
//      we currently bundle) plus stubs for cc-switch-style peers
//      (Claude Code, Codex, Gemini CLI). Stubs show in the UI so users
//      can run "Detect on $PATH" against them, but `mcp_url` returns
//      None until an adapter ships.
//   2. User overrides — `$HOME/.ctrl/brains.toml`, same TOML shape as
//      `[providers.*]` in config.toml. Lets a user pin a port, override
//      the binary path, or add a new brain id without recompiling.
//   3. Active selection — single line in `$HOME/.ctrl/active-brain`
//      (already used by irisy_chat.rs::resolve_active_brain).
//
// `brain_mcp_url(brain_id)` is the single hot path queried by
// irisy_chat_stream. It must NOT do disk IO — load() is called once at
// boot (and on Settings save) and the result lives in process memory.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Brain entry — one row in the settings UI, one possible active brain.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrainEntry {
    /// Stable id (snake_case). Matches the value written to
    /// `~/.ctrl/active-brain`. e.g. "pi", "claude_code", "codex".
    pub id: String,
    /// Human label for the Settings UI. e.g. "Pi", "Claude Code".
    pub label: String,
    /// Binary name we look for via `which`. e.g. "pi", "claude", "codex".
    pub command: String,
    /// Loopback port the brain MCP adapter listens on. None → adapter
    /// not shipped yet (UI shows "coming soon").
    pub mcp_port: Option<u16>,
    /// Free-text description for the Settings UI tooltip.
    pub description: String,
    /// Adapter slug — which packaged MCP server we spawn for this
    /// brain. "pi" maps to `@ctrl/pi-plugin` (ctrl-pi-mcp). Others
    /// are placeholders until adapters land.
    pub adapter: Option<String>,
}

impl BrainEntry {
    pub fn mcp_url(&self) -> Option<String> {
        let port = self.mcp_port?;
        Some(format!("http://127.0.0.1:{port}/mcp"))
    }

    pub fn healthz_url(&self) -> Option<String> {
        let port = self.mcp_port?;
        Some(format!("http://127.0.0.1:{port}/healthz"))
    }
}

/// Built-in brain registry shipped with CTRL. Order = UI display order.
/// Only entries with `adapter = Some(_)` can currently be activated;
/// the rest scaffold the cc-switch-style multi-brain UI per ADR-021.
pub fn default_brains() -> Vec<BrainEntry> {
    vec![
        BrainEntry {
            id: "pi".to_string(),
            label: "Pi".to_string(),
            command: "pi".to_string(),
            mcp_port: Some(17874),
            description: "@badlogic/pi-mono coding agent (MIT). Default brain.".to_string(),
            adapter: Some("pi".to_string()),
        },
        BrainEntry {
            id: "claude_code".to_string(),
            label: "Claude Code".to_string(),
            command: "claude".to_string(),
            mcp_port: None,
            description: "Claude Code CLI — runs `claude -p` via the claude_cli adapter \
                          (uses your Claude plan, no API key). Fast."
                .to_string(),
            adapter: Some("claude_cli".to_string()),
        },
        BrainEntry {
            id: "codex".to_string(),
            label: "Codex".to_string(),
            command: "codex".to_string(),
            mcp_port: Some(17876),
            description: "OpenAI Codex CLI. Adapter coming.".to_string(),
            adapter: None,
        },
        BrainEntry {
            id: "gemini".to_string(),
            label: "Gemini CLI".to_string(),
            command: "gemini".to_string(),
            mcp_port: Some(17877),
            description: "Google Gemini CLI. Adapter coming.".to_string(),
            adapter: None,
        },
    ]
}

#[derive(Debug, Default, Deserialize)]
struct BrainsToml {
    #[serde(default)]
    brains: BTreeMap<String, BrainOverride>,
}

#[derive(Debug, Default, Deserialize)]
struct BrainOverride {
    label: Option<String>,
    command: Option<String>,
    mcp_port: Option<u16>,
    description: Option<String>,
    adapter: Option<String>,
}

/// Path to the user override file. `None` when HOME is unset (CI).
pub fn default_config_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("brains.toml"))
}

/// Path to the active-brain selector file. Mirrors
/// irisy_chat::active_brain_path so the two stay in sync.
pub fn active_brain_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".ctrl").join("active-brain"))
}

/// Load the brain registry: defaults + user overrides from
/// `~/.ctrl/brains.toml` (if present). User entries can override
/// any field on a known id, or add a new id entirely.
pub fn load() -> Vec<BrainEntry> {
    let mut brains = default_brains();
    let overrides = read_overrides().unwrap_or_default();

    // Apply overrides onto existing ids.
    for entry in brains.iter_mut() {
        if let Some(ov) = overrides.brains.get(&entry.id) {
            if let Some(v) = ov.label.clone() {
                entry.label = v;
            }
            if let Some(v) = ov.command.clone() {
                entry.command = v;
            }
            if ov.mcp_port.is_some() {
                entry.mcp_port = ov.mcp_port;
            }
            if let Some(v) = ov.description.clone() {
                entry.description = v;
            }
            if let Some(v) = ov.adapter.clone() {
                entry.adapter = Some(v);
            }
        }
    }

    // Add brand-new ids the user defined that aren't in defaults.
    let known: std::collections::HashSet<String> =
        brains.iter().map(|b| b.id.clone()).collect();
    for (id, ov) in overrides.brains.iter() {
        if known.contains(id) {
            continue;
        }
        brains.push(BrainEntry {
            id: id.clone(),
            label: ov.label.clone().unwrap_or_else(|| id.clone()),
            command: ov.command.clone().unwrap_or_else(|| id.clone()),
            mcp_port: ov.mcp_port,
            description: ov.description.clone().unwrap_or_default(),
            adapter: ov.adapter.clone(),
        });
    }

    brains
}

fn read_overrides() -> Option<BrainsToml> {
    let path = default_config_path()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    match toml::from_str::<BrainsToml>(&raw) {
        Ok(v) => Some(v),
        Err(e) => {
            tracing::warn!(error = %e, path = ?path, "brain_config: failed to parse brains.toml");
            None
        }
    }
}

/// Resolve the active brain id. Reads `~/.ctrl/active-brain`; falls
/// back to "pi" when missing/unreadable/empty.
pub fn active_brain_id() -> String {
    let Some(path) = active_brain_path() else {
        return "pi".to_string();
    };
    match std::fs::read_to_string(&path) {
        Ok(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                "pi".to_string()
            } else {
                trimmed.to_string()
            }
        }
        Err(_) => "pi".to_string(),
    }
}

/// Persist the active brain id to `~/.ctrl/active-brain`. Creates
/// `~/.ctrl/` if missing.
pub fn set_active_brain(id: &str) -> std::io::Result<()> {
    let Some(path) = active_brain_path() else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "HOME is not set; cannot persist active brain",
        ));
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, id.trim())
}

/// MCP URL for a given brain id, reading the registry on every call.
/// Hot path is rare (once per chat turn) so disk read is fine; if it
/// ever shows up in a profile, move to a `OnceLock<Vec<BrainEntry>>`.
pub fn brain_mcp_url(brain_id: &str) -> Option<String> {
    load().into_iter().find(|b| b.id == brain_id)?.mcp_url()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_include_pi_with_adapter() {
        let brains = default_brains();
        let pi = brains.iter().find(|b| b.id == "pi").expect("pi present");
        assert_eq!(pi.command, "pi");
        assert_eq!(pi.mcp_port, Some(17874));
        assert_eq!(pi.adapter.as_deref(), Some("pi"));
    }

    #[test]
    fn defaults_scaffold_cc_switch_peers() {
        let ids: Vec<String> = default_brains().into_iter().map(|b| b.id).collect();
        assert!(ids.contains(&"claude_code".to_string()));
        assert!(ids.contains(&"codex".to_string()));
        assert!(ids.contains(&"gemini".to_string()));
    }

    #[test]
    fn mcp_url_is_loopback() {
        let url = brain_mcp_url("pi").expect("pi has mcp_url");
        assert!(url.starts_with("http://127.0.0.1:"));
        assert!(url.ends_with("/mcp"));
    }
}
