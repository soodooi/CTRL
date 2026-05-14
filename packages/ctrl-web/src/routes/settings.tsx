// /settings — Settings + Marketplace + BYOK keys.
//
// Sub-PR c/2: real MCP marketplace listing + install flow + BYOK key entry.
// This commit ships the route shell so navigation works end-to-end.

import styles from './settings.module.css';

export const SettingsRoute = (): React.ReactElement => (
  <div className={styles.layout}>
    <main className={styles.main} role="main">
      <h1 className={styles.title}>Settings</h1>
      <section className={styles.section}>
        <h2 className={styles.h2}>Marketplace</h2>
        <p className={styles.body}>
          Install keycaps from 10,000+ MCP servers in one click.
        </p>
      </section>
      <section className={styles.section}>
        <h2 className={styles.h2}>BYOK</h2>
        <p className={styles.body}>
          Bring your own Anthropic / OpenAI key for higher-quality creator
          flows. Stored in OS keychain — never crosses the network from this device.
        </p>
      </section>
    </main>
  </div>
);
