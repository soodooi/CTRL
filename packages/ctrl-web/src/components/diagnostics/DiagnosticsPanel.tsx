// DiagnosticsPanel — the local diagnostics client.
//
// The kernel has composed typed status, smoke checks, a bounded trace, and a
// metadata-only export preview for some time, and nothing consumed any of it: the
// accepted surface was simply unmounted, so a user debugging a stuck Irisy turn
// had nowhere to look.
//
// This is a structured client, deliberately not a raw log console: it renders the
// kernel's own typed records and never tails a file. Capture and export preview
// stay typed Tauri controls and are never projected as agent tools.
// (ADR-003 frontend § diagnostics-surface v26; ADR-005 irisy §12 v42 U21)

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import {
  diagnosticsCaptureStart,
  diagnosticsCaptureStop,
  diagnosticsExportPreview,
  diagnosticsSmoke,
  diagnosticsStatus,
  diagnosticsTrace,
  type DiagnosticsExportPreview,
  type DiagnosticsModule,
  type DiagnosticsSmoke,
  type DiagnosticsStatus,
  type DiagnosticsTrace,
} from '@/lib/kernel';
import {
  diagnosticsExportFacts,
  diagnosticsStatusFacts,
  diagnosticsTraceRows,
} from '@/lib/diagnostics-view';
import { DecisionSurface } from '@/components/decisions/DecisionSurface';
import { unavailableFact, type DecisionFact } from '@/lib/decision-registry';
import styles from './DiagnosticsPanel.module.css';

const MODULES: DiagnosticsModule[] = ['irisy', 'coding', 'notes'];
const MODULE_LABELS: Record<DiagnosticsModule, string> = {
  irisy: 'Irisy',
  coding: 'Coding',
  notes: 'Notes',
};
/** Bounded capture window: long enough to reproduce a problem, short enough that
 *  it cannot be left recording indefinitely. */
const CAPTURE_SECONDS = 120;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function DiagnosticsPanel(): ReactElement {
  const [module, setModule] = useState<DiagnosticsModule>('irisy');
  const [status, setStatus] = useState<DiagnosticsStatus | null>(null);
  const [smoke, setSmoke] = useState<DiagnosticsSmoke | null>(null);
  const [trace, setTrace] = useState<DiagnosticsTrace | null>(null);
  const [preview, setPreview] = useState<DiagnosticsExportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [decision, setDecision] = useState<DecisionFact | null>(null);

  const fail = useCallback((subject: string, error: unknown): void => {
    // A diagnostics surface that cannot report its own failure is worthless, so
    // this goes through the registry with the kernel's reason as drill-down.
    setDecision(
      unavailableFact({
        id: 'diagnostics',
        subject,
        reason: message(error),
        retryable: true,
      }),
    );
  }, []);

  const load = useCallback(
    (target: DiagnosticsModule): void => {
      setDecision(null);
      void diagnosticsStatus(target)
        .then(setStatus)
        .catch((error: unknown) => {
          setStatus(null);
          fail('Diagnostics could not read this module’s status.', error);
        });
      void diagnosticsTrace(target)
        .then(setTrace)
        // A missing trace is not the same failure as a missing status; report the
        // status one and leave the trace empty rather than blanking both.
        .catch(() => setTrace(null));
    },
    [fail],
  );

  useEffect(() => {
    setSmoke(null);
    setPreview(null);
    load(module);
  }, [module, load]);

  const runChecks = async (): Promise<void> => {
    setBusy(true);
    setDecision(null);
    try {
      setSmoke(await diagnosticsSmoke(module));
    } catch (error) {
      fail('Diagnostics could not run the checks for this module.', error);
    } finally {
      setBusy(false);
    }
  };

  const toggleCapture = async (): Promise<void> => {
    setBusy(true);
    setDecision(null);
    try {
      if (status?.capture_active) {
        await diagnosticsCaptureStop(module);
      } else {
        await diagnosticsCaptureStart(module, CAPTURE_SECONDS);
      }
      // Reread rather than assuming the toggle took effect.
      load(module);
    } catch (error) {
      fail('Diagnostics could not change capture for this module.', error);
    } finally {
      setBusy(false);
    }
  };

  const showExportPreview = async (): Promise<void> => {
    setBusy(true);
    setDecision(null);
    try {
      setPreview(await diagnosticsExportPreview(module));
    } catch (error) {
      fail('Diagnostics could not prepare an export preview.', error);
    } finally {
      setBusy(false);
    }
  };

  // A reply without an events array is a malformed trace, not an empty one; treat
  // it as nothing to show rather than crashing the panel that exists to diagnose.
  const rows = Array.isArray(trace?.events) ? diagnosticsTraceRows(trace.events) : [];

  return (
    <section className={styles.root} aria-label="Diagnostics">
      <div className={styles.moduleRow} role="tablist" aria-label="Diagnostics module">
        {MODULES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            role="tab"
            aria-selected={module === candidate}
            data-active={module === candidate}
            className={styles.moduleTab}
            onClick={() => setModule(candidate)}
          >
            {MODULE_LABELS[candidate]}
          </button>
        ))}
      </div>

      {decision ? (
        <DecisionSurface
          fact={decision}
          onResolve={(optionId) => {
            setDecision(null);
            if (optionId === 'retry') load(module);
          }}
        />
      ) : null}

      {status ? (
        <div className={styles.block} data-testid="diagnostics-status">
          <div className={styles.blockTitle} data-health={status.health}>
            {MODULE_LABELS[module]} · {status.health}
          </div>
          <dl className={styles.facts}>
            {diagnosticsStatusFacts(status).map((fact) => (
              <div key={fact.label} className={styles.factRow}>
                <dt className={styles.factLabel}>{fact.label}</dt>
                <dd className={styles.factValue}>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <div className={styles.actions}>
            <button type="button" className={styles.action} disabled={busy} onClick={() => void runChecks()}>
              Run checks
            </button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => void toggleCapture()}>
              {status.capture_active ? 'Stop capture' : `Capture ${CAPTURE_SECONDS}s`}
            </button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => void showExportPreview()}>
              Preview export
            </button>
            <button type="button" className={styles.action} disabled={busy} onClick={() => load(module)}>
              Refresh
            </button>
          </div>
        </div>
      ) : null}

      {smoke ? (
        <div className={styles.block} data-testid="diagnostics-smoke">
          <div className={styles.blockTitle} data-health={smoke.health}>
            Checks · {smoke.health}
          </div>
          <ul className={styles.checks}>
            {smoke.checks.map((check) => (
              <li key={check.name} className={styles.check} data-health={check.health}>
                <span className={styles.checkName}>{check.name}</span>
                <span className={styles.checkHealth}>{check.health}</span>
                <span className={styles.checkSummary}>{check.summary}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <div className={styles.block} data-testid="diagnostics-export">
          <div className={styles.blockTitle}>Export preview</div>
          <dl className={styles.facts}>
            {diagnosticsExportFacts(preview).map((fact) => (
              <div key={fact.label} className={styles.factRow}>
                <dt className={styles.factLabel}>{fact.label}</dt>
                <dd className={styles.factValue}>{fact.value}</dd>
              </div>
            ))}
          </dl>
          <p className={styles.note}>
            Nothing has been written yet. This preview stays on this machine.
          </p>
        </div>
      ) : null}

      <div className={styles.block} data-testid="diagnostics-trace">
        <div className={styles.blockTitle}>
          Recent activity
          {trace ? ` · keeps ${trace.retention_seconds}s, up to ${trace.capacity} events` : ''}
        </div>
        {rows.length === 0 ? (
          <p className={styles.note}>
            No retained events. Start a capture, reproduce the problem, then refresh.
          </p>
        ) : (
          <table className={styles.trace}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Kind</th>
                <th>Phase</th>
                <th>Outcome</th>
                <th>Took</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} data-severity={row.severity}>
                  <td>{row.time}</td>
                  <td>{row.kind}</td>
                  <td>{row.phase}</td>
                  <td>{row.outcome}</td>
                  <td>{row.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
