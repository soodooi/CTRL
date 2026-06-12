// ProviderHub — cc-switch-style provider manager with a user-friendly
// config flow (bao 2026-06-11: "not just the style, the way you pick + a
// user-friendly config"). Card grid of providers (your Volc / Zhipu /
// Claude float to the top); pick one and you ONLY fill the API key —
// endpoint + model are pre-filled and folded into "Advanced". Zhipu offers
// an International / China region toggle instead of typing a URL. Already
// configured providers show status and switch with one click.
//
// Real kernel commands: list_provider_templates + config_set_provider_key
// + provider_set_active (1-token trial). Browser/dev falls back to bundled
// templates (lib/kernel) so the UI renders outside Tauri.

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { listProviderTemplates, setProviderKey, type ProviderTemplate } from '@/lib/kernel';
import { providerSetActive, providerList, type ProviderListRow } from '@/lib/provider-config';
import { invoke } from '@tauri-apps/api/core';
import styles from './ProviderHub.module.css';

interface ActiveView {
  roles: Record<string, { id: string; label: string; model_id: string | null }>;
}

interface ProviderHubProps {
  onClose: () => void;
  onActivated?: (label: string, model: string) => void;
}

// Your common providers float to the top of the grid.
const PRIORITY = ['anthropic', 'volc', 'zhipu'];

// Zhipu has two regions with different OpenAI-compatible endpoints — offer a
// toggle instead of making the user type a base URL.
const ZHIPU_REGIONS: Record<'intl' | 'cn', string> = {
  intl: 'https://api.z.ai/api/paas/v4',
  cn: 'https://open.bigmodel.cn/api/paas/v4',
};

export function ProviderHub({ onClose, onActivated }: ProviderHubProps): ReactElement {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  const [configured, setConfigured] = useState<ProviderListRow[]>([]);
  const [active, setActive] = useState<ActiveView['roles'][string] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [zhipuRegion, setZhipuRegion] = useState<'intl' | 'cn'>('intl');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listProviderTemplates().then(setTemplates).catch(() => setTemplates([]));
    void providerList().then(setConfigured).catch(() => setConfigured([]));
    void invoke<ActiveView>('get_active_providers')
      .then((v) => setActive(v.roles['irisy.primary'] ?? null))
      .catch(() => setActive(null));
  }, []);

  // Order: active first, then configured, then your priority providers,
  // then the rest. Keeps the ones you care about at the top.
  const cards = useMemo(() => {
    const cfgIds = new Set(configured.filter((c) => c.ready).map((c) => c.id));
    const score = (t: ProviderTemplate): number => {
      let s = 0;
      if (active?.id === t.id) s -= 100;
      if (cfgIds.has(t.id)) s -= 50;
      const pi = PRIORITY.indexOf(t.id);
      if (pi >= 0) s -= 20 - pi;
      return s;
    };
    return [...templates].sort((a, b) => score(a) - score(b));
  }, [templates, configured, active]);

  const statusOf = (id: string): 'active' | 'configured' | 'new' => {
    if (active?.id === id) return 'active';
    if (configured.some((c) => c.id === id && c.ready)) return 'configured';
    return 'new';
  };

  const pick = (t: ProviderTemplate): void => {
    setSelectedId(t.id);
    setApiKey('');
    setModel(t.defaultModel);
    setBaseUrl(t.id === 'zhipu' ? ZHIPU_REGIONS[zhipuRegion] : t.baseUrl);
    setShowAdvanced(false);
    setError(null);
  };

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
      onActivated?.(t.defaultName, reply.model_id ?? model);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = async (id: string, label: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: id });
      onActivated?.(label, reply.model_id ?? '');
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Providers</h2>
            <p className={styles.sub}>
              {active ? (
                <>
                  Irisy is using <b>{active.label}</b>
                  {active.model_id ? ` · ${active.model_id}` : ''}
                </>
              ) : (
                'Pick a provider and paste your API key — that’s it.'
              )}
            </p>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.grid}>
          {cards.map((t) => {
            const status = statusOf(t.id);
            const isSel = selectedId === t.id;
            return (
              <div
                key={t.id}
                className={`${styles.card} ${isSel ? styles.cardSel : ''}`}
                data-status={status}
              >
                <button
                  type="button"
                  className={styles.cardHead}
                  onClick={() => (status === 'configured' ? void switchTo(t.id, t.label) : pick(t))}
                  disabled={busy}
                >
                  <span className={styles.cardName}>{t.label}</span>
                  <span className={styles.cardStatus} data-status={status}>
                    {status === 'active' ? '★ in use' : status === 'configured' ? '● switch to' : '○ set up'}
                  </span>
                  <span className={styles.cardModel}>{t.defaultModel || 'custom endpoint'}</span>
                </button>

                {isSel && status !== 'configured' && (
                  <div className={styles.config}>
                    {t.id === 'zhipu' && (
                      <div className={styles.regionRow}>
                        <span className={styles.regionLabel}>Region</span>
                        <button
                          type="button"
                          className={styles.regionBtn}
                          data-on={zhipuRegion === 'intl' || undefined}
                          onClick={() => {
                            setZhipuRegion('intl');
                            setBaseUrl(ZHIPU_REGIONS.intl);
                          }}
                        >
                          International (z.ai)
                        </button>
                        <button
                          type="button"
                          className={styles.regionBtn}
                          data-on={zhipuRegion === 'cn' || undefined}
                          onClick={() => {
                            setZhipuRegion('cn');
                            setBaseUrl(ZHIPU_REGIONS.cn);
                          }}
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
                        placeholder={t.keyHint || 'paste your key — kept in your Keychain'}
                      />
                      {t.keyHint && <span className={styles.keyHint}>{t.keyHint}</span>}
                    </label>

                    <button
                      type="button"
                      className={styles.advToggle}
                      onClick={() => setShowAdvanced((v) => !v)}
                    >
                      {showAdvanced ? '▾' : '▸'} Advanced — endpoint &amp; model
                    </button>
                    {showAdvanced && (
                      <div className={styles.adv}>
                        <label className={styles.advField}>
                          <span>Model</span>
                          <input
                            value={model}
                            onChange={(e) => setModel(e.target.value)}
                            placeholder={t.defaultModel}
                          />
                        </label>
                        <label className={styles.advField}>
                          <span>Base URL</span>
                          <input
                            value={baseUrl}
                            onChange={(e) => setBaseUrl(e.target.value)}
                            placeholder={t.baseUrl}
                          />
                        </label>
                      </div>
                    )}

                    {error && <div className={styles.error}>{error}</div>}
                    <div className={styles.actions}>
                      <button type="button" className={styles.ghost} onClick={() => setSelectedId(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.connect}
                        onClick={() => void apply(t)}
                        disabled={busy || !apiKey.trim()}
                      >
                        {busy ? 'Connecting…' : 'Connect'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
