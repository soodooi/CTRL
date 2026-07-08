// Remote-window config — which functions a remotely-connected phone may see,
// and whether it can act or only view (ADR-005 §2 remote co-view + ADR-004 §1
// capability-scoping). v1 persists client-side (localStorage); the kernel-side
// ACL that ENFORCES this for a remote session lands in a later slice (S4). Kept
// swappable behind load/save so that migration is a one-file change.
//
// Design/plan: vault/ctrl/plan-remote-window.md (option B, bao 2026-07-07).

/** Per-function remote permission. `visible` = shows in the phone's bottom nav;
 *  `canAct` = the phone may trigger writes/actions (else read-only view). */
export interface RemotePerm {
  visible: boolean;
  canAct: boolean;
}

export interface RemoteConfig {
  /** Keyed by function key (builtin face key or `pack.<id>`). */
  entries: Record<string, RemotePerm>;
}

const STORAGE_KEY = 'ctrl.remote.config.v1';

export function loadRemoteConfig(): RemoteConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw != null) return JSON.parse(raw) as RemoteConfig;
  } catch {
    // fall through to default
  }
  return { entries: {} };
}

export function saveRemoteConfig(cfg: RemoteConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // best-effort; a private-mode phone just loses the preference
  }
}

/** Resolve the effective permission for a function, applying defaults: a
 *  function is visible by default and view-only until the user grants actions. */
export function permFor(cfg: RemoteConfig, key: string): RemotePerm {
  return cfg.entries[key] ?? { visible: true, canAct: false };
}

export function withPerm(cfg: RemoteConfig, key: string, patch: Partial<RemotePerm>): RemoteConfig {
  const cur = permFor(cfg, key);
  return { entries: { ...cfg.entries, [key]: { ...cur, ...patch } } };
}
