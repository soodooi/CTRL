// /settings/* — three sub-pages selected via the right rail level-2
// sub-panel that appears when Settings is the active rail item.
//
//   /settings/ctrl    → CTRL Settings   (manifest-rendered, the L3 test bed)
//   /settings/hermes  → Hermes Settings (embeds the local hermes dashboard)
//   /settings/updates → Update Log      (build / channel info, recent changes)
//
// Bare /settings is registered separately in app.tsx as a redirect shim
// to /settings/ctrl so tray bridge / keyboard system-key flows that
// targeted the old single page keep working.

import { useEffect, type ReactElement } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  ManifestRenderer,
  type WorkspaceLayout,
} from '@/components/manifest';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { useKernelStatus } from '../hooks/useKernelStatus';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// /settings → /settings/ctrl
// ─────────────────────────────────────────────────────────────

export const SettingsRedirect = (): ReactElement => {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: '/settings/ctrl', replace: true });
  }, [navigate]);
  return <div className={styles.layout} />;
};

// ─────────────────────────────────────────────────────────────
// /settings/ctrl — CTRL shell preferences (manifest-rendered)
// ─────────────────────────────────────────────────────────────

const CTRL_SETTINGS_LAYOUT: WorkspaceLayout = {
  version: 1,
  root: {
    component: 'Stack',
    props: { padX: 6, padY: 6, gap: 5 },
    children: [
      { component: 'Heading', props: { level: 1 }, children: ['CTRL Settings'] },

      // About — version + auto-update + changelog. First section so users
      // see the build they're on without scrolling.
      { component: 'AboutPanel' },

      {
        component: 'Stack',
        props: { gap: 2 },
        children: [
          { component: 'Heading', props: { level: 4 }, children: ['Marketplace'] },
          {
            component: 'Text',
            props: { tone: 'soft' },
            children: ['Install keycaps from 10,000+ MCP servers in one click.'],
          },
        ],
      },

      {
        component: 'Stack',
        props: { gap: 2 },
        children: [
          { component: 'Heading', props: { level: 4 }, children: ['BYOK'] },
          {
            component: 'Text',
            props: { tone: 'soft' },
            children: [
              'Bring your own AI key (Volc / Anthropic / OpenAI / Ollama) for higher-quality creator flows. Stored in OS keychain — never crosses the network from this device.',
            ],
          },
        ],
      },

      {
        component: 'Stack',
        props: { gap: 2 },
        children: [
          { component: 'Heading', props: { level: 4 }, children: ['Layer model'] },
          {
            component: 'Text',
            props: { tone: 'soft' },
            children: [
              'This page is rendered by ManifestRenderer from a JSON layout — the L3 piece of the cockpit layer model. Same renderer will eat keycap manifests.',
            ],
          },
        ],
      },
    ],
  },
};

export const SettingsCtrlPage = (): ReactElement => (
  <div className={styles.layout}>
    <main className={styles.main} role="main">
      <ManifestRenderer layout={CTRL_SETTINGS_LAYOUT} />
    </main>
  </div>
);

// ─────────────────────────────────────────────────────────────
// /settings/hermes — Hermes brain config (embeds the dashboard)
// ─────────────────────────────────────────────────────────────

export const SettingsHermesPage = (): ReactElement => {
  const status = useKernelStatus();
  // `hermes_dashboard_url` is `null` when the kernel's probe of
  // 127.0.0.1:9119 fails (daemon not running / hermes not installed).
  // Earlier versions blindly embedded the iframe and showed a white
  // box for users without hermes — bao 2026-05-24 bug.
  const dashboardUrl = status?.hermes_dashboard_url ?? null;
  return (
    <div className={styles.layout}>
      <main className={styles.main} role="main">
        <header className={styles.embedHeader}>
          <h1 className={styles.embedTitle}>Hermes Settings</h1>
          <p className={styles.embedSubtitle}>
            Skills · models · providers · memory. Lives in the local hermes
            dashboard; CTRL embeds it here so the cockpit stays one window.
          </p>
        </header>
        {dashboardUrl ? (
          <iframe
            className={styles.embedFrame}
            src={dashboardUrl}
            title="Hermes dashboard"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        ) : (
          <div className={styles.emptyState} role="status">
            <p className={styles.emptyTitle}>Hermes is not running</p>
            <p className={styles.emptyBody}>
              CTRL couldn't reach the local Hermes dashboard at
              {' '}<code>127.0.0.1:9119</code>.
              Install + start <code>hermes-agent</code> to enable skill, model,
              provider, and memory configuration here.
            </p>
            <p className={styles.emptyHint}>
              Install: <code>pipx install hermes-agent</code> · Start the
              daemon, then reopen this page.
            </p>
          </div>
        )}
      </main>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// /settings/updates — build info + update log
// ─────────────────────────────────────────────────────────────

interface UpdateLogEntry {
  version: string;
  date: string;
  summary: string;
}

// Hand-maintained changelog until the kernel exposes an automated feed.
// New top entry per release; oldest at the bottom. Keep summaries to
// one line — long-form release notes belong in the GitHub release page.
const UPDATE_LOG: ReadonlyArray<UpdateLogEntry> = [
  {
    version: '0.1.13',
    date: '2026-05-23',
    summary:
      'Right-rail two-level model · Lottie Irisy mascot · ChatInput / hero / pool / keyboard polish · Settings sub-pages.',
  },
  {
    version: '0.1.12',
    date: '2026-05-23',
    summary:
      'IconRenderer SKILL.md compliance — themes / state machine / reduce-motion / CPU+Worker+WebGL backends.',
  },
  {
    version: '0.1.11',
    date: '2026-05-23',
    summary:
      'Hide button on the StatusBar; window cloak / reveal hardening.',
  },
  {
    version: '0.1.10',
    date: '2026-05-23',
    summary:
      'Initial ThorVG icon system landed — TabBar / RightRail / KeycapCard moved through the single IconRenderer pipeline.',
  },
];

export const SettingsUpdatesPage = (): ReactElement => {
  const update = useUpdateStatus();
  return (
    <div className={styles.layout}>
      <main className={styles.main} role="main">
        <header className={styles.embedHeader}>
          <h1 className={styles.embedTitle}>Update Log</h1>
          <div className={styles.versionBadge}>
            <span className={styles.versionBadgeLabel}>Installed</span>
            <span className={styles.versionBadgeValue}>v{APP_VERSION}</span>
            {update.available ? (
              <span className={styles.versionBadgePill} data-tone="success">
                update available
                {update.latestVersion ? ` · v${update.latestVersion}` : ''}
              </span>
            ) : (
              <span className={styles.versionBadgePill} data-tone="idle">
                up to date
              </span>
            )}
          </div>
        </header>

        <ul className={styles.changelog}>
          {UPDATE_LOG.map((entry) => {
            const isCurrent = entry.version === APP_VERSION;
            return (
              <li
                key={entry.version}
                className={styles.changeRow}
                data-current={isCurrent}
              >
                <div className={styles.changeMeta}>
                  <span className={styles.changeVersion}>v{entry.version}</span>
                  <span className={styles.changeDate}>{entry.date}</span>
                </div>
                <p className={styles.changeSummary}>{entry.summary}</p>
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
};
