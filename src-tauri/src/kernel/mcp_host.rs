// MCP Host — discovery + invocation of Anthropic Model Context Protocol servers.
//
// Uses the official rmcp Rust SDK (https://github.com/modelcontextprotocol/rust-sdk).
// Day-1 advantage: 10,000+ public MCP servers usable without writing any
// CTRL-specific adapter. See https://registry.modelcontextprotocol.io/
//
// Each MCP server runs as a child process (rmcp transport-child-process):
//   - npm  package -> `node` spawn
//   - pypi package -> `python` / `uvx` spawn
//   - local binary -> direct exec
//   - http endpoint -> HTTP transport (not yet wired here)
//
// Capability mediation: every McpInvoke effect from a userland actor is
// checked against the actor's Capability before reaching this host. See
// kernel::capability::CapabilityBroker.

use rmcp::model::{CallToolRequestParam, Tool};
use rmcp::service::RunningService;
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::RwLock;

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
    Npm {
        package: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// pypi package, spawn via uvx.
    Pypi {
        package: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// Binary executable on user's machine.
    Local {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// HTTP endpoint (remote MCP server). Wiring in P4.
    Http { url: String },
}

/// Shell interpreters that can `eval` an arbitrary string. Spawning any
/// of these with an eval-style flag turns the "local binary" source into
/// arbitrary shell execution, so we reject that combination.
const SHELL_INTERPRETERS: &[&str] = &["sh", "bash", "zsh", "dash", "ash", "fish", "cmd", "powershell", "pwsh"];

/// Argument flags that make a shell interpreter read a command from a
/// string/stdin rather than a script file (`sh -c '...'`, `pwsh -Command`).
const SHELL_EVAL_FLAGS: &[&str] = &["-c", "-e", "/c", "/k", "-command", "-encodedcommand"];

impl McpServerSource {
    /// Validate a `Local` source before it is ever turned into a spawn
    /// Command (OWASP A03 — arbitrary binary / command execution).
    ///
    /// Rules:
    ///   - `command` MUST be an absolute path (reject relative names that
    ///     resolve via PATH — an attacker-planted `node` shadow, etc.).
    ///   - reject shell interpreters (`sh`/`bash`/`cmd`/`powershell`/…)
    ///     combined with an eval-style flag (`-c`/`/c`/`-Command`/…),
    ///     which would let a manifest run an arbitrary command string.
    ///   - the resolved path MUST exist and canonicalize to a file.
    /// Npm/Pypi/Http sources have a fixed, trusted launcher and are not
    /// subject to these checks.
    pub fn validate(&self) -> Result<(), McpHostError> {
        let McpServerSource::Local { command, args } = self else {
            return Ok(());
        };
        let path = Path::new(command);
        if !path.is_absolute() {
            return Err(McpHostError::CommandRejected(format!(
                "local command must be an absolute path, got {command:?}"
            )));
        }
        let file_stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if SHELL_INTERPRETERS.contains(&file_stem.as_str()) {
            let has_eval_flag = args.iter().any(|a| {
                let lowered = a.to_ascii_lowercase();
                SHELL_EVAL_FLAGS.contains(&lowered.as_str())
            });
            if has_eval_flag {
                return Err(McpHostError::CommandRejected(format!(
                    "shell interpreter {file_stem:?} with an eval flag is not allowed"
                )));
            }
        }
        // Canonicalize last: confirms the binary exists and resolves
        // symlinks/`..` so the spawned path is the real on-disk target.
        std::fs::canonicalize(path).map_err(|e| {
            McpHostError::CommandRejected(format!("local command {command:?} not resolvable: {e}"))
        })?;
        Ok(())
    }

    /// Build the spawn Command for child-process transports.
    /// Returns None for Http source. Callers MUST call `validate()` first
    /// for untrusted sources (see `McpHost::connect`).
    pub fn to_command(&self) -> Option<Command> {
        match self {
            McpServerSource::Npm { package, args } => {
                let mut cmd = Command::new("npx");
                cmd.arg("-y").arg(package);
                for a in args {
                    cmd.arg(a);
                }
                Some(cmd)
            }
            McpServerSource::Pypi { package, args } => {
                let mut cmd = Command::new("uvx");
                cmd.arg(package);
                for a in args {
                    cmd.arg(a);
                }
                Some(cmd)
            }
            McpServerSource::Local { command, args } => {
                let mut cmd = Command::new(command);
                for a in args {
                    cmd.arg(a);
                }
                Some(cmd)
            }
            McpServerSource::Http { .. } => None,
        }
    }
}

/// Connected MCP server instance — owns the rmcp service handle.
struct McpConnection {
    descriptor: McpServerDescriptor,
    service: RunningService<RoleClient, ()>,
}

pub struct McpHost {
    installed: Arc<RwLock<BTreeMap<String, McpServerDescriptor>>>,
    connections: Arc<RwLock<BTreeMap<String, McpConnection>>>,
}

impl McpHost {
    pub fn new() -> Self {
        Self {
            installed: Arc::new(RwLock::new(BTreeMap::new())),
            connections: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }

    /// Register an MCP server descriptor (without spawning yet).
    pub async fn register(&self, desc: McpServerDescriptor) {
        let mut installed = self.installed.write().await;
        installed.insert(desc.id.clone(), desc);
    }

    /// Spawn the MCP server child process and complete the handshake.
    /// Caches the connection so subsequent `invoke` calls reuse it.
    pub async fn connect(&self, server_id: &str) -> Result<(), McpHostError> {
        // Already connected?
        {
            let conns = self.connections.read().await;
            if conns.contains_key(server_id) {
                return Ok(());
            }
        }

        let desc = {
            let installed = self.installed.read().await;
            installed
                .get(server_id)
                .cloned()
                .ok_or_else(|| McpHostError::NotInstalled(server_id.into()))?
        };

        // OWASP A03: reject unsafe Local sources (relative path / shell
        // eval) before spawning anything.
        desc.source.validate()?;

        let cmd = desc
            .source
            .to_command()
            .ok_or_else(|| McpHostError::TransportUnsupported("http (P4)".into()))?;

        let transport = TokioChildProcess::new(cmd)
            .map_err(|e| McpHostError::SpawnFailed(e.to_string()))?;

        let service = ()
            .serve(transport)
            .await
            .map_err(|e| McpHostError::HandshakeFailed(e.to_string()))?;

        let conn = McpConnection {
            descriptor: desc.clone(),
            service,
        };

        let mut conns = self.connections.write().await;
        conns.insert(server_id.into(), conn);
        Ok(())
    }

    /// List tools advertised by a connected MCP server.
    pub async fn list_tools(&self, server_id: &str) -> Result<Vec<Tool>, McpHostError> {
        self.connect(server_id).await?;
        let conns = self.connections.read().await;
        let conn = conns
            .get(server_id)
            .ok_or_else(|| McpHostError::NotConnected(server_id.into()))?;
        let result = conn
            .service
            .list_all_tools()
            .await
            .map_err(|e| McpHostError::ListFailed(e.to_string()))?;
        Ok(result)
    }

    /// Invoke a tool on a connected MCP server.
    pub async fn invoke(
        &self,
        server_id: &str,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpHostError> {
        self.connect(server_id).await?;
        let conns = self.connections.read().await;
        let conn = conns
            .get(server_id)
            .ok_or_else(|| McpHostError::NotConnected(server_id.into()))?;

        let arguments = match args {
            serde_json::Value::Object(map) => Some(map),
            serde_json::Value::Null => None,
            other => {
                return Err(McpHostError::InvalidArgs(format!(
                    "expected object, got {other:?}"
                )))
            }
        };

        let mut param = CallToolRequestParam::default();
        param.name = tool_name.to_string().into();
        param.arguments = arguments;

        let result = conn
            .service
            .call_tool(param)
            .await
            .map_err(|e| McpHostError::InvokeFailed(e.to_string()))?;

        serde_json::to_value(&result).map_err(|e| McpHostError::SerializationFailed(e.to_string()))
    }

    /// Iterator over installed descriptors (sync snapshot).
    pub async fn list_installed(&self) -> Vec<McpServerDescriptor> {
        let installed = self.installed.read().await;
        installed.values().cloned().collect()
    }

    /// Shut down a connected server.
    pub async fn disconnect(&self, server_id: &str) -> Result<(), McpHostError> {
        let mut conns = self.connections.write().await;
        if let Some(conn) = conns.remove(server_id) {
            conn.service
                .cancel()
                .await
                .map_err(|e| McpHostError::ShutdownFailed(e.to_string()))?;
        }
        Ok(())
    }

    /// Default on-disk registry path: $HOME/.ctrl/mcp-servers.json. Holds
    /// the array of McpServerDescriptor — what to spawn next boot, with
    /// every persisted install. Returns None when HOME isn't set (CI).
    pub fn default_registry_path() -> Option<PathBuf> {
        let home = std::env::var("HOME").ok()?;
        Some(PathBuf::from(home).join(".ctrl").join("mcp-servers.json"))
    }

    /// Read the descriptor registry from disk and re-register every entry
    /// (no auto-connect — connections lazy-establish on first invoke).
    /// Absent / unparseable file = warning + clean empty state.
    pub async fn load_registry(&self, path: &Path) -> Result<usize, McpHostError> {
        // tokio::fs (not std::fs) so the blocking read happens on the
        // runtime's blocking pool, not the current async worker thread
        // (review P2: blocking syscall in async fn body).
        let bytes = match tokio::fs::read(path).await {
            Ok(b) => b,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(e) => return Err(McpHostError::RegistryReadFailed(e.to_string())),
        };
        let entries: Vec<McpServerDescriptor> = serde_json::from_slice(&bytes)
            .map_err(|e| McpHostError::RegistryParseFailed(e.to_string()))?;
        let count = entries.len();
        {
            let mut installed = self.installed.write().await;
            for desc in entries {
                installed.insert(desc.id.clone(), desc);
            }
        }
        Ok(count)
    }

    /// Persist the current installed registry to disk atomically (write
    /// to a temp sibling, then rename — avoids leaving a half-written
    /// file if the process dies mid-write).
    pub async fn save_registry(&self, path: &Path) -> Result<(), McpHostError> {
        let entries: Vec<McpServerDescriptor> = {
            let installed = self.installed.read().await;
            installed.values().cloned().collect()
        };
        let bytes = serde_json::to_vec_pretty(&entries)
            .map_err(|e| McpHostError::RegistryWriteFailed(e.to_string()))?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent)
                .await
                .map_err(|e| McpHostError::RegistryWriteFailed(e.to_string()))?;
        }
        let tmp = path.with_extension("json.tmp");
        tokio::fs::write(&tmp, &bytes)
            .await
            .map_err(|e| McpHostError::RegistryWriteFailed(e.to_string()))?;
        tokio::fs::rename(&tmp, path)
            .await
            .map_err(|e| McpHostError::RegistryWriteFailed(e.to_string()))?;
        Ok(())
    }
}

impl Default for McpHost {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum McpHostError {
    #[error("server not installed: {0}")]
    NotInstalled(String),
    #[error("server not connected: {0}")]
    NotConnected(String),
    #[error("transport not supported: {0}")]
    TransportUnsupported(String),
    #[error("local command rejected: {0}")]
    CommandRejected(String),
    #[error("failed to spawn child process: {0}")]
    SpawnFailed(String),
    #[error("MCP handshake failed: {0}")]
    HandshakeFailed(String),
    #[error("list tools failed: {0}")]
    ListFailed(String),
    #[error("tool invocation failed: {0}")]
    InvokeFailed(String),
    #[error("invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("serialization failed: {0}")]
    SerializationFailed(String),
    #[error("server shutdown failed: {0}")]
    ShutdownFailed(String),
    #[error("read registry failed: {0}")]
    RegistryReadFailed(String),
    #[error("parse registry failed: {0}")]
    RegistryParseFailed(String),
    #[error("write registry failed: {0}")]
    RegistryWriteFailed(String),
}
