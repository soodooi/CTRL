// MCP Host — discovery + invocation of Anthropic Model Context Protocol servers.
//
// Phase: P2.1 skeleton + P4 full integration.
// Each MCP server runs inside WASM/process sandbox (see sandbox.rs).
//
// Day-1 advantage: 10,000+ public MCP servers usable without writing
// any CTRL-specific adapter. See https://registry.modelcontextprotocol.io/

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerDescriptor {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    #[serde(default)]
    pub tools: Vec<McpToolDescriptor>,
    pub source: McpServerSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpToolDescriptor {
    pub name: String,
    pub description: String,
    pub input_schema: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum McpServerSource {
    /// npm package, spawn via node.
    Npm { package: String },
    /// pypi package, spawn via python.
    Pypi { package: String },
    /// Binary executable on user's machine.
    Local { command: String, args: Vec<String> },
    /// HTTP endpoint (remote MCP server).
    Http { url: String },
}

pub struct McpHost {
    installed: BTreeMap<String, McpServerDescriptor>,
}

impl McpHost {
    pub fn new() -> Self {
        Self {
            installed: BTreeMap::new(),
        }
    }

    pub fn list_installed(&self) -> impl Iterator<Item = &McpServerDescriptor> {
        self.installed.values()
    }
}

impl Default for McpHost {
    fn default() -> Self {
        Self::new()
    }
}
