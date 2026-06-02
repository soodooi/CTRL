// kernel::vault_watch — filesystem watcher for the vault root.
//
// (ADR-002 substrate § vault v1 §8.3 #21, 2026-06-01 — memory
// `decision_vault_adr_002_section_8`.)
//
// Backs the Sourcing trigger path "vault/sourcing/ ≥ N items" by
// streaming filesystem events through a bounded ring buffer. Frontend
// polls `vault_watch_recent(since_ms)` from the Irisy schedule loop.
// True streaming (Tauri channel push) is a follow-up — polling first
// keeps the trigger surface minimal and verifiable.
//
// Per memory `feedback_reuse_existing_capability_first`, the watcher
// itself is the only new dependency (`notify = 8`); event storage uses
// `std::collections::VecDeque` + `std::sync::Mutex`, no extra channel
// abstraction.

use std::collections::VecDeque;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

/// Ring buffer capacity. ~1024 events spans a full Sourcing morning
/// burst (one cron tick) without dropping. When the buffer fills, the
/// oldest entries get evicted — frontend polls every few seconds so
/// drops are rare.
const RING_CAPACITY: usize = 1024;

#[derive(Debug, Clone, Serialize)]
pub struct EventEntry {
    pub path: String,
    pub kind: EventKindLabel,
    pub ts_ms: i64,
}

/// Stable serialization label. `notify::EventKind` is too granular and
/// platform-specific to expose verbatim across the Tauri IPC boundary;
/// callers care only about create/modify/remove for trigger purposes.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKindLabel {
    Create,
    Modify,
    Remove,
    Other,
}

#[derive(Debug, Clone, thiserror::Error)]
pub enum WatchError {
    #[error("watch: {0}")]
    Notify(String),
}

struct WatchState {
    buffer: Mutex<VecDeque<EventEntry>>,
    /// Holding the watcher inside state keeps it alive for the process.
    /// Dropping it would stop event delivery.
    _watcher: RecommendedWatcher,
    vault_root: std::path::PathBuf,
}

static STATE: OnceLock<WatchState> = OnceLock::new();

/// Start the watcher rooted at `vault_root`. Idempotent — second call
/// is a no-op even with a different root (first call wins). Callers
/// changing the vault root must restart the kernel.
///
/// `STATE.set` is called inside an early-return guard rather than via
/// `get_or_init` because the `RecommendedWatcher` constructor itself
/// is fallible — `get_or_init` cannot propagate that error cleanly.
/// The race between two concurrent starts is benign (both end up
/// watching the same root) but we log the loser instead of silently
/// dropping it so a future second-root attempt is visible in logs.
pub fn start(vault_root: &Path) -> Result<(), WatchError> {
    if STATE.get().is_some() {
        return Ok(());
    }
    let buffer: Mutex<VecDeque<EventEntry>> = Mutex::new(VecDeque::with_capacity(RING_CAPACITY));
    let root_clone = vault_root.to_path_buf();
    let mut watcher: RecommendedWatcher = notify::recommended_watcher(
        move |res: Result<Event, notify::Error>| match res {
            Ok(ev) => push_event(&ev, &root_clone),
            Err(e) => tracing::warn!(error = %e, "vault_watch: watcher error"),
        },
    )
    .map_err(|e| WatchError::Notify(e.to_string()))?;
    watcher
        .watch(vault_root, RecursiveMode::Recursive)
        .map_err(|e| WatchError::Notify(e.to_string()))?;

    let state = WatchState {
        buffer,
        _watcher: watcher,
        vault_root: vault_root.to_path_buf(),
    };
    if STATE.set(state).is_err() {
        tracing::warn!(
            root = %vault_root.display(),
            "vault_watch: race lost — another watcher started first; dropping new instance",
        );
        return Ok(());
    }
    tracing::info!(root = %vault_root.display(), "vault_watch: started");
    Ok(())
}

/// Recent events since `since_ms` (Unix epoch milliseconds), optionally
/// filtered to those whose vault-relative path starts with `prefix`.
/// Returns up to RING_CAPACITY entries in arrival order.
pub fn recent(prefix: Option<&str>, since_ms: i64) -> Vec<EventEntry> {
    let Some(state) = STATE.get() else {
        return Vec::new();
    };
    // Recover poisoned mutex rather than swallow it — a panic in the
    // watcher callback poisons the mutex but the inner buffer is
    // still consistent. Logging the recovery surfaces the underlying
    // panic without taking the watcher silently offline forever.
    let buf = match state.buffer.lock() {
        Ok(b) => b,
        Err(p) => {
            tracing::warn!("vault_watch: ring buffer mutex was poisoned, recovering");
            p.into_inner()
        }
    };
    buf.iter()
        .filter(|e| e.ts_ms >= since_ms)
        .filter(|e| match prefix {
            Some(p) if !p.is_empty() => e.path.starts_with(p),
            _ => true,
        })
        .cloned()
        .collect()
}

fn push_event(ev: &Event, root: &Path) {
    let Some(state) = STATE.get() else { return };
    let kind = label_for(ev.kind);
    let ts_ms = now_ms();
    let mut entries: Vec<EventEntry> = Vec::new();
    for full in &ev.paths {
        let rel = match full.strip_prefix(root) {
            Ok(r) => r.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };
        if rel.starts_with(".ctrl/") || rel.starts_with(".git/") {
            // Internal CTRL state churns frequently — don't trigger
            // Sourcing routines on our own writes.
            continue;
        }
        entries.push(EventEntry {
            path: rel,
            kind,
            ts_ms,
        });
    }
    if entries.is_empty() {
        return;
    }
    let mut buf = match state.buffer.lock() {
        Ok(b) => b,
        Err(p) => {
            tracing::warn!("vault_watch: push_event recovering poisoned mutex");
            p.into_inner()
        }
    };
    for e in entries {
        if buf.len() == RING_CAPACITY {
            buf.pop_front();
        }
        buf.push_back(e);
    }
}

fn label_for(kind: EventKind) -> EventKindLabel {
    match kind {
        EventKind::Create(_) => EventKindLabel::Create,
        EventKind::Modify(_) => EventKindLabel::Modify,
        EventKind::Remove(_) => EventKindLabel::Remove,
        _ => EventKindLabel::Other,
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
