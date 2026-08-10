//! One process-wide per-file write lock registry for vault content.
//!
//! Two independent registries would not serialize against each other: a legacy
//! bespoke vault write and a canonical `produce` on the SAME file could both
//! pass their revision checks, and the canonical rollback could then revert
//! content the legacy writer had already committed. Every writer that mutates a
//! vault file must take the guard from here, keyed by the vault-relative path.
//!
//! (ADR-002 substrate §15.2 v87 clause 7)

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, OnceLock},
};

type Registry = Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>;

fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Normalize to one key per file so `a/b.md` and `./a/b.md` cannot take
/// different locks for the same content.
fn key(path: &str) -> String {
    path.split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/")
}

/// The lock for one vault-relative path. Hold the guard across the whole
/// read-modify-write, including any rollback.
pub fn for_path(path: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = registry().lock().unwrap_or_else(|error| error.into_inner());
    Arc::clone(map.entry(key(path)).or_default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn equivalent_paths_share_one_lock() {
        let direct = for_path("daily/today.md");
        let dotted = for_path("./daily/today.md");
        let doubled = for_path("daily//today.md");
        assert!(Arc::ptr_eq(&direct, &dotted));
        assert!(Arc::ptr_eq(&direct, &doubled));
    }

    #[test]
    fn different_files_do_not_share_a_lock() {
        assert!(!Arc::ptr_eq(&for_path("a.md"), &for_path("b.md")));
    }

    #[tokio::test]
    async fn the_guard_serializes_writers_on_one_path() {
        let lock = for_path("serialize.md");
        let guard = lock.lock().await;
        let contended = Arc::clone(&lock);
        let waiter = tokio::spawn(async move {
            let _second = contended.lock().await;
            true
        });
        assert!(!waiter.is_finished(), "the second writer must wait");
        drop(guard);
        assert!(waiter.await.expect("waiter"));
    }
}
