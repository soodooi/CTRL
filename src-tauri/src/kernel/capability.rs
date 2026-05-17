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
    // Storage
    FsRead {
        path_glob: String,
    },
    FsWrite {
        path_glob: String,
    },
    KvRead {
        namespace: String,
    },
    KvWrite {
        namespace: String,
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
    // OAuth — Pattern E (ADR-010 §5.2)
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
    pub fn check(&self, cap: &Capability, required: &CapToken) -> Result<(), CapabilityError> {
        if cap.contains(required) {
            Ok(())
        } else {
            Err(CapabilityError::MissingToken {
                token: format!("{required:?}"),
            })
        }
    }
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
}
