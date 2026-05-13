// /workspace — ephemeral workspace route. Replaces win/CTRL/Pages/WorkspacePage.xaml.
//
// Renders the live result of a running keycap. Fed by the kernel via the
// ST-SS stream (Cell stream subscribed through @ctrl/kernel-sdk transport).
// Sub-PR c/2 wires the subscription; for now, placeholder.

import styles from './workspace.module.css';

export const WorkspaceRoute = (): React.ReactElement => (
  <div className={styles.layout}>
    <main className={styles.main} role="main">
      <h1 className={styles.title}>Workspace</h1>
      <p className={styles.subtitle}>
        Pick a keycap from the pool to start. Results stream here.
      </p>
    </main>
  </div>
);
