// AdaptiveWorkspaceTabs — renders a mcp's workspace tab declaration.
//
// ADR-003 frontend §8.2 (morph-to-output-type via the content-type viewer
// registry) + §7.1 Tab column: a mcp manifest declares
// `ui_surface.workspace.tabs[]`; this component is the **presentation shell**
// that turns that declaration into the Tab column's interior — capability-
// agnostic, no per-pack code.
//
// Scope of THIS file:
//   - Top tab bar (icon-free chip per tab, single-select).
//   - Active-tab content dispatch: `tab.viewer` + `tab.props.uri` are adapted
//     to a `ViewerResource` (see ./AdaptiveWorkspaceTabs.dispatch) and rendered
//     through the content-type viewer registry (markdown / code / json / yaml /
//     toml / html / svg / mermaid / image / pdf / smart-table / fallback). One
//     declaration → a real multi-tab frontend.
//   - L2 sub-nav side-effect: when the active tab carries `l2_subnav`,
//     a `ctrl:l2-open` event fires so the shell root can flip
//     `[data-l2-open]` and reserve the L2 column (§7.1 L2 column).
//
// NOT in scope (follow-up):
//   - Interactive WorkspaceUi kinds inside a tab (chat-stream streaming /
//     form / picker / canvas) — these are the §8.2 agent-workspace stream
//     path, not the content viewer registry; they render a labelled fallback
//     for now.
//   - L2 sub-nav rendering inside the shell's L2 slot.
//   - The router that picks WHICH mcp's tabs to mount in the Tab column.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react';
import type { WorkspaceTab } from '@ctrl/mcp-sdk';
import { ViewerHost } from '@/components/viewers/ViewerHost';
import {
  INTERACTIVE_VIEWERS,
  tabToResource,
} from './AdaptiveWorkspaceTabs.dispatch';
import styles from './AdaptiveWorkspaceTabs.module.css';

interface AdaptiveWorkspaceTabsProps {
  /** Tab declarations from a mcp manifest's `ui_surface.workspace.tabs[]`. */
  tabs: ReadonlyArray<WorkspaceTab>;
  /** Initial active tab id. Defaults to `tabs[0].id`. */
  initialActiveId?: string;
  /** Fires when the user switches tabs; useful for mcp-side state sync. */
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
  // Adapt the active tab to a content resource; null when there's nothing to
  // render through the registry (interactive kind, or no props.uri declared).
  const resource = useMemo(
    () => (activeTab ? tabToResource(activeTab) : null),
    [activeTab],
  );

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
        className={resource ? styles.contentFlush : styles.content}
        role="tabpanel"
        aria-labelledby={activeTab?.id}
      >
        {resource ? (
          <ViewerHost resource={resource} />
        ) : activeTab ? (
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
              {INTERACTIVE_VIEWERS.has(activeTab.viewer)
                ? `"${activeTab.viewer}" is an interactive surface — streaming / form rendering inside tabs is a follow-up. Content viewers (markdown / json / smart-table / …) render here when the tab declares a props.uri source.`
                : 'No content source. Declare props.uri (e.g. a vault:// path) on this tab to render it through the viewer registry.'}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
