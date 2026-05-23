// System status — PWA status bar's data source.
//
// Phase 1F per bao 2026-05-22: surface kernel-side health metrics so
// the JSON-manifest-rendered status bar can show real numbers (LLM
// adapter registered? how many MCP servers? vault size? uptime?).
//
// Returns a single KernelStatus struct serialized once per poll. PWA
// polls every few seconds; if real-time updates ever matter we move
// these onto the ST-SS bridge as Cell events.

use crate::kernel::vault::default_vault_root;
use crate::shell::KernelHandle;
use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use tauri::State;

/// Default loopback address of the Hermes Agent's local dashboard
/// daemon. Hermes 0.14+ binds here when `hermes dashboard` is running.
/// Kept loopback-only — never proxied / never exposed beyond the host.
const HERMES_DASHBOARD_ADDR: &str = "127.0.0.1:9119";
const HERMES_DASHBOARD_PROBE_TIMEOUT_MS: u64 = 200;

#[derive(Debug, Serialize)]
pub struct KernelStatus {
    /// Kernel uptime in milliseconds (monotonic, captured at boot).
    pub uptime_ms: u64,
    /// LLM adapters registered at boot. Empty = no provider configured.
    pub llm_adapters: Vec<String>,
    /// Name of the adapter chosen by `LlmPortRouter::primary_adapter`,
    /// or None when no adapter is registered.
    pub primary_adapter: Option<String>,
    /// Number of MCP server descriptors persisted to the registry. Not
    /// the same as connected — connections lazy-establish on first
    /// invoke.
    pub mcp_servers_installed: usize,
    /// Approximate vault file count (markdown files under vault root).
    /// `0` when HOME is unset / vault dir doesn't exist yet.
    pub vault_files: usize,
    /// ST-SS bridge listen address (loopback only, token-auth).
    pub stss_bridge_addr: String,
    /// URL of the local Hermes Agent dashboard daemon when it is
    /// reachable on its default port (127.0.0.1:9119). `None` when the
    /// dashboard isn't running (or hermes isn't installed). The PWA's
    /// Hermes Settings tab uses this to drive the iframe `src` — when
    /// `None`, the tab can show an install prompt instead of a black
    /// iframe. Probed via TCP connect on each poll (~200ms cap).
    pub hermes_dashboard_url: Option<String>,
    /// "ok" when everything boot-time-required is registered; warnings
    /// list each missing component (e.g. "no llm adapter").
    pub overall: &'static str,
    pub warnings: Vec<String>,
}

/// Probe the Hermes dashboard daemon. Returns `Some(url)` when a TCP
/// connection succeeds within `HERMES_DASHBOARD_PROBE_TIMEOUT_MS`, else
/// `None`. We don't speak HTTP here — a successful TCP accept on the
/// loopback port is good enough for the PWA to decide "show the iframe
/// vs. show the install prompt" because no other service binds 9119 on
/// loopback by convention. The PWA does its own HTTP-level health-check
/// on the iframe load event.
fn probe_hermes_dashboard() -> Option<String> {
    let addr: SocketAddr = HERMES_DASHBOARD_ADDR.parse().ok()?;
    let timeout = Duration::from_millis(HERMES_DASHBOARD_PROBE_TIMEOUT_MS);
    TcpStream::connect_timeout(&addr, timeout).ok()?;
    Some(format!("http://{HERMES_DASHBOARD_ADDR}"))
}

#[tauri::command]
pub async fn kernel_status(
    kernel: State<'_, KernelHandle>,
) -> Result<KernelStatus, String> {
    let runtime = &kernel.runtime;
    let uptime_ms = runtime.booted_at.elapsed().as_millis() as u64;

    let llm_adapters: Vec<String> = runtime
        .llm_port
        .fallback_chain()
        .iter()
        .filter(|name| runtime.llm_port.adapter_for(name).is_some())
        .cloned()
        .collect();
    let primary_adapter = runtime
        .llm_port
        .primary_adapter()
        .map(|a| a.name().to_string());

    let mcp_servers_installed = runtime.mcp_host.list_installed().await.len();

    let vault_files = match default_vault_root() {
        Some(root) => crate::kernel::vault::list(&root, None)
            .map(|v| v.len())
            .unwrap_or(0),
        None => 0,
    };

    let stss_bridge_addr = crate::kernel::STSS_LISTEN_ADDR.to_string();

    let mut warnings: Vec<String> = Vec::new();
    if primary_adapter.is_none() {
        warnings.push(
            "no LLM adapter registered — edit ~/.ctrl/config.toml or run setup_llm_key".into(),
        );
    }
    let overall = if warnings.is_empty() { "ok" } else { "degraded" };

    let hermes_dashboard_url = probe_hermes_dashboard();

    Ok(KernelStatus {
        uptime_ms,
        llm_adapters,
        primary_adapter,
        mcp_servers_installed,
        vault_files,
        stss_bridge_addr,
        hermes_dashboard_url,
        overall,
        warnings,
    })
}
