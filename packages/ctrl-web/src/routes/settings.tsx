// /settings — single page with an inline tab strip at the top.
//
//   /settings/ctrl      → General   (theme picker, hotkey readout)
//   /settings/providers → Providers (2-role picker, ADR-002 § provider §3.6)
//   /settings/logs      → Logs      (release log + installed pill + Check for Updates)
//
// /settings/brain retired with Pi (ADR-002 substrate §1 v19, 2026-06-09).
//
// Bare /settings redirects to /settings/ctrl so legacy tray / keyboard
// links keep landing somewhere sensible.

import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTheme } from '@/hooks/useTheme';
import { useKernelStatus } from '@/hooks/useKernelStatus';
import type { ThemePreference } from '@/lib/theme';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { ProviderHub } from '@/components/ambient/ProviderHub';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'providers' | 'agent' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'General', to: '/settings/ctrl' },
  // ADR-002 substrate § provider v2 §3.6 — 2-role provider picker
  { id: 'providers', label: 'Providers', to: '/settings/providers' },
  // Agent (hermes) config — embeds hermes's own dashboard web UI so its
  // agent settings (toolsets / memory / personality) live in one place
  // inside CTRL; the user never has to edit ~/.hermes by hand.
  { id: 'agent', label: 'Irisy', to: '/settings/agent' },
  // brain tab retired with Pi (ADR-002 substrate §1 v19, 2026-06-09)
  { id: 'logs', label: 'Logs', to: '/settings/logs' },
];

// Hermes dashboard web UI port — CTRL starts `hermes dashboard` on this
// fixed loopback port and embeds it (Settings -> Irisy). Keep in sync with
// the kernel-side launcher.
const HERMES_DASHBOARD_URL = 'http://127.0.0.1:17890';

interface SettingsShellProps {
  activeTab: SettingsTab;
  children: ReactNode;
}

// Live header indicator — mirrors the InfraBar chips at the bottom of
// the Irisy chat so the user sees the same substrate state at the top
// of Settings (which provider Pi is talking to, how many vault files
// are indexed). bao 2026-06-01: requested ENGINE + VAULT readout in
// Settings, same data source as the InfraBar.
const SettingsHeaderStatus = (): ReactElement => {
  const status = useKernelStatus();
  const engine = status?.active_brain ?? '—';
  const vaultCount = status?.vault_files ?? null;
  return (
    <div className={styles.headerStatus} aria-label="Substrate status">
      <span className={styles.headerChip} title={`Active provider: ${engine}`}>
        <span className={styles.headerChipLabel}>ENGINE</span>
        <span className={styles.headerChipValue}>{engine}</span>
      </span>
      <span className={styles.headerChip} title="Vault markdown files">
        <span className={styles.headerChipLabel}>VAULT</span>
        <span className={styles.headerChipValue}>{vaultCount ?? '—'}</span>
      </span>
    </div>
  );
};

const SettingsShell = ({ activeTab, children }: SettingsShellProps): ReactElement => {
  // bao 2026-06-04: Settings is opened as a `kind: 'route'` workspace
  // tab (PrimaryRail.handleSettingsClick) and the workspace shell
  // renders the component pulled from `tab.path` in the zustand store.
  // A plain TanStack `<Link>` only updates the URL — the workspace
  // store keeps the old `tab.path` and re-renders the old component,
  // so clicking "Providers" appeared to do nothing. Dispatch
  // `openSystemTab` with the new path so the store + workspace
  // re-render alongside the router navigation. Keep the Link href for
  // a11y / right-click "open in new tab" / accessibility tree.
  return (
    <div className={styles.layout}>
      <header className={styles.header}>
        <div className={styles.headerRow}>
          <h1 className={styles.pageTitle}>Settings</h1>
          <SettingsHeaderStatus />
        </div>
        <nav className={styles.tabs} role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <Link
              key={t.id}
              to={t.to}
              role="tab"
              aria-selected={activeTab === t.id}
              data-active={activeTab === t.id}
              className={styles.tab}
              onClick={() => {
                useWorkspaceStore.getState().openSystemTab({
                  id: 'settings',
                  kind: 'route',
                  path: t.to,
                  title: 'Settings',
                });
              }}
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
};

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
// Sections of /settings/ctrl (= "General")
// ─────────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

const Section = ({ title, description, children }: SectionProps): ReactElement => (
  <section className={styles.section}>
    <header className={styles.sectionHead}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {description && <p className={styles.sectionDesc}>{description}</p>}
    </header>
    <div className={styles.sectionBody}>{children}</div>
  </section>
);

// Theme picker — three-segment control. Pure preference toggle, no API
// round-trip; lives in localStorage via the theme module.
const THEME_OPTIONS: ReadonlyArray<{ id: ThemePreference; label: string; hint: string }> = [
  { id: 'light', label: 'Light', hint: 'Polar white (default)' },
  { id: 'dark', label: 'Dark', hint: 'Cool slate' },
  { id: 'system', label: 'System', hint: 'Follow OS preference' },
];

const ThemePicker = (): ReactElement => {
  const { theme, setTheme } = useTheme();
  return (
    <div className={styles.segmented} role="radiogroup" aria-label="Theme">
      {THEME_OPTIONS.map((opt) => {
        const isActive = theme === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            data-active={isActive}
            className={styles.segment}
            onClick={() => setTheme(opt.id)}
          >
            <span className={styles.segmentLabel}>{opt.label}</span>
            <span className={styles.segmentHint}>{opt.hint}</span>
          </button>
        );
      })}
    </div>
  );
};

// Hotkey readout. The lone-Ctrl chord is the fixed launcher hotkey, owned by
// the native shell (shell/hotkey.rs CGEventTap) — it is intentionally not
// rebindable, so this is a read-only display, not a control.
const HotkeyBlock = (): ReactElement => (
  <div className={styles.hotkeyBox}>
    <div className={styles.hotkeyChord}>
      <kbd className={styles.kbd}>Ctrl</kbd>
    </div>
    <p className={styles.hotkeyNote}>
      Tap to summon or dismiss CTRL. This is the fixed launcher hotkey.
    </p>
  </div>
);

// ─────────────────────────────────────────────────────────────
// /settings/ctrl  (label: General)
// ─────────────────────────────────────────────────────────────

// ADR-002 substrate § provider v3 amendment 2026-06-04 (bao directive:
// theme picker should not sit next to providers). The AI providers
// section moved to its own dedicated `/settings/providers` tab (Tabs
// entry at the top of this file). General now hosts user-preference
// surface only: appearance + hotkey.
export const SettingsCtrlPage = (): ReactElement => (
  <SettingsShell activeTab="ctrl">
    <Section
      title="Appearance"
      description="Polar paper or cool slate. System follows your OS dark / light setting."
    >
      <ThemePicker />
    </Section>
    <Section
      title="Hotkey"
      description="Single-key chord to summon CTRL. The hotkey is reserved by the launcher, not by any individual mcp."
    >
      <HotkeyBlock />
    </Section>
  </SettingsShell>
);

// ─────────────────────────────────────────────────────────────
// /settings/brain — RETIRED (ADR-002 substrate §1 v19, 2026-06-09)
// ─────────────────────────────────────────────────────────────
// Pi exited the hot path with the 3-agent aggregator, taking the
// pi_status / pi_upgrade_now panel with it. Provider selection lives in
// Settings → Providers; per-agent install state surfaces via
// commands/agents.rs (agent_status / list_agents) when an agents
// settings pane lands.

// ─────────────────────────────────────────────────────────────
// /settings/logs
// ─────────────────────────────────────────────────────────────

interface UpdateLogEntry {
  version: string;
  date: string;
  summary: string;
}

// Manually-maintained changelog. When a CHANGELOG.md lands at the repo
// root, swap this for a vite-import-glob of that file parsed at build
// time so the list stays current automatically.
const UPDATE_LOG: ReadonlyArray<UpdateLogEntry> = [
  {
    version: '0.1.41',
    date: '2026-05-26',
    summary:
      'macOS launcher activation — NSApp.activate() back on show so the window actually focuses after Ctrl-hotkey toggle.',
  },
  {
    version: '0.1.40',
    date: '2026-05-26',
    summary:
      'PWA polish lap — polar white v0.5 tokens · pupil-blink baked in lottie · right-rail L1 fixed (route-pushed items channel removed) · new InstallMcpTile primitive · Modal + ConfirmDialog primitives (portal + focus-trap) · Settings rewritten with real controls.',
  },
  {
    version: '0.1.39',
    date: '2026-05-25',
    summary:
      'VMark stack adoption — Tiptap markdown WYSIWYG · CodeMirror 6 · mermaid.js · SmartTable viewer · Vault browser + backlinks · ADR-001 spine amendment (Pi sole brain, hermes demoted to mcp).',
  },
  {
    version: '0.1.34',
    date: '2026-05-23',
    summary:
      'Right-rail two-level model · ChatInput / hero / pool / keyboard polish · Settings inline tabs · Tauri auto-updater · Hephaestus Irisy backend (irisy_init / chat / upgrade).',
  },
  {
    version: '0.1.15',
    date: '2026-05-24',
    summary:
      'VI v0.3 — warm-tinted neutrals · fixed-rem type scale · 9px retired · active-state softened · AI-slop bans enforced.',
  },
];

export const SettingsProvidersPage = (): ReactElement => (
  <SettingsShell activeTab="providers">
    <Section
      title="Irisy provider"
      description="Pick the model Irisy uses. Paste your API key once — Volc, Zhipu, Claude and more — and switch anytime."
    >
      <ProviderHub inline />
    </Section>
  </SettingsShell>
);

// Settings -> Irisy : embed hermes's own dashboard web UI (config / agent
// settings / sessions). hermes serves the full front+back at a loopback port;
// CTRL just frames it so the user configures the agent without leaving CTRL.
export const SettingsAgentPage = (): ReactElement => (
  <SettingsShell activeTab="agent">
    <iframe
      title="Irisy agent settings"
      src={HERMES_DASHBOARD_URL}
      style={{
        width: '100%',
        height: 'calc(100vh - 160px)',
        border: 'none',
        borderRadius: 12,
        background: '#fff',
      }}
    />
  </SettingsShell>
);

export const SettingsLogsPage = (): ReactElement => {
  const update = useUpdateStatus();
  const buttonLabel = update.installing
    ? 'Installing…'
    : update.checking
      ? 'Checking…'
      : update.available
        ? `Install v${update.latestVersion ?? ''} & restart`
        : 'Check for Updates';
  const onClick = update.available ? update.installAndRestart : update.checkNow;
  const disabled = update.checking || update.installing;
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
      <div className={styles.updateActions}>
        <button
          type="button"
          className={styles.updateButton}
          data-tone={update.available ? 'primary' : 'default'}
          onClick={() => void onClick()}
          disabled={disabled}
        >
          {buttonLabel}
        </button>
        {update.error ? (
          <span className={styles.updateError}>{update.error}</span>
        ) : null}
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
