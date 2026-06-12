// ActionBar — a feature pack's actions rendered as a button group. Clicking
// an action triggers it (execution wired to the kernel run_action path).
// Part of the feature-pack scene panel — the "using" face of an installed
// pack (ADR-002 substrate § composition v21 §7.1).
//
// Purpose-built for feature packs, NOT a reuse of McpRunView's single-form
// run model (bao 2026-06-12: don't reuse, build the best fit, refactor-ok).

import { type ReactElement } from 'react';
import styles from './FeaturePackScene.module.css';

export interface PackAction {
  id: string;
  name: string;
  description?: string;
}

interface ActionBarProps {
  actions: PackAction[];
  /** Id of the action currently running, or null. Disables the whole bar. */
  runningId: string | null;
  onRun: (actionId: string) => void;
}

export function ActionBar({ actions, runningId, onRun }: ActionBarProps): ReactElement {
  return (
    <div className={styles.actionBar} role="toolbar" aria-label="Pack actions">
      {actions.map((a) => {
        const isRunning = runningId === a.id;
        return (
          <button
            key={a.id}
            type="button"
            className={styles.actionBtn}
            title={a.description ?? a.name}
            disabled={runningId !== null}
            data-running={isRunning}
            onClick={() => onRun(a.id)}
          >
            {isRunning ? <span className={styles.spinner} aria-hidden /> : null}
            {a.name}
          </button>
        );
      })}
    </div>
  );
}
