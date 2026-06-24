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

/// Header an external caller sets to identify itself to the gate (e.g.
/// `irisy`, `hermes`, `claude-code`). The value is recorded in the audit
/// ledger so the trail attributes each call to a concrete caller rather than a
/// blanket `"external"` (SC3 caller refinement).
pub const CALLER_HEADER: &str = "x-ctrl-caller";

/// Default caller id when the `X-Ctrl-Caller` header is absent.
const CALLER_DEFAULT: &str = "external";

/// Normalize a caller-identity header value into a ledger-safe id: trimmed,
/// lowercased, and restricted to `[a-z0-9._-]` so a hostile header can't inject
/// control characters or unbounded payloads into the audit trail. Absent or
/// empty => the generic `"external"` (preserves the pre-SC3 attribution).
pub fn normalize_caller(raw: Option<&str>) -> String {
    let Some(raw) = raw else {
        return CALLER_DEFAULT.to_string();
    };
    let cleaned: String = raw
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
        .take(64)
        .collect();
    if cleaned.is_empty() {
        CALLER_DEFAULT.to_string()
    } else {
        cleaned
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
    fn normalize_caller_defaults_and_sanitizes() {
        // Absent / empty -> generic external attribution.
        assert_eq!(normalize_caller(None), "external");
        assert_eq!(normalize_caller(Some("   ")), "external");
        // Known callers pass through, lowercased + trimmed.
        assert_eq!(normalize_caller(Some("  Irisy ")), "irisy");
        assert_eq!(normalize_caller(Some("claude-code")), "claude-code");
        // Hostile input is stripped to the safe charset (no injection / blowup).
        assert_eq!(normalize_caller(Some("ev!l\n<script>")), "evlscript");
        let long = "a".repeat(200);
        assert_eq!(normalize_caller(Some(&long)).len(), 64);
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
