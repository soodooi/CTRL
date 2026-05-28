// /settings — single page with an inline tab strip at the top.
//
//   /settings/ctrl    → General (theme picker, BYOK providers, hotkey readout)
//   /settings/brain   → Brain   (cc-switch style switcher, ADR-021)
//   /settings/logs    → Logs    (release log + installed pill + Check for Updates)
//
// Bare /settings redirects to /settings/ctrl so legacy tray / keyboard
// links keep landing somewhere sensible.

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
import { invoke } from '@/lib/bridge';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'brain' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'General', to: '/settings/ctrl' },
  { id: 'brain', label: 'Brain', to: '/settings/brain' },
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
// /settings/brain  (ADR-021 — cc-switch / VMark / opencode style)
// ─────────────────────────────────────────────────────────────

interface BrainView {
  id: string;
  label: string;
  command: string;
  mcp_port: number | null;
  mcp_url: string | null;
  description: string;
  adapter: string | null;
  binary_path: string | null;
  version: string | null;
  reachable: boolean;
  active: boolean;
  adapter_available: boolean;
}

interface BrainListReply {
  brains: BrainView[];
  active_id: string;
}

export const SettingsBrainPage = (): ReactElement => {
  const [reply, setReply] = useState<BrainListReply | null>(null);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await invoke<BrainListReply>('brain_list');
      setReply(result);
      setError(null);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(`brain_list failed: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const detect = useCallback(async (): Promise<void> => {
    setDetecting(true);
    try {
      const result = await invoke<BrainListReply>('brain_detect');
      setReply(result);
      setError(null);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(`brain_detect failed: ${detail}`);
    } finally {
      setDetecting(false);
    }
  }, []);

  const selectBrain = useCallback(
    async (id: string): Promise<void> => {
      setSavingId(id);
      try {
        const result = await invoke<BrainListReply>('brain_set_active', { args: { id } });
        setReply(result);
        setError(null);
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        setError(detail);
      } finally {
        setSavingId(null);
      }
    },
    [],
  );

  return (
    <SettingsShell activeTab="brain">
      <div className={styles.brainHeader}>
        <div className={styles.brainHeaderText}>
          <h2 className={styles.brainTitle}>Brain</h2>
          <p className={styles.brainHelp}>
            Pick which agent CLI drives Irisy. Only entries with a CTRL-shipped
            adapter can be activated; the others are scaffolded for future
            adapters.
          </p>
        </div>
        <div className={styles.brainActions}>
          <button
            type="button"
            className={styles.brainButton}
            onClick={() => void detect()}
            disabled={detecting || loading}
          >
            {detecting ? 'Detecting…' : 'Detect on $PATH'}
          </button>
        </div>
      </div>

      {error && <p className={styles.brainError}>{error}</p>}

      {loading ? (
        <p className={styles.sectionSubtitle}>Loading brain registry…</p>
      ) : (
        <ul className={styles.brainList}>
          {reply?.brains.map((b) => {
            const detected = b.binary_path != null;
            const canActivate = b.adapter_available && detected;
            const isSaving = savingId === b.id;
            return (
              <li
                key={b.id}
                className={styles.brainCard}
                data-active={b.active}
                data-detected={detected}
              >
                <div className={styles.brainRadio}>
                  <input
                    type="radio"
                    name="active-brain"
                    aria-label={`Set ${b.label} as active brain`}
                    checked={b.active}
                    disabled={!canActivate || isSaving}
                    onChange={() => void selectBrain(b.id)}
                  />
                </div>
                <div className={styles.brainBody}>
                  <span className={styles.brainName}>{b.label}</span>
                  <span className={styles.brainDetail}>
                    {b.binary_path ?? '(not on $PATH)'}
                    {b.version ? ` · ${b.version}` : ''}
                    {b.mcp_port != null ? ` · :${b.mcp_port}` : ''}
                  </span>
                  <div className={styles.brainTags}>
                    {b.adapter_available ? (
                      <span className={styles.brainTag} data-tone="good">
                        adapter shipped
                      </span>
                    ) : (
                      <span className={styles.brainTag} data-tone="warn">
                        adapter coming
                      </span>
                    )}
                    {b.reachable && (
                      <span className={styles.brainTag} data-tone="good">
                        reachable
                      </span>
                    )}
                    {b.description && (
                      <span className={styles.brainTag}>{b.description}</span>
                    )}
                  </div>
                </div>
                <div className={styles.brainStatus}>
                  {b.active
                    ? 'active'
                    : !detected
                      ? 'not installed'
                      : !b.adapter_available
                        ? 'not yet'
                        : isSaving
                          ? 'saving…'
                          : ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SettingsShell>
  );
};

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
