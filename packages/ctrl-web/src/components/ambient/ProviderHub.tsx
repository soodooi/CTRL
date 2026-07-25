// ProviderHub — provider manager (bao 2026-06-11, redesigned: "common ones
// on the outside, the rest behind Add"). The outer surface shows only YOUR
// configured providers (one-click switch); everything else is folded behind
// "+ Add a provider" — pick a template, fill ONLY the API key (endpoint +
// model fold into Advanced). The complete refreshable catalogue comes from
// the kernel; the UI contains no provider-specific model inventory.
// Compact, sectioned, no wall of cards.
//
// Two surfaces: modal (first-run / Connect-AI) and inline (Settings → Providers).
// Real kernel commands: list_provider_templates + config_set_provider_key +
// provider_set_active (1-token trial). Browser/dev falls back to bundled
// templates + a demo "configured" list so the layout renders outside Tauri.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  listProviderTemplates,
  refreshProviderCatalog,
  setProviderKey,
  deleteProvider,
  queryProviderModels,
  type ProviderTemplate,
} from '@/lib/kernel';
import {
  canonicalProviderId,
  providerSetActive,
  providerList,
  type ProviderListRow,
} from '@/lib/provider-config';
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
// (ADR-002 substrate §3.10 v67)
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
  const [selectedOverride, setSelectedOverride] = useState<ProviderTemplate | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [catalogRefreshing, setCatalogRefreshing] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<ProviderListRow | null>(null);

  // Decision 0007 §per-provider-models (2026-06-19): when the user
  // picks a template + types their key, debounce-query the provider's
  // /models endpoint so the model <input> shows a <datalist> of real
  // ids the provider actually exposes today. Failures fall through to
  // the catalogue selector while the model id remains free-text editable.
  const debounceRef = useRef<number | null>(null);
  const liveModelsGeneration = useRef(0);
  const catalogReloadGeneration = useRef(0);
  useEffect(() => {
    const generation = ++liveModelsGeneration.current;
    const tpl = selectedOverride
      ?? (selectedId ? templates.find((t) => t.id === selectedId) : null);
    if (!tpl) {
      setLiveModels([]);
      setModelsLoading(false);
      return;
    }
    const effectiveBase = baseUrl || tpl.baseUrl;
    const trimmedKey = apiKey.trim();
    if (!effectiveBase || !trimmedKey) {
      setLiveModels([]);
      setModelsLoading(false);
      return;
    }
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    const handle = window.setTimeout(() => {
      if (liveModelsGeneration.current !== generation) return;
      setModelsLoading(true);
      // Ignore stale results after input/catalogue changes or unmount.
      // (ADR-002 substrate §3.10 v67)
      void queryProviderModels(effectiveBase, trimmedKey)
        .then((models) => {
          if (liveModelsGeneration.current === generation) setLiveModels(models);
        })
        .catch(() => {
          if (liveModelsGeneration.current === generation) setLiveModels([]);
        })
        .finally(() => {
          if (liveModelsGeneration.current === generation) setModelsLoading(false);
        });
    }, 400);
    debounceRef.current = handle;
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (liveModelsGeneration.current === generation) liveModelsGeneration.current += 1;
    };
  }, [selectedId, selectedOverride, templates, apiKey, baseUrl]);

  const reload = useCallback(() => {
    const generation = ++catalogReloadGeneration.current;
    setCatalogRefreshing(true);
    setCatalogError(null);
    // Publish the cache/bundled floor first, then the refreshed catalogue in
    // sequence. A generation guard prevents an older reload (or an unmounted
    // hub) from replacing newer state. (ADR-002 substrate §3.10 v67)
    void (async () => {
      try {
        const floor = await listProviderTemplates();
        if (catalogReloadGeneration.current === generation) setTemplates(floor);
        await refreshProviderCatalog();
        const refreshed = await listProviderTemplates();
        if (catalogReloadGeneration.current === generation) setTemplates(refreshed);
      } catch (e) {
        // Keep the already-published cache/bundled floor on refresh failure,
        // but make the degraded catalogue visible instead of silently looking
        // complete. (ADR-002 substrate §3.10 v67)
        if (catalogReloadGeneration.current === generation) {
          setCatalogError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (catalogReloadGeneration.current === generation) setCatalogRefreshing(false);
      }
    })();
    // Outside Tauri providerList rejects — show a small demo set so the
    // "Your providers" section renders (real app uses the real list).
    void providerList().then((rows) => {
      if (catalogReloadGeneration.current === generation) setConfigured(rows);
    }).catch(() => {
      if (catalogReloadGeneration.current === generation) setConfigured(DEMO_CONFIGURED);
    });
    // Active provider state is owned by useActiveProvider() above — no
    // more local invoke here. reload() just refreshes the catalog +
    // configured list (templates + configuredRows drive the picker).
  }, []);
  useEffect(() => {
    reload();
    return () => { catalogReloadGeneration.current += 1; };
  }, [reload]);

  const finish = useCallback(
    (label: string, modelId: string) => {
      onActivated?.(label, modelId);
      if (inline) {
        setShowAdd(false);
        setSelectedId(null);
        setSelectedOverride(null);
        setApiKey('');
        reload();
      } else {
        onClose?.();
      }
    },
    [inline, onActivated, onClose, reload],
  );

  // Keep every persisted manifest visible. A non-ready provider is a
  // repairable configuration state, not an absent provider.
  // (ADR-002 substrate § provider v67)
  const configuredRows = configured;

  // Add-list templates: hide ones already configured, prioritize your common,
  // filter by search.
  const addTemplates = useMemo(() => {
    const cfgIds = new Set(configured.map((c) => c.id));
    const q = search.trim().toLowerCase();
    return [...templates]
      .filter((t) => t.id === 'custom' || !cfgIds.has(canonicalProviderId(t.id)))
      .filter((t) => {
        if (!q) return true;
        return t.label.toLowerCase().includes(q)
          || t.id.toLowerCase().includes(q)
          || t.defaultModel.toLowerCase().includes(q)
          || (t.models ?? []).some((modelId) => modelId.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        const pa = PRIORITY.indexOf(a.id);
        const pb = PRIORITY.indexOf(b.id);
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
      });
  }, [templates, configured, search]);

  const pick = (t: ProviderTemplate): void => {
    setSelectedOverride(null);
    setSelectedId(t.id);
    setApiKey('');
    setModel(t.defaultModel);
    setBaseUrl(t.baseUrl);
    // Default-expand Advanced so the user sees the live model picker as
    // soon as they type their key (decision 0007 §per-provider-models).
    setShowAdvanced(true);
    setError(null);
  };

  const selectedTpl = selectedOverride ?? templates.find((t) => t.id === selectedId) ?? null;
  const availableModels = Array.from(new Set([
    ...(liveModels.length > 0 ? liveModels : selectedTpl?.models ?? []),
    ...(selectedTpl?.defaultModel ? [selectedTpl.defaultModel] : []),
  ]));
  const isEditingProvider = selectedId != null && configured.some(
    (c) => c.id === canonicalProviderId(selectedId),
  );

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
        ? [chosen, ...availableModels].filter(
            (m, i, arr) => m && arr.indexOf(m) === i,
          )
        : availableModels;
      const providerId = await setProviderKey({
        provider: t.id,
        api_key: apiKey,
        base_url: effectiveBase.replace(/\/$/, ''),
        default_model: chosen,
        display_name: t.defaultName,
        api_protocol: t.protocol,
        models: carry,
      });
      // Active-provider edits are verified transactionally by the save command
      // before it replaces the live manifest. The role id is unchanged, so a
      // second trial would only duplicate the locked gate.
      // (ADR-002 substrate § provider v2 lock #4)
      if (isEditingProvider && active != null
        && canonicalProviderId(active.id) === providerId) {
        finish(t.defaultName, chosen);
        return;
      }
      // Activate the canonical id returned by the manifest writer; catalogue
      // ids may contain characters normalized by sanitize_slug.
      // (ADR-002 substrate § provider v67)
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: providerId });
      finish(t.defaultName, reply.model_id ?? model);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (id: string, label: string): Promise<void> => {
    if (active != null && canonicalProviderId(active.id) === canonicalProviderId(id)) return;
    setBusy(true);
    setSwitchingId(id);
    setError(null);
    try {
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: id });
      finish(label, reply.model_id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setSwitchingId(null);
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
      protocol: c.shape === 'anthropic_messages' ? 'anthropic' : 'openai',
      baseUrl: endpoint,
      defaultModel: c.models[0] ?? '',
      keyHint: '',
      models: c.models,
    };
    setSelectedOverride(tpl);
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
    setSelectedOverride(null);
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
            const isActive = active != null
              && canonicalProviderId(active.id) === canonicalProviderId(c.id);
            return (
              <div
                key={c.id}
                className={styles.providerRow}
                data-active={isActive || undefined}
                onClick={busy || !c.ready ? undefined : () => void switchTo(c.id, c.label)}
                title={
                  !c.ready
                    ? c.load_error ?? 'Edit this provider to finish setup'
                    : isActive
                      ? 'Currently used by Irisy'
                      : 'Switch Irisy to this'
                }
              >
                <span className={styles.providerName}>{c.label}</span>
                <span className={styles.providerModel}>{c.models[0] ?? '—'}</span>
                <span className={styles.providerStatus} data-active={isActive || undefined}>
                  {switchingId === c.id
                    ? 'Verifying…'
                    : !c.ready
                      ? 'Needs setup'
                      : isActive
                        ? '★ in use'
                        : '● switch'}
                </span>
                {/* Edit / Remove — bao 2026-06-19: prior art had no way to
                    fix a misconfigured provider (wrong region / dead key)
                    short of editing ~/.ctrl/providers/<slug>.toml by hand.
                    Edit reuses the +Add form pre-filled; Remove calls
                    config_delete_provider (clears keychain + toml). */}
                {c.source === 'user' && (
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
                )}
              </div>
            );
          })}
        </div>
      )}
      {error && !showAdd && (
        <div className={styles.error} role="alert">
          Provider switch failed: {error}
        </div>
      )}

      {/* ── Add (collapsed by default; the rest lives here) ── */}
      {!showAdd ? (
        <button type="button" className={styles.addBtn} onClick={() => setShowAdd(true)} disabled={busy}>
          + Add a provider
        </button>
      ) : (
        <div className={styles.addPanel}>
          <div className={styles.catalogHeader}>
            <div className={styles.sectionLabel}>Add a provider</div>
            <button
              type="button"
              className={styles.catalogRefresh}
              onClick={reload}
              disabled={catalogRefreshing}
            >
              {catalogRefreshing ? 'Refreshing…' : 'Refresh catalog'}
            </button>
          </div>
          {catalogError ? (
            <div className={styles.catalogWarning} role="status">
              Catalog refresh failed; showing the offline provider set.
            </div>
          ) : (
            <div className={styles.catalogStatus}>
              {catalogRefreshing ? 'Loading current providers and models…' : `${templates.length} providers loaded`}
            </div>
          )}

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
                    <span className={styles.templateModel}>
                      {(t.models?.length ?? 0) > 1
                        ? `${t.models!.length} models`
                        : t.defaultModel || 'custom endpoint'}
                    </span>
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

              <label className={styles.modelField}>
                <span className={styles.keyLabel}>
                  Model{' '}
                  {modelsLoading
                    ? '(loading live list…)'
                    : liveModels.length > 0
                      ? `(${liveModels.length} live)`
                      : availableModels.length > 0
                        ? `(${availableModels.length} available)`
                        : ''}
                </span>
                {availableModels.length > 0 && (
                  <select
                    value={availableModels.includes(model) ? model : ''}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    <option value="" disabled>Choose a model…</option>
                    {availableModels.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                )}
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder={selectedTpl.defaultModel || 'Enter a model id'}
                  autoComplete="off"
                />
                <span className={styles.keyHint}>
                  Choose from the catalogue or enter any model id supported by this endpoint.
                </span>
              </label>

              <button type="button" className={styles.advToggle} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '▾' : '▸'} Advanced — endpoint
              </button>
              {showAdvanced && (
                <div className={styles.adv}>
                  <label className={styles.advField}>
                    <span>Base URL</span>
                    <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={selectedTpl.baseUrl} />
                  </label>
                </div>
              )}

              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.actions}>
                <button type="button" className={styles.ghost} onClick={() => {
                  setSelectedId(null);
                  setSelectedOverride(null);
                }}>
                  ← Back
                </button>
                <button
                  type="button"
                  className={styles.connect}
                  onClick={() => void apply(selectedTpl)}
                  disabled={busy || (!isEditingProvider && !apiKey.trim())}
                >
                  {busy ? 'Connecting…' : isEditingProvider ? 'Save & use' : 'Connect'}
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
