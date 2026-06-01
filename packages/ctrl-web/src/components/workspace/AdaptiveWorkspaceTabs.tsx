// AdaptiveWorkspaceTabs — renders a keycap's v3 workspace declaration.
//
// ADR-003 frontend §7.3 universal adaptive workspace: a keycap manifest declares
// `ui_surface.workspace.tabs[]`; this component is the **presentation
// shell** that turns that declaration into the NSWindow's interior.
//
// Scope of THIS file (intentionally minimal):
//   - Top tab bar (icon-free chip per tab, single-select).
//   - Active-tab content area — currently a placeholder; full
//     viewer-registry dispatch is the next PR (the registry expects a
//     `ViewerResource` with content-type / uri; mapping `tab.viewer`
//     to a synthetic resource needs a small adapter, not built yet).
//   - L2 sub-nav side-effect: when the active tab carries `l2_subnav`,
//     a `ctrl:l2-open` event fires so the shell root can flip
//     `[data-l2-open]` and reserve the L2 column.
//
// NOT in scope (next PR per ADR-003 frontend §7.5):
//   - Viewer dispatch (`tab.viewer` → ViewerHost / chat-stream / form).
//   - L2 sub-nav rendering inside the shell's L2 slot.
//   - NSWindow content router that picks WHICH keycap's tabs to mount.
//   - Tauri event bridge between NSWindow child and main window.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { WorkspaceTab } from '@ctrl/keycap-sdk';
import styles from './AdaptiveWorkspaceTabs.module.css';

interface AdaptiveWorkspaceTabsProps {
  /** Tab declarations from a keycap manifest's `ui_surface.workspace.tabs[]`. */
  tabs: ReadonlyArray<WorkspaceTab>;
  /** Initial active tab id. Defaults to `tabs[0].id`. */
  initialActiveId?: string;
  /** Fires when the user switches tabs; useful for keycap-side state sync. */
  onActiveChange?: (tabId: string) => void;
}

const L2_OPEN_EVENT = 'ctrl:l2-open';

export const AdaptiveWorkspaceTabs = ({
  tabs,
  initialActiveId,
  onActiveChange,
}: AdaptiveWorkspaceTabsProps): ReactElement => {
  const firstTabId = tabs[0]?.id ?? '';
  const [activeId, setActiveId] = useState<string>(initialActiveId ?? firstTabId);

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const handleSwitch = useCallback(
    (id: string) => {
      setActiveId(id);
      onActiveChange?.(id);
    },
    [onActiveChange],
  );

  // L2 sub-nav signal: shell listens on `window` and flips `[data-l2-open]`
  // on the root. Detached on unmount so the L2 slot collapses cleanly.
  useEffect(() => {
    const hasL2 = !!activeTab?.l2_subnav && activeTab.l2_subnav.length > 0;
    window.dispatchEvent(
      new CustomEvent(L2_OPEN_EVENT, {
        detail: {
          open: hasL2,
          items: activeTab?.l2_subnav ?? [],
        },
      }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent(L2_OPEN_EVENT, { detail: { open: false, items: [] } }),
      );
    };
  }, [activeTab]);

  if (tabs.length === 0) {
    return (
      <div className={styles.empty} role="status">
        No workspace tabs declared.
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.tabBar} role="tablist" aria-label="Workspace tabs">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              className={styles.tab}
              data-active={isActive || undefined}
              aria-selected={isActive}
              onClick={() => handleSwitch(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div
        className={styles.content}
        role="tabpanel"
        aria-labelledby={activeTab?.id}
      >
        {activeTab ? (
          <div className={styles.placeholder}>
            <div className={styles.placeholderTitle}>{activeTab.label}</div>
            <div className={styles.placeholderMeta}>
              viewer: <code>{activeTab.viewer}</code>
              {activeTab.l2_subnav && activeTab.l2_subnav.length > 0 ? (
                <span className={styles.placeholderHint}>
                  {' '}
                  · L2 sub-nav: {activeTab.l2_subnav.length} item
                  {activeTab.l2_subnav.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <div className={styles.placeholderBody}>
              Viewer dispatch lands in the next PR — see ADR-003 frontend §7.5.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
