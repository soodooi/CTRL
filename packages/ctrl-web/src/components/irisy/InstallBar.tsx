// [H-2026-05-18-001] InstallBar — sticky bottom bar.
//
// Shows Zod status (structural error counts go silent on the LLM; only
// semantic errors surface here, mirroring what ChatPane shows) + the
// Install CTA. Per v1 contract, the button is greyed and labelled
// "Install · backend in progress" until zeus Z2 ships install_keycap.

import {
  selectInstallable,
  useKeycapCreatorStore,
} from '@/lib/irisy-keycap-store';
import styles from './InstallBar.module.css';

interface InstallBarProps {
  /** Z2 status. When false, button is greyed with a "coming soon" tooltip. */
  backendReady: boolean;
  /** Called only when backendReady && installable. */
  onInstall(): void;
}

export function InstallBar({ backendReady, onInstall }: InstallBarProps): React.ReactElement {
  const installable = useKeycapCreatorStore(selectInstallable);
  const phase = useKeycapCreatorStore((s) => s.phase);
  const errors = useKeycapCreatorStore((s) => s.errors);

  const structuralCount = errors.filter((e) => e.kind === 'structural').length;
  const semanticCount = errors.filter((e) => e.kind === 'semantic').length;

  const buttonEnabled = backendReady && installable && phase === 'ready';
  const installing = phase === 'installing';

  const buttonLabel = (() => {
    if (installing) return 'Installing…';
    if (!backendReady) return 'Install · backend in progress';
    if (phase === 'installed') return '✓ Installed';
    return '▸ Install keycap';
  })();

  const buttonTitle = backendReady
    ? installable
      ? 'Land manifest + server.ts at ~/.ctrl/keycaps/<id>/'
      : 'Finish slot-filling first'
    : 'Coming soon — zeus Z2 ships install_keycap Tauri command';

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
