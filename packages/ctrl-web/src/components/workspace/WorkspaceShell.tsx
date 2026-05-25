// WorkspaceShell — replaces the old single-instance WorkspaceTabs with
// a multi-instance shell: InstanceSwitcher on top, TabBar per active
// instance below, instance's active tab content fills the body.
//
// Empty state: when no instance is open (first run or after closing
// the last one), shows a neutral "drop a keycap here" hint. Drag handler
// for the drop is wired one level up in app.tsx so the entire workspace
// area is a valid target, not just this rectangle.

import type { ReactElement, ReactNode } from 'react';
import { useCallback } from 'react';
import { useWorkspaceStore } from '@/lib/workspace-store';
import type { Tab } from '@/lib/tab-store';
import { TabBar } from '@/components/TabBar';
import { InstanceSwitcher } from './InstanceSwitcher';
import { EmbedView } from './EmbedView';
import styles from './WorkspaceShell.module.css';

interface WorkspaceShellProps {
  /** Rendered when no instance is open. Caller passes the cockpit's
   *  idle hint (mascot + greeting) so the empty state stays branded. */
  fallback: ReactNode;
}

const renderTabBody = (tab: Tab): ReactElement => {
  switch (tab.kind) {
    case 'external-embed':
      return <EmbedView url={tab.url} label={tab.title} />;
    case 'vault-md':
      return (
        <div className={styles.placeholder}>
          <span className={styles.placeholderKind}>vault-md</span>
          <span className={styles.placeholderPath}>{tab.vaultPath || '—'}</span>
          <p className={styles.placeholderHint}>
            Markdown viewer wires through the viewer registry — implementation
            lands when Tiptap module is added (see <code>lib/viewer-registry.ts</code>).
          </p>
        </div>
      );
    case 'keycap-output':
      return (
        <div className={styles.placeholder}>
          <span className={styles.placeholderKind}>keycap-output</span>
          <span className={styles.placeholderPath}>{tab.keycapId}</span>
          <p className={styles.placeholderHint}>
            Invocation output renders here once the kernel emits cells for
            invocation <code>{tab.invocationId}</code>.
          </p>
        </div>
      );
    case 'session-stream':
      return (
        <div className={styles.placeholder}>
          <span className={styles.placeholderKind}>session-stream</span>
          <span className={styles.placeholderPath}>{tab.streamId}</span>
          <p className={styles.placeholderHint}>
            Live cell stream — connects via <code>useCellStream({tab.streamId})</code>{' '}
            when the stream view module lands.
          </p>
        </div>
      );
    case 'route':
      return (
        <div className={styles.placeholder}>
          <span className={styles.placeholderKind}>route</span>
          <span className={styles.placeholderPath}>{tab.path}</span>
        </div>
      );
  }
};

export const WorkspaceShell = ({ fallback }: WorkspaceShellProps): ReactElement => {
  const instances = useWorkspaceStore((s) => s.instances);
  const activeId = useWorkspaceStore((s) => s.activeInstanceId);
  const activateTab = useWorkspaceStore((s) => s.activateTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  const active = instances.find((i) => i.id === activeId) ?? null;

  const handleActivate = useCallback(
    (tabId: string) => {
      if (!active) return;
      activateTab(active.id, tabId);
    },
    [active, activateTab],
  );
  const handleClose = useCallback(
    (tabId: string) => {
      if (!active) return;
      closeTab(active.id, tabId);
    },
    [active, closeTab],
  );

  if (instances.length === 0 || !active) {
    return <div className={styles.shell}>{fallback}</div>;
  }

  const activeTab = active.tabs.find((t) => t.id === active.activeTabId) ?? null;

  return (
    <div className={styles.shell}>
      <InstanceSwitcher />
      {active.layout !== 'single' && (
        <TabBar
          tabs={active.tabs}
          activeId={active.activeTabId}
          onActivate={handleActivate}
          onClose={handleClose}
        />
      )}
      <div className={styles.body}>
        {activeTab ? (
          renderTabBody(activeTab)
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.placeholderKind}>empty instance</span>
            <p className={styles.placeholderHint}>
              No tabs in this workspace yet. Drag a keycap from the left rail
              to add one.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
