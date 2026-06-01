// workspace-store — multi-instance workspace state.
//
// A "workspace" here is an INSTANCE: a bundle of tabs + layout spawned
// from a keycap (or blank). Multiple instances coexist; the user
// switches between them with the InstanceSwitcher pill row, and each
// instance owns its own tab tree, active tab, and layout.
//
// Tabs themselves still use the BaseTab / Tab / TabKind contracts from
// `tab-store.ts` — no need to invent a parallel taxonomy. The old
// `useTabStore` is preserved for the constants it exports but its store
// value is no longer the source of truth for workspace tabs.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Tab } from './tab-store';
import {
  deriveShape,
  inferKindFromId,
  type KeycapKind,
  type WorkspaceLayout,
} from './workspace-shape';

export interface WorkspaceInstance {
  id: string;
  /** Keycap that drove createFromKeycap; null = blank instance. */
  keycapId: string | null;
  /** Cached kind for badge / overrides without re-deriving every render. */
  kind: KeycapKind;
  title: string;
  layout: WorkspaceLayout;
  tabs: Tab[];
  activeTabId: string | null;
  /** ms timestamp — drives LRU ordering in the switcher. */
  lastActivatedAt: number;
  /** If duplicated, points back to the source instance (PlayCanvas FORK). */
  forkedFrom?: string;
}

interface WorkspaceStoreState {
  instances: WorkspaceInstance[];
  activeInstanceId: string | null;

  /** Spawn an instance from a keycap. Idempotent on (keycapId): clicking
   *  the same keycap again focuses the existing instance rather than
   *  duplicating. Use `duplicateInstance` to explicitly fork. */
  createFromKeycap: (keycap: { id: string; name: string }) => WorkspaceInstance;

  /** Spawn an empty instance — for a future "Create blank workspace"
   *  affordance. Not surfaced in v1 UI but the API ships now so the
   *  3-rail (Blank / Template / Import) modal lands trivially later. */
  createBlank: (title?: string) => WorkspaceInstance;

  /** Fork an existing instance — clones its tabs + layout, retains a
   *  `forkedFrom` backlink. Per PlayCanvas FORK pattern. */
  duplicateInstance: (id: string) => WorkspaceInstance | null;

  activateInstance: (id: string) => void;
  closeInstance: (id: string) => void;
  renameInstance: (id: string, title: string) => void;

  /** Open a tab inside a specific instance (or the active one if omitted). */
  openTab: (tab: Tab, opts?: { instanceId?: string; activate?: boolean }) => void;
  closeTab: (instanceId: string, tabId: string) => void;
  activateTab: (instanceId: string, tabId: string) => void;
  renameTab: (instanceId: string, tabId: string, title: string) => void;

  /** Wipe everything (dev / first-run reset). */
  reset: () => void;

  /** Open a tab in the singleton "system" instance (Settings / Pool /
   *  Vault / etc. — non-keycap routes invoked from L1). The system
   *  instance is created on first call with layout = `tabs` so the
   *  TabBar shows even with a single tab. Idempotent on tab.id. */
  openSystemTab: (tab: Tab) => void;
}

const initial: Pick<WorkspaceStoreState, 'instances' | 'activeInstanceId'> = {
  instances: [],
  activeInstanceId: null,
};

const now = (): number => Date.now();

const newId = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}_${now().toString(36)}`;

const spawnTabsFromShape = (
  shape: ReturnType<typeof deriveShape>,
  keycapId: string | null,
): Tab[] =>
  shape.tabs.map((spec, idx): Tab => {
    const tabId = newId('tab');
    const base = { id: tabId, title: spec.title, kind: spec.kind } as const;
    switch (spec.kind) {
      case 'keycap-output':
        return {
          ...base,
          kind: 'keycap-output',
          keycapId: keycapId ?? 'blank',
          invocationId: newId('inv'),
        };
      case 'session-stream':
        return {
          ...base,
          kind: 'session-stream',
          streamId: keycapId ? `keycap-${keycapId}` : `blank-${idx}`,
        };
      case 'external-embed':
        return { ...base, kind: 'external-embed', url: 'about:blank' };
      case 'vault-md':
        return { ...base, kind: 'vault-md', vaultPath: '' };
      case 'route':
        return { ...base, kind: 'route', path: '/' };
    }
  });

export const useWorkspaceStore = create<WorkspaceStoreState>()(
  persist(
    (set, get) => ({
      ...initial,

      createFromKeycap: (keycap) => {
        // Idempotent: same keycap → focus existing instance.
        const existing = get().instances.find(
          (i) => i.keycapId === keycap.id,
        );
        if (existing) {
          set((s) => ({
            activeInstanceId: existing.id,
            instances: s.instances.map((i) =>
              i.id === existing.id ? { ...i, lastActivatedAt: now() } : i,
            ),
          }));
          return existing;
        }
        const kind = inferKindFromId(keycap.id);
        const shape = deriveShape(keycap.id);
        const tabs = spawnTabsFromShape(shape, keycap.id);
        const inst: WorkspaceInstance = {
          id: newId('ws'),
          keycapId: keycap.id,
          kind,
          title: keycap.name,
          layout: shape.layout,
          tabs,
          activeTabId: tabs[0]?.id ?? null,
          lastActivatedAt: now(),
        };
        set((s) => ({
          instances: [...s.instances, inst],
          activeInstanceId: inst.id,
        }));
        return inst;
      },

      createBlank: (title = 'Untitled') => {
        const inst: WorkspaceInstance = {
          id: newId('ws'),
          keycapId: null,
          kind: 'builtin',
          title,
          layout: 'single',
          tabs: [],
          activeTabId: null,
          lastActivatedAt: now(),
        };
        set((s) => ({
          instances: [...s.instances, inst],
          activeInstanceId: inst.id,
        }));
        return inst;
      },

      duplicateInstance: (id) => {
        const source = get().instances.find((i) => i.id === id);
        if (!source) return null;
        // Deep-clone tabs with fresh ids so closing one in the dup
        // doesn't affect the source.
        const tabs: Tab[] = source.tabs.map((t) => ({
          ...t,
          id: newId('tab'),
        }));
        const dup: WorkspaceInstance = {
          ...source,
          id: newId('ws'),
          tabs,
          activeTabId: tabs[0]?.id ?? null,
          lastActivatedAt: now(),
          forkedFrom: source.id,
          title: `${source.title} (copy)`,
        };
        set((s) => ({
          instances: [...s.instances, dup],
          activeInstanceId: dup.id,
        }));
        return dup;
      },

      activateInstance: (id) => {
        if (!get().instances.find((i) => i.id === id)) return;
        set((s) => ({
          activeInstanceId: id,
          instances: s.instances.map((i) =>
            i.id === id ? { ...i, lastActivatedAt: now() } : i,
          ),
        }));
      },

      closeInstance: (id) => {
        set((s) => {
          const idx = s.instances.findIndex((i) => i.id === id);
          if (idx < 0) return {};
          const next = s.instances.filter((i) => i.id !== id);
          let active = s.activeInstanceId;
          if (active === id) {
            active = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
          }
          return { instances: next, activeInstanceId: active };
        });
      },

      renameInstance: (id, title) => {
        set((s) => ({
          instances: s.instances.map((i) =>
            i.id === id ? { ...i, title } : i,
          ),
        }));
      },

      openTab: (tab, opts = {}) => {
        const { instanceId, activate = true } = opts;
        set((s) => {
          const targetId = instanceId ?? s.activeInstanceId;
          if (!targetId) return {};
          return {
            instances: s.instances.map((i) => {
              if (i.id !== targetId) return i;
              const existing = i.tabs.findIndex((t) => t.id === tab.id);
              if (existing >= 0) {
                return {
                  ...i,
                  activeTabId: activate ? tab.id : i.activeTabId,
                };
              }
              return {
                ...i,
                tabs: [...i.tabs, tab],
                activeTabId: activate ? tab.id : i.activeTabId,
              };
            }),
          };
        });
      },

      closeTab: (instanceId, tabId) => {
        set((s) => ({
          instances: s.instances.map((i) => {
            if (i.id !== instanceId) return i;
            const idx = i.tabs.findIndex((t) => t.id === tabId);
            if (idx < 0) return i;
            const next = i.tabs.filter((t) => t.id !== tabId);
            let activeTabId = i.activeTabId;
            if (activeTabId === tabId) {
              activeTabId = next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
            }
            return { ...i, tabs: next, activeTabId };
          }),
        }));
      },

      activateTab: (instanceId, tabId) => {
        set((s) => ({
          instances: s.instances.map((i) =>
            i.id === instanceId && i.tabs.some((t) => t.id === tabId)
              ? { ...i, activeTabId: tabId }
              : i,
          ),
        }));
      },

      renameTab: (instanceId, tabId, title) => {
        set((s) => ({
          instances: s.instances.map((i) =>
            i.id === instanceId
              ? {
                  ...i,
                  tabs: i.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
                }
              : i,
          ),
        }));
      },

      reset: () => set(initial),

      openSystemTab: (tab) => {
        const SYSTEM_INSTANCE_ID = 'ws-system';
        set((s) => {
          const existing = s.instances.find((i) => i.id === SYSTEM_INSTANCE_ID);
          if (!existing) {
            const inst: WorkspaceInstance = {
              id: SYSTEM_INSTANCE_ID,
              keycapId: null,
              kind: 'builtin',
              title: 'System',
              layout: 'tabs',
              tabs: [tab],
              activeTabId: tab.id,
              lastActivatedAt: now(),
            };
            return {
              instances: [...s.instances, inst],
              activeInstanceId: SYSTEM_INSTANCE_ID,
            };
          }
          // Idempotent on tab.id — re-activate existing tab.
          const hasTab = existing.tabs.some((t) => t.id === tab.id);
          const nextTabs = hasTab ? existing.tabs : [...existing.tabs, tab];
          return {
            instances: s.instances.map((i) =>
              i.id === SYSTEM_INSTANCE_ID
                ? { ...i, tabs: nextTabs, activeTabId: tab.id, lastActivatedAt: now() }
                : i,
            ),
            activeInstanceId: SYSTEM_INSTANCE_ID,
          };
        });
      },
    }),
    {
      name: 'ctrl-workspace-store',
      // bao 2026-06-01 BUG 2 fix: bump version so v0.1.131 boots with
      // an empty store. Stale `instances` from older sessions were
      // flipping `data-workspace-open='true'` immediately, which made
      // the 4-col grid require ~800px of width — at the compact 430px
      // window size the grid collapsed and the StatusBar / version pill
      // were clipped offscreen ("can't see version"). Future schema
      // changes should bump this too.
      version: 2,
      partialize: (s) => ({
        instances: s.instances,
        activeInstanceId: s.activeInstanceId,
      }),
      migrate: (_persisted, version) => {
        // Any pre-v2 payload is discarded — earlier sessions wrote
        // partially-typed instances that no longer match the contract.
        if (version < 2) return { instances: [], activeInstanceId: null };
        const p = _persisted as Partial<WorkspaceStoreState>;
        return {
          instances: p.instances ?? [],
          activeInstanceId: p.activeInstanceId ?? null,
        };
      },
    },
  ),
);

/** Convenience selector: the active instance, or null. */
export const useActiveInstance = (): WorkspaceInstance | null =>
  useWorkspaceStore((s) =>
    s.instances.find((i) => i.id === s.activeInstanceId) ?? null,
  );
