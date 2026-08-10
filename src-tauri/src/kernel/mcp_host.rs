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

use rmcp::model::{CallToolRequestParams, Tool};
use rmcp::service::RunningService;
use rmcp::transport::TokioChildProcess;
use rmcp::{RoleClient, ServiceExt};
use serde::{Deserialize, Serialize};
// Private source classification remains inside the existing MCP host.
// (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
use std::collections::{BTreeMap, BTreeSet};
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
        /// Kernel-owned trust decision for the bundled LibreOffice adapter.
        /// Skipped during serialization so an on-disk registry cannot claim the
        /// keychain-backed spawn privilege. (ADR-010 communication § transports v13)
        #[serde(skip)]
        trusted_libreoffice_adapter: bool,
        /// Pack root for OS sandboxing. Present only for governed private local
        /// source children; legacy user-connected MCP servers remain unchanged.
        /// (ADR-004 cap § execution v13)
        #[serde(default)]
        sandbox_pack_dir: Option<PathBuf>,
        /// Whether the sandbox may connect to localhost. Non-loopback network
        /// remains denied by the OS profile.
        #[serde(default)]
        allow_loopback_network: bool,
    },
    /// HTTP endpoint (remote / local HTTP MCP server serving streamable-http
    /// /mcp/). `auth_header` is the full Authorization header value (e.g.
    /// "Bearer <token>") when required. (Generic transport — outlived its
    /// first consumer, the Obsidian connector, retired ADR-002 §1.9 v46.)
    Http {
        url: String,
        #[serde(default)]
        auth_header: Option<String>,
    },
}

/// Resolve a pack manifest's Local server `command` + `args` into a runnable
/// [`McpServerSource::Local`] (ADR-002 substrate § composition §7.4). A SHARED
/// manifest stays machine-independent by using `${PACK_DIR}` (the pack's real
/// install dir, substituted here) and a bare interpreter like `uv` (resolved
/// via PATH + ~/.ctrl/bin). Absolute commands/args pass through unchanged
/// (back-compat). Used by BOTH install-time connect and boot-time reconnect so
/// a portable published pack runs on any machine.
/// (ADR-004 cap § execution v13; ADR-010 communication § transports v13)
pub fn resolve_local_source(
    command: &str,
    args: &[String],
    pack_dir: &std::path::Path,
    sandbox_local_source: bool,
    allow_loopback_network: bool,
) -> McpServerSource {
    let subst = |s: &str| s.replace("${PACK_DIR}", pack_dir.to_string_lossy().as_ref());
    let command = subst(command);
    let command = if std::path::Path::new(&command).is_absolute() {
        command
    } else {
        crate::kernel::provider::path_resolver::resolve_binary_path(&command)
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or(command)
    };
    let args: Vec<String> = args.iter().map(|a| subst(a)).collect();
    let trusted_libreoffice_adapter =
        crate::kernel::libreoffice_bridge::is_trusted_adapter(pack_dir, &command, &args);
    McpServerSource::Local {
        command,
        args,
        trusted_libreoffice_adapter,
        sandbox_pack_dir: sandbox_local_source.then(|| pack_dir.to_path_buf()),
        allow_loopback_network: sandbox_local_source && allow_loopback_network,
    }
}

/// Whether a pack server is consumed only by the generic local Source adapter.
/// (ADR-002 substrate §14 v78)
pub fn is_private_source_manifest(manifest: &serde_json::Value) -> bool {
    manifest
        .pointer("/record_source/query/mcp_tool")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|tool| !tool.trim().is_empty())
}

/// Collision-free Actor id for a private source child. Public legacy pack ids
/// retain their historical mapping for compatibility.
/// (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
pub fn private_source_server_id(manifest_id: &str) -> String {
    format!("source:{manifest_id}")
}

/// Return every valid managed Actor identity derived from the immutable install
/// directory id. Uninstall removes both candidates before deleting local truth,
/// so a drifted or malformed manifest cannot orphan a running child.
/// (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
pub fn installed_pack_actor_ids(pack_id: &str) -> [String; 2] {
    [
        private_source_server_id(pack_id),
        pack_id.trim_start_matches("ctrl-").to_string(),
    ]
}

/// A private bridge gets loopback network only when every declared HTTP target
/// is a loopback pattern. Any broader declaration fails closed to no network.
/// (ADR-004 cap § execution v13; ADR-010 communication § transports v13)
pub fn manifest_allows_only_loopback(manifest: &serde_json::Value) -> bool {
    let Some(entries) = manifest
        .pointer("/capabilities/network/http/allowlist")
        .and_then(serde_json::Value::as_array)
    else {
        return false;
    };
    !entries.is_empty()
        && entries.iter().all(|entry| {
            entry.as_str().is_some_and(|url| {
                [
                    "http://127.0.0.1:*",
                    "http://[::1]:*",
                    "http://localhost:*",
                    "https://127.0.0.1:*",
                    "https://[::1]:*",
                    "https://localhost:*",
                ]
                .contains(&url)
            })
        })
}

/// Reconnect every installed feature pack that declares a `server` block
/// (mcp-server variant, ADR-002 §7 Pattern D) — called at boot so pack tools
/// return to the gate after a restart without a reinstall. Best-effort:
/// a pack whose server fails to spawn logs and is skipped.
pub async fn reconnect_installed_pack_servers(host: &McpHost) {
    let Some(home) = std::env::var_os("HOME") else {
        return;
    };
    let dir = std::path::PathBuf::from(home).join(".ctrl").join("mcps");
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let manifest_path = entry.path().join("manifest.json");
        let Ok(raw) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(m) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        let Some(server) = m.get("server").and_then(|v| v.as_object()) else {
            continue;
        };
        let command = server.get("command").and_then(|v| v.as_str()).unwrap_or("");
        if command.is_empty() {
            continue;
        }
        let private_source = is_private_source_manifest(&m);
        // The install-directory basename is the stable Actor identity even if
        // mutable manifest metadata drifts. (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
        let directory_id = entry.file_name().to_string_lossy().into_owned();
        let id = if private_source {
            private_source_server_id(&directory_id)
        } else {
            directory_id.trim_start_matches("ctrl-").to_string()
        };
        let args: Vec<String> = server
            .get("args")
            .and_then(|v| v.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        let desc = McpServerDescriptor {
            id: id.clone(),
            name: m
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(&id)
                .to_string(),
            version: m
                .get("version")
                .and_then(|v| v.as_str())
                .unwrap_or("0.0.0")
                .to_string(),
            description: String::new(),
            tools: Vec::new(),
            // Reconnect resolves the same isolated child descriptor used at install.
            // (ADR-004 cap § execution v13)
            source: resolve_local_source(
                command,
                &args,
                &entry.path(),
                private_source,
                manifest_allows_only_loopback(&m),
            ),
        };
        if private_source {
            host.register_private(desc).await;
        } else {
            host.register(desc).await;
        }
        match host.connect(&id).await {
            Ok(()) => tracing::info!(pack = %id, "pack mcp server reconnected to bus"),
            Err(e) => tracing::info!(pack = %id, error = %e, "pack mcp server reconnect deferred"),
        }
    }
}

impl McpServerSource {
    /// Build the spawn Command for child-process transports.
    /// Returns None for Http source.
    /// (ADR-004 cap § execution v13)
    pub fn to_command(&self) -> Result<Option<Command>, String> {
        match self {
            McpServerSource::Npm { package, args } => {
                let mut cmd = Command::new("npx");
                cmd.arg("-y").arg(package);
                for a in args {
                    cmd.arg(a);
                }
                Ok(Some(cmd))
            }
            McpServerSource::Pypi { package, args } => {
                let mut cmd = Command::new("uvx");
                cmd.arg(package);
                for a in args {
                    cmd.arg(a);
                }
                Ok(Some(cmd))
            }
            McpServerSource::Local {
                command,
                args,
                trusted_libreoffice_adapter,
                sandbox_pack_dir,
                allow_loopback_network,
            } => {
                // Revalidate immediately before spawn, then execute the adapter
                // from bytes embedded in CTRL. This closes both executable-name
                // spoofing and the installed-script read/spawn race.
                // (ADR-010 communication § transports v13)
                let embedded_args = if *trusted_libreoffice_adapter {
                    let pack_dir = sandbox_pack_dir.as_deref().ok_or_else(|| {
                        "trusted LibreOffice adapter is missing its sandbox root".to_string()
                    })?;
                    if !crate::kernel::libreoffice_bridge::is_trusted_adapter(
                        pack_dir, command, args,
                    ) {
                        return Err(
                            "trusted LibreOffice adapter identity changed before spawn".into()
                        );
                    }
                    Some(crate::kernel::libreoffice_bridge::embedded_adapter_args())
                } else {
                    None
                };
                let spawn_args = embedded_args.as_deref().unwrap_or(args);

                // A private local Source receives only its declared sandbox and
                // environment projection. (ADR-004 cap § execution v13)
                let mut cmd = if let Some(pack_dir) = sandbox_pack_dir {
                    let command = crate::kernel::pack_sandbox::wrap_program(
                        command,
                        spawn_args,
                        pack_dir,
                        &[],
                        *allow_loopback_network,
                    );
                    // (ADR-004 cap § execution v13)
                    Command::from(command)
                } else {
                    let mut command_process = Command::new(command);
                    for arg in spawn_args {
                        command_process.arg(arg);
                    }
                    command_process
                };
                // Every private child starts empty. Only the exact bundled
                // LibreOffice adapter receives its kernel-resolved values; no
                // manifest can select parent environment names or claim this
                // privilege from a serialized descriptor.
                // (ADR-004 cap § execution v13; ADR-010 communication § transports v13)
                if sandbox_pack_dir.is_some() {
                    cmd.env_clear();
                    if *trusted_libreoffice_adapter {
                        for (name, value) in
                            crate::kernel::libreoffice_bridge::resolve_spawn_environment()?
                        {
                            cmd.env(name, value);
                        }
                    }
                }
                // The resolved command remains the managed Actor transport.
                // (ADR-004 cap § execution v13)
                Ok(Some(cmd))
            }
            McpServerSource::Http { .. } => Ok(None),
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
    /// Downstream Actors consumed only by a governed adapter. They remain in
    /// the same host but are excluded from caller-visible proxy operations.
    /// (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
    private_servers: Arc<RwLock<BTreeSet<String>>>,
}

impl McpHost {
    pub fn new() -> Self {
        Self {
            installed: Arc::new(RwLock::new(BTreeMap::new())),
            connections: Arc::new(RwLock::new(BTreeMap::new())),
            // (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
            private_servers: Arc::new(RwLock::new(BTreeSet::new())),
        }
    }

    /// Register an MCP server descriptor (without spawning yet).
    pub async fn register(&self, desc: McpServerDescriptor) {
        // Public registration must clear any prior private classification.
        // (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
        self.private_servers.write().await.remove(&desc.id);
        let mut installed = self.installed.write().await;
        installed.insert(desc.id.clone(), desc);
    }

    /// Register a downstream Actor that only an in-kernel governed adapter may
    /// invoke. It is deliberately unavailable through MCP proxy discovery and
    /// calls. (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
    pub async fn register_private(&self, desc: McpServerDescriptor) {
        self.private_servers.write().await.insert(desc.id.clone());
        let mut installed = self.installed.write().await;
        installed.insert(desc.id.clone(), desc);
    }

    /// Spawn the MCP server child process and complete the handshake.
    /// Caches the connection so subsequent `invoke` calls reuse it.
    /// (ADR-004 cap § execution v13)
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

        // Transport per source kind: HTTP MCP servers (registry remotes etc.,
        // ADR-002 §1.9 v46 — generic since the Obsidian connector retired) use
        // the rmcp streamable-http client; everything else spawns a stdio child.
        let service = match &desc.source {
            McpServerSource::Http { url, auth_header } => {
                use rmcp::transport::streamable_http_client::{
                    StreamableHttpClientTransport, StreamableHttpClientTransportConfig,
                };
                let cfg = StreamableHttpClientTransportConfig::with_uri(url.clone());
                // Carry the bearer auth as a default header with the EXACT
                // "Bearer <token>" value the server expects (verified live by
                // curl → 200), rather than cfg.auth_header() — which Bearer-
                // prefixes again and double-prefixed, 401'ing against Obsidian's
                // /mcp/ (ADR-002 substrate §1.9.1). default_headers applies it to
                // every request (POST initialize + GET SSE).
                let mut headers = rmcp_reqwest::header::HeaderMap::new();
                if let Some(h) = auth_header {
                    if let Ok(val) = rmcp_reqwest::header::HeaderValue::from_str(h) {
                        headers.insert(rmcp_reqwest::header::AUTHORIZATION, val);
                    }
                }
                // Local plugin servers (Obsidian :27124) present a self-signed
                // cert; accept it — these are loopback, user-authorised endpoints.
                // rmcp-reqwest = reqwest 0.13 (matches rmcp's StreamableHttpClient
                // impl type); CTRL's own reqwest 0.12 is a separate crate instance.
                let client = rmcp_reqwest::Client::builder()
                    .danger_accept_invalid_certs(true)
                    .default_headers(headers)
                    .build()
                    .map_err(|e| McpHostError::SpawnFailed(e.to_string()))?;
                let transport = StreamableHttpClientTransport::with_client(client, cfg);
                ().serve(transport)
                    .await
                    .map_err(|e| McpHostError::HandshakeFailed(e.to_string()))?
            }
            _ => {
                // Child transports remain owned by this McpHost connection.
                // (ADR-004 cap § execution v13)
                let cmd = desc
                    .source
                    .to_command()
                    .map_err(McpHostError::SpawnFailed)?
                    .ok_or_else(|| {
                        McpHostError::TransportUnsupported(format!("{:?}", desc.source))
                    })?;
                let transport = TokioChildProcess::new(cmd)
                    .map_err(|e| McpHostError::SpawnFailed(e.to_string()))?;
                ().serve(transport)
                    .await
                    .map_err(|e| McpHostError::HandshakeFailed(e.to_string()))?
            }
        };

        let conn = McpConnection {
            descriptor: desc.clone(),
            service,
        };

        let mut conns = self.connections.write().await;
        conns.insert(server_id.into(), conn);
        Ok(())
    }

    /// List tools advertised by a connected MCP server. A failed cached
    /// service is evicted and retried once; reconnect is bounded and never
    /// loops in the host. (ADR-004 cap § execution v13)
    pub async fn list_tools(&self, server_id: &str) -> Result<Vec<Tool>, McpHostError> {
        self.connect(server_id).await?;
        match self.list_tools_once(server_id).await {
            Ok(tools) => Ok(tools),
            Err(_) => {
                // A failed cached service is never retained; discovery receives
                // one bounded retry only. (ADR-004 cap § execution v13)
                let _ = self.disconnect(server_id).await;
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                self.connect(server_id).await?;
                self.list_tools_once(server_id).await
            }
        }
    }

    async fn list_tools_once(&self, server_id: &str) -> Result<Vec<Tool>, McpHostError> {
        // The cached service remains owned by McpHost for the duration of this
        // single request. (ADR-004 cap § execution v13)
        let conns = self.connections.read().await;
        let conn = conns
            .get(server_id)
            .ok_or_else(|| McpHostError::NotConnected(server_id.into()))?;
        conn.service
            .list_all_tools()
            .await
            .map_err(|e| McpHostError::ListFailed(e.to_string()))
    }

    /// Invoke a tool on a connected MCP server. Failed services are always
    /// evicted. Only private read-only Source children receive one automatic
    /// retry, avoiding duplicate effects on general downstream MCP servers.
    /// (ADR-004 cap § execution v13; ADR-010 communication § transports v13)
    pub async fn invoke(
        &self,
        server_id: &str,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpHostError> {
        let arguments = match args {
            serde_json::Value::Object(map) => Some(map),
            serde_json::Value::Null => None,
            other => {
                return Err(McpHostError::InvalidArgs(format!(
                    "expected object, got {other:?}"
                )))
            }
        };

        let mut param = CallToolRequestParams::default();
        param.name = tool_name.to_string().into();
        param.arguments = arguments;

        self.connect(server_id).await?;
        let first = self.invoke_once(server_id, param.clone()).await;
        match first {
            Ok(result) => Ok(result),
            Err(first_error) => {
                let private = self.private_servers.read().await.contains(server_id);
                let _ = self.disconnect(server_id).await;
                if !private {
                    return Err(first_error);
                }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                self.connect(server_id).await?;
                self.invoke_once(server_id, param).await
            }
        }
    }

    async fn invoke_once(
        &self,
        server_id: &str,
        param: CallToolRequestParams,
    ) -> Result<serde_json::Value, McpHostError> {
        let conns = self.connections.read().await;
        let conn = conns
            .get(server_id)
            .ok_or_else(|| McpHostError::NotConnected(server_id.into()))?;
        let result = conn
            .service
            .call_tool(param)
            .await
            .map_err(|e| McpHostError::InvokeFailed(e.to_string()))?;
        serde_json::to_value(&result).map_err(|e| McpHostError::SerializationFailed(e.to_string()))
    }

    async fn ensure_proxy_visible(&self, server_id: &str) -> Result<(), McpHostError> {
        // Private adapter children never enter caller-visible MCP discovery or
        // dispatch. (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
        if self.private_servers.read().await.contains(server_id) {
            return Err(McpHostError::PrivateServer(server_id.into()));
        }
        Ok(())
    }

    /// Caller-visible proxy listing. Private adapter children fail before a
    /// connection or downstream call is attempted.
    /// (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
    pub async fn proxy_list_tools(&self, server_id: &str) -> Result<Vec<Tool>, McpHostError> {
        self.ensure_proxy_visible(server_id).await?;
        self.list_tools(server_id).await
    }

    /// Caller-visible proxy invocation, separate from the internal adapter path.
    /// (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
    pub async fn proxy_invoke(
        &self,
        server_id: &str,
        tool_name: &str,
        args: serde_json::Value,
    ) -> Result<serde_json::Value, McpHostError> {
        self.ensure_proxy_visible(server_id).await?;
        self.invoke(server_id, tool_name, args).await
    }

    /// Caller-visible descriptor snapshot excludes private adapter children.
    /// (ADR-002 substrate §14 v78)
    pub async fn list_proxy_installed(&self) -> Vec<McpServerDescriptor> {
        let private = self.private_servers.read().await;
        let installed = self.installed.read().await;
        installed
            .iter()
            .filter(|(id, _)| !private.contains(*id))
            .map(|(_, descriptor)| descriptor.clone())
            .collect()
    }

    /// Shut down a connected server. Removal happens before awaiting cancel so
    /// a failed service can never remain cached as live.
    /// (ADR-004 cap § execution v13)
    pub async fn disconnect(&self, server_id: &str) -> Result<(), McpHostError> {
        let connection = self.connections.write().await.remove(server_id);
        if let Some(conn) = connection {
            conn.service
                .cancel()
                .await
                .map_err(|e| McpHostError::ShutdownFailed(e.to_string()))?;
        }
        Ok(())
    }

    /// Idempotently cancel every owned downstream service during CTRL shutdown.
    /// All entries are removed first; cancellation failures cannot leave stale
    /// connections discoverable. (ADR-004 cap § execution v13)
    pub async fn shutdown_all(&self) -> Result<(), McpHostError> {
        let connections = {
            let mut guard = self.connections.write().await;
            std::mem::take(&mut *guard)
        };
        let mut first_error = None;
        for (_server_id, connection) in connections {
            if let Err(error) = connection.service.cancel().await {
                if first_error.is_none() {
                    first_error = Some(McpHostError::ShutdownFailed(error.to_string()));
                }
            }
        }
        match first_error {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }

    /// Stop and remove a descriptor, including its private classification.
    /// Used by feature-pack uninstall so no orphan child remains callable.
    /// (ADR-004 cap § execution v13)
    pub async fn unregister(&self, server_id: &str) -> Result<(), McpHostError> {
        self.disconnect(server_id).await?;
        self.installed.write().await.remove(server_id);
        self.private_servers.write().await.remove(server_id);
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
    // Proxy callers receive a typed denial without connecting the child.
    // (ADR-002 substrate §14 v78; ADR-004 cap § execution v13)
    #[error("server is private to a governed adapter: {0}")]
    PrivateServer(String),
    #[error("transport not supported: {0}")]
    TransportUnsupported(String),
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

#[cfg(test)]
mod tests {
    // Exercises the optional child through the existing managed MCP host.
    // (ADR-004 cap § execution v13; ADR-010 communication § transports v13)
    use super::*;

    #[test]
    fn trusted_adapter_is_revalidated_before_spawn() {
        let root = tempfile::TempDir::new().unwrap();
        let pack = root.path().join("ctrl-libreoffice");
        std::fs::create_dir(&pack).unwrap();
        let bundled = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("packages/ctrl-mcps/optional/ctrl-libreoffice/server.mjs");
        std::fs::copy(bundled, pack.join("server.mjs")).unwrap();
        let source = resolve_local_source(
            "node",
            &["${PACK_DIR}/server.mjs".into()],
            &pack,
            true,
            true,
        );
        std::fs::write(pack.join("server.mjs"), b"modified after resolution").unwrap();
        let error = source.to_command().unwrap_err();
        assert!(error.contains("identity changed before spawn"));
    }

    #[tokio::test]
    async fn optional_libreoffice_child_handshakes_and_fails_closed_without_bridge() {
        let pack_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("packages/ctrl-mcps/optional/ctrl-libreoffice");
        // The extra inert argv entry deliberately prevents privileged adapter
        // matching while preserving a valid stdio child for this fail-closed test.
        let args = vec![
            "${PACK_DIR}/server.mjs".to_string(),
            "--untrusted-test".to_string(),
        ];
        // This drives a real `node` stdio child through a real MCP handshake, so it
        // is also the test that catches a child which starts but declines to serve.
        // (ADR-010 communication § transports v13)
        let host = McpHost::new();
        let server_id = "source:ctrl-libreoffice";
        assert_eq!(
            installed_pack_actor_ids("ctrl-libreoffice"),
            [server_id.to_string(), "libreoffice".to_string(),]
        );
        host.register_private(McpServerDescriptor {
            id: server_id.into(),
            name: "LibreOffice test".into(),
            version: "0.1.0".into(),
            description: String::new(),
            tools: Vec::new(),
            source: resolve_local_source("node", &args, &pack_dir, true, true),
        })
        .await;

        assert!(host.list_proxy_installed().await.is_empty());
        assert!(matches!(
            host.proxy_list_tools(server_id).await,
            Err(McpHostError::PrivateServer(_))
        ));
        assert!(matches!(
            host.proxy_invoke(server_id, "read_selected_context", serde_json::json!({}))
                .await,
            Err(McpHostError::PrivateServer(_))
        ));

        // Spawning a managed local child requires a wired OS-sandbox arm. Where
        // there is none the spawn is REFUSED — the child runs third-party pack code
        // and the deny-network/deny-write profile is the reason the wrapper exists,
        // so running it unsandboxed would be worse than not running it. The handshake
        // therefore cannot succeed there, and asserting that it does would be
        // asserting macOS-only behaviour. (ADR-004 cap § execution v15)
        if !cfg!(target_os = "macos") {
            assert!(
                host.list_tools(server_id).await.is_err(),
                "an unwired sandbox arm must refuse the spawn, not serve tools"
            );
            host.unregister(server_id).await.unwrap();
            return;
        }

        let tools = host.list_tools(server_id).await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name.as_ref(), "read_selected_context");
        let result = host
            .invoke(server_id, "read_selected_context", serde_json::json!({}))
            .await
            .unwrap();
        assert_eq!(
            result.get("isError").and_then(serde_json::Value::as_bool),
            Some(true)
        );
        assert_eq!(result["content"].as_array().map(Vec::len), Some(1));

        host.shutdown_all().await.unwrap();
        assert!(host.connections.read().await.is_empty());
        host.shutdown_all().await.unwrap();
        assert_eq!(host.list_tools(server_id).await.unwrap().len(), 1);

        host.unregister(server_id).await.unwrap();
        assert!(matches!(
            host.list_tools(server_id).await,
            Err(McpHostError::NotInstalled(_))
        ));
    }

    /// The refusal is the accepted behaviour, so it is asserted rather than left
    /// as whatever the platform happens to do. `wrap_program` must not return the
    /// pack's own command on a platform whose sandbox arm is not wired, because
    /// that would run third-party code with the user's full privileges.
    /// (ADR-004 cap § execution v15)
    #[test]
    fn an_unwired_sandbox_arm_refuses_to_spawn_instead_of_running_unsandboxed() {
        let pack_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("packages/ctrl-mcps/optional/ctrl-libreoffice");
        let command = crate::kernel::pack_sandbox::wrap_program(
            "node",
            &["${PACK_DIR}/server.mjs".to_string()],
            &pack_dir,
            &[],
            false,
        );
        let program = command.get_program().to_string_lossy().into_owned();
        if cfg!(target_os = "macos") {
            assert_eq!(
                program, "/usr/bin/sandbox-exec",
                "a wired arm must run the child THROUGH the sandbox"
            );
        } else {
            assert_ne!(
                program, "node",
                "an unwired arm must never spawn the pack's own command"
            );
        }
    }
}
