// InfraBar — substrate-state chip row at the bottom of the Irisy chat
// pane (= directly above the input window's top edge in companion mode).
//
// bao 2026-05-30 (substrate-state placement): the substrate row
// (ENGINE, provider, mcps) sits directly above the input window, not in
// the StatusBar top zone. The CTRL logo's KRN indicator lives in the
// header; everything else lives in this bar at the bottom of the
// chat pane.
// ADR-002 substrate § brain v17 (2026-06-07): legacy "keycap" word
// retired from the comment alongside the concept.
//
// This bar carries the substrate state (ENGINE, MCP count, VAULT
// file count) that previously cluttered the StatusBar's top zone.

import type { ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useKernelStatus } from '../hooks/useKernelStatus';
import styles from './InfraBar.module.css';

interface InfraChipProps {
  label: string;
  value: string | number;
  title?: string;
  onClick?: () => void;
}

const InfraChip = ({ label, value, title, onClick }: InfraChipProps): ReactElement => {
  const body = (
    <>
      <span className={styles.chipLabel}>{label}</span>
      <span className={styles.chipValue}>{value}</span>
    </>
  );
  if (onClick) {
    return (
      <button type="button" className={`${styles.chip} ${styles.chipButton}`} title={title} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <span className={styles.chip} title={title}>
      {body}
    </span>
  );
};

export const InfraBar = (): ReactElement => {
  const status = useKernelStatus();
  const navigate = useNavigate();

  const engine = status?.active_brain ?? '—';
  const mcpCount = status?.mcp_servers_installed ?? null;
  const vaultCount = status?.vault_files ?? null;

  return (
    <footer className={styles.bar} aria-label="Substrate status">
      <InfraChip
        label="ENGINE"
        value={engine}
        title={`Active brain: ${engine}`}
        onClick={() => void navigate({ to: '/settings/brain' })}
      />
      <InfraChip
        label="MCP"
        value={mcpCount ?? '—'}
        title="MCP servers installed"
      />
      <InfraChip
        label="VAULT"
        value={vaultCount ?? '—'}
        title="Vault markdown files"
      />
    </footer>
  );
};
