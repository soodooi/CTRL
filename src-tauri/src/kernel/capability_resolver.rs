// Capability resolver — given a keycap_id, returns the Capability
// (bundle of CapTokens) that keycap is authorized to use.
//
// Resolution order:
//   1. Seed keycaps shipped with CTRL — hardcoded capability set
//      (ctrl-chat / clipboard-ai / ai-translate / ai-text / ai-ocr).
//      These eventually migrate to manifest-driven; hardcoded keeps v1
//      moving without writing seed manifests.
//   2. Installed keycaps — read the manifest at
//      ~/.ctrl/keycaps/<id>/manifest.json, parse the `capabilities`
//      array of CapToken JSON values.
//   3. Unknown keycap_id → Capability::empty() (deny by default).
//
// The special keycap_id "ctrl-system" returns full-access capability —
// used by Tauri commands when no keycap context is provided (debug /
// Settings UI / first-run wizard). PWA-side commands inside run_keycap
// MUST pass the real keycap_id so the per-keycap scoping kicks in.

use crate::kernel::capability::{CapToken, Capability};
use std::fs;
use std::path::PathBuf;

pub fn resolve_for_keycap(keycap_id: &str) -> Capability {
    if let Some(cap) = resolve_seed(keycap_id) {
        return cap;
    }
    if let Some(cap) = resolve_installed(keycap_id) {
        return cap;
    }
    Capability::empty()
}

fn resolve_seed(keycap_id: &str) -> Option<Capability> {
    let tokens = match keycap_id {
        // The 5 v1 launch seed keycaps. They speak text.chat + read/write
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
                namespace: keycap_id.to_string(),
            },
            CapToken::KvWrite {
                namespace: keycap_id.to_string(),
            },
            CapToken::CacheRead {
                scope: keycap_id.to_string(),
            },
            CapToken::CacheWrite {
                scope: keycap_id.to_string(),
            },
        ],
        // Trusted system context — used when no keycap_id is passed.
        // Future tightening: drop this; require explicit keycap_id every call.
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

fn resolve_installed(keycap_id: &str) -> Option<Capability> {
    let home = std::env::var("HOME").ok()?;
    let manifest_path = PathBuf::from(home)
        .join(".ctrl")
        .join("keycaps")
        .join(keycap_id)
        .join("manifest.json");
    let bytes = fs::read(&manifest_path).ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    let caps = manifest.get("capabilities")?;
    let token_arr = caps.as_array()?;
    let mut tokens = Vec::new();
    for t in token_arr {
        // Each entry MUST be a tagged CapToken JSON ({ kind: "VaultWrite",
        // path_glob: "chats/" }). Invalid entries are dropped with a warn —
        // a typo in a user-installed manifest shouldn't crash the kernel.
        match serde_json::from_value::<CapToken>(t.clone()) {
            Ok(token) => tokens.push(token),
            Err(e) => {
                tracing::warn!(
                    keycap_id = %keycap_id,
                    error = %e,
                    "capability_resolver: skipping malformed token in manifest"
                );
            }
        }
    }
    Some(Capability::new(tokens))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_ctrl_chat_has_vault_and_llm() {
        let cap = resolve_for_keycap("ctrl-chat");
        assert!(cap.contains(&CapToken::LlmCall {
            model: "*".to_string(),
            max_tokens: None,
        }));
        assert!(cap.contains(&CapToken::VaultWrite {
            path_glob: "*".to_string(),
        }));
        // Scoped to own keycap_id, not other keycaps
        assert!(cap.contains(&CapToken::KvWrite {
            namespace: "ctrl-chat".to_string(),
        }));
        assert!(!cap.contains(&CapToken::KvWrite {
            namespace: "ai-translate".to_string(),
        }));
    }

    #[test]
    fn ctrl_system_has_wildcard_storage_access() {
        let cap = resolve_for_keycap("ctrl-system");
        assert!(cap.contains(&CapToken::KvWrite {
            namespace: "*".to_string(),
        }));
        assert!(cap.contains(&CapToken::CacheWrite {
            scope: "*".to_string(),
        }));
    }

    #[test]
    fn unknown_keycap_returns_empty() {
        let cap = resolve_for_keycap("never-installed-foo");
        assert_eq!(cap.tokens().count(), 0);
    }
}
