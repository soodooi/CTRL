// Workspace tab store — the multi-tab persistent work surface that
// makes CTRL feel like a workshop (Cursor / Figma / Notion), not a
// chat shell. Per decision_ctrl_is_hermes_workbench.md (2026-05-22).
//
// Each tab declares its `kind` (discriminated union) so the workspace
// renderer can pick the right view component. Tab list persists to
// localStorage so a window restart restores the last session.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Icon } from './icon';

export type TabKind =
  | 'external-embed' // iframe pointing at e.g. hermes dashboard
  | 'vault-md' // markdown doc from the user's vault
  | 'keycap-output' // output surface for an invoked keycap
  | 'session-stream' // live stream (chat / code-space env)
  | 'route'; // wrap an existing route component until that surface migrates

export interface BaseTab {
  id: string;
  kind: TabKind;
  title: string;
  // Per-tab icon override. `string` = glyph char (legacy); `Icon` = full
  // discriminated union (glyph / svg / lottie / dotlottie). When omitted
  // the TabBar falls back to a kind-specific default.
  icon?: string | Icon;
}

export interface ExternalEmbedTab extends BaseTab {
  kind: 'external-embed';
  url: string;
}
export interface VaultMdTab extends BaseTab {
  kind: 'vault-md';
  vaultPath: string;
}
export interface KeycapOutputTab extends BaseTab {
  kind: 'keycap-output';
  keycapId: string;
  invocationId: string;
}
export interface SessionStreamTab extends BaseTab {
  kind: 'session-stream';
  streamId: string;
}
export interface RouteTab extends BaseTab {
  kind: 'route';
  path: string;
}

export type Tab =
  | ExternalEmbedTab
  | VaultMdTab
  | KeycapOutputTab
  | SessionStreamTab
  | RouteTab;

interface TabStoreState {
  tabs: ReadonlyArray<Tab>;
  activeId: string | null;
  openTab: (tab: Tab, opts?: { activate?: boolean; replaceById?: string }) => void;
  closeTab: (id: string) => void;
  activateTab: (id: string) => void;
  renameTab: (id: string, title: string) => void;
  reset: () => void;
}

const initial: Pick<TabStoreState, 'tabs' | 'activeId'> = {
  tabs: [],
  activeId: null,
};

export const useTabStore = create<TabStoreState>()(
  persist(
    (set, get) => ({
      ...initial,
      openTab: (tab, opts = {}) => {
        const { activate = true, replaceById } = opts;
        set((s) => {
          const next = [...s.tabs];
          // Idempotency: if a tab with the same id already exists, just
          // re-activate it (don't create a duplicate).
          const existingIdx = next.findIndex((t) => t.id === tab.id);
          if (existingIdx >= 0) {
            return {
              tabs: next,
              activeId: activate ? tab.id : s.activeId,
            };
          }
          if (replaceById) {
            const replaceIdx = next.findIndex((t) => t.id === replaceById);
            if (replaceIdx >= 0) {
              next[replaceIdx] = tab;
              return {
                tabs: next,
                activeId: activate ? tab.id : s.activeId,
              };
            }
          }
          next.push(tab);
          return {
            tabs: next,
            activeId: activate ? tab.id : s.activeId,
          };
        });
      },
      closeTab: (id) => {
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx < 0) return {};
          const next = s.tabs.filter((t) => t.id !== id);
          let activeId = s.activeId;
          if (activeId === id) {
            // Activate the sibling on the left if available, otherwise right.
            activeId =
              next[Math.max(0, idx - 1)]?.id ?? next[0]?.id ?? null;
          }
          return { tabs: next, activeId };
        });
      },
      activateTab: (id) => {
        if (!get().tabs.find((t) => t.id === id)) return;
        set({ activeId: id });
      },
      renameTab: (id, title) => {
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
        }));
      },
      reset: () => set(initial),
    }),
    {
      name: 'ctrl-tab-store',
      // Persist only the shape — function references are recreated on hydration.
      partialize: (s) => ({ tabs: s.tabs, activeId: s.activeId }),
    },
  ),
);

/** Stable id for the Hermes settings embed tab — opening it twice
 *  should focus the existing tab, not duplicate. */
export const HERMES_SETTINGS_TAB_ID = 'hermes-settings';

/** Default URL for the local hermes dashboard. Replaced at runtime by
 *  kernel_status.hermes_dashboard_url once Zeus ships that field. */
export const HERMES_DASHBOARD_DEFAULT_URL = 'http://127.0.0.1:9119';
