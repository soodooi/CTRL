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

import { useCallback, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Button,
  FormField,
  StatusPill,
  TextInput,
} from '@/components/primitives';
import { useTheme } from '@/hooks/useTheme';
import { useKernelStatus } from '@/hooks/useKernelStatus';
import {
  deleteProvider,
  listProviderTemplates,
  setProviderKey,
  testProvider,
  type ProviderTemplate,
} from '@/lib/kernel';
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

type SettingsTab = 'ctrl' | 'providers' | 'logs';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string; to: string }> = [
  { id: 'ctrl', label: 'General', to: '/settings/ctrl' },
  // ADR-002 substrate § provider v2 §3.6 — 2-role provider picker
  { id: 'providers', label: 'Providers', to: '/settings/providers' },
  // brain tab retired with Pi (ADR-002 substrate §1 v19, 2026-06-09)
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
  /** Optional prefill — when set, the form opens in edit mode with id
   *  read-only and other fields populated from the row. */
  prefill?: ProviderListRow | null;
  onAdded: (id: string) => Promise<void>;
  onClose: () => void;
}

// bao 2026-06-05 e refactor: AddModal is now a free-form provider editor
// (industry pattern: OpenWebUI / Cursor / Continue / Roo Code). User
// supplies display name, picks API protocol, types base URL + key +
// default model. No hardcoded preset list. The backend
// (config_set_provider_key) writes a manifest to ~/.ctrl/providers/<slug>.toml
// + stores the key in macOS Keychain.
// bao 2026-06-06: provider preset list = data, not code. PWA fetches
// via Tauri `list_provider_templates` which reads bundled defaults +
// merges `~/.ctrl/provider-templates.json` user override.
// AddModal calls useQuery({ queryFn: listProviderTemplates }).

const AddModal = ({ prefill, onAdded, onClose }: AddModalProps): ReactElement => {
  const editMode = prefill != null;
  const templatesQuery = useQuery({
    queryKey: ['provider-templates'],
    queryFn: listProviderTemplates,
    staleTime: 60_000,
  });
  const templates: ProviderTemplate[] = templatesQuery.data ?? [];
  const [templateId, setTemplateId] = useState<string>(editMode ? 'custom' : '');
  const [displayName, setDisplayName] = useState(prefill?.label ?? '');
  const [protocol, setProtocol] = useState<'openai' | 'anthropic'>('openai');
  // Prefill base URL from existing manifest so user can edit one
  // field without remembering the URL. bao 2026-06-06 UX fix.
  const [baseUrl, setBaseUrl] = useState(prefill?.endpoint ?? '');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(prefill?.models?.[0] ?? '');
  const [error, setError] = useState<string | null>(null);

  // Apply template when picked (only in Add mode, not Edit).
  const applyTemplate = useCallback((id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setDisplayName(t.defaultName);
    setProtocol(t.protocol);
    setBaseUrl(t.baseUrl);
    setDefaultModel(t.defaultModel);
  }, [templates]);

  // First mount (after templates load): apply the first template so the
  // form is pre-filled. Users can switch via the dropdown.
  useEffect(() => {
    if (editMode) return;
    if (templateId) return;
    if (templates.length === 0) return;
    const first = templates[0];
    if (first) applyTemplate(first.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates, templateId, editMode]);

  const currentTemplate = useMemo(
    () => templates.find((x) => x.id === templateId) ?? null,
    [templates, templateId],
  );

  const computedSlug = useMemo(() => {
    if (editMode && prefill) return prefill.id;
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }, [displayName, editMode, prefill]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!computedSlug) throw new Error('Name produces empty id');
      if (!baseUrl.trim()) throw new Error('Base URL is required');
      // Edit mode: empty API key means "keep existing keychain entry".
      // Add mode: API key is mandatory. bao 2026-06-06 UX fix.
      if (!editMode && !apiKey.trim()) throw new Error('API key is required');
      await setProviderKey({
        provider: computedSlug,
        api_key: apiKey.trim(),
        base_url: baseUrl.trim(),
        default_model: defaultModel.trim() || undefined,
        display_name: displayName.trim() || undefined,
        api_protocol: protocol,
      });
    },
    onSuccess: async () => { await onAdded(computedSlug); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  return (
    <div className={styles.providerModalBackdrop} role="dialog" aria-modal="true">
      <div className={styles.providerModal}>
        <h3 className={styles.providerModalTitle}>
          {editMode ? `Edit ${prefill?.label}` : 'Add provider'}
        </h3>
        {!editMode && (
          <FormField
            label="Template"
            hint="Pick a preset to auto-fill, then tweak as needed. Choose Custom for any OpenAI-compatible endpoint."
          >
            <select
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              disabled={saveMutation.isPending || templatesQuery.isPending}
              style={{
                width: '100%', padding: '6px 10px', fontSize: '0.85rem',
                border: '1px solid var(--color-border)', borderRadius: 6,
                background: 'var(--color-bg)', color: 'var(--color-text)',
                fontFamily: 'inherit',
              }}
            >
              {templatesQuery.isPending && <option value="">Loading templates…</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </FormField>
        )}
        <FormField
          label="Name"
          hint={editMode
            ? `id: ${prefill?.id} (cannot be changed once created)`
            : `id will be: ${computedSlug || '(empty — type a name)'}`}
        >
          <TextInput
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="My OpenRouter"
            autoComplete="off"
            disabled={saveMutation.isPending || editMode}
          />
        </FormField>
        <FormField label="API protocol">
          <div style={{ display: 'flex', gap: 16, fontSize: '0.85rem' }}>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="api-protocol"
                value="openai"
                checked={protocol === 'openai'}
                onChange={() => setProtocol('openai')}
                disabled={saveMutation.isPending}
              />{' '}
              OpenAI-compatible
            </label>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="radio"
                name="api-protocol"
                value="anthropic"
                checked={protocol === 'anthropic'}
                onChange={() => setProtocol('anthropic')}
                disabled={saveMutation.isPending}
              />{' '}
              Anthropic Messages
            </label>
          </div>
        </FormField>
        <FormField label="Base URL" hint="Provider's API endpoint (no trailing slash).">
          <TextInput
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
            disabled={saveMutation.isPending}
          />
        </FormField>
        <FormField
          label="API key"
          hint={editMode
            ? 'Leave blank to keep the current key. Type to replace.'
            : `${currentTemplate?.keyHint ?? 'Paste your API key.'} Stored in macOS Keychain. Never leaves this device.`}
        >
          <TextInput
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={editMode ? 'paste new key to replace' : 'sk-...'}
            autoComplete="off"
            disabled={saveMutation.isPending}
          />
        </FormField>
        <FormField label="Default model" hint="Optional. Used when no model is explicitly chosen.">
          <TextInput
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="gpt-4o-mini"
            autoComplete="off"
            disabled={saveMutation.isPending}
          />
        </FormField>
        {error && (
          <p className={styles.providerError} role="alert">{error}</p>
        )}
        <div className={styles.providerModalActions}>
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => saveMutation.mutate()}
            disabled={
              saveMutation.isPending ||
              !computedSlug ||
              !baseUrl.trim() ||
              (!editMode && !apiKey.trim())
            }
          >
            {saveMutation.isPending ? 'Saving…' : (editMode ? 'Save' : 'Add')}
          </Button>
        </div>
      </div>
    </div>
  );
};

// One row in the providers list. `kind` controls which actions are
// rendered: builtin rows (Ollama and future CLI manifests) cannot be
// Edited or Deleted — they are system-shipped — while user rows expose
// the full 5 ops (Add/Edit/Delete/Test/Set active). bao 2026-06-06.
interface ProviderRowProps {
  p: ProviderListRow;
  isActive: boolean;
  isBuiltin: boolean;
  healthy: boolean;
  testResult: { ok: boolean; message: string } | null;
  testing: boolean;
  pendingActivate: boolean;
  pendingDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onActivate: () => void;
}

const ProviderRow = ({
  p, isActive, isBuiltin, healthy, testResult,
  testing, pendingActivate, pendingDelete,
  onEdit, onDelete, onTest, onActivate,
}: ProviderRowProps): ReactElement => (
  <li className={styles.providerListRow} data-active={isActive}>
    <div className={styles.providerListInfo}>
      <span
        className={styles.providerListDot}
        data-healthy={(isActive ? healthy : p.ready) || undefined}
        aria-hidden
      />
      <span className={styles.providerListLabel}>{p.label}</span>
      {isActive && <span className={styles.providerListBadge}>Active</span>}
      <code className={styles.providerListModel}>{p.models[0] ?? '—'}</code>
      {testResult && (
        <span
          className={styles.providerListTest}
          style={{ color: testResult.ok ? 'var(--color-success, #15803d)' : 'var(--color-danger, #dc2626)' }}
        >
          {testResult.ok ? '✓' : '✗'} {testResult.message}
        </span>
      )}
    </div>
    <div className={styles.providerListActions}>
      {!isBuiltin && (
        <button
          type="button"
          className={styles.providerListBtn}
          onClick={onEdit}
          title={p.ready ? 'Edit settings or replace key' : 'Add key / fix configuration'}
        >
          {p.ready ? 'Edit' : 'Add key'}
        </button>
      )}
      {!isBuiltin && (
        <button
          type="button"
          className={styles.providerListBtn}
          data-tone="danger"
          onClick={onDelete}
          disabled={pendingDelete}
          title="Remove this provider entirely"
        >
          Delete
        </button>
      )}
      {p.ready && (
        <button
          type="button"
          className={styles.providerListBtn}
          onClick={onTest}
          disabled={testing}
          title="Run the production chat path with a 1-token probe"
        >
          {testing ? '…' : 'Test'}
        </button>
      )}
      {p.ready && !isActive && (
        <button
          type="button"
          className={styles.providerListBtn}
          data-tone="primary"
          onClick={onActivate}
          disabled={pendingActivate}
        >
          Set active
        </button>
      )}
    </div>
  </li>
);

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

  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefilledId, setPrefilledId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['providers-v2'] });
    await queryClient.invalidateQueries({ queryKey: ['brain-state'] });
  }, [queryClient]);

  // Listen for kernel-emitted active-providers-changed events so save /
  // delete / set_active in another window (or via the menu bar) refreshes
  // this list without manual reload. ADR-002 substrate § provider v8 §3.5
  // (2026-06-06) — event name anchors to the SSOT it mirrors
  // (~/.ctrl/state/active-providers.json), not a generic provider event.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen('active-providers-changed', () => {
      void refresh();
    }).then((u) => { unlisten = u; });
    return () => { unlisten?.(); };
  }, [refresh]);

  const activateMutation = useMutation({
    mutationFn: (id: string) =>
      providerSetActive({ role: 'irisy.primary', provider_id: id }),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProvider(id),
    onSuccess: async () => { setError(null); await refresh(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const runTest = async (id: string): Promise<void> => {
    setTestingId(id);
    setTestResults((prev) => ({ ...prev, [id]: { ok: false, message: '…' } }));
    try {
      const r = await testProvider(id);
      setTestResults((prev) => ({ ...prev, [id]: { ok: r.success, message: r.message } }));
    } catch (e) {
      setTestResults((prev) => ({
        ...prev,
        [id]: { ok: false, message: e instanceof Error ? e.message : String(e) },
      }));
    } finally {
      setTestingId(null);
    }
  };

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
  const builtinRows = providers.filter((p) => p.source === 'builtin');
  const userRows = providers.filter((p) => p.source === 'user');
  const brain = brainQuery.data ?? null;
  const active = brain?.providers['irisy.primary'] ?? null;
  const activeRow =
    (active && providers.find((p) => p.id === active.id)) ??
    providers.find((p) => p.ready) ??
    null;
  const healthy = active?.healthy ?? Boolean(activeRow?.ready);
  const activeId = active?.id ?? activeRow?.id ?? null;

  const renderRow = (p: ProviderListRow): ReactElement => (
    <ProviderRow
      key={p.id}
      p={p}
      isActive={p.id === activeId}
      isBuiltin={p.source === 'builtin'}
      healthy={healthy}
      testResult={testResults[p.id] ?? null}
      testing={testingId === p.id}
      pendingActivate={activateMutation.isPending}
      pendingDelete={deleteMutation.isPending}
      onEdit={() => { setPrefilledId(p.id); setAddOpen(true); }}
      onDelete={() => {
        if (window.confirm(`Remove ${p.label}? This clears the vault entry + the user manifest file.`)) {
          deleteMutation.mutate(p.id);
        }
      }}
      onTest={() => void runTest(p.id)}
      onActivate={() => activateMutation.mutate(p.id)}
    />
  );

  return (
    <>
      {/* Available — system-shipped (Ollama + future CLI manifests).
          Auto-detected, no key needed. Cannot be edited or deleted. */}
      <div className={styles.providerGroup}>
        <h3 className={styles.providerGroupTitle}>Available</h3>
        <p className={styles.providerGroupHint}>
          Auto-detected on this device. No setup required.
        </p>
        {builtinRows.length === 0 ? (
          <p className={styles.providersFallback}>No detected providers.</p>
        ) : (
          <ul className={styles.providerList}>{builtinRows.map(renderRow)}</ul>
        )}
      </div>

      {/* Your providers — user-added via AddModal. Full CRUD. */}
      <div className={styles.providerGroup}>
        <h3 className={styles.providerGroupTitle}>Your providers</h3>
        <p className={styles.providerGroupHint}>
          BYOK endpoints you added. Stored in the local encrypted vault.
        </p>
        {userRows.length === 0 ? (
          <p className={styles.providersFallback}>
            No BYOK providers yet. Add one to use Anthropic, OpenAI, Volc, etc.
          </p>
        ) : (
          <ul className={styles.providerList}>{userRows.map(renderRow)}</ul>
        )}
        <div className={styles.providerAddBar}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => { setPrefilledId(null); setAddOpen(true); }}
          >
            + Add provider
          </Button>
        </div>
      </div>

      {error && (
        <p className={styles.providerError} role="alert">{error}</p>
      )}
      {addOpen && (
        <AddModal
          prefill={prefilledId ? providers.find((p) => p.id === prefilledId) ?? null : null}
          onClose={() => { setAddOpen(false); setPrefilledId(null); }}
          onAdded={async () => {
            setAddOpen(false);
            setPrefilledId(null);
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

// ─────────────────────────────────────────────────────────────
// /settings/providers — 2-role provider picker (ADR-002 v2 §3.6)
// ─────────────────────────────────────────────────────────────

interface IrisyRoleSpec {
  id: IrisyRole;
  label: string;
  description: string;
}

// ADR-002 substrate § brain v13 (2026-06-07, retracts v11 §3.11):
// coding.primary row REMOVED. The Coding L1 chip spawns Pi natively;
// Pi picks provider from ~/.pi/agent/models.json (same SSOT used by
// the Irisy chat panel, since both are the same Pi binary).
const IRISY_ROLES: ReadonlyArray<IrisyRoleSpec> = [
  {
    id: 'irisy.primary',
    label: 'Irisy primary',
    description:
      'Your own CLI (Claude / Codex / Gemini / Aider). No CTRL cost — augmentation slot. Also drives the Coding L1 native Pi TUI.',
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
  // bao 2026-06-05 e: completeness — Add was not enough. Per-row CRUD
  // actions surface Test (smoke-call provider /models), Edit (re-Add
  // with same id, backend keychain helper updates via -U), Delete
  // (clear keychain + config.toml). Each is optional in props so the
  // row can render in legacy contexts without forcing the wiring.
  onTest?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isTesting?: boolean;
  testResult?: { ok: boolean; message: string } | null;
}

const ProviderRoleRow = ({
  row,
  isActive,
  isPending,
  errorText,
  onSelect,
  onTest,
  onEdit,
  onDelete,
  isTesting,
  testResult,
}: ProviderRoleRowProps): ReactElement => {
  const detected = row.ready;
  const disabled = isPending || (!row.ready && !isActive);
  const showActions = (onTest || onEdit || onDelete) && row.ready;
  return (
    <div
      className={styles.brainCard}
      data-active={isActive}
      data-detected={detected}
      role="radio"
      aria-checked={isActive}
      aria-label={row.label}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={disabled ? -1 : 0}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : { cursor: 'pointer' }}
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
        {testResult && (
          <span
            className={styles.brainError}
            style={{ color: testResult.ok ? 'var(--color-success, #15803d)' : 'var(--color-danger, #dc2626)' }}
          >
            {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
          </span>
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
      {showActions && (
        <div
          className={styles.brainActions}
          onClick={(e) => e.stopPropagation()}
          aria-label={`Actions for ${row.label}`}
        >
          {onTest && (
            <button
              type="button"
              className={styles.brainAction}
              onClick={(e) => { e.stopPropagation(); onTest(); }}
              disabled={isTesting}
              title="Test this provider (1-token smoke chat)"
              aria-label="Test provider"
            >
              {isTesting ? '…' : 'Test'}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              className={styles.brainAction}
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              title="Replace this provider's API key"
              aria-label="Edit key"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={styles.brainAction}
              data-tone="danger"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title="Remove this provider's key (keychain + config)"
              aria-label="Delete provider"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
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

// bao 2026-06-05 — providers v3. Previous version stacked 2 roles
// (primary + fallback) × N candidate rows = ~18 rows of clickable
// radios. Replaced by a single active-chip card (ProvidersBlock) per
// the simplified design. Fallback is intentionally not user-facing
// (memory `decision_irisy_fallback_is_ctrl_paid_volc_now`: ctrl-managed
// safety net, user shouldn't have to think about it).
export const SettingsProvidersPage = (): ReactElement => (
  <SettingsShell activeTab="providers">
    <Section
      title="Irisy provider"
      description="The brain Irisy talks to. Defaults to local Ollama via Pi-first; add a hosted provider to switch."
    >
      <ProvidersBlock />
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
