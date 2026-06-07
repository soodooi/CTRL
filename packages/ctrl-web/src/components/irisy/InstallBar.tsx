// InstallBar — sticky bottom bar.
//
// Shows Zod status (structural error counts go silent on the LLM; only
// semantic errors surface here, mirroring what ChatPane shows) + the
// Install CTA.
//
// 2026-05-30 (ECC review C5): the historical "backend in progress" gate
// referred to zeus's Z2 install_mcp Tauri command, which shipped at
// commands/kernel.rs:197 long ago. The prop + greyed-out branch are
// retired; the CTA is always live as long as the manifest is installable.

import {
  selectInstallable,
  useMcpCreatorStore,
} from '@/lib/irisy-mcp-store';
import styles from './InstallBar.module.css';

interface InstallBarProps {
  /** Called only when the manifest is installable. */
  onInstall(): void;
}

export function InstallBar({ onInstall }: InstallBarProps): React.ReactElement {
  const installable = useMcpCreatorStore(selectInstallable);
  const phase = useMcpCreatorStore((s) => s.phase);
  const errors = useMcpCreatorStore((s) => s.errors);

  const structuralCount = errors.filter((e) => e.kind === 'structural').length;
  const semanticCount = errors.filter((e) => e.kind === 'semantic').length;

  const buttonEnabled = installable && phase === 'ready';
  const installing = phase === 'installing';

  const buttonLabel = (() => {
    if (installing) return 'Installing…';
    if (phase === 'installed') return '✓ Installed';
    return '▸ Install mcp';
  })();

  const buttonTitle = installable
    ? 'Land manifest + server.ts at ~/.ctrl/mcps/<id>/'
    : 'Finish slot-filling first';

  return (
    <footer className={styles.bar}>
      <div className={styles.status}>
        <span className={styles.zodLabel}>Zod</span>
        <span
          className={`${styles.zodValue} ${
            structuralCount > 0 ? styles.zodFail : styles.zodPass
          }`}
        >
          {structuralCount === 0 ? '✓ structural' : `✗ ${structuralCount} structural`}
        </span>
        <span className={styles.zodSep}>·</span>
        <span
          className={`${styles.zodValue} ${
            semanticCount > 0 ? styles.zodFail : styles.zodPass
          }`}
        >
          {semanticCount === 0
            ? 'no semantic issues'
            : `${semanticCount} semantic ${semanticCount === 1 ? 'issue' : 'issues'}`}
        </span>
      </div>

      <button
        type="button"
        className={`${styles.cta} ${buttonEnabled ? styles.ctaReady : ''}`}
        disabled={!buttonEnabled || installing}
        onClick={onInstall}
        title={buttonTitle}
      >
        {buttonLabel}
      </button>
    </footer>
  );
}
