// VersionPill — bottom-left of the shell. Click to check + install the
// next update via Tauri's updater. The pill is the only place version is
// shown; previously lived in the right rail's footer.

import type { ReactElement } from 'react';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import styles from '../app.module.css';

export const VersionPill = (): ReactElement => {
  const update = useUpdateStatus();
  const title = update.installing
    ? 'Installing…'
    : update.checking
      ? 'Checking…'
      : update.available
        ? `Click to install v${update.latestVersion ?? ''} & restart`
        : `CTRL v${APP_VERSION} · click to check for updates`;
  const label = update.installing
    ? 'Updating…'
    : update.checking
      ? 'Checking…'
      : `v${APP_VERSION}`;
  return (
    <button
      type="button"
      className={styles.versionPill}
      title={title}
      onClick={() => void update.checkAndInstall()}
      disabled={update.checking || update.installing}
    >
      <span>{label}</span>
      {update.available && (
        <span
          className={styles.versionPillDot}
          aria-label="Update available"
          role="status"
        />
      )}
    </button>
  );
};
