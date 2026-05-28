// /settings — single page with an inline tab strip at the top.
//
//   /settings/ctrl    → CTRL Settings   (manifest-rendered)
//   /settings/brain   → Brain Settings  (cc-switch style switcher, ADR-021)
//   /settings/logs    → Logs            (release log + installed pill)
//
// Bare /settings redirects to /settings/ctrl so legacy tray / keyboard
// links keep landing somewhere sensible. /settings/hermes is retained
// as a redirect to /settings/brain — the Hermes-as-brain framing was
// superseded 2026-05-25 (ADR-019) and the Settings tab follows.

import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ManifestRenderer,
  type WorkspaceLayout,
} from '@/components/manifest';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { invoke } from '@/lib/bridge';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'brain' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'CTRL', to: '/settings/ctrl' },
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

// Backwards-compat: the old `/settings/hermes` route now redirects to
// /settings/brain. Kept so the tray / keyboard's "open settings"
// shortcut (which still links to the old URL) lands somewhere live.
export const SettingsHermesPage = (): ReactElement => {
  const navigate = useNavigate();
  useEffect(() => {
    void navigate({ to: '/settings/brain', replace: true });
  }, [navigate]);
  return <div className={styles.layout} />;
};

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
