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

use crate::kernel::actor::ActorId;
use crate::kernel::event::Event;
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

/// A cross-domain (External) call that crossed the `:17873` gate, captured as a
/// type — the `GateRequest` half of the trust-domain boundary (ADR-010 communication
/// § trust-domains v3, SC1). Constructed ONLY at the gate (`at_gate`), so the
/// type system now enforces, at the AUDIT/LEDGER boundary, what was previously
/// only convention:
///   - internal actor-to-actor traffic (the `channel`/`event` side) has no way
///     to construct a `GateRequest`, so a kernel self-call cannot reach the audit
///     ledger (self-calls stay unrecorded by construction, not best-effort);
///   - an external call cannot be recorded without going through `at_gate`, so it
///     cannot silently bypass the gate's ledger.
///
/// `GateRequest` has its positive sibling in `InternalMsg` (below): the two are
/// disjoint by construction with NO conversion either way, so the compiler keeps
/// the domains apart. There is deliberately no `Default`/`From`/`Into` and no
/// internal constructor here; the domain is `External` by construction. Residual
/// SC1 work is narrower now: retyping each actor *handler* signature to carry the
/// domain (the dispatch entry points — gate + bus — are typed).
#[derive(Debug, Clone)]
pub struct GateRequest {
    caller: String,
    tool: String,
    args_hash: String,
    args_json: String,
}

impl GateRequest {
    /// The ONLY constructor — at the gate boundary, from the caller header + the
    /// tool call. Keeps BOTH a hash (stable shape id, dedup) and a REDACTED JSON
    /// of the args (real trace: what was actually passed, minus secrets — OTel
    /// GenAI `gen_ai.tool.call.arguments`, plan-agent-observability.md S2). There
    /// is intentionally no internal constructor.
    pub fn at_gate(
        caller: String,
        tool: &str,
        args: Option<&serde_json::Map<String, serde_json::Value>>,
    ) -> Self {
        Self {
            caller,
            tool: tool.to_string(),
            args_hash: hash_args(args),
            args_json: redact_args(args),
        }
    }

    /// Trust domain is `External` by construction.
    pub fn domain(&self) -> TrustDomain {
        TrustDomain::External
    }
    pub fn caller(&self) -> &str {
        &self.caller
    }
    pub fn tool(&self) -> &str {
        &self.tool
    }
    pub fn args_hash(&self) -> &str {
        &self.args_hash
    }
    /// Redacted JSON of the args (secrets stripped) — the real-trace payload.
    pub fn args_json(&self) -> &str {
        &self.args_json
    }
}

/// Keys whose VALUE is a secret and must never land in the ledger (privacy —
/// content capture stays local + redacted, plan-agent-observability.md §red-line).
fn is_secret_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    ["token", "secret", "password", "passwd", "authorization", "bearer", "credential", "api_key", "apikey", "access_key", "private_key"]
        .iter()
        .any(|s| k.contains(s))
    // NB: "key" alone is too broad (a smart-table field is called `key`), so we
    // only match the compound secret-ish names above, not bare "key".
}

/// Largest index `<= max` that lies on a char boundary of `s` (stable
/// stand-in for the unstable `str::floor_char_boundary`). Used everywhere the
/// ledger bounds a UTF-8 string: truncating at a raw byte offset panics
/// mid-char, and a panic inside the gate's call path kills the tool task and
/// leaves the client hanging with no audit row (stock-cn N2-0).
pub fn floor_char_boundary(s: &str, max: usize) -> usize {
    if max >= s.len() {
        return s.len();
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    end
}

/// Redact secret values in the args, then serialize to a bounded JSON string —
/// the ledger keeps WHAT was passed (for debugging) without leaking credentials
/// or ballooning on a huge payload.
pub fn redact_args(args: Option<&serde_json::Map<String, serde_json::Value>>) -> String {
    const MAX: usize = 4000;
    let Some(map) = args else {
        return String::new();
    };
    let mut out = serde_json::Map::new();
    for (k, v) in map {
        if is_secret_key(k) {
            out.insert(k.clone(), serde_json::Value::String("<redacted>".into()));
        } else {
            out.insert(k.clone(), v.clone());
        }
    }
    let mut s = serde_json::to_string(&serde_json::Value::Object(out)).unwrap_or_default();
    if s.len() > MAX {
        s.truncate(floor_char_boundary(&s, MAX));
        s.push_str("…<truncated>");
    }
    s
}

/// The `Internal` half of the trust-domain boundary (ADR-010 communication
/// § trust-domains v3, SC1) — the positive sibling of `GateRequest`. Kernel
/// actor<->actor traffic over channel/event is `Internal` by construction: an
/// `InternalMsg` wraps an `Event` (the kernel's single inter-actor message
/// format) plus the originating `ActorId`, and is built ONLY by in-kernel
/// constructors. There is deliberately NO conversion to or from `GateRequest`
/// in either direction, so:
///   - internal traffic cannot be turned into a gate request — it has no path to
///     the gate's audit/visibility surface (internal stays unaudited *by type*);
///   - a gate request cannot masquerade as internal to skip governance, because
///     only an `InternalMsg` can be published on the internal `EventBus`.
/// "Internal" is now a positive type, not the mere absence of a `GateRequest`.
#[derive(Debug, Clone)]
pub struct InternalMsg {
    origin: ActorId,
    event: Event,
}

impl InternalMsg {
    /// Construct internal actor->actor traffic. In-kernel only — the ABSENCE of
    /// any gate/external constructor (no `at_gate`, no `From<GateRequest>`) is
    /// the compile-time guarantee that external calls can't enter the bus.
    pub fn from_actor(origin: ActorId, event: Event) -> Self {
        Self { origin, event }
    }

    /// Trust domain is `Internal` by construction (mirror of `GateRequest`).
    pub fn domain(&self) -> TrustDomain {
        TrustDomain::Internal
    }
    pub fn origin(&self) -> &ActorId {
        &self.origin
    }
    pub fn event(&self) -> &Event {
        &self.event
    }
    /// Consume the message, yielding the carried `Event` for delivery on the bus.
    pub fn into_event(self) -> Event {
        self.event
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
    fn gate_request_is_external_by_construction() {
        // The compile-time guarantee (no internal constructor, no From/Into) is
        // enforced by the type system; this locks the runtime contract: a
        // GateRequest is always External and carries the gate-captured fields.
        let r = GateRequest::at_gate("pwa".into(), "vault_read", None);
        assert_eq!(r.domain(), TrustDomain::External);
        assert_eq!(r.caller(), "pwa");
        assert_eq!(r.tool(), "vault_read");
        assert_eq!(r.args_hash(), hash_args(None));
    }

    #[test]
    fn internal_msg_is_internal_by_construction_and_disjoint_from_gate() {
        use crate::kernel::event::{Event, Op, OpKind};
        let ev = Event::Op(Op {
            kind: OpKind::ActorSpawned,
            ts_ms: 0,
            stream_id: None,
            payload: serde_json::json!({}),
        });
        let msg = InternalMsg::from_actor(ActorId::from_str("actor-1"), ev);
        // Positive Internal type — not the mere absence of a GateRequest.
        assert_eq!(msg.domain(), TrustDomain::Internal);
        assert_eq!(msg.origin().as_str(), "actor-1");
        // The sibling GateRequest is External; the two domains never coincide,
        // and the type system offers no conversion between InternalMsg and
        // GateRequest in either direction (enforced at compile time).
        let gate = GateRequest::at_gate("pwa".into(), "vault_read", None);
        assert_ne!(msg.domain(), gate.domain());
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

    #[test]
    fn floor_char_boundary_lands_on_boundaries() {
        let s = "a股b";
        // Inside the 3-byte char (bytes 1..4): floor back to its start.
        assert_eq!(floor_char_boundary(s, 2), 1);
        assert_eq!(floor_char_boundary(s, 3), 1);
        // On a boundary / beyond the end: unchanged / clamped.
        assert_eq!(floor_char_boundary(s, 4), 4);
        assert_eq!(floor_char_boundary(s, 99), s.len());
    }

    /// Regression (stock-cn N2-0): truncating the serialized args at a raw
    /// byte offset panicked mid-UTF-8-char BEFORE dispatch — big CJK
    /// vault_write bodies hung the gate and the write never landed.
    #[test]
    fn redact_args_truncates_multibyte_payload_without_panicking() {
        let mut args = serde_json::Map::new();
        args.insert("path".into(), serde_json::Value::String("a.md".into()));
        args.insert("body".into(), serde_json::Value::String("股".repeat(3000)));
        let s = redact_args(Some(&args));
        assert!(s.ends_with("…<truncated>"), "marker missing: {}", &s[..60]);
        assert!(s.len() <= 4000 + "…<truncated>".len());
    }
}
