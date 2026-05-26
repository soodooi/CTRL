// InstanceSwitcher — pill row above the TabBar listing open workspace
// instances. Click switches. Middle-click closes (matches TabBar).
//
// Renders nothing when ≤ 1 instance is open — the UI silently appears
// when the user actually has multiple. Keeps the cockpit calm by
// default, doesn't impose multi-instance chrome on single-task flows.

import type { ReactElement } from 'react';
import { useWorkspaceStore } from '@/lib/workspace-store';
import styles from './InstanceSwitcher.module.css';

const CloseIcon = (): ReactElement => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M2 2 L8 8 M8 2 L2 8" />
  </svg>
);

export const InstanceSwitcher = (): ReactElement | null => {
  const instances = useWorkspaceStore((s) => s.instances);
  const activeId = useWorkspaceStore((s) => s.activeInstanceId);
  const activate = useWorkspaceStore((s) => s.activateInstance);
  const close = useWorkspaceStore((s) => s.closeInstance);

  if (instances.length <= 1) return null;

  return (
    <nav className={styles.row} role="tablist" aria-label="Workspace instances">
      {instances.map((inst) => {
        const active = inst.id === activeId;
        return (
          <div
            key={inst.id}
            className={styles.pill}
            data-active={active}
            data-kind={inst.kind}
            role="tab"
            aria-selected={active}
          >
            <button
              type="button"
              className={styles.pillButton}
              onClick={() => activate(inst.id)}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  close(inst.id);
                }
              }}
              title={inst.title}
            >
              <span className={styles.pillLabel}>{inst.title}</span>
            </button>
            <button
              type="button"
              className={styles.pillClose}
              onClick={(e) => {
                e.stopPropagation();
                close(inst.id);
              }}
              aria-label={`Close ${inst.title}`}
              title="Close"
            >
              <CloseIcon />
            </button>
          </div>
        );
      })}
    </nav>
  );
};
