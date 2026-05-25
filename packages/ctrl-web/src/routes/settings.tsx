// /settings — single page with an inline tab strip at the top per
// bao 2026-05-24 ("hermes setting / ctrl setting / logs 放在右下角设置
// 页面，按 tab"). Three tabs share one shell; switching tabs is just a
// route change so URL stays canonical and back-button works.
//
//   /settings/ctrl    → CTRL Settings   (manifest-rendered)
//   /settings/hermes  → Hermes Settings (embeds the local dashboard)
//   /settings/logs    → Logs            (release log + installed pill)
//
// Bare /settings redirects to /settings/ctrl so legacy tray / keyboard
// links keep landing somewhere sensible.

import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ManifestRenderer,
  type WorkspaceLayout,
} from '@/components/manifest';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { HERMES_DASHBOARD_DEFAULT_URL } from '@/lib/tab-store';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'hermes' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'CTRL', to: '/settings/ctrl' },
  { id: 'hermes', label: 'Hermes', to: '/settings/hermes' },
  { id: 'logs', label: 'Logs', to: '/settings/logs' },
];

interface SettingsShellProps {
  activeTab: SettingsTab;
  children: ReactNode;
}

const SettingsShell = ({ activeTab, children }: SettingsShellProps): ReactElement => (
  <div className={styles.layout}>
    <header className={styles.header}>
      <h1 className={styles.pageTitle}>Settings</h1>
      <nav className={styles.tabs} role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            to={t.to}
            role="tab"
            aria-selected={activeTab === t.id}
            data-active={activeTab === t.id}
            className={styles.tab}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </header>
    <main className={styles.main} role="main">
      {children}
    </main>
  </div>
);

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
// /settings/ctrl
// ─────────────────────────────────────────────────────────────

const CTRL_SETTINGS_LAYOUT: WorkspaceLayout = {
  version: 1,
  root: {
    component: 'Stack',
    props: { padX: 0, padY: 0, gap: 5 },
    children: [
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
  <SettingsShell activeTab="ctrl">
    <ManifestRenderer layout={CTRL_SETTINGS_LAYOUT} />
  </SettingsShell>
);

// ─────────────────────────────────────────────────────────────
// /settings/hermes
// ─────────────────────────────────────────────────────────────

export const SettingsHermesPage = (): ReactElement => (
  <SettingsShell activeTab="hermes">
    <p className={styles.sectionSubtitle}>
      Skills · models · providers · memory. Lives in the local hermes
      dashboard; CTRL embeds it so the cockpit stays one window.
    </p>
    <iframe
      className={styles.embedFrame}
      src={HERMES_DASHBOARD_DEFAULT_URL}
      title="Hermes dashboard"
      sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
    />
  </SettingsShell>
);

// ─────────────────────────────────────────────────────────────
// /settings/logs
// ─────────────────────────────────────────────────────────────

interface UpdateLogEntry {
  version: string;
  date: string;
  summary: string;
}

const UPDATE_LOG: ReadonlyArray<UpdateLogEntry> = [
  {
    version: '0.1.15',
    date: '2026-05-24',
    summary:
      'VI v0.3 — warm-tinted neutrals · fixed-rem type scale · 9px retired · active-state softened · AI-slop bans enforced (gradient text + side-stripe out) · Irisy SVG breath + blink restored · Settings inline tabs.',
  },
  {
    version: '0.1.14',
    date: '2026-05-23',
    summary:
      'Hephaestus Irisy backend (irisy_init / chat / upgrade) · Tauri auto-updater · version pill · hotkey HID fix.',
  },
  {
    version: '0.1.13',
    date: '2026-05-23',
    summary:
      'Right-rail two-level model · ChatInput / hero / pool / keyboard polish · Settings sub-pages.',
  },
  {
    version: '0.1.12',
    date: '2026-05-23',
    summary:
      'IconRenderer SKILL.md compliance — themes / state machine / reduce-motion / CPU+Worker+WebGL backends.',
  },
];

export const SettingsLogsPage = (): ReactElement => {
  const update = useUpdateStatus();
  return (
    <SettingsShell activeTab="logs">
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
    </SettingsShell>
  );
};
