// Discover registry data source (ADR-002 substrate § composition §7.4).
//
// CSP blocks the PWA from fetching external hosts directly, so the kernel
// fetches the pack sources server-side. Two sources are merged so Irisy's
// reach isn't a single registry (ADR-002 §7.4 names both the official MCP
// Registry and Smithery 2000+):
//   - the official MCP Registry (registry.modelcontextprotocol.io)
//   - Smithery (registry.smithery.ai) — keyless, keyword-searchable, 2000+
// `fetch_pack_registry` keeps returning the raw MCP-Registry JSON for the PWA
// (whose mapping is TS-tested). `discover_packs` is the brain-facing path: it
// merges both sources into one normalized listing. The normalizers are pure +
// unit-tested so the scrape/shape contract is pinned without a network call.

use std::time::Duration;

const ENV_REGISTRY_URL: &str = "CTRL_MCP_REGISTRY_URL";
const DEFAULT_REGISTRY_URL: &str = "https://registry.modelcontextprotocol.io/v0/servers";
const SMITHERY_URL: &str = "https://registry.smithery.ai/servers";
const FETCH_TIMEOUT: Duration = Duration::from_secs(15);

/// Resolve the MCP Registry URL (env override wins) and append a bounded limit
/// plus an optional `search` keyword.
fn resolve_url(limit: u32, query: Option<&str>) -> String {
    let base = std::env::var(ENV_REGISTRY_URL)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| DEFAULT_REGISTRY_URL.to_string());
    let sep = if base.contains('?') { '&' } else { '?' };
    let mut url = format!("{base}{sep}limit={limit}");
    if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
        url.push_str("&search=");
        url.push_str(&urlencode(q));
    }
    url
}

/// Minimal query-component percent-encoding (spaces + reserved chars). Enough
/// for a search keyword; avoids pulling in a url crate.
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[derive(Debug, serde::Deserialize)]
pub struct FetchPackRegistryArgs {
    pub limit: Option<u32>,
}

/// Fetch the MCP Registry server list and return the raw JSON body. Returns
/// Err on network / HTTP failure; the PWA degrades to the bundled pack set.
#[tauri::command]
pub async fn fetch_pack_registry(args: FetchPackRegistryArgs) -> Result<String, String> {
    let url = resolve_url(args.limit.unwrap_or(50).clamp(1, 200), None);
    fetch_text(&url, "application/json").await
}

/// Shared GET → text helper for the registry fetches.
async fn fetch_text(url: &str, accept: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .build()
        .map_err(|e| format!("reqwest build: {e}"))?;
    let resp = client
        .get(url)
        .header("accept", accept)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    resp.text().await.map_err(|e| format!("body read: {e}"))
}

/// Normalize one MCP-Registry response body into `{id, name, description, url,
/// source}` entries. Shape: `{servers:[{server:{name,description,title,
/// remotes:[{url}]}}]}`. Pure — unit-tested against a captured real body.
fn normalize_mcp_registry(body: &str) -> Vec<serde_json::Value> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let Some(arr) = json["servers"].as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|entry| {
            let s = &entry["server"];
            let name = s["name"].as_str()?;
            let url = s["remotes"]
                .as_array()
                .and_then(|r| r.first())
                .and_then(|r| r["url"].as_str())
                .unwrap_or("");
            Some(serde_json::json!({
                "id": name,
                "name": s["title"].as_str().filter(|t| !t.is_empty()).unwrap_or(name),
                "description": s["description"].as_str().unwrap_or(""),
                "url": url,
                "source": "mcp-registry",
            }))
        })
        .collect()
}

/// Normalize one Smithery response body into the same entry shape. Shape:
/// `{servers:[{qualifiedName,displayName,description,homepage,remote}]}`.
/// Pure — unit-tested against a captured real body.
fn normalize_smithery(body: &str) -> Vec<serde_json::Value> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let Some(arr) = json["servers"].as_array() else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|s| {
            let qn = s["qualifiedName"].as_str()?;
            Some(serde_json::json!({
                "id": qn,
                "name": s["displayName"].as_str().filter(|t| !t.is_empty()).unwrap_or(qn),
                "description": s["description"].as_str().unwrap_or(""),
                "url": s["homepage"].as_str().unwrap_or(""),
                "source": "smithery",
            }))
        })
        .collect()
}

async fn fetch_smithery(query: Option<&str>, limit: u32) -> Result<String, String> {
    let mut url = format!("{SMITHERY_URL}?pageSize={limit}");
    if let Some(q) = query.map(str::trim).filter(|q| !q.is_empty()) {
        url.push_str("&q=");
        url.push_str(&urlencode(q));
    }
    fetch_text(&url, "application/json").await
}

/// Brain-facing pack discovery: merge the MCP Registry + Smithery into one
/// normalized listing `{servers:[{id,name,description,url,source}], sources}`.
/// Best-effort per source — if one is unreachable, the other still returns
/// (derived rule #1: degrade, never hard-fail). Each entry is tagged with its
/// `source` so the brain knows provenance.
pub async fn discover_packs(query: Option<String>, limit: u32) -> Result<String, String> {
    let limit = limit.clamp(1, 100);
    let q = query.as_deref();
    let mcp = fetch_text(&resolve_url(limit, q), "application/json").await;
    let smithery = fetch_smithery(q, limit).await;

    let mut servers = Vec::new();
    let mut sources = Vec::new();
    if let Ok(body) = &smithery {
        let n = normalize_smithery(body);
        sources.push(serde_json::json!({ "source": "smithery", "count": n.len() }));
        servers.extend(n);
    }
    if let Ok(body) = &mcp {
        let n = normalize_mcp_registry(body);
        sources.push(serde_json::json!({ "source": "mcp-registry", "count": n.len() }));
        servers.extend(n);
    }

    if servers.is_empty() {
        // Both failed — surface the errors so the brain can report / retry.
        return Err(format!(
            "no pack source reachable (mcp-registry: {}; smithery: {})",
            mcp.err().unwrap_or_default(),
            smithery.err().unwrap_or_default(),
        ));
    }
    serde_json::to_string(&serde_json::json!({
        "servers": servers,
        "sources": sources,
        "note": "Merged MCP Registry + Smithery. Each entry tags its source.",
    }))
    .map_err(|e| format!("serialize: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // One test: the env var is process-global, so the default / search / override
    // cases must run sequentially in a single thread (parallel tests would race on
    // it). Assertions are grouped, not split across concurrent tests.
    #[test]
    fn resolve_url_default_search_and_env_override() {
        std::env::remove_var(ENV_REGISTRY_URL);
        let url = resolve_url(50, None);
        assert!(url.starts_with(DEFAULT_REGISTRY_URL));
        assert!(url.contains("limit=50"));

        let url = resolve_url(10, Some("stock price"));
        assert!(url.contains("limit=10"));
        assert!(url.contains("search=stock%20price"), "got {url}");

        std::env::set_var(ENV_REGISTRY_URL, "https://self.hosted/registry/servers");
        let url = resolve_url(10, None);
        assert!(url.starts_with("https://self.hosted/registry/servers"));
        assert!(url.contains("limit=10"));
        std::env::remove_var(ENV_REGISTRY_URL);
    }

    #[test]
    fn normalize_mcp_registry_pulls_name_desc_url() {
        // Captured real MCP-Registry shape (registry.modelcontextprotocol.io).
        let body = r#"{"servers":[
            {"server":{"name":"ac.inference.sh/mcp","title":"inference.sh",
              "description":"Run 150+ AI apps","remotes":[{"type":"streamable-http","url":"https://sh.inference.ac"}]},
              "_meta":{}},
            {"server":{"name":"no.remote/srv","description":"local only"},"_meta":{}}
        ],"metadata":{}}"#;
        let out = normalize_mcp_registry(body);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0]["id"], "ac.inference.sh/mcp");
        assert_eq!(out[0]["name"], "inference.sh");
        assert_eq!(out[0]["url"], "https://sh.inference.ac");
        assert_eq!(out[0]["source"], "mcp-registry");
        // Title-less entry falls back to name; remote-less entry has empty url.
        assert_eq!(out[1]["name"], "no.remote/srv");
        assert_eq!(out[1]["url"], "");
    }

    #[test]
    fn normalize_smithery_pulls_name_desc_url() {
        // Captured real Smithery shape (registry.smithery.ai).
        let body = r#"{"servers":[
            {"id":"c1368","qualifiedName":"axel-belfort/stock-price","namespace":"axel-belfort",
             "displayName":"Stock Price — Real-Time Quotes","description":"Stock market price API",
             "homepage":"https://github.com/Br0ski777/stock-price-x402","remote":true}
        ],"pagination":{"totalCount":140}}"#;
        let out = normalize_smithery(body);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["id"], "axel-belfort/stock-price");
        assert_eq!(out[0]["name"], "Stock Price — Real-Time Quotes");
        assert_eq!(out[0]["url"], "https://github.com/Br0ski777/stock-price-x402");
        assert_eq!(out[0]["source"], "smithery");
    }

    #[test]
    fn normalizers_tolerate_garbage() {
        assert!(normalize_smithery("not json").is_empty());
        assert!(normalize_mcp_registry("{}").is_empty());
    }
}
