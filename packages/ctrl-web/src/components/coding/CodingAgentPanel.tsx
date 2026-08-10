// Project Resource launcher for the fixed Irisy identity.
//
// CTRL may project a selected local project and open a user-owned OpenCode
// process, but it does not own that process's transcript, cancellation, or
// agent loop. Conversation and Skill scope remain in the sole Irisy dialog.
// (ADR-001 spine §4 v22; ADR-003 frontend §8.5/§8.6 v40;
// ADR-005 irisy §11 v40)

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { invoke, platform } from '@/lib/bridge';
import {
  codingLauncherStatus,
  launchCodingWorkspace,
  registerProjectResource,
  reconcileWorkspaceId,
  selectTerminalId,
  type CodingLauncherStatus,
} from '@/lib/coding-launcher';
import { importLegacyCodingSessions } from '@/lib/irisy-sessions';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { unavailableFact } from '@/lib/decision-registry';
import styles from './CodingScene.module.css';

const hideCtrlWindow = (): void => {
  if (platform() !== 'tauri') return;
  void invoke<void>('hide_window').catch(() => undefined);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

interface CodingAgentPanelProps {
  onResourceChange: (resourceRef: string | null) => void;
}

export function CodingAgentPanel({ onResourceChange }: CodingAgentPanelProps): ReactElement {
  const [status, setStatus] = useState<CodingLauncherStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(() => {
    if (typeof window === 'undefined') return '';
    return window.localStorage.getItem('ctrl:coding-active-workspace:v1') ?? '';
  });
  const [terminalId, setTerminalId] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    setLoadError(null);
    try {
      const next = await codingLauncherStatus();
      if (requestId !== requestIdRef.current) return;
      const workspace = reconcileWorkspaceId(workspaceId, next.workspaces).nextId;
      setWorkspaceId(workspace);
      setTerminalId((current) => selectTerminalId(current, next.terminals));
      setStatus(next);
    } catch (error: unknown) {
      if (requestId === requestIdRef.current) setLoadError(errorMessage(error));
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  const workspace = useMemo(
    () => status?.workspaces.find((candidate) => candidate.id === workspaceId)
      ?? status?.workspaces[0]
      ?? null,
    [status, workspaceId],
  );
  const terminal = useMemo(
    () => status?.terminals.find((candidate) => candidate.id === terminalId) ?? null,
    [status, terminalId],
  );

  useEffect(() => {
    if (typeof window !== 'undefined' && workspace?.id) {
      window.localStorage.setItem('ctrl:coding-active-workspace:v1', workspace.id);
    }

    let cancelled = false;
    if (!workspace) {
      onResourceChange(null);
      return () => {
        cancelled = true;
      };
    }

    // Resolve the selected project before publishing session context. Clearing
    // first would create a transient empty owner and can feed registration
    // back through the canonical session subscription.
    // (ADR-003 frontend §8.5 v40; ADR-005 irisy §11 v40)
    setFeedback(null);
    void registerProjectResource(workspace.path)
      .then((resourceRef) => {
        if (!cancelled) onResourceChange(resourceRef);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        onResourceChange(null);
        setFeedback(`Project resource registration failed: ${errorMessage(error)}`);
      });

    return () => {
      cancelled = true;
    };
  }, [onResourceChange, workspace]);

  const launchExternally = async (): Promise<void> => {
    if (!workspace || !terminal?.available || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      await launchCodingWorkspace({
        target: terminal.id,
        workspace: workspace.path,
        mode: 'open_code',
      });
      hideCtrlWindow();
    } catch (error: unknown) {
      setFeedback(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const importHistory = async (): Promise<void> => {
    const count = await importLegacyCodingSessions(registerProjectResource);
    setFeedback(
      count > 0
        ? `Imported ${count} former Coding conversation${count === 1 ? '' : 's'} into Irisy.`
        : 'No former Coding conversations were available to import.',
    );
  };

  if (loadError && !status) {
    // The raw loader error used to be the headline here. It is now drill-down
    // behind a plain-language statement with a real recovery action, rendered by
    // the one decision registry rather than hand-built in this pane.
    // (ADR-003 frontend § decision-registry v44; ADR-005 §12 U9/U12)
    return (
      <div className={styles.root} aria-label="Project Resource">
        <div className={styles.content}>
          <DecisionSurface
            fact={unavailableFact({
              id: 'project-unavailable',
              subject: 'CTRL could not inspect your local projects.',
              reason: loadError,
              retryable: true,
              // Nothing sits behind this state, so a dismissal would leave an
              // empty pane with no way forward.
              dismissible: false,
            })}
            onResolve={() => void refresh()}
          />
          <button type="button" className={styles.ghost} onClick={() => void importHistory()}>
            Import former Coding history
          </button>
        </div>
      </div>
    );
  }

  if (!status || !workspace) {
    return (
      <div className={styles.root} aria-label="Project Resource">
        <div className={styles.content}>
          <p className={styles.notice} role="status">Inspecting local projects…</p>
          <button type="button" className={styles.ghost} onClick={() => void importHistory()}>
            Import former Coding history
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root} aria-label="Project Resource">
      <div className={styles.content}>
        <h1 className={styles.title}>Project</h1>
        <p className={styles.notice}>
          Select a local Resource, then continue in Irisy or open a user-owned OpenCode session.
        </p>
        {loadError && <p className={styles.error} role="alert">Refresh failed: {loadError}</p>}
        {feedback && <p className={styles.notice} role="status">{feedback}</p>}
        <label className={styles.field}>
          <span className={styles.label}>Resource</span>
          <select
            className={styles.select}
            value={workspace.id}
            onChange={(event) => setWorkspaceId(event.target.value)}
          >
            {status.workspaces.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.label}</option>
            ))}
          </select>
        </label>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={!status.opencodeAvailable || !terminal?.available || busy}
            onClick={() => void launchExternally()}
          >
            {busy ? 'Opening…' : 'Open externally'}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button type="button" className={styles.ghost} onClick={() => void importHistory()}>
            Import former Coding history
          </button>
        </div>
      </div>
    </div>
  );
}
