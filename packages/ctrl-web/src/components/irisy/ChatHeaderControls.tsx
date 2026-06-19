// ChatHeaderControls — top-of-chat provider chip.
//
// ADR-002 substrate §1 v19 (2026-06-09, 3-agent aggregator): Pi exited
// the hot path, so the v9 Pi-RPC chips (getState model chip, thinking
// cycle, session stats, exportHtml) are retired with it. What remains is
// the one chip with a kernel-side SSOT: the active provider for the
// Irisy persona shell, read from `get_active_providers`
// (ADR-002 § provider v2 §3.7 introspection). Click → Settings →
// Providers, where switching lives.
//
// Decision 0007 §display (2026-06-19): replaced bespoke 8s poll + invoke
// with the shared `useActiveProvider` hook so this chip stays in lockstep
// with the Sidebar + AmbientHome + Settings surfaces instead of drifting
// behind them by 8 seconds.

import { useNavigate } from '@tanstack/react-router';
import { useActiveProvider, formatProviderLabel } from '@/hooks/useActiveProvider';
import styles from './ChatHeaderControls.module.css';

export function ChatHeaderControls(): JSX.Element {
  const navigate = useNavigate();
  const { active, loading } = useActiveProvider();

  const label = active ? formatProviderLabel(active) : loading ? '…' : 'configure provider';
  const title = active
    ? label
    : 'No provider configured — click to open Settings';

  return (
    <div className={styles.bar} role="toolbar" aria-label="Chat runtime controls">
      <button
        type="button"
        className={styles.chip}
        onClick={() => void navigate({ to: '/settings/providers' })}
        title={title}
        aria-label={title}
      >
        <span className={styles.chipIcon} aria-hidden="true">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12" />
          </svg>
        </span>
        <span className={styles.chipLabel}>{label}</span>
      </button>
    </div>
  );
}
