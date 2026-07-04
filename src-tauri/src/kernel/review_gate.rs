// Review gate — human approval for high-blast-radius gate calls
// (ADR-002 substrate §264 "write / delete / command tools are high
// blast-radius → gated through the ADR-006 §4 autonomy ladder: intent →
// review → approve → execute; never silent").
//
// The red-team's C3: a review prompt that shows the *caller's* natural-
// language description can be prompt-injected ("delete the vault" rendered
// as "read quotes"). Two invariants close that here:
//
//   1. The confirm shown to the human is built GATE-SIDE from the parsed
//      tool name + structured arguments — never from any caller/LLM prose.
//      `ReviewRequest` carries only `tool` + an `arg_summary` the gate
//      derived from `request.arguments`.
//   2. Approval arrives OUT-OF-BAND through a Tauri command (the human UI,
//      intra-process), NOT as an MCP argument the calling brain could set
//      itself. The external brain reaches only `:17873` MCP tools, so it
//      physically cannot resolve its own pending review. (This is why
//      `confirm_over_gate=true`-style self-approval is theatre, not a gate.)
//
// Safety: the enforcing path in `call_tool` is OFF by default
// (`CTRL_REVIEW_GATE=1` opt-in) until the PWA approval modal is wired —
// a blocking gate with no UI would hang every legitimate write for the
// timeout then deny, bricking normal operation. The mechanism + its
// trust boundary are testable now regardless of the flag.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio::sync::{broadcast, oneshot};

/// How long the gate waits for a human decision before defaulting to DENY
/// (fail-closed: no human ⇒ no high-blast action).
pub const REVIEW_TIMEOUT: Duration = Duration::from_secs(120);

/// A pending high-blast call awaiting human approval. Pushed to the PWA so
/// it can render an approve/deny modal. Everything here is gate-derived.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ReviewRequest {
    pub id: String,
    pub caller: String,
    pub tool: String,
    /// Gate-side summary of the structured args (capped) — the human reads
    /// THIS, never the caller's prose.
    pub arg_summary: String,
}

struct Pending {
    decided: oneshot::Sender<bool>,
    request: ReviewRequest,
}

pub struct ReviewGate {
    pending: Mutex<HashMap<String, Pending>>,
    /// Fan-out of new review requests to any PWA listener (Tauri-event
    /// forwarder subscribes in the supervisor).
    notify: broadcast::Sender<ReviewRequest>,
    seq: Mutex<u64>,
}

impl Default for ReviewGate {
    fn default() -> Self {
        Self::new()
    }
}

impl ReviewGate {
    pub fn new() -> Self {
        let (notify, _rx) = broadcast::channel(64);
        Self {
            pending: Mutex::new(HashMap::new()),
            notify,
            seq: Mutex::new(0),
        }
    }

    /// True when the enforcing path should run. Default ON now that the PWA
    /// approval modal ships — a high-blast EXTERNAL call pops a human confirm.
    /// Escape hatch `CTRL_REVIEW_GATE=0` disables it; always off in `test`
    /// builds so unit/integration tests never block on a human decision.
    pub fn enforcing() -> bool {
        if cfg!(test) {
            return false;
        }
        std::env::var("CTRL_REVIEW_GATE").as_deref() != Ok("0")
    }

    /// Subscribe to new review requests (PWA forwarder).
    pub fn subscribe(&self) -> broadcast::Receiver<ReviewRequest> {
        self.notify.subscribe()
    }

    /// Snapshot of currently-pending requests (for a PWA that connects late
    /// or polls).
    pub fn list_pending(&self) -> Vec<ReviewRequest> {
        self.pending
            .lock()
            .unwrap()
            .values()
            .map(|p| p.request.clone())
            .collect()
    }

    /// Register a pending review and return the receiver the caller awaits.
    /// Pushes the request to PWA listeners. The id is opaque + unguessable-
    /// enough for a local single-user trust model (monotonic seq is fine —
    /// the surface is intra-machine and the resolve path is first-party).
    pub fn request(&self, caller: &str, tool: &str, arg_summary: String) -> oneshot::Receiver<bool> {
        let id = {
            let mut s = self.seq.lock().unwrap();
            *s += 1;
            format!("rv-{}", *s)
        };
        let (tx, rx) = oneshot::channel();
        let request = ReviewRequest {
            id: id.clone(),
            caller: caller.to_string(),
            tool: tool.to_string(),
            arg_summary,
        };
        self.pending.lock().unwrap().insert(
            id,
            Pending {
                decided: tx,
                request: request.clone(),
            },
        );
        // Best-effort fan-out; a dropped notify just means the PWA learns of
        // it via list_pending instead.
        let _ = self.notify.send(request);
        rx
    }

    /// Resolve a pending review (the human's approve/deny, arriving via the
    /// Tauri command surface). Returns false if the id is unknown/already
    /// resolved. NOT reachable by the external MCP brain.
    pub fn resolve(&self, id: &str, approved: bool) -> bool {
        let pending = self.pending.lock().unwrap().remove(id);
        match pending {
            Some(p) => p.decided.send(approved).is_ok(),
            None => false,
        }
    }
}

/// Classify a gate tool by blast radius. High-blast = mutates user data,
/// deletes, runs a pack/command, or writes to the network. Read-only tools
/// (the vast majority: read/list/search/backlinks/status/describe/query)
/// pass through with no review (ADR-006 §4 — only high-blast is gated).
///
/// Deny-by-verb on the tool's leaf name so a newly-added mutating tool is
/// gated by default rather than silently slipping through an allowlist.
pub fn requires_review(tool_name: &str) -> bool {
    // Downstream tools are namespaced `<server>_<tool>`; match on the whole
    // name so e.g. `stock-cn_run` is caught too.
    let n = tool_name.to_ascii_lowercase();
    const MUTATING: &[&str] = &[
        "write", "delete", "remove", "rename", "append_row", "create",
        "update", "put", "post", "run", "exec", "install", "uninstall",
        "move", "drop", "send", "publish", "deploy",
        // §14 write verb — the generic connector write `source_produce` (and any
        // `<x>_produce`) is a side-effecting write that must pass review, same as
        // vault.write (ADR-002 §14.9 produce = Write through the gate).
        "produce",
        // Structure/schema writes — `smart_table_add_field` / `add_view` mutate
        // the table's shape (a write). All current `*_add_*` tools are writes.
        "add",
    ];
    // Read-ish tools that contain a mutating substring but are safe — keep a
    // tiny explicit exception list so the deny-by-verb default stays simple.
    const SAFE_EXCEPTIONS: &[&str] = &[
        "vault_broken_links", // "links" not "write"; defensive, no match anyway
    ];
    if SAFE_EXCEPTIONS.contains(&n.as_str()) {
        return false;
    }
    MUTATING.iter().any(|verb| n.contains(verb))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_blast_radius() {
        // High-blast: mutating verbs (first-party + downstream-namespaced).
        for t in [
            "vault_write",
            "vault_delete",
            "vault_rename",
            "smart_table_append_row",
            "mcp_pack_run",
            "http_post",
            "stock-cn_run",
            "github_create_issue",
            "source_produce", // §14 generic connector write
            "smart_table_produce", // §14.13 unified smart-table write verb
            "task_produce", // §14.13 unified task write verb
            "calendar_produce", // §14.13 unified calendar write verb
            "doc_produce", // §14.13 unified doc (block) write verb
            "mcp_pack_publish", // registry publish (has `publish`)
            "smart_table_delete_row", // record delete
            "smart_table_add_field", // schema write (add column)
            "smart_table_delete_field", // schema write (drop column)
            "smart_table_add_view", // structure write
        ] {
            assert!(requires_review(t), "{t} should require review");
        }
        // Read-only: pass through.
        for t in [
            "vault_read",
            "vault_list",
            "vault_search",
            "vault_backlinks",
            "vault_tags",
            "kernel_status",
            "vault_text_query",
            "market_quote",
            "http_get",
            "source_describe", // §14 read verbs — no review
            "source_query",
        ] {
            assert!(!requires_review(t), "{t} should NOT require review");
        }
    }

    #[tokio::test]
    async fn approve_lets_call_through() {
        let gate = ReviewGate::new();
        let rx = gate.request("claude-code", "vault_write", "path=notes/x.md".into());
        assert_eq!(gate.list_pending().len(), 1);
        // The id is the only pending one.
        let id = gate.list_pending()[0].id.clone();
        assert!(gate.resolve(&id, true));
        assert_eq!(rx.await.unwrap(), true);
        assert!(gate.list_pending().is_empty(), "resolved request is removed");
    }

    #[tokio::test]
    async fn deny_rejects_call() {
        let gate = ReviewGate::new();
        let rx = gate.request("claude-code", "vault_delete", "path=secret.md".into());
        let id = gate.list_pending()[0].id.clone();
        assert!(gate.resolve(&id, false));
        assert_eq!(rx.await.unwrap(), false);
    }

    #[tokio::test]
    async fn unknown_id_is_noop() {
        let gate = ReviewGate::new();
        assert!(!gate.resolve("rv-999", true), "unknown id resolves nothing");
    }

    #[tokio::test]
    async fn dropped_gate_fails_closed() {
        // If the pending sender is dropped without a decision (e.g. kernel
        // shutdown), the awaiting receiver errors → caller treats as DENY.
        let gate = ReviewGate::new();
        let rx = gate.request("x", "vault_write", "p".into());
        drop(gate); // sender dropped
        assert!(rx.await.is_err(), "dropped review must fail closed (deny)");
    }
}
