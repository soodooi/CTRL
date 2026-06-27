// Capability resolver — given a mcp_id, returns the Capability
// (bundle of CapTokens) that mcp is authorized to use.
//
// Resolution order:
//   1. Seed mcps shipped with CTRL — hardcoded capability set
//      (ctrl-chat / clipboard-ai / ai-translate / ai-text / ai-ocr).
//      These eventually migrate to manifest-driven; hardcoded keeps v1
//      moving without writing seed manifests.
//   2. Installed mcps — read the manifest at
//      ~/.ctrl/mcps/<id>/manifest.json, parse the `capabilities`
//      array of CapToken JSON values.
//   3. Unknown mcp_id → Capability::empty() (deny by default).
//
// The special mcp_id "ctrl-system" returns full-access capability —
// used by Tauri commands when no mcp context is provided (debug /
// Settings UI / first-run wizard). PWA-side commands inside run_mcp
// MUST pass the real mcp_id so the per-mcp scoping kicks in.

use crate::kernel::capability::{CapToken, Capability};
use std::fs;
use std::path::PathBuf;

pub fn resolve_for_mcp(mcp_id: &str) -> Capability {
    if let Some(cap) = resolve_seed(mcp_id) {
        return cap;
    }
    if let Some(cap) = resolve_installed(mcp_id) {
        return cap;
    }
    Capability::empty()
}

fn resolve_seed(mcp_id: &str) -> Option<Capability> {
    let tokens = match mcp_id {
        // The 5 v1 launch seed mcps. They speak text.chat + read/write
        // the user's clipboard + own a scoped slice of the storage tiers.
        "ctrl-chat" | "clipboard-ai" | "ai-translate" | "ai-text" | "ai-ocr" => vec![
            CapToken::LlmCall {
                model: "*".to_string(),
                max_tokens: None,
            },
            CapToken::ClipboardRead,
            CapToken::ClipboardWrite,
            // Seeds share the vault (broad path_glob) because their output
            // is user content the user expects to see in their vault.
            CapToken::VaultRead {
                path_glob: "*".to_string(),
            },
            CapToken::VaultWrite {
                path_glob: "*".to_string(),
            },
            CapToken::KvRead {
                namespace: mcp_id.to_string(),
            },
            CapToken::KvWrite {
                namespace: mcp_id.to_string(),
            },
            CapToken::CacheRead {
                scope: mcp_id.to_string(),
            },
            CapToken::CacheWrite {
                scope: mcp_id.to_string(),
            },
        ],
        // Trusted system context — used when no mcp_id is passed.
        // Future tightening: drop this; require explicit mcp_id every call.
        "ctrl-system" => vec![
            CapToken::LlmCall {
                model: "*".to_string(),
                max_tokens: None,
            },
            CapToken::ClipboardRead,
            CapToken::ClipboardWrite,
            CapToken::VaultRead {
                path_glob: "*".to_string(),
            },
            CapToken::VaultWrite {
                path_glob: "*".to_string(),
            },
            CapToken::KvRead {
                namespace: "*".to_string(),
            },
            CapToken::KvWrite {
                namespace: "*".to_string(),
            },
            CapToken::CacheRead {
                scope: "*".to_string(),
            },
            CapToken::CacheWrite {
                scope: "*".to_string(),
            },
            CapToken::McpInvoke {
                server: "*".to_string(),
                tool_glob: "*".to_string(),
            },
        ],
        _ => return None,
    };
    Some(Capability::new(tokens))
}

fn resolve_installed(mcp_id: &str) -> Option<Capability> {
    let home = std::env::var("HOME").ok()?;
    let mcps_dir = PathBuf::from(home).join(".ctrl").join("mcps");
    resolve_installed_at(&mcps_dir, mcp_id)
}

/// Path-taking core of `resolve_installed` (hermetic — testable without
/// touching `$HOME`). Reads `<mcps_dir>/<mcp_id>/manifest.json`.
fn resolve_installed_at(mcps_dir: &std::path::Path, mcp_id: &str) -> Option<Capability> {
    let manifest_path = mcps_dir.join(mcp_id).join("manifest.json");
    let bytes = fs::read(&manifest_path).ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let caps = manifest.get("capabilities")?;

    // Baseline: every installed pack owns its own KV + cache namespace
    // (mirrors resolve_seed) so a pack can persist its own state without
    // declaring it. Scoped to mcp_id → it can never touch another pack's.
    let mut tokens = vec![
        CapToken::KvRead { namespace: mcp_id.to_string() },
        CapToken::KvWrite { namespace: mcp_id.to_string() },
        CapToken::CacheRead { scope: mcp_id.to_string() },
        CapToken::CacheWrite { scope: mcp_id.to_string() },
    ];

    match caps {
        // Manifest SSOT (`manifest-schema.ts` Capabilities) is an OBJECT
        // (clipboard/text/network/file/mcp/platform). Adapt it to the
        // kernel's CapToken model. This is the fix for the drift where
        // `caps.as_array()` always failed → installed packs resolved to
        // empty → denied everything (ADR-002 v35 KNOWN GAP).
        serde_json::Value::Object(_) => {
            tokens.extend(capabilities_object_to_tokens(caps));
        }
        // Legacy / advanced: a raw CapToken JSON array, parsed directly.
        serde_json::Value::Array(arr) => {
            for t in arr {
                match serde_json::from_value::<CapToken>(t.clone()) {
                    Ok(token) => tokens.push(token),
                    Err(e) => tracing::warn!(
                        mcp_id = %mcp_id,
                        error = %e,
                        "capability_resolver: skipping malformed token in manifest"
                    ),
                }
            }
        }
        _ => {}
    }
    Some(Capability::new(tokens))
}

/// Adapt the manifest `capabilities` OBJECT (the `manifest-schema.ts`
/// Capabilities SSOT) into the kernel's flat `CapToken` set. Faithful, least-
/// privilege: only declared sub-capabilities become tokens. Sub-capabilities
/// with no kernel CapToken yet (keyring / screen / notify / mcp.spawn /
/// mcp.notifications) are intentionally NOT granted — they route through other
/// mechanisms (keychain provision) or are future tokens.
fn capabilities_object_to_tokens(caps: &serde_json::Value) -> Vec<CapToken> {
    let mut t = Vec::new();
    let flag = |path: &[&str]| -> bool {
        let mut cur = caps;
        for k in path {
            match cur.get(k) {
                Some(v) => cur = v,
                None => return false,
            }
        }
        cur.as_bool() == Some(true)
    };
    let str_array = |v: Option<&serde_json::Value>| -> Vec<String> {
        v.and_then(|x| x.as_array())
            .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
            .unwrap_or_default()
    };

    // clipboard.{read,write}
    if flag(&["clipboard", "read"]) {
        t.push(CapToken::ClipboardRead);
    }
    if flag(&["clipboard", "write"]) {
        t.push(CapToken::ClipboardWrite);
    }
    // text.chat → LLM access
    if flag(&["text", "chat"]) {
        t.push(CapToken::LlmCall { model: "*".into(), max_tokens: None });
    }
    // network.http.{allowlist,methods} → one Http{Get,Post} token per host,
    // gated by the declared methods (default GET+POST per the schema).
    if let Some(http) = caps.get("network").and_then(|n| n.get("http")) {
        let hosts = str_array(http.get("allowlist"));
        let methods = {
            let m = str_array(http.get("methods"));
            if m.is_empty() { vec!["GET".into(), "POST".into()] } else { m }
        };
        let has = |name: &str| methods.iter().any(|m| m.eq_ignore_ascii_case(name));
        for host in hosts {
            if has("GET") {
                t.push(CapToken::HttpGet { url_glob: host.clone() });
            }
            if has("POST") {
                t.push(CapToken::HttpPost { url_glob: host });
            }
        }
    }
    // file.{read,write}_allowlist → Fs{Read,Write} per path glob
    for p in str_array(caps.get("file").and_then(|f| f.get("read_allowlist"))) {
        t.push(CapToken::FsRead { path_glob: p });
    }
    for p in str_array(caps.get("file").and_then(|f| f.get("write_allowlist"))) {
        t.push(CapToken::FsWrite { path_glob: p });
    }
    // mcp.invoke → call other MCP servers through the gate
    if flag(&["mcp", "invoke"]) {
        t.push(CapToken::McpInvoke { server: "*".into(), tool_glob: "*".into() });
    }
    // platform.hotkey → register a global hotkey
    if flag(&["platform", "hotkey"]) {
        t.push(CapToken::HotkeyRegister { combo: "*".into() });
    }
    t
}

/// Does this capability authorize an HTTP request to `url` with `method`?
/// The per-pack network allowlist (ADR-002 §2 "network http allowlist-bound"):
/// a GET needs an `HttpGet` token, a write method (POST/PUT/DELETE/PATCH)
/// needs an `HttpPost` token, whose `url_glob` matches the URL host —
/// `"*"` = any host, exact host, or a parent domain (`host` ends with
/// `".<glob>"`). Fail-closed: no matching token → not authorized. This is
/// what makes `http_get`/`http_post` (the prime exfiltration surface) only
/// reach hosts a pack actually declared.
pub fn network_authorizes(cap: &Capability, url: &str, method: &str) -> bool {
    let host = match reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_string()))
    {
        Some(h) => h.to_ascii_lowercase(),
        None => return false,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']').to_string();
    let is_write = !method.eq_ignore_ascii_case("GET");
    let host_matches = |glob: &str| -> bool {
        let g = glob.to_ascii_lowercase();
        g == "*" || host == g || host.ends_with(&format!(".{g}"))
    };
    cap.tokens().any(|tok| match tok {
        CapToken::HttpGet { url_glob } if !is_write => host_matches(url_glob),
        CapToken::HttpPost { url_glob } if is_write => host_matches(url_glob),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_ctrl_chat_has_vault_and_llm() {
        let cap = resolve_for_mcp("ctrl-chat");
        assert!(cap.contains(&CapToken::LlmCall {
            model: "*".to_string(),
            max_tokens: None,
        }));
        assert!(cap.contains(&CapToken::VaultWrite {
            path_glob: "*".to_string(),
        }));
        // Scoped to own mcp_id, not other mcps
        assert!(cap.contains(&CapToken::KvWrite {
            namespace: "ctrl-chat".to_string(),
        }));
        assert!(!cap.contains(&CapToken::KvWrite {
            namespace: "ai-translate".to_string(),
        }));
    }

    #[test]
    fn ctrl_system_has_wildcard_storage_access() {
        let cap = resolve_for_mcp("ctrl-system");
        assert!(cap.contains(&CapToken::KvWrite {
            namespace: "*".to_string(),
        }));
        assert!(cap.contains(&CapToken::CacheWrite {
            scope: "*".to_string(),
        }));
    }

    #[test]
    fn unknown_mcp_returns_empty() {
        let cap = resolve_for_mcp("never-installed-foo");
        assert_eq!(cap.tokens().count(), 0);
    }

    #[test]
    fn adapts_manifest_capabilities_object_faithfully() {
        // The shape a real `manifest-schema.ts` Capabilities object produces.
        let caps = serde_json::json!({
            "clipboard": { "read": true, "write": false },
            "text": { "chat": true },
            "network": { "http": { "allowlist": ["api.example.com"], "methods": ["GET"] } },
            "file": { "read_allowlist": ["Stocks/"], "write_allowlist": [] },
            "mcp": { "invoke": true, "spawn": false },
            "platform": { "hotkey": false, "notify": true }
        });
        let tokens = capabilities_object_to_tokens(&caps);

        // Declared → granted.
        assert!(tokens.contains(&CapToken::ClipboardRead));
        assert!(tokens.contains(&CapToken::LlmCall { model: "*".into(), max_tokens: None }));
        assert!(tokens.contains(&CapToken::HttpGet { url_glob: "api.example.com".into() }));
        assert!(tokens.contains(&CapToken::FsRead { path_glob: "Stocks/".into() }));
        assert!(tokens.contains(&CapToken::McpInvoke { server: "*".into(), tool_glob: "*".into() }));

        // NOT declared → NOT granted (least privilege).
        assert!(!tokens.contains(&CapToken::ClipboardWrite), "write was false");
        assert!(
            !tokens.contains(&CapToken::HttpPost { url_glob: "api.example.com".into() }),
            "only GET declared, POST must not be granted"
        );
        assert!(!tokens.contains(&CapToken::HotkeyRegister { combo: "*".into() }), "hotkey false");
        // keyring/screen/notify/mcp.spawn have no kernel CapToken → never appear.
        assert_eq!(
            tokens.iter().filter(|t| matches!(t, CapToken::FsWrite { .. })).count(),
            0,
            "empty write_allowlist grants no FsWrite"
        );
    }

    #[test]
    fn network_allowlist_authorizes_only_declared_hosts() {
        // Pack declared GET access to one host only.
        let cap = Capability::new(vec![CapToken::HttpGet {
            url_glob: "push2.eastmoney.com".into(),
        }]);
        // Declared host (+ subdomain) GET → allowed.
        assert!(network_authorizes(&cap, "https://push2.eastmoney.com/api/qt", "GET"));
        assert!(network_authorizes(&cap, "https://sub.push2.eastmoney.com/x", "GET"));
        // Undeclared host → denied (no exfil to evil.com).
        assert!(!network_authorizes(&cap, "https://evil.com/steal", "GET"));
        // Declared for GET only → POST (write/exfil) denied.
        assert!(!network_authorizes(&cap, "https://push2.eastmoney.com/up", "POST"));
        // Empty capability → nothing authorized (fail-closed).
        assert!(!network_authorizes(&Capability::new(vec![]), "https://push2.eastmoney.com/", "GET"));
    }

    #[test]
    fn empty_capabilities_object_grants_nothing() {
        let tokens = capabilities_object_to_tokens(&serde_json::json!({}));
        assert!(tokens.is_empty(), "no declared caps → no tokens");
    }

    /// End-to-end pack governance (the CTRL-side equivalent of a pack
    /// authoring tool's "install → call → PASS"): a real installed pack
    /// manifest resolves to capabilities the broker ENFORCES — declared
    /// passes, undeclared is denied — and its write surface is flagged for
    /// the review gate. Hermetic: writes a manifest to a temp dir, no $HOME,
    /// no network, no live gate.
    #[test]
    fn e2e_installed_pack_is_capability_governed_and_write_gated() {
        use crate::kernel::capability::CapabilityBroker;
        use crate::kernel::review_gate;

        // 1. "Install" a pack: drop a manifest with a real Capabilities object
        //    (a stock pack — read live quotes from one API host, no writes).
        let root = std::env::temp_dir().join("ctrl-e2e-pack-gov");
        let pack = root.join("stock");
        std::fs::create_dir_all(&pack).unwrap();
        std::fs::write(
            pack.join("manifest.json"),
            serde_json::to_vec(&serde_json::json!({
                "id": "stock",
                "name": "A-Share Stocks",
                "capabilities": {
                    "text": { "chat": true },
                    "network": { "http": { "allowlist": ["push2.eastmoney.com"], "methods": ["GET"] } }
                }
            }))
            .unwrap(),
        )
        .unwrap();

        // 2. Resolve the installed pack's capability (the link that was inert).
        let cap = resolve_installed_at(&root, "stock").expect("pack resolves");
        let broker = CapabilityBroker::new();

        // 3. ENFORCE — declared capabilities pass.
        assert!(
            broker
                .check(&cap, &CapToken::HttpGet { url_glob: "push2.eastmoney.com".into() })
                .is_ok(),
            "declared network GET must be authorized"
        );
        assert!(
            broker.check(&cap, &CapToken::LlmCall { model: "*".into(), max_tokens: None }).is_ok(),
            "declared text.chat must authorize LlmCall"
        );
        assert!(
            broker.check(&cap, &CapToken::KvWrite { namespace: "stock".into() }).is_ok(),
            "baseline own-namespace KV must be authorized"
        );

        // 4. ENFORCE — undeclared capabilities are DENIED (the whole point:
        //    an injected model can't make this read-only pack write the vault
        //    or POST out, because the pack never declared it).
        assert!(
            broker.check(&cap, &CapToken::VaultWrite { path_glob: "*".into() }).is_err(),
            "undeclared vault write must be denied"
        );
        assert!(
            broker.check(&cap, &CapToken::HttpPost { url_glob: "push2.eastmoney.com".into() }).is_err(),
            "only GET declared — POST must be denied"
        );
        assert!(
            broker.check(&cap, &CapToken::KvWrite { namespace: "other-pack".into() }).is_err(),
            "must not reach another pack's namespace"
        );

        // 5. Write surface is flagged for the human review gate; reads aren't.
        assert!(review_gate::requires_review("stock_write"), "writes need review");
        assert!(!review_gate::requires_review("stock_quote"), "reads run freely");

        let _ = std::fs::remove_dir_all(&root);
    }
}
