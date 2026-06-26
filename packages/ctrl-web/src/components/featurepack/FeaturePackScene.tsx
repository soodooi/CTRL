// FeaturePackScene — the "using" face of an installed feature pack: an action
// bar (manifest.actions) over an output area. Irisy stays alongside via the
// parent split (this component owns only the right/scene column).
// ADR-002 substrate § composition v21 §7.1.
//
// Best-fit component, not a reuse of McpRunView (bao 2026-06-12: don't reuse,
// build the best fit, refactor-ok). Execution is injected via onRunAction so
// the scene renders/iterates independently of the kernel run_action wiring.

import { useState, type ReactElement } from 'react';
import { ActionBar, type PackAction } from './ActionBar';
import styles from './FeaturePackScene.module.css';

export interface FeaturePack {
  id: string;
  name: string;
  icon?: string;
  summary?: string;
  actions: PackAction[];
  /** Dedicated knowledge base = a vault subpath this pack's data lives in
   *  (manifest `knowledge_base`). When the assistant uses this pack, retrieval
   *  scopes here (bao 2026-06-25: stocks = assistant + Stocks/ + ghostfolio). */
  kbDir?: string;
}

interface FeaturePackSceneProps {
  pack: FeaturePack;
  /** Execute an action; resolves to output text/markdown to show. Thrown
   *  errors surface in the output area. */
  onRunAction: (actionId: string) => Promise<string>;
  /** Open the pack's secret config (url / key / token). Passed only when the
   *  pack declares secrets — without setting them, actions fail with a keychain
   *  error, so the work interface surfaces a Configure step. */
  onConfigure?: () => void;
}

export function FeaturePackScene({
  pack,
  onRunAction,
  onConfigure,
}: FeaturePackSceneProps): ReactElement {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);

  const run = async (actionId: string): Promise<void> => {
    setRunningId(actionId);
    setLastAction(pack.actions.find((a) => a.id === actionId)?.name ?? actionId);
    setError(null);
    setOutput(null);
    try {
      setOutput(await onRunAction(actionId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunningId(null);
    }
  };

  return (
    <section className={styles.scene} aria-label={`${pack.name} pack`}>
      <header className={styles.header}>
        <span className={styles.icon} aria-hidden>
          {pack.icon ?? '⚡'}
        </span>
        <div className={styles.titleCol}>
          <span className={styles.name}>{pack.name}</span>
          {pack.summary != null && <span className={styles.summary}>{pack.summary}</span>}
        </div>
        {onConfigure != null && (
          <button
            type="button"
            className={styles.configBtn}
            onClick={onConfigure}
            title="Configure this pack — enter its URL / key (stored in your keychain)"
          >
            ⚙ Configure
          </button>
        )}
      </header>

      <ActionBar actions={pack.actions} runningId={runningId} onRun={run} />

      <div className={styles.output}>
        {error != null ? (
          <pre className={styles.error}>{error}</pre>
        ) : runningId != null ? (
          <div className={styles.empty}>Running {lastAction}…</div>
        ) : output != null ? (
          <>
            {lastAction != null && <div className={styles.outputLabel}>{lastAction}</div>}
            <pre className={styles.outputBody}>{output}</pre>
          </>
        ) : (
          <div className={styles.empty}>Pick an action above to run it.</div>
        )}
      </div>
    </section>
  );
}
