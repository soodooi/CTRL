// /settings — single page with an inline tab strip at the top.
//
//   /settings/ctrl    → General (theme picker, BYOK providers, hotkey readout)
//   /settings/brain   → Brain   (cc-switch style switcher, [deleted ADR-021 brain switcher — superseded by ADR-002 substrate § brain v1 Pi singleton])
//   /settings/logs    → Logs    (release log + installed pill + Check for Updates)
//
// Bare /settings redirects to /settings/ctrl so legacy tray / keyboard
// links keep landing somewhere sensible.

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  FormField,
  StatusPill,
  TextInput,
} from '@/components/primitives';
import { useTheme } from '@/hooks/useTheme';
import { useKernelStatus } from '@/hooks/useKernelStatus';
import { setProviderKey } from '@/lib/kernel';
import type { ThemePreference } from '@/lib/theme';
import { APP_VERSION, useUpdateStatus } from '@/lib/app-meta';
import { invoke } from '@/lib/bridge';
import { useWorkspaceStore } from '@/lib/workspace-store';
// ADR-002 substrate § provider v2 §3.6 — Providers tab data sources
import { loadBrainState, type BrainState } from '@/lib/irisy-prompts';
import {
  providerList,
  providerSetActive,
  type IrisyRole,
  type ProviderListRow,
} from '@/lib/provider-config';
import styles from './settings.module.css';

// ─────────────────────────────────────────────────────────────
// Shared tab shell
// ─────────────────────────────────────────────────────────────

type SettingsTab = 'ctrl' | 'providers' | 'brain' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'General', to: '/settings/ctrl' },
  // ADR-002 substrate § provider v2 §3.6 — 2-role provider picker
  { id: 'providers', label: 'Providers', to: '/settings/providers' },
  { id: 'brain', label: 'Model Integration', to: '/settings/brain' },
  { id: 'logs', label: 'Logs', to: '/settings/logs' },
];

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
      <span className={styles.headerChip} title={`Active brain: ${engine}`}>
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

// Provider row — one card per known provider. Inline edit + test +
// delete; pending state disables both buttons. Errors surface inline
// ── Providers — simplified UI (bao 2026-06-05) ─────────────────────
//
// Previous design listed all 9 builtin providers as configurable rows
// even when 8 of them were not configured. UX was noisy — most rows
// were disabled placeholders for providers the user had never added
// a key for. New design: one active chip + Change + Add buttons.
//
// Data sources:
//   - providerList() → 9 builtin manifests, each with `ready` flag
//     (true iff credentials resolve + adapter constructs without error)
//   - loadBrainState() → currently-active providers per role
//   - setProviderKey() → write API key into the macOS keychain
//   - providerSetActive() → 1-token trial chat + bind role
//
// "Configured" = providers with `ready === true` (keyless local
// adapters like Ollama also report ready when reachable).
// "Unconfigured" = `ready === false`, candidates for the Add modal.

interface ChangeMenuProps {
  candidates: ProviderListRow[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
  busy: boolean;
}

const ChangeMenu = ({
  candidates,
  activeId,
  onPick,
  onClose,
  busy,
}: ChangeMenuProps): ReactElement => (
  <div className={styles.providerMenu} role="menu">
    {candidates.length === 0 ? (
      <p className={styles.providerMenuEmpty}>
        Only one provider is configured. Add another from the “Add new”
        button to switch between them.
      </p>
    ) : (
      candidates.map((c) => (
        <button
          key={c.id}
          type="button"
          role="menuitem"
          className={styles.providerMenuRow}
          data-active={c.id === activeId || undefined}
          onClick={() => onPick(c.id)}
          disabled={busy || c.id === activeId}
        >
          <span className={styles.providerMenuLabel}>{c.label}</span>
          <code className={styles.providerMenuSlug}>{c.id}</code>
        </button>
      ))
    )}
    <button
      type="button"
      className={styles.providerMenuClose}
      onClick={onClose}
      disabled={busy}
    >
      Close
    </button>
  </div>
);

interface AddModalProps {
  candidates: ProviderListRow[];
  onAdded: (id: string) => Promise<void>;
  onClose: () => void;
}

const AddModal = ({ candidates, onAdded, onClose }: AddModalProps): ReactElement => {
  const [picked, setPicked] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async (args: { id: string; key: string }) => {
      await setProviderKey({ provider: args.id, api_key: args.key });
    },
    onSuccess: async () => {
      if (picked) await onAdded(picked);
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

  const pickedRow = useMemo(
    () => candidates.find((c) => c.id === picked) ?? null,
    [candidates, picked],
  );

  return (
    <div className={styles.providerModalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.providerModal}>
        <h3 className={styles.providerModalTitle}>Add provider</h3>
        {!picked ? (
          <div className={styles.providerModalList}>
            {candidates.length === 0 ? (
              <p className={styles.providerMenuEmpty}>
                All known providers are already configured.
              </p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={styles.providerMenuRow}
                  onClick={() => setPicked(c.id)}
                >
                  <span className={styles.providerMenuLabel}>{c.label}</span>
                  <code className={styles.providerMenuSlug}>{c.id}</code>
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            <p className={styles.providerModalPickedLine}>
              Adding <strong>{pickedRow?.label ?? picked}</strong>
            </p>
            <FormField
              label="API key"
              hint="Stored in macOS Keychain. Never leaves this device."
            >
              <TextInput
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                disabled={saveMutation.isPending}
              />
            </FormField>
            {error && (
              <p className={styles.providerError} role="alert">
                {error}
              </p>
            )}
          </>
        )}
        <div className={styles.providerModalActions}>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {picked && (
            <Button
              size="sm"
              variant="primary"
              onClick={() =>
                saveMutation.mutate({ id: picked, key: apiKey.trim() })
              }
              disabled={
                saveMutation.isPending || apiKey.trim().length === 0
              }
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

const ProvidersBlock = (): ReactElement => {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: ['providers-v2'],
    queryFn: providerList,
  });
  const brainQuery = useQuery({
    queryKey: ['brain-state'],
    queryFn: loadBrainState,
    refetchInterval: 8_000,
  });

  const [menuOpen, setMenuOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['providers-v2'] });
    await queryClient.invalidateQueries({ queryKey: ['brain-state'] });
  }, [queryClient]);

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      providerSetActive({ role: 'irisy.primary', provider_id: id }),
    onSuccess: async () => {
      setMenuOpen(false);
      setError(null);
      await refresh();
    },
    onError: (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
  });

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
  const configured = providers.filter((p) => p.ready);
  const unconfigured = providers.filter((p) => !p.ready);
  const brain = brainQuery.data ?? null;
  const active = brain?.providers['irisy.primary'] ?? null;
  // Active row data — prefer brain state (live), fall back to first
  // configured manifest if brain hasn't responded yet.
  const activeRow =
    (active && providers.find((p) => p.id === active.id)) ??
    configured[0] ??
    null;
  const activeLabel = active?.label ?? activeRow?.label ?? 'No provider';
  const activeModel = activeRow?.models[0] ?? '—';
  const healthy = active?.healthy ?? Boolean(activeRow?.ready);

  const changeCandidates = configured.filter(
    (c) => c.id !== (active?.id ?? activeRow?.id),
  );

  return (
    <>
      <div className={styles.providerActiveCard}>
        <div className={styles.providerActiveHead}>
          <span
            className={styles.providerActiveDot}
            data-healthy={healthy || undefined}
            aria-hidden
          />
          <span className={styles.providerActiveLabel}>{activeLabel}</span>
          <code className={styles.providerActiveModel}>{activeModel}</code>
          <span className={styles.providerActiveStatus}>
            {healthy ? 'Ready' : 'Not ready'}
          </span>
        </div>
        <div className={styles.providerActiveActions}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={configured.length <= 1}
          >
            ↻ Change
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setAddOpen(true)}
          >
            + Add new
          </Button>
        </div>
        {menuOpen && (
          <ChangeMenu
            candidates={changeCandidates}
            activeId={active?.id ?? activeRow?.id ?? null}
            onPick={(id) => activateMutation.mutate(id)}
            onClose={() => setMenuOpen(false)}
            busy={activateMutation.isPending}
          />
        )}
        {error && (
          <p className={styles.providerError} role="alert">
            {error}
          </p>
        )}
        <p className={styles.providerHint}>
          Advanced: edit <code>~/.pi/agent/models.json</code> for full
          control over models, endpoints, and routing.
        </p>
      </div>
      {addOpen && (
        <AddModal
          candidates={unconfigured}
          onClose={() => setAddOpen(false)}
          onAdded={async () => {
            setAddOpen(false);
            await refresh();
          }}
        />
      )}
    </>
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
      description="Single-key chord to summon CTRL. The hotkey is reserved by the launcher, not by any individual keycap."
    >
      <HotkeyBlock />
    </Section>
  </SettingsShell>
);

// ─────────────────────────────────────────────────────────────
// /settings/brain  ([deleted ADR-021 brain switcher — superseded by ADR-002 substrate § brain v1 Pi singleton] — cc-switch / VMark / opencode style)
// ─────────────────────────────────────────────────────────────

// ADR-002 substrate §5 — brain switcher retired. Pi is the sole brain (singleton);
// no `brain_list / brain_detect / brain_set_active` calls. Settings → Brain
// reads `pi_status` (system.rs) + binds "Upgrade now" to `pi_upgrade_now`.
// bao 2026-05-31 (ADR-002 substrate acceptance #5 close-out): legacy BrainListReply
// + multi-radio switcher removed in this commit.

interface PiStatusView {
  installed_version: string | null;
  latest_version: string | null;
  upgrade_available: boolean;
  major_update_blocked: boolean;
  last_upgrade_error: string | null;
  last_probe_ms: number;
  pi_bin: string | null;
  install_root: string | null;
  running: boolean;
  last_error: string | null;
  provider_port: number;
}

export const SettingsBrainPage = (): ReactElement => {
  const [status, setStatus] = useState<PiStatusView | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await invoke<PiStatusView>('pi_status');
      setStatus(result);
      setError(null);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(`pi_status failed: ${detail}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const upgrade = useCallback(async (): Promise<void> => {
    setUpgrading(true);
    try {
      const result = await invoke<PiStatusView>('pi_upgrade_now');
      setStatus(result);
      setError(null);
    } catch (e: unknown) {
      const detail = e instanceof Error ? e.message : String(e);
      setError(`pi_upgrade_now failed: ${detail}`);
    } finally {
      setUpgrading(false);
    }
  }, []);

  return (
    <SettingsShell activeTab="brain">
      <div className={styles.brainHeader}>
        <div className={styles.brainHeaderText}>
          <h2 className={styles.brainTitle}>Brain</h2>
          <p className={styles.brainHelp}>
            Pi is the sole brain (ADR-002 substrate §1). Provider selection happens in
            Settings → Providers — this pane shows Pi&apos;s version, runtime
            health, and lets you trigger a manual upgrade.
          </p>
        </div>
        <div className={styles.brainActions}>
          <button
            type="button"
            className={styles.brainButton}
            onClick={() => void upgrade()}
            disabled={upgrading || loading || !status?.upgrade_available}
          >
            {upgrading
              ? 'Upgrading…'
              : status?.upgrade_available
                ? 'Upgrade now'
                : 'Up to date'}
          </button>
        </div>
      </div>

      {error && <p className={styles.brainError}>{error}</p>}

      {loading ? (
        <p className={styles.sectionSubtitle}>Loading Pi status…</p>
      ) : status == null ? null : (
        <ul className={styles.brainList}>
          <li
            className={styles.brainCard}
            data-active={status.running}
            data-detected={status.installed_version != null}
          >
            <div className={styles.brainBody}>
              <span className={styles.brainName}>Pi</span>
              <span className={styles.brainDetail}>
                {status.pi_bin ?? '(not installed)'}
                {status.installed_version
                  ? ` · v${status.installed_version}`
                  : ''}
                {status.latest_version &&
                status.latest_version !== status.installed_version
                  ? ` · latest v${status.latest_version}`
                  : ''}
                {` · provider :${status.provider_port}`}
              </span>
              <div className={styles.brainTags}>
                {status.running ? (
                  <span className={styles.brainTag} data-tone="good">
                    running
                  </span>
                ) : (
                  <span className={styles.brainTag} data-tone="warn">
                    not running
                  </span>
                )}
                {status.major_update_blocked && (
                  <span className={styles.brainTag} data-tone="warn">
                    major update pending review
                  </span>
                )}
                {status.last_error && (
                  <span className={styles.brainTag} data-tone="bad">
                    {status.last_error}
                  </span>
                )}
                {status.last_upgrade_error && (
                  <span className={styles.brainTag} data-tone="warn">
                    upgrade error: {status.last_upgrade_error}
                  </span>
                )}
              </div>
            </div>
            <div className={styles.brainStatus}>
              {status.running ? 'active' : 'idle'}
            </div>
          </li>
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
      'VMark stack adoption — Tiptap markdown WYSIWYG · CodeMirror 6 · mermaid.js · SmartTable viewer · Vault browser + backlinks · ADR-001 spine amendment (Pi sole brain, hermes demoted to keycap).',
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

// ─────────────────────────────────────────────────────────────
// /settings/providers — 2-role provider picker (ADR-002 v2 §3.6)
// ─────────────────────────────────────────────────────────────

interface IrisyRoleSpec {
  id: IrisyRole;
  label: string;
  description: string;
}

const IRISY_ROLES: ReadonlyArray<IrisyRoleSpec> = [
  {
    id: 'irisy.primary',
    label: 'Irisy primary',
    description:
      'Your own CLI (Claude / Codex / Gemini / Aider). No CTRL cost — augmentation slot.',
  },
  {
    id: 'irisy.fallback',
    label: 'Irisy fallback',
    description:
      'CTRL-managed safety net so a fresh install without a CLI still has a working AI path.',
  },
];

interface ProviderRoleRowProps {
  row: ProviderListRow;
  isActive: boolean;
  isPending: boolean;
  errorText: string | null;
  onSelect: () => void;
}

const ProviderRoleRow = ({
  row,
  isActive,
  isPending,
  errorText,
  onSelect,
}: ProviderRoleRowProps): ReactElement => {
  const detected = row.ready;
  const disabled = isPending || (!row.ready && !isActive);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isActive}
      aria-label={row.label}
      disabled={disabled}
      onClick={onSelect}
      className={styles.brainCard}
      data-active={isActive}
      data-detected={detected}
    >
      <span className={styles.brainRadio} aria-hidden />
      <div className={styles.brainBody}>
        <span className={styles.brainName}>{row.label}</span>
        {row.description && (
          <span className={styles.brainDetail}>{row.description}</span>
        )}
        {errorText && (
          <span className={styles.brainError}>{errorText}</span>
        )}
      </div>
      <div className={styles.brainTags}>
        {row.managed_by === 'ctrl' && (
          <span className={styles.brainTag} data-tone="good">
            CTRL-managed
          </span>
        )}
        <span
          className={styles.brainTag}
          data-tone={detected ? 'good' : 'warn'}
        >
          {detected ? 'Available' : 'Not configured'}
        </span>
      </div>
    </button>
  );
};

interface RoleSectionProps {
  spec: IrisyRoleSpec;
  rows: ReadonlyArray<ProviderListRow>;
  activeProviderId: string | null;
  pendingProviderId: string | null;
  errorPerProvider: Record<string, string>;
  onActivate: (providerId: string) => void;
}

const RoleSection = ({
  spec,
  rows,
  activeProviderId,
  pendingProviderId,
  errorPerProvider,
  onActivate,
}: RoleSectionProps): ReactElement => (
  <Section title={spec.label} description={spec.description}>
    <div
      className={styles.brainList}
      role="radiogroup"
      aria-label={`${spec.label} provider`}
    >
      {rows.map((row) => (
        <ProviderRoleRow
          key={`${spec.id}::${row.id}`}
          row={row}
          isActive={activeProviderId === row.id}
          isPending={pendingProviderId === row.id}
          errorText={errorPerProvider[row.id] ?? null}
          onSelect={() => onActivate(row.id)}
        />
      ))}
    </div>
  </Section>
);

interface ActivationError {
  role: IrisyRole;
  providerId: string;
  message: string;
}

export const SettingsProvidersPage = (): ReactElement => {
  const queryClient = useQueryClient();
  const brain = useQuery<BrainState | null>({
    queryKey: ['brain-status'],
    queryFn: loadBrainState,
  });
  const list = useQuery<ProviderListRow[]>({
    queryKey: ['provider-list'],
    queryFn: providerList,
  });

  const [activationError, setActivationError] = useState<ActivationError | null>(null);

  const activation = useMutation({
    mutationFn: providerSetActive,
    onSuccess: () => {
      setActivationError(null);
      void queryClient.invalidateQueries({ queryKey: ['brain-status'] });
      void queryClient.invalidateQueries({ queryKey: ['provider-list'] });
    },
  });

  const handleActivate = useCallback(
    (role: IrisyRole, providerId: string): void => {
      setActivationError(null);
      activation.mutate(
        { role, provider_id: providerId },
        {
          onError: (err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            setActivationError({ role, providerId, message });
          },
        },
      );
    },
    [activation],
  );

  const pendingProviderId = activation.isPending
    ? activation.variables?.provider_id ?? null
    : null;

  const errorPerProvider = useMemo<Record<string, string>>(() => {
    if (!activationError) return {};
    return { [activationError.providerId]: activationError.message };
  }, [activationError]);

  const rows: ReadonlyArray<ProviderListRow> = list.data ?? [];

  return (
    <SettingsShell activeTab="providers">
      {brain.isError && (
        <p className={styles.brainError}>
          Could not load current brain state — showing manifest list only.
        </p>
      )}
      {list.isError && (
        <p className={styles.brainError}>
          Could not load provider manifests:{' '}
          {list.error instanceof Error ? list.error.message : 'unknown error'}
        </p>
      )}
      {IRISY_ROLES.map((spec) => {
        const activeId = brain.data?.providers[spec.id]?.id ?? null;
        return (
          <RoleSection
            key={spec.id}
            spec={spec}
            rows={rows}
            activeProviderId={activeId}
            pendingProviderId={pendingProviderId}
            errorPerProvider={errorPerProvider}
            onActivate={(providerId) => handleActivate(spec.id, providerId)}
          />
        );
      })}
      <Section
        title="REST API keys (BYOK)"
        description={
          <>
            Configure your own API keys for Anthropic, OpenAI, Volc, etc. in the{' '}
            <Link to="/settings/ctrl" className={styles.tab}>
              General tab
            </Link>
            . Once a key is set, the provider becomes Available here and can be
            assigned to a role.
          </>
        }
      >
        <p className={styles.brainHelp}>
          BYOK calls are billed to your own account. The CTRL-managed fallback
          slot keeps working even when you have no BYOK keys configured.
        </p>
      </Section>
    </SettingsShell>
  );
};

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
