// ProviderHub is the single provider configuration surface for Settings and
// the ambient model badge. It mirrors OpenCode's provider-first drill-down
// while preserving CTRL's manifest, Keychain, readiness, and activation gates.
// (ADR-002 substrate §3.10 v68; ADR-003 frontend §8.5 v25)

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  deleteProvider,
  listProviderTemplates,
  queryProviderModels,
  refreshProviderCatalog,
  setProviderKey,
  type ProviderTemplate,
} from '@/lib/kernel';
import {
  canonicalProviderId,
  providerList,
  providerSetActive,
  type ProviderListRow,
} from '@/lib/provider-config';
import { useActiveProvider } from '@/hooks/useActiveProvider';
import { ConfirmDialog } from '@/components/primitives/ConfirmDialog';
import styles from './ProviderHub.module.css';

interface ProviderHubProps {
  inline?: boolean;
  onClose?: () => void;
  onActivated?: (label: string, model: string) => void;
}

const PRIORITY = ['anthropic', 'zhipu', 'zai-coding-plan', 'volc'];

export function ProviderHub({ inline = false, onClose, onActivated }: ProviderHubProps): ReactElement {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [configured, setConfigured] = useState<ProviderListRow[]>([]);
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

  const modelListId = useId();
  const debounceRef = useRef<number | null>(null);
  const liveModelsGeneration = useRef(0);
  const catalogReloadGeneration = useRef(0);

  // A live model list improves selection but never becomes the provider truth:
  // the chosen model remains an editable manifest value. Stale requests cannot
  // replace a newer provider/key result. (ADR-002 substrate §3.10 v68)
  useEffect(() => {
    const generation = ++liveModelsGeneration.current;
    const template = selectedOverride
      ?? (selectedId ? templates.find((candidate) => candidate.id === selectedId) : null);
    if (!template) {
      setLiveModels([]);
      setModelsLoading(false);
      return;
    }

    const effectiveBase = baseUrl || template.baseUrl;
    const trimmedKey = apiKey.trim();
    if (!effectiveBase || !trimmedKey) {
      setLiveModels([]);
      setModelsLoading(false);
      return;
    }

    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      if (liveModelsGeneration.current !== generation) return;
      setModelsLoading(true);
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

    void (async () => {
      try {
        const floor = await listProviderTemplates();
        if (catalogReloadGeneration.current === generation) setTemplates(floor);
        await refreshProviderCatalog();
        const refreshed = await listProviderTemplates();
        if (catalogReloadGeneration.current === generation) setTemplates(refreshed);
      } catch (cause) {
        if (catalogReloadGeneration.current === generation) {
          setCatalogError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (catalogReloadGeneration.current === generation) setCatalogRefreshing(false);
      }
    })();

    // Browser preview has no credential truth, so it must show an honest empty
    // configured list rather than demo providers. (ADR-002 substrate §3.10 v68)
    void providerList()
      .then((rows) => {
        if (catalogReloadGeneration.current === generation) setConfigured(rows);
      })
      .catch(() => {
        if (catalogReloadGeneration.current === generation) setConfigured([]);
      });
  }, []);

  useEffect(() => {
    reload();
    return () => { catalogReloadGeneration.current += 1; };
  }, [reload]);

  const clearFlow = useCallback(() => {
    setShowAdd(false);
    setSelectedId(null);
    setSelectedOverride(null);
    setSearch('');
    setApiKey('');
    setModel('');
    setBaseUrl('');
    setShowAdvanced(false);
    setLiveModels([]);
    setCatalogError(null);
    setError(null);
  }, []);

  const finishActivation = useCallback((label: string, modelId: string) => {
    onActivated?.(label, modelId);
    if (inline) {
      clearFlow();
      reload();
    } else {
      onClose?.();
    }
  }, [clearFlow, inline, onActivated, onClose, reload]);

  const finishSave = useCallback(() => {
    if (inline) {
      clearFlow();
      reload();
    } else {
      onClose?.();
    }
  }, [clearFlow, inline, onClose, reload]);

  const addTemplates = useMemo(() => {
    const configuredIds = new Set(configured.map((row) => canonicalProviderId(row.id)));
    const query = search.trim().toLowerCase();
    return [...templates]
      .filter((template) => template.id === 'custom'
        || !configuredIds.has(canonicalProviderId(template.id)))
      .filter((template) => {
        if (!query) return true;
        return template.label.toLowerCase().includes(query)
          || template.id.toLowerCase().includes(query)
          || template.defaultModel.toLowerCase().includes(query)
          || (template.models ?? []).some((modelId) => modelId.toLowerCase().includes(query));
      })
      .sort((left, right) => {
        if (left.id === 'custom') return -1;
        if (right.id === 'custom') return 1;
        const leftPriority = PRIORITY.indexOf(left.id);
        const rightPriority = PRIORITY.indexOf(right.id);
        if (leftPriority >= 0 || rightPriority >= 0) {
          return (leftPriority < 0 ? 99 : leftPriority) - (rightPriority < 0 ? 99 : rightPriority);
        }
        return left.label.localeCompare(right.label);
      });
  }, [configured, search, templates]);

  const popularTemplates = addTemplates.filter((template) => PRIORITY.includes(template.id));
  const otherTemplates = addTemplates.filter((template) => !PRIORITY.includes(template.id));

  const pick = (template: ProviderTemplate): void => {
    setSelectedOverride(null);
    setSelectedId(template.id);
    setApiKey('');
    setModel(template.defaultModel);
    setBaseUrl(template.baseUrl);
    setShowAdvanced(false);
    setError(null);
  };

  const selectedTemplate = selectedOverride
    ?? templates.find((template) => template.id === selectedId)
    ?? null;
  const availableModels = Array.from(new Set([
    ...liveModels,
    ...(selectedTemplate?.models ?? []),
    ...(selectedTemplate?.defaultModel ? [selectedTemplate.defaultModel] : []),
  ]));
  const editingRow = selectedId == null
    ? undefined
    : configured.find((row) => canonicalProviderId(row.id) === canonicalProviderId(selectedId));
  const isEditingProvider = editingRow != null;
  const isEditingActive = editingRow != null
    && active != null
    && canonicalProviderId(active.id) === canonicalProviderId(editingRow.id);
  const requiresApiKey = !isEditingProvider;

  const apply = async (template: ProviderTemplate): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const effectiveBase = baseUrl || template.baseUrl;
      const chosen = isEditingProvider
        ? model.trim()
        : model.trim() || template.defaultModel;
      const carriedModels = isEditingProvider
        ? chosen
          ? [chosen, ...(editingRow?.models ?? [])].filter(
              (item, index, values) => item && values.indexOf(item) === index,
            )
          : editingRow?.models ?? []
        : chosen
          ? [chosen, ...availableModels].filter(
              (item, index, values) => item && values.indexOf(item) === index,
            )
          : availableModels;
      const providerId = await setProviderKey({
        provider: template.id,
        api_key: apiKey,
        base_url: effectiveBase.replace(/\/$/, ''),
        default_model: chosen,
        display_name: template.defaultName,
        api_protocol: template.protocol,
        models: carriedModels,
      });

      if (isEditingProvider) {
        // An active edit is transactionally trialed by config_set_provider_key.
        // Editing any other provider only saves it; it must not silently change
        // irisy.primary. (ADR-002 substrate §3.10 v68)
        if (isEditingActive) finishActivation(template.defaultName, chosen);
        else finishSave();
        return;
      }

      // New connections become active only after provider_set_active completes
      // the real production first-output trial. (ADR-002 substrate §3.10 v68)
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: providerId });
      finishActivation(template.defaultName, reply.model_id ?? chosen);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
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
      finishActivation(label, reply.model_id ?? '');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setSwitchingId(null);
    }
  };

  const editProvider = (row: ProviderListRow): void => {
    const endpoint = row.endpoint ?? '';
    const catalogTemplate = templates.find(
      (candidate) => canonicalProviderId(candidate.id) === canonicalProviderId(row.id),
    );
    // The persisted row owns identity, wire shape, endpoint, display label,
    // and selected model during edit. Catalogue data may suggest additional
    // models and a key hint, but must never overwrite the manifest contract.
    // (ADR-002 substrate §3.10 v68)
    const template: ProviderTemplate = {
      id: row.id,
      label: row.label,
      defaultName: row.label,
      protocol: row.shape === 'anthropic_messages' ? 'anthropic' : 'openai',
      baseUrl: endpoint,
      defaultModel: row.models[0] ?? '',
      keyHint: catalogTemplate?.keyHint ?? '',
      models: Array.from(new Set([
        ...row.models,
        ...(catalogTemplate?.models ?? []),
      ])),
    };
    setSelectedOverride(template);
    setShowAdd(true);
    setSelectedId(template.id);
    setApiKey('');
    setModel(row.models[0] ?? template.defaultModel);
    setBaseUrl(endpoint);
    setShowAdvanced(false);
    setError(null);
  };

  const confirmRemove = async (): Promise<void> => {
    const row = pendingRemove;
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await deleteProvider(row.id);
      setPendingRemove(null);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const connectionStatus = activeLoading
    ? 'Loading active provider…'
    : active
      ? `Irisy uses ${active.label}${active.model_id ? ` · ${active.model_id}` : ''}`
      : 'No active provider';

  const inner = (
    <div
      className={`${styles.panel} ${inline ? styles.panelInline : ''}`}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={styles.header}>
        <div className={styles.headerCopy}>
          {!inline && <h2 className={styles.title}>Providers</h2>}
          <p className={styles.sub}>{connectionStatus}</p>
        </div>
        {!inline && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ×
          </button>
        )}
      </div>

      {!showAdd ? (
        <>
          <section className={styles.section} aria-labelledby="configured-providers-heading">
            <div className={styles.sectionHeader}>
              <h3 id="configured-providers-heading" className={styles.sectionLabel}>Configured</h3>
              <span className={styles.sectionCount}>{configured.length}</span>
            </div>

            {configured.length === 0 ? (
              <div className={styles.emptyState}>
                <strong>No providers configured</strong>
                <span>Connect a provider to choose the model Irisy uses.</span>
              </div>
            ) : (
              <div className={styles.providerList}>
                {configured.map((row) => {
                  const isActive = active != null
                    && canonicalProviderId(active.id) === canonicalProviderId(row.id);
                  const state = !row.ready ? 'setup' : isActive ? 'active' : 'ready';
                  const status = switchingId === row.id
                    ? 'Verifying…'
                    : state === 'setup'
                      ? 'Needs setup'
                      : state === 'active'
                        ? 'Active'
                        : 'Ready';
                  return (
                    <div key={row.id} className={styles.providerRow} data-state={state}>
                      <div className={styles.providerCopy}>
                        <span className={styles.providerName}>{row.label}</span>
                        <span className={styles.providerModel}>{row.models[0] ?? 'No model selected'}</span>
                      </div>
                      <span className={styles.providerStatus} data-state={state}>{status}</span>
                      <div className={styles.providerActions}>
                        {row.ready && !isActive && (
                          <button
                            type="button"
                            className={styles.useButton}
                            onClick={() => void switchTo(row.id, row.label)}
                            disabled={busy}
                          >
                            Use
                          </button>
                        )}
                        {row.source === 'user' && (
                          <>
                            <button
                              type="button"
                              className={styles.providerActionButton}
                              onClick={() => editProvider(row)}
                              disabled={busy}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className={styles.providerActionButton}
                              data-danger
                              onClick={() => setPendingRemove(row)}
                              disabled={busy}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {error && <div className={styles.error} role="alert">Provider activation failed: {error}</div>}
          <button
            type="button"
            className={styles.addButton}
            onClick={() => {
              setShowAdd(true);
              setError(null);
            }}
            disabled={busy}
          >
            Add provider
          </button>
        </>
      ) : (
        <section className={styles.flow} aria-label={selectedTemplate ? 'Provider setup' : 'Provider selection'}>
          <div className={styles.flowHeader}>
            <button
              type="button"
              className={styles.backButton}
              onClick={() => {
                if (selectedTemplate) {
                  setSelectedId(null);
                  setSelectedOverride(null);
                  setApiKey('');
                  setError(null);
                } else {
                  clearFlow();
                }
              }}
            >
              ← Back
            </button>
            <div>
              <h3 className={styles.flowTitle}>
                {selectedTemplate
                  ? isEditingProvider ? `Edit ${selectedTemplate.label}` : `Connect ${selectedTemplate.label}`
                  : 'Choose a provider'}
              </h3>
              <p className={styles.flowDescription}>
                {selectedTemplate
                  ? 'Credentials stay in your system Keychain.'
                  : 'Select a provider, then add its API key and model.'}
              </p>
            </div>
          </div>

          {!selectedTemplate ? (
            <>
              <div className={styles.searchRow}>
                <input
                  className={styles.search}
                  type="search"
                  placeholder="Search providers…"
                  value={search}
                  autoFocus
                  onChange={(event) => setSearch(event.target.value)}
                />
                <button
                  type="button"
                  className={styles.refreshButton}
                  onClick={reload}
                  disabled={catalogRefreshing}
                >
                  {catalogRefreshing ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
              {catalogError && (
                <div className={styles.catalogWarning} role="status">
                  Catalog refresh failed. Showing the offline provider set.
                </div>
              )}
              <div className={styles.templateList}>
                {[
                  { label: 'Popular', items: popularTemplates },
                  { label: 'Other', items: otherTemplates },
                ].map((group) => group.items.length > 0 && (
                  <div key={group.label} className={styles.templateGroup}>
                    <div className={styles.templateGroupLabel}>{group.label}</div>
                    {group.items.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        className={styles.templateRow}
                        onClick={() => pick(template)}
                      >
                        <span className={styles.templateName}>{template.label}</span>
                        <span className={styles.templateMeta}>
                          {(template.models?.length ?? 0) > 1
                            ? `${template.models!.length} models`
                            : template.defaultModel || 'Custom endpoint'}
                        </span>
                        <span className={styles.templateArrow} aria-hidden="true">›</span>
                      </button>
                    ))}
                  </div>
                ))}
                {addTemplates.length === 0 && (
                  <div className={styles.noResults}>No providers match “{search}”.</div>
                )}
              </div>
            </>
          ) : (
            <div className={styles.config}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>API key</span>
                <input
                  className={styles.fieldInput}
                  type="password"
                  value={apiKey}
                  autoFocus
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={isEditingProvider
                    ? 'Leave blank to keep the stored key'
                    : selectedTemplate.keyHint || 'Paste your API key'}
                />
                <span className={styles.fieldHint}>
                  {isEditingProvider
                    ? 'Enter a new key only when you want to replace the stored credential.'
                    : selectedTemplate.keyHint || 'The key is encrypted by the operating system and never written to the manifest.'}
                </span>
              </label>

              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Model
                  {modelsLoading
                    ? ' · loading live models…'
                    : liveModels.length > 0
                      ? ` · ${liveModels.length} live`
                      : ''}
                </span>
                <input
                  className={styles.fieldInputMono}
                  list={availableModels.length > 0 ? modelListId : undefined}
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={selectedTemplate.defaultModel || 'Enter a model ID'}
                  autoComplete="off"
                />
                {availableModels.length > 0 && (
                  <datalist id={modelListId}>
                    {availableModels.map((modelId) => <option key={modelId} value={modelId} />)}
                  </datalist>
                )}
                <span className={styles.fieldHint}>
                  Choose a discovered model or enter any model ID supported by this endpoint.
                </span>
              </label>

              <button
                type="button"
                className={styles.advancedToggle}
                onClick={() => setShowAdvanced((visible) => !visible)}
                aria-expanded={showAdvanced}
              >
                Advanced {showAdvanced ? '−' : '+'}
              </button>
              {showAdvanced && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Base URL</span>
                  <input
                    className={styles.fieldInputMono}
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder={selectedTemplate.baseUrl}
                  />
                  <span className={styles.fieldHint}>Change this only for another region or compatible endpoint.</span>
                </label>
              )}

              {error && <div className={styles.error} role="alert">{error}</div>}
              <div className={styles.actions}>
                <button type="button" className={styles.cancelButton} onClick={clearFlow} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void apply(selectedTemplate)}
                  disabled={busy
                    || (requiresApiKey && !apiKey.trim())
                    || (!isEditingProvider && !model.trim())}
                >
                  {busy
                    ? isEditingProvider ? 'Saving…' : 'Connecting…'
                    : isEditingProvider ? 'Save changes' : 'Connect'}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <ConfirmDialog
        open={pendingRemove != null}
        title="Remove provider?"
        body={pendingRemove
          ? `Remove ${pendingRemove.label}? This deletes its manifest and Keychain entry. Irisy falls back to the next configured provider.`
          : ''}
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
