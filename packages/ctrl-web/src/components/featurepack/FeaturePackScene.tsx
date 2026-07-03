// FeaturePackScene — the "using" face of an installed feature pack. Two faces,
// picked by the manifest:
//  • a pack that declares a §14 `record_source` (ADR-002 §14.12) leads with its
//    RECORDS — a product-grade data table (e.g. Ghostfolio holdings), the pack's
//    data IS the view; actions sit above it (e.g. "record a trade").
//  • otherwise it is an action bar over an output area.
// Irisy stays alongside via the parent split (this component owns only the
// right/scene column). ADR-002 substrate § composition v21 §7.1 + §7.5.
//
// Best-fit component, not a reuse of McpRunView (bao 2026-06-12: don't reuse,
// build the best fit, refactor-ok). Execution + record loading are injected
// (onRunAction / loadRecords) so the scene renders/iterates independently of the
// kernel wiring — and unit-tests + visually verifies with mock data.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { type PackConfigField, provisionPack, publishPack } from '@/lib/feature-pack';
import { ActionBar, type PackAction } from './ActionBar';
import { PackConfigModal } from './PackConfigModal';
import { SourceDataView, type SourceData } from './SourceDataView';
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
  /** Domain grouping (manifest `category`, e.g. "stocks") — packs of the same
   *  category surface TOGETHER in Irisy's pack strip when one of them is the
   *  open L1 scene (bao 2026-07-03: L1 stocks shows the stock packs). */
  category?: string;
  /** Post-install config the pack needs (manifest `config_schema`) — drives the
   *  Configure wizard; values land under `mcp:<id>:<key>` for the kernel. */
  configFields?: PackConfigField[];
  /** Declares a service/bootstrap auth → one-click silent "Set up" (the
   *  provision engine) instead of the manual Configure wizard. */
  needsProvision?: boolean;
  /** Manifest declares a §14 `record_source` → the scene leads with its records
   *  (a product-grade data table) instead of a bare action bar (§14.12). */
  hasRecords?: boolean;
}

interface FeaturePackSceneProps {
  pack: FeaturePack;
  /** Execute an action; resolves to output text/markdown to show. Thrown
   *  errors surface in the output area. */
  onRunAction: (actionId: string) => Promise<string>;
  /** Fetch the pack's §14 records (describe + query through the gate). Injected
   *  so the scene is testable/visual without the live kernel. Present iff
   *  `pack.hasRecords`. */
  loadRecords?: () => Promise<SourceData>;
}

type RecordsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; data: SourceData }
  | { status: 'error'; message: string };

export function FeaturePackScene({
  pack,
  onRunAction,
  loadRecords,
}: FeaturePackSceneProps): ReactElement {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [records, setRecords] = useState<RecordsState>({ status: 'idle' });
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const configFields = pack.configFields ?? [];
  const showsRecords = pack.hasRecords === true && loadRecords != null;

  const refreshRecords = useCallback(async (): Promise<void> => {
    if (loadRecords == null) return;
    setRecords({ status: 'loading' });
    try {
      setRecords({ status: 'ready', data: await loadRecords() });
    } catch (e) {
      setRecords({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [loadRecords]);

  // Load records when the scene opens (or the pack changes).
  useEffect(() => {
    if (showsRecords) void refreshRecords();
    // Reset transient action output when switching packs.
    setOutput(null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pack.id]);

  const setUp = async (): Promise<void> => {
    setSettingUp(true);
    setError(null);
    setOutput(null);
    setLastAction('Set up');
    try {
      setOutput(await provisionPack(pack.id));
      if (showsRecords) void refreshRecords();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSettingUp(false);
    }
  };

  const share = async (): Promise<void> => {
    setPublishing(true);
    setPublishMsg(null);
    try {
      const ref = await publishPack(pack.id);
      const where = ref.url ?? [ref.namespace, ref.id].filter(Boolean).join('/');
      setPublishMsg({ ok: true, text: `Published to ${where}` });
    } catch (e) {
      setPublishMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setPublishing(false);
    }
  };

  const run = async (actionId: string): Promise<void> => {
    setRunningId(actionId);
    setLastAction(pack.actions.find((a) => a.id === actionId)?.name ?? actionId);
    setError(null);
    setOutput(null);
    try {
      setOutput(await onRunAction(actionId));
      // An action may have produced a record (e.g. recorded a trade) — refresh.
      if (showsRecords) void refreshRecords();
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
        {showsRecords && (
          <button
            type="button"
            className={styles.configBtn}
            onClick={() => void refreshRecords()}
            disabled={records.status === 'loading'}
            title={`Refresh ${pack.name} records`}
          >
            {records.status === 'loading' ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
        <button
          type="button"
          className={styles.configBtn}
          onClick={() => void share()}
          disabled={publishing}
          title={`Publish ${pack.name} to the commons (share-and-be-shared)`}
        >
          {publishing ? 'Publishing…' : 'Share'}
        </button>
        {pack.needsProvision ? (
          <button
            type="button"
            className={styles.configBtn}
            onClick={() => void setUp()}
            disabled={settingUp}
            title={`Set up ${pack.name} (one-click, silent)`}
          >
            {settingUp ? 'Setting up…' : 'Set up'}
          </button>
        ) : configFields.length > 0 ? (
          <button
            type="button"
            className={styles.configBtn}
            onClick={() => setShowConfig(true)}
            title={`Configure ${pack.name}`}
          >
            Configure
          </button>
        ) : null}
      </header>

      {publishMsg != null && (
        <div className={publishMsg.ok ? styles.publishOk : styles.publishErr} role="status">
          {publishMsg.text}
        </div>
      )}

      {showConfig && (
        <PackConfigModal
          packId={pack.id}
          packName={pack.name}
          fields={configFields}
          onClose={() => setShowConfig(false)}
        />
      )}

      <ActionBar actions={pack.actions} runningId={runningId} onRun={run} />

      <div className={styles.output}>
        {showsRecords ? (
          <>
            {error != null && <pre className={styles.error}>{error}</pre>}
            {records.status === 'loading' ? (
              <div className={styles.empty}>Loading {pack.name} records…</div>
            ) : records.status === 'error' ? (
              <pre className={styles.error}>{records.message}</pre>
            ) : records.status === 'ready' ? (
              <SourceDataView data={records.data} title={pack.name} />
            ) : (
              <div className={styles.empty}>No records loaded.</div>
            )}
          </>
        ) : error != null ? (
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
