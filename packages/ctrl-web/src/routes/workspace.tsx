// /workspace — workspace surface.
//
// Two modes coexist by URL shape:
//   (1) /workspace                — multi-instance shell (today's PWA flow,
//       driven by workspace-store + WorkspaceShell)
//   (2) /workspace?mcp_id=foo  — legacy dedicated Tauri window route,
//       reads a single mcp_id from URL/hash and renders its
//       cell-stream feed (kept for the Rust shell that opens a dedicated
//       workspace window per ADR-003 frontend § nav-keyboard v2 —
//       workspace area opens via L1 ▾, lives in main window's leftward
//       expansion; the legacy mcp_id query path is preserved for the
//       Rust shell that still calls it directly during transition)
//
// Both paths land here so the existing Tauri window code that navigates
// `/workspace?mcp_id=...` keeps working while the multi-instance UI
// owns the unparameterised entry point.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useCellStream, type EventRecord } from '@/hooks/useCellStream';
import { formatHHMMSS } from '@/hooks/useWallClock';
import { WorkspaceShell } from '@/components/workspace/WorkspaceShell';
import styles from './workspace.module.css';

const readMcpId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.searchParams.has('mcp_id')) return url.searchParams.get('mcp_id');
  const hash = url.hash;
  const hashQs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(hashQs).get('mcp_id');
};

const renderPayload = (payload: unknown): string => {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  try {
    const s = JSON.stringify(payload, null, 2);
    return s.length > 320 ? `${s.slice(0, 320)}…` : s;
  } catch {
    return String(payload);
  }
};

const cls = (value: string | undefined): string => value ?? '';

const eventKindClass = (event: EventRecord): string => {
  if (event.type === 'cell') {
    switch (event.kind) {
      case 'user_input':
        return cls(styles.cellUser);
      case 'llm_response':
        return cls(styles.cellLlm);
      case 'mcp_tool_result':
        return cls(styles.cellMcp);
      default:
        return cls(styles.cellDefault);
    }
  }
  if (event.kind === 'mcp_failed') return cls(styles.opFailed);
  if (event.kind === 'mcp_completed') return cls(styles.opComplete);
  return cls(styles.opDefault);
};

interface WorkspaceRouteProps {
  /**
   * Override the mcp id source. When omitted the route reads the id from
   * the URL (default behavior used by the dedicated Tauri workspace window).
   */
  mcpId?: string | null;
}

const LegacyMcpStreamView = ({
  mcpId,
}: {
  mcpId: string;
}): ReactElement => {
  const streamId = useMemo(() => `mcp-${mcpId}`, [mcpId]);
  const { events, status, error } = useCellStream(streamId);
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1 className={styles.title}>Workspace</h1>
        <p className={styles.subtitle}>
          Mcp <code className={styles.code}>{mcpId}</code>
          <span className={`${cls(styles.status)} ${cls(styles[`status_${status}`])}`}>
            {status}
          </span>
        </p>
        {error && <p className={styles.error}>{error}</p>}
      </header>
      <main className={styles.feed} role="log" aria-live="polite">
        {events.length === 0 && status === 'open' && (
          <p className={styles.hint}>Stream connected — waiting for cells…</p>
        )}
        {events.map((event, idx) => (
          <article
            key={`${event.ts_ms}-${idx}`}
            className={`${cls(styles.event)} ${eventKindClass(event)}`}
          >
            <header className={styles.eventHead}>
              <span className={styles.eventKind}>
                {event.type === 'cell' ? '·' : '◆'} {event.kind}
              </span>
              <time className={styles.eventTime}>{formatHHMMSS(event.ts_ms)}</time>
            </header>
            <pre className={styles.eventBody}>{renderPayload(event.payload)}</pre>
          </article>
        ))}
      </main>
    </div>
  );
};

const ShellFallback = (): ReactElement => (
  <div className={styles.layout}>
    <header className={styles.header}>
      <h1 className={styles.title}>Workspace</h1>
      <p className={styles.subtitle}>
        Click a mcp on the left, or drop one here to open it.
      </p>
    </header>
  </div>
);

export const WorkspaceRoute = ({
  mcpId: mcpIdProp,
}: WorkspaceRouteProps = {}): ReactElement => {
  const [urlMcpId, setUrlMcpId] = useState<string | null>(() => readMcpId());
  const mcpId = mcpIdProp !== undefined ? mcpIdProp : urlMcpId;

  useEffect(() => {
    if (mcpIdProp !== undefined) return;
    const onHashChange = (): void => setUrlMcpId(readMcpId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [mcpIdProp]);

  // Legacy single-mcp stream mode — only when an explicit id is in
  // the URL (dedicated Tauri window flow). Multi-instance shell owns
  // everything else.
  if (mcpId) {
    return <LegacyMcpStreamView mcpId={mcpId} />;
  }

  return <WorkspaceShell fallback={<ShellFallback />} />;
};
