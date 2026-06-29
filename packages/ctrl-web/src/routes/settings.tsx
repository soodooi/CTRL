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

import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTheme } from '@/hooks/useTheme';
import { useKernelStatus } from '@/hooks/useKernelStatus';
import type { ThemePreference } from '@/lib/theme';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { useWorkspaceStore } from '@/lib/workspace-store';
import { ProviderHub } from '@/components/ambient/ProviderHub';
import { VaultSetup } from '@/components/VaultSetup';
import { useByoDrivers } from '@/lib/active-agent';
import {
  listEnvEntries,
  setEnvVar,
  removeEnvVar,
  isValidEnvName,
  ENV_PRESETS,
  loadMcpCredentials,
  setMcpCredential,
  clearMcpCredential,
  type EnvEntryView,
  type McpCredField,
} from '@/lib/dev-env';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'providers' | 'agent' | 'env' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'General', to: '/settings/ctrl' },
  // ADR-002 substrate § provider v2 §3.6 — 2-role provider picker
  { id: 'providers', label: 'Providers', to: '/settings/providers' },
  // Agent (hermes) config — embeds hermes's own dashboard web UI so its
  // agent settings (toolsets / memory / personality) live in one place
  // inside CTRL; the user never has to edit ~/.hermes by hand.
  { id: 'agent', label: 'Irisy', to: '/settings/agent' },
  // Env — local dev-environment vars (API keys / tokens / endpoints) stored
  // in the keychain and injected into the Coding terminal (bao 2026-06-22).
  { id: 'env', label: 'Env', to: '/settings/env' },
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
      title="Vault"
      description="The folder CTRL treats as your knowledge base. Point it at your own (Obsidian) vault — local markdown is the truth; CTRL is a layer over it, not a separate store."
    >
      <VaultSetup variant="settings" />
    </Section>
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
// Agent-backend selector — the env home for Irisy's AGENT axis (ADR-005 irisy
// §8). Primary place to pick the engine; the in-chat chip mirrors it. Honest
// detection: a BYO-CLI driver appears selectable only when the user has it.
// Industry note (2026-06-28 research): consumer AI apps hide the engine behind
// the persona, so this lives in Settings, not co-equal with the persona chip.
const AgentBackendSelector = (): ReactElement => {
  const { drivers, active, setActive, loaded } = useByoDrivers();
  return (
    <Section
      title="Engine"
      description="Pick the engine behind Irisy — Hermes, Codex, or Claude. Hermes is the built-in default; Codex and Claude install in one click and reuse the API key you set in Providers."
    >
      <div className={styles.segmented} role="radiogroup" aria-label="Agent backend">
        {drivers.map((d) => {
          const isActive = d.id === active.id;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              data-active={isActive}
              className={styles.segment}
              onClick={() => setActive(d.id)}
              title={d.detail}
            >
              <span className={styles.segmentLabel}>{d.label}</span>
              <span className={styles.segmentHint}>{d.detail}</span>
            </button>
          );
        })}
      </div>
      {!loaded && <p className={styles.sectionDesc}>Detecting drivers…</p>}
    </Section>
  );
};

export const SettingsAgentPage = (): ReactElement => (
  <SettingsShell activeTab="agent">
    <AgentBackendSelector />
    <iframe
      title="Irisy agent settings"
      src={HERMES_DASHBOARD_URL}
      style={{
        width: '100%',
        height: 'calc(100vh - 320px)',
        minHeight: 360,
        border: 'none',
        borderRadius: 12,
        background: '#fff',
      }}
    />
  </SettingsShell>
);

// ─────────────────────────────────────────────────────────────
// /settings/env — local dev-environment variables (keychain-backed)
// ─────────────────────────────────────────────────────────────

// Secret values are never read back for display: the page shows whether a var
// is set and lets the user overwrite or delete it, but does not echo the
// stored secret. Inputs are masked (type=password).
const EnvManager = (): ReactElement => {
  const [entries, setEntries] = useState<EnvEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setEntries(await listEnvEntries());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = useCallback(async (): Promise<void> => {
    const name = newName.trim();
    if (!isValidEnvName(name)) {
      setError(`Invalid name "${name}" — use letters, digits, _ (must not start with a digit)`);
      return;
    }
    if (!newValue) {
      setError('Value is empty');
      return;
    }
    setError(null);
    setBusy(name);
    try {
      await setEnvVar(name, newValue);
      setNewName('');
      setNewValue('');
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [newName, newValue, reload]);

  const save = useCallback(
    async (name: string): Promise<void> => {
      const v = drafts[name];
      if (!v) return;
      setBusy(name);
      try {
        await setEnvVar(name, v);
        setDrafts((d) => {
          const next = { ...d };
          delete next[name];
          return next;
        });
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [drafts, reload],
  );

  const remove = useCallback(
    async (name: string): Promise<void> => {
      setBusy(name);
      try {
        await removeEnvVar(name);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--color-border, #d6d3cc)',
    background: 'var(--color-surface, #fff)',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13,
  };
  const btnStyle: CSSProperties = {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border, #d6d3cc)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 13,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {error && (
        <div role="alert" style={{ color: 'var(--color-danger, #c0392b)', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Existing vars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <span style={{ fontSize: 13, opacity: 0.6 }}>Loading…</span>
        ) : entries.length === 0 ? (
          <span style={{ fontSize: 13, opacity: 0.6 }}>
            No variables yet. Add one below — e.g. ANTHROPIC_API_KEY.
          </span>
        ) : (
          entries.map((e) => (
            <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <code style={{ flex: '0 0 220px', fontSize: 13 }}>{e.name}</code>
              <input
                type="password"
                style={inputStyle}
                placeholder={e.hasValue ? '•••••• set — type to replace' : 'value'}
                value={drafts[e.name] ?? ''}
                onChange={(ev) =>
                  setDrafts((d) => ({ ...d, [e.name]: ev.target.value }))
                }
                aria-label={`Value for ${e.name}`}
              />
              <button
                type="button"
                style={btnStyle}
                disabled={busy === e.name || !drafts[e.name]}
                onClick={() => void save(e.name)}
              >
                Save
              </button>
              <button
                type="button"
                style={{ ...btnStyle, color: 'var(--color-danger, #c0392b)' }}
                disabled={busy === e.name}
                onClick={() => void remove(e.name)}
                aria-label={`Delete ${e.name}`}
              >
                Delete
              </button>
            </div>
          ))
        )}
      </div>

      {/* Add new */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          style={{ ...inputStyle, flex: '0 0 220px', fontFamily: 'monospace' }}
          placeholder="NAME"
          value={newName}
          onChange={(ev) => setNewName(ev.target.value)}
          aria-label="New variable name"
        />
        <input
          type="password"
          style={inputStyle}
          placeholder="value"
          value={newValue}
          onChange={(ev) => setNewValue(ev.target.value)}
          aria-label="New variable value"
        />
        <button type="button" style={btnStyle} disabled={busy != null} onClick={() => void add()}>
          Add
        </button>
      </div>

      {/* Presets */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 12, opacity: 0.6 }}>Common:</span>
        {ENV_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            style={{ ...btnStyle, padding: '4px 8px', fontSize: 12 }}
            title={p.hint}
            onClick={() => setNewName(p.name)}
          >
            {p.name}
          </button>
        ))}
      </div>
    </div>
  );
};

// MCP credentials — the keys each installed mcp declares it needs. Read
// dynamically from the installed mcps' manifests (no per-mcp hardcoding), so
// this scales to any number of mcps; only installed mcps that declare secret
// fields show up.
const McpCredentialsManager = (): ReactElement => {
  const [creds, setCreds] = useState<McpCredField[]>([]);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setCreds(await loadMcpCredentials());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = useCallback(
    async (account: string): Promise<void> => {
      const v = drafts[account];
      if (!v) return;
      setBusy(account);
      try {
        await setMcpCredential(account, v);
        setDrafts((d) => {
          const next = { ...d };
          delete next[account];
          return next;
        });
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [drafts, reload],
  );

  const clear = useCallback(
    async (account: string): Promise<void> => {
      setBusy(account);
      try {
        await clearMcpCredential(account);
        await reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    padding: '6px 10px',
    borderRadius: 8,
    border: '1px solid var(--color-border, #d6d3cc)',
    background: 'var(--color-surface, #fff)',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 13,
  };
  const btnStyle: CSSProperties = {
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid var(--color-border, #d6d3cc)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 13,
  };

  if (loading) return <span style={{ fontSize: 13, opacity: 0.6 }}>Loading…</span>;
  if (creds.length === 0)
    return (
      <span style={{ fontSize: 13, opacity: 0.6 }}>
        No mcp needs a key yet. Install an mcp that declares one (e.g. a Cloudflare
        deploy pack) and its key fields show up here.
      </span>
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {error && (
        <div role="alert" style={{ color: 'var(--color-danger, #c0392b)', fontSize: 13 }}>
          {error}
        </div>
      )}
      {creds.map((c) => (
        <div key={c.account} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: '0 0 220px', fontSize: 13 }} title={c.description ?? ''}>
            <code>{c.mcpName}</code> · {c.label}
          </span>
          <input
            type="password"
            style={inputStyle}
            placeholder={c.hasValue ? '•••••• set — type to replace' : 'value'}
            value={drafts[c.account] ?? ''}
            onChange={(ev) => setDrafts((d) => ({ ...d, [c.account]: ev.target.value }))}
            aria-label={`Value for ${c.mcpName} ${c.label}`}
          />
          <button
            type="button"
            style={btnStyle}
            disabled={busy === c.account || !drafts[c.account]}
            onClick={() => void save(c.account)}
          >
            Save
          </button>
          <button
            type="button"
            style={{ ...btnStyle, color: 'var(--color-danger, #c0392b)' }}
            disabled={busy === c.account || !c.hasValue}
            onClick={() => void clear(c.account)}
          >
            Clear
          </button>
        </div>
      ))}
    </div>
  );
};

export const SettingsEnvPage = (): ReactElement => (
  <SettingsShell activeTab="env">
    <Section
      title="Environment variables"
      description="Local development config — API keys, tokens, endpoints. Stored in your OS keychain (never plain text) and injected into the Coding terminal, so a CLI like Claude Code picks up ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL without you pasting secrets into the shell."
    >
      <EnvManager />
    </Section>
    <Section
      title="MCP credentials"
      description="The keys each installed mcp says it needs — read from the mcps you actually have, so the list grows with them, never a fixed catalog. Stored in the keychain too."
    >
      <McpCredentialsManager />
    </Section>
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
