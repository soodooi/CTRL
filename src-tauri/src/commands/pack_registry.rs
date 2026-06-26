// Discover registry data source (ADR-002 substrate § composition §7.4).
//
// CSP blocks the PWA from fetching external hosts directly, so the kernel
// fetches the MCP Registry server-side and hands the raw JSON to the PWA,
// which maps entries to browsable listings (the mapping is the testable logic;
// keeping it in TS lets vitest cover it without network). The default points at
// the official registry; override to a self-hosted registry via env.

use std::time::Duration;

const ENV_REGISTRY_URL: &str = "CTRL_MCP_REGISTRY_URL";
const DEFAULT_REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0/servers";
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Resolve the registry URL (env override wins) and append a bounded limit.
fn resolve_url(limit: u32) -> String {
    let base = std::env::var(ENV_REGISTRY_URL)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string());
    let sep = if base.contains('?') { '&' } else { '?' };
    format!("{base}{sep}limit={limit}")
}

#[derive(Debug, serde::Deserialize)]
pub struct FetchPackRegistryArgs {
    pub limit: Option<u32>,
}

/// Fetch the MCP Registry server list and return the raw JSON body. Returns
/// Err on network / HTTP failure; the PWA degrades to the bundled pack set.
#[tauri::command]
pub async fn fetch_pack_registry(args: FetchPackRegistryArgs) -> Result<String, String> {
    let url = resolve_url(args.limit.unwrap_or(50).clamp(1, 200));
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;
    let resp = client
        .get(&url)
        .header("accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("registry fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("registry HTTP {}", resp.status()));
    }
    resp.text()
        .await
        .map_err(|e| format!("registry body read: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_url_appends_limit_to_default() {
        std::env::remove_var(ENV_REGISTRY_URL);
        let url = resolve_url(50);
        assert!(url.starts_with(DEFAULT_REGISTRY_URL));
        assert!(url.contains("limit=50"));
    }

    #[test]
    fn resolve_url_env_override_wins() {
        std::env::set_var(ENV_REGISTRY_URL, "https://self.hosted/registry/servers");
        let url = resolve_url(10);
        assert!(url.starts_with("https://self.hosted/registry/servers"));
        assert!(url.contains("limit=10"));
        std::env::remove_var(ENV_REGISTRY_URL);
    }
}
