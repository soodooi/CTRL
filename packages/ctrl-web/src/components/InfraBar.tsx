// InfraBar — substrate-state chip row at the bottom of the Irisy chat
// pane (= directly above the input window's top edge in companion mode).
//
// bao 2026-05-30: "底座, 基础设施放在对话框上方, 基础设施包括 provider
// mcp, 键帽等" + 校正 "CTRL logo 右侧是 KRN 的指示灯, 其他的在对话框
// 底部". This bar carries the substrate state (ENGINE, MCP count, VAULT
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
