// ProviderHub — provider manager (bao 2026-06-11, redesigned: "common ones
// on the outside, the rest behind Add"). The outer surface shows only YOUR
// configured providers (one-click switch); everything else is folded behind
// "+ Add a provider" — pick a template, fill ONLY the API key (endpoint +
// model fold into Advanced; Zhipu gets an International/China region toggle).
// Compact, sectioned, no wall of cards.
//
// Two surfaces: modal (first-run / Connect-AI) and inline (Settings → Providers).
// Real kernel commands: list_provider_templates + config_set_provider_key +
// provider_set_active (1-token trial). Browser/dev falls back to bundled
// templates + a demo "configured" list so the layout renders outside Tauri.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  listProviderTemplates,
  setProviderKey,
  deleteProvider,
  queryProviderModels,
  type ProviderTemplate,
} from '@/lib/kernel';
import { providerSetActive, providerList, type ProviderListRow } from '@/lib/provider-config';
import { useActiveProvider } from '@/hooks/useActiveProvider';
import { ConfirmDialog } from '@/components/primitives/ConfirmDialog';
import styles from './ProviderHub.module.css';

interface ActiveView {
  roles: Record<string, { id: string; label: string; model_id: string | null }>;
}

interface ProviderHubProps {
  inline?: boolean;
  onClose?: () => void;
  onActivated?: (label: string, model: string) => void;
}

// In the Add list, your common providers float to the top.
const PRIORITY = ['anthropic', 'zhipu', 'zai-coding-plan', 'volc'];

// Z.AI's general API and Coding Plan use distinct endpoints and credentials.
// Both stay template-driven; OpenCode's broader OAuth/profile/local-runtime
// provider surface remains owned by its native `/connect` flow.
// (ADR-002 substrate §3.10 v66)
// (ADR-001 spine §4 v10)

// Browser/dev demo so the "Your providers" section isn't empty outside Tauri.
const DEMO_CONFIGURED: ProviderListRow[] = [
  { id: 'anthropic', label: 'Claude', models: ['claude-sonnet-4-6'], ready: true, endpoint: 'https://api.anthropic.com', source: 'user' } as ProviderListRow,
  { id: 'volc', label: 'Volc Doubao', models: ['doubao-1-5-pro-32k-250115'], ready: true, endpoint: 'https://ark.cn-beijing.volces.com/api/v3', source: 'user' } as ProviderListRow,
];

export function ProviderHub({ inline = false, onClose, onActivated }: ProviderHubProps): ReactElement {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [configured, setConfigured] = useState<ProviderListRow[]>([]);
  // Decision 0007 §display (2026-06-19): single hook replaces the
  // per-component invoke + fallback. The fallback ("Claude" demo row)
  // is gone — when no provider is bound the modal title shows the empty
  // state honestly instead of a fake demo.
  const { active: activeFromHook, loading: activeLoading } = useActiveProvider();
  const active = activeFromHook && {
    id: activeFromHook.id,
    label: activeFromHook.label,
    model_id: activeFromHook.model_id,
  };
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ProviderListRow | null>(null);

  // Decision 0007 §per-provider-models (2026-06-19): when the user
  // picks a template + types their key, debounce-query the provider's
  // /models endpoint so the model <input> shows a <datalist> of real
  // ids the provider actually exposes today. Failures fall through to
  // an empty list (the input stays free-text).
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    const tpl = selectedId ? templates.find((t) => t.id === selectedId) : null;
    if (!tpl) {
      setLiveModels([]);
      return;
    }
    const effectiveBase = baseUrl || tpl.baseUrl;
    const trimmedKey = apiKey.trim();
    if (!effectiveBase || !trimmedKey) {
      setLiveModels([]);
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    const handle = window.setTimeout(() => {
      setModelsLoading(true);
      void queryProviderModels(effectiveBase, trimmedKey)
        .then(setLiveModels)
        .catch(() => setLiveModels([]))
        .finally(() => setModelsLoading(false));
    }, 400);
    debounceRef.current = handle;
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [selectedId, templates, apiKey, baseUrl]);

  const reload = useCallback(() => {
    void listProviderTemplates().then(setTemplates).catch(() => setTemplates([]));
    // Outside Tauri providerList rejects — show a small demo set so the
    // "Your providers" section renders (real app uses the real list).
    void providerList().then(setConfigured).catch(() => setConfigured(DEMO_CONFIGURED));
    // Active provider state is owned by useActiveProvider() above — no
    // more local invoke here. reload() just refreshes the catalog +
    // configured list (templates + configuredRows drive the picker).
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const finish = useCallback(
    (label: string, modelId: string) => {
      onActivated?.(label, modelId);
      if (inline) {
        setShowAdd(false);
        setSelectedId(null);
        setApiKey('');
        reload();
      } else {
        onClose?.();
      }
    },
    [inline, onActivated, onClose, reload],
  );

  const configuredRows = configured.filter((c) => c.ready);

  // Add-list templates: hide ones already configured, prioritize your common,
  // filter by search.
  const addTemplates = useMemo(() => {
    const cfgIds = new Set(configuredRows.map((c) => c.id));
    const q = search.trim().toLowerCase();
    return [...templates]
      .filter((t) => t.id === 'custom' || !cfgIds.has(t.id))
      .filter((t) => !q || t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q))
      .sort((a, b) => {
        const pa = PRIORITY.indexOf(a.id);
        const pb = PRIORITY.indexOf(b.id);
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
      });
  }, [templates, configuredRows, search]);

  const pick = (t: ProviderTemplate): void => {
    setSelectedId(t.id);
    setApiKey('');
    setModel(t.defaultModel);
    setBaseUrl(t.baseUrl);
    // Default-expand Advanced so the user sees the live model picker as
    // soon as they type their key (decision 0007 §per-provider-models).
    setShowAdvanced(true);
    setError(null);
  };

  const selectedTpl = templates.find((t) => t.id === selectedId) ?? null;

  const apply = async (t: ProviderTemplate): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const effectiveBase = baseUrl || t.baseUrl;
      // Carry the catalog's recommended models[] into the manifest so the
      // provider_list_models static fallback stays populated (decision
      // 0007 §per-provider-models). Dedup around the user-picked model
      // so the chosen id always wins slot 0 (which is what
      // registry.first_model_for reads for the chip display).
      const chosen = model.trim() || t.defaultModel;
      const carry: string[] = chosen
        ? [chosen, ...(t.models ?? [])].filter(
            (m, i, arr) => m && arr.indexOf(m) === i,
          )
        : t.models ?? [];
      await setProviderKey({
        provider: t.id,
        api_key: apiKey,
        base_url: effectiveBase.replace(/\/$/, ''),
        default_model: chosen,
        display_name: t.defaultName,
        api_protocol: t.protocol,
        models: carry,
      });
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: t.id });
      finish(t.defaultName, reply.model_id ?? model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (id: string, label: string): Promise<void> => {
    if (active?.id === id) return;
    setBusy(true);
    setError(null);
    try {
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: id });
      finish(label, reply.model_id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Edit reuses the +Add form pre-filled with the configured provider's
  // current values. The user re-types the key (keychain write is opaque
  // for security — we never read it back into the input). Save overwrites
  // the manifest via setProviderKey (upsert).
  const editProvider = (c: ProviderListRow): void => {
    const endpoint = c.endpoint ?? '';
    const tpl: ProviderTemplate = templates.find((t) => t.id === c.id) ?? {
      id: c.id,
      label: c.label,
      defaultName: c.label,
      protocol: 'openai',
      baseUrl: endpoint,
      defaultModel: c.models[0] ?? '',
      keyHint: '',
      models: c.models,
    };
    setShowAdd(true);
    setSelectedId(tpl.id);
    setApiKey('');
    setModel(c.models[0] ?? tpl.defaultModel);
    setBaseUrl(endpoint);
    setShowAdvanced(true);
    setError(null);
  };

  // Remove calls config_delete_provider (clears keychain + removes
  // ~/.ctrl/providers/<slug>.toml). The active SSOT falls back to the
  // next configured provider on the next chip refresh.
  // Open the in-app confirm (window.confirm returns false in Tauri's WKWebView,
  // so a native browser confirm would make delete impossible).
  const removeProvider = (c: ProviderListRow): void => {
    setPendingRemove(c);
  };

  const confirmRemove = async (): Promise<void> => {
    const c = pendingRemove;
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProvider(c.id);
      setPendingRemove(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const closeAdd = (): void => {
    setShowAdd(false);
    setSelectedId(null);
    setSearch('');
    setError(null);
  };

  const inner = (
    <div
      className={`${styles.panel} ${inline ? styles.panelInline : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <div>
          {!inline && <h2 className={styles.title}>Providers</h2>}
          <p className={styles.sub}>
            {active ? (
              <>
                Irisy is using <b>{active.label}</b>
                {active.model_id ? ` · ${active.model_id}` : ''}
              </>
            ) : (
              'Add a provider and paste your API key — that’s it.'
            )}
          </p>
        </div>
        {!inline && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      {/* ── Your providers (configured) — the outer surface ── */}
      {configuredRows.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Your providers</div>
          {configuredRows.map((c) => {
            const isActive = active?.id === c.id;
            return (
              <div
                key={c.id}
                className={styles.providerRow}
                data-active={isActive || undefined}
                onClick={busy ? undefined : () => void switchTo(c.id, c.label)}
                title={isActive ? 'Currently used by Irisy' : 'Switch Irisy to this'}
              >
                <span className={styles.providerName}>{c.label}</span>
                <span className={styles.providerModel}>{c.models[0] ?? '—'}</span>
                <span className={styles.providerStatus} data-active={isActive || undefined}>
                  {isActive ? '★ in use' : '● switch'}
                </span>
                {/* Edit / Remove — bao 2026-06-19: prior art had no way to
                    fix a misconfigured provider (wrong region / dead key)
                    short of editing ~/.ctrl/providers/<slug>.toml by hand.
                    Edit reuses the +Add form pre-filled; Remove calls
                    config_delete_provider (clears keychain + toml). */}
                <div className={styles.providerActions}>
                  <button
                    type="button"
                    className={styles.providerActionBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      editProvider(c);
                    }}
                    title="Edit credentials / model / region"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={styles.providerActionBtn}
                    data-danger
                    onClick={(e) => {
                      e.stopPropagation();
                      void removeProvider(c);
                    }}
                    title="Remove manifest + keychain entry"
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add (collapsed by default; the rest lives here) ── */}
      {!showAdd ? (
        <button type="button" className={styles.addBtn} onClick={() => setShowAdd(true)} disabled={busy}>
          + Add a provider
        </button>
      ) : (
        <div className={styles.addPanel}>
          <div className={styles.sectionLabel}>Add a provider</div>

          {!selectedTpl ? (
            <>
              <input
                className={styles.search}
                placeholder="Search providers…"
                value={search}
                autoFocus
                onChange={(e) => setSearch(e.target.value)}
              />
              <div className={styles.templateList}>
                {addTemplates.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.templateRow}
                    onClick={() => pick(t)}
                  >
                    <span className={styles.templateName}>{t.label}</span>
                    <span className={styles.templateModel}>{t.defaultModel || 'custom endpoint'}</span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className={styles.config}>
              <div className={styles.configTitle}>{selectedTpl.label}</div>

              <label className={styles.keyField}>
                <span className={styles.keyLabel}>API key</span>
                <input
                  className={styles.keyInput}
                  type="password"
                  value={apiKey}
                  autoFocus
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={selectedTpl.keyHint || 'paste your key — kept in your Keychain'}
                />
                {selectedTpl.keyHint && (
                  <span className={styles.keyHint}>{selectedTpl.keyHint}</span>
                )}
              </label>

              <button type="button" className={styles.advToggle} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '▾' : '▸'} Advanced — endpoint &amp; model
              </button>
              {showAdvanced && (
                <div className={styles.adv}>
                  <label className={styles.advField}>
                    <span>
                      Model{' '}
                      {modelsLoading
                        ? '(loading live list…)'
                        : liveModels.length > 0
                          ? `(${liveModels.length} live)`
                          : (selectedTpl.models?.length ?? 0) > 0
                            ? `(${selectedTpl.models!.length} recommended)`
                            : selectedTpl.defaultModel
                              ? `(default: ${selectedTpl.defaultModel})`
                              : ''}
                    </span>
                    <input
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      placeholder={selectedTpl.defaultModel}
                      list="provider-models-datalist"
                      autoComplete="off"
                    />
                    {/* Live <datalist> from /models — opencode-style. When
                        live list isn't fetched yet (no key) or fails, fall
                        back to the catalog's recommended `models` array so
                        the user still sees the current lineup (glm-5.2 etc.)
                        without typing a key. Empty list = input stays
                        free-text. Id is stable across renders so React
                        doesn't recreate the node and lose focus. */}
                    <datalist id="provider-models-datalist">
                      {(liveModels.length > 0
                        ? liveModels
                        : selectedTpl.models ?? []
                      ).map((id) => (
                        <option key={id} value={id} />
                      ))}
                      {selectedTpl.defaultModel &&
                        !(liveModels.length > 0
                          ? liveModels
                          : selectedTpl.models ?? []
                        ).includes(selectedTpl.defaultModel) && (
                          <option value={selectedTpl.defaultModel} />
                        )}
                    </datalist>
                  </label>
                  <label className={styles.advField}>
                    <span>Base URL</span>
                    <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={selectedTpl.baseUrl} />
                  </label>
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.actions}>
                <button type="button" className={styles.ghost} onClick={() => setSelectedId(null)}>
                  ← Back
                </button>
                <button
                  type="button"
                  className={styles.connect}
                  onClick={() => void apply(selectedTpl)}
                  disabled={busy || !apiKey.trim()}
                >
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </div>
          )}

          {!selectedTpl && (
            <button type="button" className={styles.addCancel} onClick={closeAdd}>
              Cancel
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove provider?"
        body={
          pendingRemove
            ? `Remove ${pendingRemove.label}? Deletes the manifest + keychain entry. Irisy falls back to the next configured provider.`
            : ''
        }
        confirmLabel="Remove"
        destructive
        pending={busy}
        onCancel={() => setPendingRemove(null)}
        onConfirm={() => void confirmRemove()}
      />
    </div>
  );

  return inline ? inner : (
    <div className={styles.backdrop} onClick={onClose}>
      {inner}
    </div>
  );
}
