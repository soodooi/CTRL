// kernel::audit — trust-domain tagging + external-call audit ledger.
//
// ADR-010 communication § trust-domains: CTRL has two trust domains.
//   - Internal: kernel actor<->actor over channel/event — zero governance,
//     never crosses the :17873 gate.
//   - External: anything that crossed the :17873 gate (external agent / Irisy
//     -> tool / PWA write / connector -> third party). These MUST be audited.
//
// `TrustDomain` makes that boundary an explicit type rather than an implicit
// convention, so every audited call carries which side it came from. The
// ledger rows live in `persistence::EventStore` (table `audit_calls`).

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Which trust domain a call originated in. The gate audits `External` calls;
/// kernel-internal traffic is tagged `Internal` and is not recorded — the tag
/// makes "internal self-calls bypass the gate" a visible, checkable fact.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TrustDomain {
    Internal,
    External,
}

impl TrustDomain {
    pub fn as_str(&self) -> &'static str {
        match self {
            TrustDomain::Internal => "internal",
            TrustDomain::External => "external",
        }
    }
}

/// Hash tool arguments so the ledger records *what shape* was invoked without
/// persisting potentially sensitive full argument payloads (data sovereignty:
/// the audit trail proves a call happened, it does not leak its contents).
pub fn hash_args(args: Option<&serde_json::Map<String, serde_json::Value>>) -> String {
    let bytes = match args {
        Some(map) => serde_json::to_vec(map).unwrap_or_default(),
        None => Vec::new(),
    };
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    format!("{:x}", hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domain_str_is_stable() {
        assert_eq!(TrustDomain::Internal.as_str(), "internal");
        assert_eq!(TrustDomain::External.as_str(), "external");
    }

    #[test]
    fn hash_args_is_deterministic_and_distinguishes() {
        let mut a = serde_json::Map::new();
        a.insert("path".into(), serde_json::Value::String("note.md".into()));
        let mut b = serde_json::Map::new();
        b.insert("path".into(), serde_json::Value::String("other.md".into()));

        // Same input -> same hash; different input -> different hash.
        assert_eq!(hash_args(Some(&a)), hash_args(Some(&a)));
        assert_ne!(hash_args(Some(&a)), hash_args(Some(&b)));
        // None hashes to the empty-input digest, stably.
        assert_eq!(hash_args(None), hash_args(None));
    }
}
