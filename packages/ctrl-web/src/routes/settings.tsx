// /settings — two-tab page (General / Logs). Tabs share one shell.
//
// Per bao 2026-05-26 audit:
//   - `/settings/hermes` removed. Hermes is no longer brain (Pi is sole
//     brain per decision_pi_is_sole_brain_hermes_is_keycap); hermes
//     configuration belongs in keycap config, not CTRL Settings.
//   - `/settings/ctrl` was rendering marketing prose — replaced with
//     actual controls (theme picker, provider table, hotkey readout).
//   - `/settings/logs` was stale at 0.1.15; brought up to 0.1.41.
//
// URL kept as `/settings/ctrl` for back-compat with the tray bridge +
// keyboard system-key links that already deep-link to it. The tab
// label reads "General" so users see the right name.

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  FormField,
  StatusPill,
  TextInput,
  type StatusPillProps,
} from '@/components/primitives';
import { useTheme } from '@/hooks/useTheme';
import {
  deleteProvider,
  listProviders,
  setProviderKey,
  testProvider,
  type ProviderInfo,
  type TestProviderResult,
} from '@/lib/kernel';
import type { ThemePreference } from '@/lib/theme';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'General', to: '/settings/ctrl' },
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

// Provider row — one card per known provider. Inline edit + test +
// delete; pending state disables both buttons. Errors surface inline
// rather than via a global toast (we don't have one yet).
interface ProviderRowProps {
  provider: ProviderInfo;
  onRefresh: () => Promise<void>;
}

const statusTone = (
  provider: ProviderInfo,
): StatusPillProps['tone'] =>
  provider.is_active ? 'nominal' : 'offline';

const statusLabel = (provider: ProviderInfo): string =>
  provider.is_active ? 'active' : 'not configured';

const ProviderRow = ({ provider, onRefresh }: ProviderRowProps): ReactElement => {
  const [apiKey, setApiKey] = useState('');
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: (key: string) =>
      setProviderKey({ provider: provider.name, api_key: key }),
    onSuccess: async () => {
      setApiKey('');
      setError(null);
      await onRefresh();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const testMutation = useMutation({
    mutationFn: () => testProvider(provider.name),
    onSuccess: (result) => {
      setTestResult(result);
      setError(null);
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteProvider(provider.name),
    onSuccess: async () => {
      setApiKey('');
      setTestResult(null);
      setError(null);
      await onRefresh();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const busy =
    saveMutation.isPending ||
    testMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div className={styles.providerRow}>
      <div className={styles.providerHead}>
        <div className={styles.providerIdentity}>
          <h3 className={styles.providerName}>{provider.display_name}</h3>
          <code className={styles.providerSlug}>{provider.name}</code>
        </div>
        <StatusPill tone={statusTone(provider)}>
          {statusLabel(provider)}
        </StatusPill>
      </div>
      <dl className={styles.providerMeta}>
        <div>
          <dt>Endpoint</dt>
          <dd>{provider.base_url}</dd>
        </div>
        <div>
          <dt>Default model</dt>
          <dd>{provider.default_model}</dd>
        </div>
      </dl>
      <FormField
        label={provider.is_active ? 'Update API key' : 'API key'}
        hint="Stored in macOS Keychain. Never leaves this device."
      >
        <TextInput
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider.is_active ? '••••••••  (set, hidden)' : 'sk-…'}
          autoComplete="off"
          disabled={busy}
        />
      </FormField>
      <div className={styles.providerActions}>
        <Button
          size="sm"
          variant="primary"
          onClick={() => saveMutation.mutate(apiKey)}
          disabled={busy || apiKey.trim().length === 0}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => testMutation.mutate()}
          disabled={busy || !provider.is_active}
        >
          {testMutation.isPending ? 'Testing…' : 'Test'}
        </Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => deleteMutation.mutate()}
          disabled={busy || !provider.is_active}
        >
          {deleteMutation.isPending ? 'Removing…' : 'Remove'}
        </Button>
      </div>
      {testResult && (
        <p
          className={styles.providerTestResult}
          data-tone={testResult.success ? 'success' : 'danger'}
        >
          {testResult.success ? '✓' : '✗'} {testResult.message}
          {testResult.model_count != null && (
            <> · {testResult.model_count} models · {testResult.elapsed_ms}ms</>
          )}
        </p>
      )}
      {error && (
        <p className={styles.providerError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

const ProvidersBlock = (): ReactElement => {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: ['providers'],
    queryFn: listProviders,
  });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['providers'] });
  }, [queryClient]);

  if (providersQuery.isPending) {
    return <p className={styles.providersFallback}>Loading providers…</p>;
  }
  if (providersQuery.isError) {
    return (
      <p className={styles.providersFallback} data-tone="danger">
        Failed to load providers:{' '}
        {providersQuery.error instanceof Error
          ? providersQuery.error.message
          : String(providersQuery.error)}
      </p>
    );
  }

  const providers = providersQuery.data ?? [];
  return (
    <div className={styles.providerStack}>
      {providers.map((p) => (
        <ProviderRow key={p.name} provider={p} onRefresh={refresh} />
      ))}
    </div>
  );
};

// Hotkey readout — read-only summary today. Rebinding lives in the
// system tray (lifecycle.rs owns the chord, PWA can't mutate it yet).
const HotkeyBlock = (): ReactElement => (
  <div className={styles.hotkeyBox}>
    <div className={styles.hotkeyChord}>
      <kbd className={styles.kbd}>Ctrl</kbd>
    </div>
    <p className={styles.hotkeyNote}>
      Tap to summon or dismiss CTRL. To rebind, open the system tray
      menu and choose <em>Set hotkey…</em>
    </p>
  </div>
);

// ─────────────────────────────────────────────────────────────
// /settings/ctrl  (label: General)
// ─────────────────────────────────────────────────────────────

export const SettingsCtrlPage = (): ReactElement => (
  <SettingsShell activeTab="ctrl">
    <Section
      title="Appearance"
      description="Polar paper or cool slate. System follows your OS dark / light setting."
    >
      <ThemePicker />
    </Section>
    <Section
      title="AI providers"
      description={
        <>
          Bring your own key. Keys live in the macOS Keychain and never
          cross the network from CTRL itself. Anthropic / Claude is
          deliberately absent from the runtime list (ADR-005).
        </>
      }
    >
      <ProvidersBlock />
    </Section>
    <Section
      title="Hotkey"
      description="Single-key chord to summon CTRL. The hotkey is reserved by the launcher, not by any individual keycap."
    >
      <HotkeyBlock />
    </Section>
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
      'PWA polish lap — polar white v0.5 tokens · pupil-blink baked in lottie · right-rail L1 fixed (route-pushed items channel removed) · new InstallKeycapTile primitive · Modal + ConfirmDialog primitives (portal + focus-trap) · Settings rewritten with real controls.',
  },
  {
    version: '0.1.39',
    date: '2026-05-25',
    summary:
      'VMark stack adoption — Tiptap markdown WYSIWYG · CodeMirror 6 · mermaid.js · SmartTable viewer · Vault browser + backlinks · ADR-001 amendment (Pi sole brain, hermes demoted to keycap).',
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
