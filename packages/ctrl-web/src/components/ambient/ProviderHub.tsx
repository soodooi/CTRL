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

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { listProviderTemplates, setProviderKey, type ProviderTemplate } from '@/lib/kernel';
import { providerSetActive, providerList, type ProviderListRow } from '@/lib/provider-config';
import { invoke } from '@tauri-apps/api/core';
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
const PRIORITY = ['anthropic', 'volc', 'zhipu'];

const ZHIPU_REGIONS: Record<'intl' | 'cn', string> = {
  intl: 'https://api.z.ai/api/paas/v4',
  cn: 'https://open.bigmodel.cn/api/paas/v4',
};
const ZHIPU_KEY_HINTS: Record<'intl' | 'cn', string> = {
  intl: 'create an API key at z.ai → API Keys',
  cn: 'create an API key at open.bigmodel.cn/usercenter/apikeys',
};

// Browser/dev demo so the "Your providers" section isn't empty outside Tauri.
const DEMO_CONFIGURED: ProviderListRow[] = [
  { id: 'anthropic', label: 'Claude', models: ['claude-sonnet-4-6'], ready: true, endpoint: 'https://api.anthropic.com', source: 'user' } as ProviderListRow,
  { id: 'volc', label: 'Volc Doubao', models: ['doubao-1-5-pro-32k-250115'], ready: true, endpoint: 'https://ark.cn-beijing.volces.com/api/v3', source: 'user' } as ProviderListRow,
];

export function ProviderHub({ inline = false, onClose, onActivated }: ProviderHubProps): ReactElement {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [configured, setConfigured] = useState<ProviderListRow[]>([]);
  const [active, setActive] = useState<ActiveView['roles'][string] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [zhipuRegion, setZhipuRegion] = useState<'intl' | 'cn'>('intl');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void listProviderTemplates().then(setTemplates).catch(() => setTemplates([]));
    // Outside Tauri providerList rejects — show a small demo set so the
    // "Your providers" section renders (real app uses the real list).
    void providerList().then(setConfigured).catch(() => setConfigured(DEMO_CONFIGURED));
    void invoke<ActiveView>('get_active_providers')
      .then((v) => setActive(v.roles['irisy.primary'] ?? null))
      .catch(() => setActive({ id: 'anthropic', label: 'Claude', model_id: 'claude-sonnet-4-6' }));
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
    setBaseUrl(t.id === 'zhipu' ? ZHIPU_REGIONS[zhipuRegion] : t.baseUrl);
    setShowAdvanced(false);
    setError(null);
  };

  const selectedTpl = templates.find((t) => t.id === selectedId) ?? null;

  const apply = async (t: ProviderTemplate): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const effectiveBase =
        t.id === 'zhipu' ? baseUrl || ZHIPU_REGIONS[zhipuRegion] : baseUrl || t.baseUrl;
      await setProviderKey({
        provider: t.id,
        api_key: apiKey,
        base_url: effectiveBase.replace(/\/$/, ''),
        default_model: model.trim() || t.defaultModel,
        display_name: t.defaultName,
        api_protocol: t.protocol,
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
              <button
                key={c.id}
                type="button"
                className={styles.providerRow}
                data-active={isActive || undefined}
                onClick={() => void switchTo(c.id, c.label)}
                disabled={busy}
                title={isActive ? 'Currently used by Irisy' : 'Switch Irisy to this'}
              >
                <span className={styles.providerName}>{c.label}</span>
                <span className={styles.providerModel}>{c.models[0] ?? '—'}</span>
                <span className={styles.providerStatus} data-active={isActive || undefined}>
                  {isActive ? '★ in use' : '● switch'}
                </span>
              </button>
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
              {selectedTpl.id === 'zhipu' && (
                <div className={styles.regionRow}>
                  <span className={styles.regionLabel}>Region</span>
                  <button
                    type="button"
                    className={styles.regionBtn}
                    data-on={zhipuRegion === 'intl' || undefined}
                    onClick={() => { setZhipuRegion('intl'); setBaseUrl(ZHIPU_REGIONS.intl); }}
                  >
                    International (z.ai)
                  </button>
                  <button
                    type="button"
                    className={styles.regionBtn}
                    data-on={zhipuRegion === 'cn' || undefined}
                    onClick={() => { setZhipuRegion('cn'); setBaseUrl(ZHIPU_REGIONS.cn); }}
                  >
                    China (bigmodel.cn)
                  </button>
                </div>
              )}

              <label className={styles.keyField}>
                <span className={styles.keyLabel}>API key</span>
                <input
                  className={styles.keyInput}
                  type="password"
                  value={apiKey}
                  autoFocus
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    (selectedTpl.id === 'zhipu' ? ZHIPU_KEY_HINTS[zhipuRegion] : selectedTpl.keyHint) ||
                    'paste your key — kept in your Keychain'
                  }
                />
                {(selectedTpl.id === 'zhipu' ? ZHIPU_KEY_HINTS[zhipuRegion] : selectedTpl.keyHint) && (
                  <span className={styles.keyHint}>
                    {selectedTpl.id === 'zhipu' ? ZHIPU_KEY_HINTS[zhipuRegion] : selectedTpl.keyHint}
                  </span>
                )}
              </label>

              <button type="button" className={styles.advToggle} onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? '▾' : '▸'} Advanced — endpoint &amp; model
              </button>
              {showAdvanced && (
                <div className={styles.adv}>
                  <label className={styles.advField}>
                    <span>Model</span>
                    <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={selectedTpl.defaultModel} />
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
    </div>
  );

  return inline ? inner : (
    <div className={styles.backdrop} onClick={onClose}>
      {inner}
    </div>
  );
}
