// ChatHeaderControls — top-of-chat provider chip.
//
// ADR-002 substrate §1 v19 (2026-06-09, 3-agent aggregator): Pi exited
// the hot path, so the v9 Pi-RPC chips (getState model chip, thinking
// cycle, session stats, exportHtml) are retired with it. What remains is
// the one chip with a kernel-side SSOT: the active provider for the
// Irisy persona shell, read from `get_active_providers`
// (ADR-002 § provider v2 §3.7 introspection). Click → Settings →
// Providers, where switching lives.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { invoke } from '@tauri-apps/api/core';
import styles from './ChatHeaderControls.module.css';

interface ActiveRoleProvider {
  id: string;
  label: string;
  model_id: string | null;
  model_label: string | null;
}

interface ActiveProvidersView {
  roles: Record<string, ActiveRoleProvider>;
}

const PRIMARY_ROLE = 'irisy.primary';

export function ChatHeaderControls(): JSX.Element {
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveRoleProvider | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const view = await invoke<ActiveProvidersView>('get_active_providers');
      setActive(view.roles[PRIMARY_ROLE] ?? null);
    } catch {
      // Browser preview without a kernel — chip falls back to the
      // configure-provider affordance.
      setActive(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Settings mutates the SSOT in another route; a slow poll keeps the
    // chip honest without a dedicated event channel.
    const id = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(id);
  }, [refresh]);

  const label = active
    ? active.model_label
      ? `${active.label} · ${active.model_label}`
      : active.label
    : 'configure provider';
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
