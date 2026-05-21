// /workspace — ephemeral workspace route.
//
// Per bao 2026-05-14, this route loads in a DEDICATED window (label =
// "workspace" in tauri.conf.json), not as a tab in the main launcher.
// The Rust shell navigates this window's URL on each keycap activation,
// so the route reads `keycap_id` from the URL search params (or hash
// param when navigation uses location.hash + hashchange dispatch).
//
// Cell stream: useCellStream subscribes to `keycap-<id>` on the kernel
// bridge; incoming Cell/Op events render in a kind-aware feed.

import { useEffect, useMemo, useState } from 'react';
import { useCellStream, type EventRecord } from '@/hooks/useCellStream';
import styles from './workspace.module.css';

const readKeycapId = (): string | null => {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  if (url.searchParams.has('keycap_id')) return url.searchParams.get('keycap_id');
  const hash = url.hash;
  const hashQs = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : '';
  return new URLSearchParams(hashQs).get('keycap_id');
};

const formatTime = (tsMs: number): string => {
  const d = new Date(tsMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
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
  if (event.kind === 'keycap_failed') return cls(styles.opFailed);
  if (event.kind === 'keycap_completed') return cls(styles.opComplete);
  return cls(styles.opDefault);
};

interface WorkspaceRouteProps {
  /**
   * Override the keycap id source. When omitted the route reads the id from
   * the URL (default behavior used by the dedicated Tauri workspace window).
   * The dual-panel home view passes its own state so left/right panels stay
   * in sync without round-tripping through hashchange.
   */
  keycapId?: string | null;
}

export const WorkspaceRoute = ({
  keycapId: keycapIdProp,
}: WorkspaceRouteProps = {}): React.ReactElement => {
  const [urlKeycapId, setUrlKeycapId] = useState<string | null>(() => readKeycapId());
  const keycapId = keycapIdProp !== undefined ? keycapIdProp : urlKeycapId;

  useEffect(() => {
    // Skip the hashchange wiring when an explicit id is provided — the parent
    // owns the lifecycle and we should not race it.
    if (keycapIdProp !== undefined) return;
    const onHashChange = (): void => setUrlKeycapId(readKeycapId());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [keycapIdProp]);

  const streamId = useMemo(() => (keycapId ? `keycap-${keycapId}` : null), [keycapId]);
  const { events, status, error } = useCellStream(streamId);

  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <h1 className={styles.title}>Workspace</h1>
        {keycapId ? (
          <p className={styles.subtitle}>
            Keycap <code className={styles.code}>{keycapId}</code>
            <span className={`${cls(styles.status)} ${cls(styles[`status_${status}`])}`}>
              {status}
            </span>
          </p>
        ) : (
          <p className={styles.subtitle}>Pick a keycap from the pool to start.</p>
        )}
        {error && <p className={styles.error}>{error}</p>}
      </header>

      <main className={styles.feed} role="log" aria-live="polite">
        {keycapId && events.length === 0 && status === 'open' && (
          <p className={styles.hint}>Stream connected — waiting for cells…</p>
        )}
        {events.map((event, idx) => (
          <article key={`${event.ts_ms}-${idx}`} className={`${cls(styles.event)} ${eventKindClass(event)}`}>
            <header className={styles.eventHead}>
              <span className={styles.eventKind}>
                {event.type === 'cell' ? '·' : '◆'} {event.kind}
              </span>
              <time className={styles.eventTime}>{formatTime(event.ts_ms)}</time>
            </header>
            <pre className={styles.eventBody}>{renderPayload(event.payload)}</pre>
          </article>
        ))}
      </main>
    </div>
  );
};
