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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { type PackConfigField, provisionPack, publishPack } from '@/lib/feature-pack';
import { vaultRead, vaultList } from '@/lib/kernel';
import { SmartTableViewer } from '@/components/viewers/SmartTableViewer';
import { resourceFromVaultPath } from '@/lib/viewer-resource';
import { ActionBar, type PackAction } from './ActionBar';
import { PackConfigModal } from './PackConfigModal';
import { SourceDataView, type SourceData } from './SourceDataView';
import { parseRuntimeGuidance, type RuntimeGuidance } from './runtimeGuidance';
import {
  installContainerRuntime,
  onRuntimeInstallProgress,
  type RuntimeInstallStatus,
} from '@/lib/runtime-install';
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
  /** Workspace = smart-tables that ARE this pack's operating UI (§7.5 v48).
   *  v1: a table_prefix convention — vault tables under `tables/<pack>-*` are
   *  its work surface (Feishu Bitable-style). The scene renders them as tabs. */
  workspace?: { tablePrefix?: string };
  /** Manifest declares a §14 `record_source` → the scene leads with its records
   *  (a product-grade data table) instead of a bare action bar (§14.12). */
  hasRecords?: boolean;
}

interface FeaturePackSceneProps {
  pack: FeaturePack;
  /** Execute an action; resolves to output text/markdown to show. Thrown
   *  errors surface in the output area. */
  onRunAction: (actionId: string) => Promise<string>;
  /** Send a natural-language prompt to Irisy (starter chips). Wired to the
   *  ambient send() so a chip click runs a full pack-aware Irisy turn. */
  onSendMessage?: (text: string) => void | Promise<void>;
  /** Optional first-screen dashboard (e.g. the stock cockpit). When present it
   *  leads the workspace as a "Today" tab — a glanceable snapshot on open. */
  dashboard?: ReactElement;
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

// Sentinel tab id for a record_source pack's product-grade records tab, shown
// FIRST in the workspace alongside the user's vault tables (§7.5 v48 dual-face).
const RECORDS_TAB = '__records__';
const INTRO_TAB = '__intro__';
const DASHBOARD_TAB = '__dashboard__';

/** Drop the YAML frontmatter block so intro.md renders as clean prose, not raw
 *  `title: … type: …` text at the top. */
const stripFrontmatter = (md: string): string => md.replace(/^---\n[\s\S]*?\n---\n?/, '');

// A record_source pack's query fails with a gate "not configured" error until
// the user connects it — show a friendly nudge to Set up / Connect existing,
// not the raw JSON-RPC error (bao 2026-07-05 saw the raw -32602 on first open).
const isNotConfigured = (msg: string): boolean => /not configured|credentials/i.test(msg);

// The guided-install card. When the platform supports it (macOS + Homebrew),
// a one-click "Install it for me" runs the commands (streaming live output) and
// auto-retries Set up on success — the auto-run half (bao 2026-07-05). Elsewhere
// it stays a GUIDE: platform steps + copy-pasteable commands (Linux sudo /
// Windows GUI installs aren't auto-run). Design: feature-pack-provision-auth-engine.md.
export function RuntimeGuidanceCard({
  guidance,
  onDismiss,
  onInstalled,
}: {
  guidance: RuntimeGuidance;
  onDismiss: () => void;
  onInstalled: () => void;
}): ReactElement {
  const [copied, setCopied] = useState<number | null>(null);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<RuntimeInstallStatus | null>(null);
  const [installErr, setInstallErr] = useState<string | null>(null);
  // Guard against the card unmounting (user dismisses) mid-install: drop the
  // event listener and don't fire state/retry callbacks on a gone component.
  const mountedRef = useRef(true);
  const unlistenRef = useRef<() => void>(() => {});
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      unlistenRef.current();
    };
  }, []);

  const copy = (cmd: string, i: number): void => {
    void navigator.clipboard?.writeText(cmd).then(() => {
      setCopied(i);
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    });
  };

  const runInstall = async (): Promise<void> => {
    setInstalling(true);
    setInstallErr(null);
    setStatus(null);
    try {
      unlistenRef.current = await onRuntimeInstallProgress((s) => {
        if (!mountedRef.current) return;
        setStatus(s);
        if (s.done) {
          unlistenRef.current();
          setInstalling(false);
          if (s.ok) onInstalled();
          else setInstallErr(s.error ?? 'Install failed — try the manual steps below.');
        }
      });
      await installContainerRuntime();
    } catch (e) {
      unlistenRef.current();
      if (!mountedRef.current) return;
      setInstalling(false);
      setInstallErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className={styles.guide} role="status">
      <div className={styles.guideHead}>
        <span className={styles.guideTitle}>Set up needs a container runtime</span>
        <button type="button" className={styles.guideClose} onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      <p className={styles.guideText}>{guidance.headline}</p>

      {guidance.auto_installable && (
        <button
          type="button"
          className={styles.guidePrimary}
          onClick={() => void runInstall()}
          disabled={installing}
        >
          {installing ? 'Installing…' : 'Install it for me'}
        </button>
      )}

      {status != null && (status.running || status.log_tail.length > 0) && (
        <pre className={styles.guideLog}>
          {status.current != null && status.running ? `▸ ${status.current}\n` : ''}
          {status.log_tail.slice(-12).join('\n')}
        </pre>
      )}
      {installErr != null && <p className={styles.guideErr}>{installErr}</p>}

      {guidance.steps.length > 0 && (
        <ol className={styles.guideSteps}>
          {guidance.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {guidance.commands.map((cmd, i) => (
        <div key={i} className={styles.guideCmd}>
          <code>{cmd}</code>
          <button type="button" className={styles.guideCopy} onClick={() => copy(cmd, i)}>
            {copied === i ? 'Copied' : 'Copy'}
          </button>
        </div>
      ))}
      {guidance.docs_url !== '' && (
        <a className={styles.guideLink} href={guidance.docs_url} target="_blank" rel="noreferrer">
          Installation docs →
        </a>
      )}
    </div>
  );
}

export function FeaturePackScene({
  pack,
  onRunAction,
  onSendMessage,
  dashboard,
  loadRecords,
}: FeaturePackSceneProps): ReactElement {
  const [runningId, setRunningId] = useState<string | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const [runtimeGuidance, setRuntimeGuidance] = useState<RuntimeGuidance | null>(null);
  const [records, setRecords] = useState<RecordsState>({ status: 'idle' });
  const [publishing, setPublishing] = useState(false);
  const [publishMsg, setPublishMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const configFields = pack.configFields ?? [];
  const showsRecords = pack.hasRecords === true && loadRecords != null;

  // §7.5 v48: the pack's smart-table WORKSPACE — its operating UI. When the
  // manifest declares a workspace table_prefix, list the vault tables under it
  // and render each as a tab (the generic smart-table viewer, multi-view). A
  // pack with a workspace leads with it, over records/intro (bao 2026-07-03:
  // smart-table = the pack's operating page, Feishu Bitable-style; zero bespoke UI).
  const wsPrefix = pack.workspace?.tablePrefix ?? null;
  const [wsTables, setWsTables] = useState<string[] | null>(null);
  const [wsActive, setWsActive] = useState<string | null>(null);
  useEffect(() => {
    if (wsPrefix == null) {
      setWsTables(null);
      return;
    }
    let alive = true;
    void vaultList()
      .then((paths) => {
        if (!alive) return;
        setWsTables(paths.filter((p) => p.startsWith(wsPrefix) && p.endsWith('.md')).sort());
      })
      .catch(() => {
        if (alive) setWsTables([]);
      });
    return () => {
      alive = false;
    };
  }, [wsPrefix]);
  const showsWorkspace = wsPrefix != null;
  // Pack intro.md (its detail/how-to page). Declared here so the workspace can
  // lead with a Guide tab; the fetch effect lives further down.
  const [intro, setIntro] = useState<string | null>(null);
  // §7.5 v48 dual-face: a pack with BOTH a §14 record_source AND a workspace
  // (e.g. ctrl-ghostfolio) surfaces its product-grade records as the FIRST tab
  // (read-only, live from the connector) alongside the user's own vault tables —
  // Feishu Bitable-style, so declaring a workspace never HIDES the records.
  // Lead a workspace pack with a "Guide" tab (its intro.md) so opening it lands
  // on how-to-use-it, not a bare empty table (bao 2026-07-07). Records-first
  // packs (ghostfolio) keep records leading; the guide slots in right after.
  const wsTabs = useMemo(
    () => [
      ...(dashboard != null ? [DASHBOARD_TAB] : []),
      ...(showsRecords ? [RECORDS_TAB] : []),
      ...(intro != null ? [INTRO_TAB] : []),
      ...(wsTables ?? []),
    ],
    [dashboard, showsRecords, intro, wsTables],
  );
  // Starter prompts: the example phrases the pack's intro.md wraps in CJK corner
  // brackets (U+300C … U+300D). Data-driven (single source = intro), so a chip
  // click sends a proven prompt to Irisy — the user learns what to ask without
  // typing. All prompt text lives in intro data, not this code.
  const starters = useMemo(() => {
    if (intro == null) return [];
    const out: string[] = [];
    const re = /\u300c(.+?)\u300d/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(intro)) !== null) {
      const s = m[1]?.trim();
      if (s && !out.includes(s)) out.push(s);
      if (out.length >= 5) break;
    }
    return out;
  }, [intro]);

  const wsTabsKey = wsTabs.join('\n');
  useEffect(() => {
    setWsActive((cur) => (cur != null && wsTabs.includes(cur) ? cur : (wsTabs[0] ?? null)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsTabsKey]);

  // Fetch intro.md (state declared above so wsTabs can lead with a Guide tab;
  // bao 2026-07-03: data-driven detail page, zero per-pack code).
  useEffect(() => {
    if (showsRecords || pack.kbDir == null) {
      setIntro(null);
      return;
    }
    let alive = true;
    void vaultRead(`${pack.kbDir}/intro.md`)
      .then((e) => {
        if (alive) setIntro(e.content != null ? stripFrontmatter(e.content) : null);
      })
      .catch(() => {
        if (alive) setIntro(null);
      });
    return () => {
      alive = false;
    };
  }, [pack.kbDir, showsRecords]);

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
    setRuntimeGuidance(null);
    setLastAction('Set up');
    try {
      setOutput(await provisionPack(pack.id));
      if (showsRecords) void refreshRecords();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // No container runtime → show the guided-install card, not a raw error.
      const guidance = parseRuntimeGuidance(msg);
      if (guidance != null) setRuntimeGuidance(guidance);
      else setError(msg);
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
        {/* A pack may offer BOTH: one-click provision (needs Docker) AND a
            manual "connect existing" path (fill URL + token for an instance you
            already run). ctrl-ghostfolio has both — a Docker-less user picks
            Connect existing (bao 2026-07-05). No longer mutually exclusive. */}
        {pack.needsProvision && (
          <button
            type="button"
            className={styles.configBtn}
            onClick={() => void setUp()}
            disabled={settingUp}
            title={`Set up ${pack.name} (one-click, brings up its Docker stack)`}
          >
            {settingUp ? 'Setting up…' : 'Set up'}
          </button>
        )}
        {configFields.length > 0 && (
          <button
            type="button"
            className={styles.configBtn}
            onClick={() => setShowConfig(true)}
            title={
              pack.needsProvision
                ? `Connect an existing ${pack.name} you already run (no Docker)`
                : `Configure ${pack.name}`
            }
          >
            {pack.needsProvision ? 'Connect existing' : 'Configure'}
          </button>
        )}
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

      {onSendMessage != null && starters.length > 0 && (
        <div className={styles.starters}>
          {starters.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.starterChip}
              onClick={() => void onSendMessage(s)}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className={styles.output}>
        {/* No-docker guided install — sits above both faces so it's seen whether
            the pack leads with records or a workspace (bao 2026-07-05). */}
        {runtimeGuidance != null && (
          <RuntimeGuidanceCard
            guidance={runtimeGuidance}
            onDismiss={() => setRuntimeGuidance(null)}
            onInstalled={() => {
              // Runtime installed — clear the card and retry Set up automatically.
              setRuntimeGuidance(null);
              void setUp();
            }}
          />
        )}
        {/* Action feedback (error/output) also surfaces in the workspace face — a
            dual-face pack's action (e.g. ghostfolio "Record a trade") must not
            fail silently behind the tabs (independent checker, §7.5 v48). */}
        {showsWorkspace && error != null && <pre className={styles.error}>{error}</pre>}
        {showsWorkspace && output != null && (
          <>
            {lastAction != null && <div className={styles.outputLabel}>{lastAction}</div>}
            <pre className={styles.outputBody}>{output}</pre>
          </>
        )}
        {showsWorkspace ? (
          wsTables == null && !showsRecords ? (
            <div className={styles.empty}>Loading {pack.name} workspace…</div>
          ) : wsTabs.length === 0 ? (
            <div className={styles.empty}>
              No tables yet — ask Irisy to create one (e.g. a watchlist), and it
              appears here as a tab.
            </div>
          ) : (
            <div className={styles.workspace}>
              <div className={styles.wsTabs} role="tablist" aria-label={`${pack.name} tables`}>
                {wsTabs.map((t) => {
                  const label =
                    t === DASHBOARD_TAB
                      ? 'Today'
                      : t === RECORDS_TAB
                        ? pack.name
                        : t === INTRO_TAB
                          ? 'Guide'
                          : t.replace(wsPrefix ?? '', '').replace(/\.md$/, '');
                  return (
                    <button
                      key={t}
                      type="button"
                      role="tab"
                      aria-selected={t === wsActive}
                      className={styles.wsTab}
                      data-active={t === wsActive || undefined}
                      onClick={() => setWsActive(t)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className={styles.wsBody}>
                {wsActive === DASHBOARD_TAB ? (
                  dashboard
                ) : wsActive === RECORDS_TAB ? (
                  records.status === 'loading' ? (
                    <div className={styles.empty}>Loading {pack.name} records…</div>
                  ) : records.status === 'error' ? (
                    isNotConfigured(records.message) ? (
                      <div className={styles.empty}>
                        {pack.name} isn't connected yet — use the &quot;Connect existing&quot;
                        or &quot;Set up&quot; button above to link a {pack.name} you already run.
                      </div>
                    ) : (
                      <pre className={styles.error}>{records.message}</pre>
                    )
                  ) : records.status === 'ready' ? (
                    <SourceDataView data={records.data} title={pack.name} />
                  ) : (
                    <div className={styles.empty}>No records loaded.</div>
                  )
                ) : wsActive === INTRO_TAB ? (
                  <div className={styles.intro}>
                    {intro != null ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
                    ) : null}
                  </div>
                ) : wsActive != null ? (
                  <SmartTableViewer resource={resourceFromVaultPath(wsActive)} />
                ) : null}
              </div>
            </div>
          )
        ) : showsRecords ? (
          <>
            {error != null && <pre className={styles.error}>{error}</pre>}
            {records.status === 'loading' ? (
              <div className={styles.empty}>Loading {pack.name} records…</div>
            ) : records.status === 'error' ? (
              isNotConfigured(records.message) ? (
                <div className={styles.empty}>
                  {pack.name} isn't connected yet — use the &quot;Connect existing&quot; or
                  &quot;Set up&quot; button above to link a {pack.name} you already run.
                </div>
              ) : (
                <pre className={styles.error}>{records.message}</pre>
              )
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
        ) : intro != null ? (
          <div className={styles.intro}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{intro}</ReactMarkdown>
          </div>
        ) : (
          <div className={styles.empty}>
            {pack.actions.length > 0
              ? 'Pick an action above to run it.'
              : `Use ${pack.name} through Irisy — ask it in the chat.`}
          </div>
        )}
      </div>
    </section>
  );
}
