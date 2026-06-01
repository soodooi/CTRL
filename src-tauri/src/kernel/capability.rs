// Capability — static token bundle declaring what an actor may do.
//
// No ambient authority. Every effect requires explicit capability check
// by `CapabilityBroker`. Mirrors @ctrl/kernel-sdk/src/capability.ts.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(tag = "kind", rename_all = "PascalCase")]
pub enum CapToken {
    // LLM
    LlmCall {
        model: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        max_tokens: Option<u32>,
    },
    // Storage — filesystem (generic)
    FsRead {
        path_glob: String,
    },
    FsWrite {
        path_glob: String,
    },
    // Storage — vault (Obsidian-compatible markdown, $HOME/.ctrl/vault/)
    // Per CLAUDE.md design philosophy, vault is the user's data; this
    // token gates *which keycap* writes *which path prefix*, not whether
    // the data itself is private (the user always owns it).
    VaultRead {
        /// Prefix match against vault-relative paths. "*" allows full vault.
        path_glob: String,
    },
    VaultWrite {
        path_glob: String,
    },
    // Storage — localstorage (per-keycap persistent JSON KV)
    KvRead {
        namespace: String,
    },
    KvWrite {
        namespace: String,
    },
    // Storage — cache (per-keycap transient LRU blob)
    CacheRead {
        scope: String,
    },
    CacheWrite {
        scope: String,
    },
    // Network
    HttpGet {
        url_glob: String,
    },
    HttpPost {
        url_glob: String,
    },
    // System
    ClipboardRead,
    ClipboardWrite,
    HotkeyRegister {
        combo: String,
    },
    // MCP
    McpInvoke {
        server: String,
        tool_glob: String,
    },
    // OAuth — Pattern E (ADR-004 cap § execution v1 §5.2)
    // Grants a keycap permission to obtain and use OAuth tokens for a given
    // provider. Token issuance + storage handled by kernel OAuth runtime;
    // keycap never touches the raw token, only the Effect dispatches through
    // a provider-scoped client.
    OAuthAccess {
        provider: String,
        #[serde(default)]
        scopes: Vec<String>,
    },
    // ST-SS
    StssEmit {
        stream_id: String,
    },
    StssSubscribe {
        stream_id: String,
    },
    // Inter-actor
    Spawn {
        prototype: String,
    },
    Send {
        target: String,
    },
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Capability {
    tokens: BTreeSet<CapToken>,
}

impl Capability {
    pub fn new(tokens: impl IntoIterator<Item = CapToken>) -> Self {
        Self {
            tokens: tokens.into_iter().collect(),
        }
    }

    pub fn empty() -> Self {
        Self::default()
    }

    pub fn contains(&self, token: &CapToken) -> bool {
        self.tokens.contains(token)
    }

    pub fn tokens(&self) -> impl Iterator<Item = &CapToken> {
        self.tokens.iter()
    }

    /// Compute a subset capability for a child actor. Child capability
    /// MUST be a subset of parent — enforced here at spawn time.
    pub fn derive_subset(&self, requested: &Capability) -> Result<Capability, CapabilityError> {
        for token in &requested.tokens {
            if !self.tokens.contains(token) {
                return Err(CapabilityError::EscalationAttempt {
                    token: format!("{token:?}"),
                });
            }
        }
        Ok(requested.clone())
    }
}

#[derive(Debug, Clone)]
pub enum CapabilityError {
    MissingToken { token: String },
    EscalationAttempt { token: String },
}

impl fmt::Display for CapabilityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CapabilityError::MissingToken { token } => {
                write!(f, "capability missing token: {token}")
            }
            CapabilityError::EscalationAttempt { token } => {
                write!(f, "capability escalation rejected for token: {token}")
            }
        }
    }
}

impl std::error::Error for CapabilityError {}

/// Capability mediation point for the kernel. Every Effect execution
/// passes through here. P2.1 skeleton — wiring in P2.4.
pub struct CapabilityBroker;

impl CapabilityBroker {
    pub fn new() -> Self {
        Self
    }

    /// Check whether a capability authorizes a given token usage.
    /// Exact-match for tokens with no glob fields; prefix-match for tokens
    /// with `path_glob` / `url_glob` (so a keycap holding
    /// `VaultWrite { path_glob: "chats/" }` can write `chats/2026/x.md`
    /// without listing every concrete path).
    pub fn check(&self, cap: &Capability, required: &CapToken) -> Result<(), CapabilityError> {
        for held in cap.tokens() {
            if token_authorizes(held, required) {
                return Ok(());
            }
        }
        Err(CapabilityError::MissingToken {
            token: format!("{required:?}"),
        })
    }
}

/// Does a held token authorize a requested token? Exact match by default;
/// glob-bearing variants match by literal prefix or "*" wildcard. KvRead/
/// Write + CacheRead/Write also support "*" as namespace/scope wildcard
/// so a system keycap (ctrl-system) can declare full-access without
/// enumerating every concrete scope.
fn token_authorizes(held: &CapToken, requested: &CapToken) -> bool {
    use CapToken::*;
    match (held, requested) {
        (VaultRead { path_glob: h }, VaultRead { path_glob: r }) => glob_authorizes(h, r),
        (VaultWrite { path_glob: h }, VaultWrite { path_glob: r }) => glob_authorizes(h, r),
        (FsRead { path_glob: h }, FsRead { path_glob: r }) => glob_authorizes(h, r),
        (FsWrite { path_glob: h }, FsWrite { path_glob: r }) => glob_authorizes(h, r),
        (KvRead { namespace: h }, KvRead { namespace: r }) => glob_authorizes(h, r),
        (KvWrite { namespace: h }, KvWrite { namespace: r }) => glob_authorizes(h, r),
        (CacheRead { scope: h }, CacheRead { scope: r }) => glob_authorizes(h, r),
        (CacheWrite { scope: h }, CacheWrite { scope: r }) => glob_authorizes(h, r),
        (HttpGet { url_glob: h }, HttpGet { url_glob: r }) => glob_authorizes(h, r),
        (HttpPost { url_glob: h }, HttpPost { url_glob: r }) => glob_authorizes(h, r),
        (
            McpInvoke {
                server: hs,
                tool_glob: ht,
            },
            McpInvoke {
                server: rs,
                tool_glob: rt,
            },
        ) => glob_authorizes(hs, rs) && glob_authorizes(ht, rt),
        _ => held == requested,
    }
}

/// Minimal glob: `*` matches anything; otherwise literal-prefix match.
/// Avoids a globset dep for v1 — most policies are `"*"` or `"prefix/"`.
fn glob_authorizes(held_pattern: &str, requested_value: &str) -> bool {
    if held_pattern == "*" {
        return true;
    }
    requested_value.starts_with(held_pattern)
}

impl Default for CapabilityBroker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oauth_access_serde_roundtrip() {
        let t = CapToken::OAuthAccess {
            provider: "feishu".into(),
            scopes: vec!["im:message".into(), "drive:doc:read".into()],
        };
        let j = serde_json::to_string(&t).unwrap();
        assert!(j.contains("OAuthAccess"));
        assert!(j.contains("feishu"));
        assert!(j.contains("im:message"));
        let back: CapToken = serde_json::from_str(&j).unwrap();
        match back {
            CapToken::OAuthAccess { provider, scopes } => {
                assert_eq!(provider, "feishu");
                assert_eq!(scopes, vec!["im:message", "drive:doc:read"]);
            }
            other => panic!("roundtrip wrong variant: {other:?}"),
        }
    }

    #[test]
    fn capability_contains_oauth_access() {
        let oauth = CapToken::OAuthAccess {
            provider: "notion".into(),
            scopes: vec!["pages:read".into()],
        };
        let cap = Capability::new(vec![oauth.clone()]);
        assert!(cap.contains(&oauth));

        let different_provider = CapToken::OAuthAccess {
            provider: "slack".into(),
            scopes: vec!["pages:read".into()],
        };
        assert!(!cap.contains(&different_provider));
    }

    #[test]
    fn broker_check_rejects_missing_oauth() {
        let broker = CapabilityBroker::new();
        let cap = Capability::empty();
        let required = CapToken::OAuthAccess {
            provider: "feishu".into(),
            scopes: vec!["im:message".into()],
        };
        assert!(broker.check(&cap, &required).is_err());
    }

    #[test]
    fn vault_write_prefix_authorizes_subpath() {
        let broker = CapabilityBroker::new();
        let held = Capability::new(vec![CapToken::VaultWrite {
            path_glob: "chats/".into(),
        }]);
        // exact-prefix match
        assert!(broker
            .check(
                &held,
                &CapToken::VaultWrite {
                    path_glob: "chats/2026-05-22/hello.md".into(),
                },
            )
            .is_ok());
        // outside prefix → rejected
        assert!(broker
            .check(
                &held,
                &CapToken::VaultWrite {
                    path_glob: "notes/secret.md".into(),
                },
            )
            .is_err());
    }

    #[test]
    fn vault_write_wildcard_authorizes_anything() {
        let broker = CapabilityBroker::new();
        let held = Capability::new(vec![CapToken::VaultWrite {
            path_glob: "*".into(),
        }]);
        assert!(broker
            .check(
                &held,
                &CapToken::VaultWrite {
                    path_glob: "anything/here.md".into(),
                },
            )
            .is_ok());
    }

    #[test]
    fn vault_read_does_not_grant_vault_write() {
        let broker = CapabilityBroker::new();
        let read_only = Capability::new(vec![CapToken::VaultRead {
            path_glob: "*".into(),
        }]);
        assert!(broker
            .check(
                &read_only,
                &CapToken::VaultWrite {
                    path_glob: "x.md".into(),
                },
            )
            .is_err());
    }

    #[test]
    fn cache_scope_exact_match() {
        let broker = CapabilityBroker::new();
        let held = Capability::new(vec![CapToken::CacheWrite {
            scope: "my-keycap".into(),
        }]);
        assert!(broker
            .check(
                &held,
                &CapToken::CacheWrite {
                    scope: "my-keycap".into(),
                },
            )
            .is_ok());
        assert!(broker
            .check(
                &held,
                &CapToken::CacheWrite {
                    scope: "other-keycap".into(),
                },
            )
            .is_err());
    }
}
