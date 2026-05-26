// WorkspaceShell — replaces the old single-instance WorkspaceTabs with
// a multi-instance shell: InstanceSwitcher on top, TabBar per active
// instance below, instance's active tab content fills the body.
//
// Empty state: when no instance is open (first run or after closing
// the last one), shows a neutral "drop a keycap here" hint. Drag handler
// for the drop is wired one level up in app.tsx so the entire workspace
// area is a valid target, not just this rectangle.

import type { ReactElement, ReactNode } from 'react';
import { Suspense, createElement, useCallback } from 'react';
import { useWorkspaceStore } from '@/lib/workspace-store';
import type { Tab } from '@/lib/tab-store';
import { TabBar } from '@/components/TabBar';
import { InstanceSwitcher } from './InstanceSwitcher';
import { EmbedView } from './EmbedView';
import { resolveViewer, type ViewerResource } from '@/lib/viewer-registry';
import { vaultUri } from '@/lib/viewer-uri';
import styles from './WorkspaceShell.module.css';

interface WorkspaceShellProps {
  /** Rendered when no instance is open. Caller passes the cockpit's
   *  idle hint (mascot + greeting) so the empty state stays branded. */
  fallback: ReactNode;
}

// File-extension → MIME type for the viewer registry. Kept here because
// vault-md tabs carry a path, not a content-type; the registry expects
// MIME. Anything unknown falls through to text/markdown (default for
// vault notes per Obsidian convention).
const contentTypeForPath = (path: string): string => {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : '';
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'text/markdown';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    case 'yaml':
    case 'yml':
      return 'text/yaml';
    case 'toml':
      return 'text/toml';
    case 'mmd':
    case 'mermaid':
      return 'text/mermaid';
    case 'html':
    case 'htm':
      return 'text/html';
    case 'svg':
      return 'image/svg+xml';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'pdf':
      return 'application/pdf';
    case 'ts':
    case 'tsx':
      return 'application/typescript';
    case 'js':
    case 'jsx':
      return 'application/javascript';
    case 'rs':
      return 'text/x-rust';
    case 'sh':
    case 'bash':
      return 'application/x-sh';
    default:
      return 'text/markdown';
  }
};

const renderTabBody = (tab: Tab): ReactElement => {
  switch (tab.kind) {
    case 'external-embed':
      return <EmbedView url={tab.url} label={tab.title} />;
    case 'vault-md': {
      // Empty path = no resource selected yet — show a hint instead of
      // mounting a viewer against a bogus URI (which would fetch-fail).
      if (!tab.vaultPath) {
        return (
          <div className={styles.placeholder}>
            <span className={styles.placeholderKind}>vault-md</span>
            <p className={styles.placeholderHint}>
              No file selected. Set <code>vaultPath</code> on the tab to load
              a markdown note from the vault.
            </p>
          </div>
        );
      }
      // Dispatch to the viewer registry. Smart-table content-types take
      // precedence when the file extension hints at structured data;
      // everything else falls into the markdown viewer.
      const contentType = contentTypeForPath(tab.vaultPath);
      const resource: ViewerResource = {
        location: 'vault',
        contentType,
        uri: vaultUri(tab.vaultPath),
        editable: true,
      };
      const Viewer = resolveViewer(contentType);
      return (
        <Suspense
          fallback={
            <div className={styles.placeholder}>
              <span className={styles.placeholderKind}>loading viewer…</span>
              <span className={styles.placeholderPath}>{tab.vaultPath}</span>
            </div>
          }
        >
          {createElement(Viewer, { resource })}
        </Suspense>
      );
    }
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
