// WorkspaceTabs — picks the right view per tab kind. When no tabs are
// open the consumer renders a fallback (Irisy idle, recent docs, etc).
//
// MVP supports `external-embed` only; the other kinds (vault-md /
// keycap-output / session-stream / route) render a placeholder so the
// tab system itself is testable today without waiting on every view.

import type { ReactElement, ReactNode } from 'react';
import { useTabStore, type Tab } from '@/lib/tab-store';
import { TabBar } from '@/components/TabBar';
import { EmbedView } from './EmbedView';
import styles from './WorkspaceTabs.module.css';

interface WorkspaceTabsProps {
  /** Rendered when there are no open tabs. */
  fallback: ReactNode;
}

const renderTab = (tab: Tab): ReactElement => {
  switch (tab.kind) {
    case 'external-embed':
      return <EmbedView url={tab.url} label={tab.title} />;
    case 'vault-md':
    case 'keycap-output':
    case 'session-stream':
    case 'route':
      return (
        <div className={styles.unknown}>
          {tab.kind} view · not yet implemented
        </div>
      );
  }
};

export const WorkspaceTabs = ({ fallback }: WorkspaceTabsProps): ReactElement => {
  const tabs = useTabStore((s) => s.tabs);
  const activeId = useTabStore((s) => s.activeId);
  const active = tabs.find((t) => t.id === activeId) ?? null;

  if (tabs.length === 0) {
    return <div className={styles.shell}>{fallback}</div>;
  }

  return (
    <div className={styles.shell}>
      <TabBar tabs={tabs} activeId={activeId} />
      <div className={styles.body}>
        {active ? renderTab(active) : null}
      </div>
    </div>
  );
};
