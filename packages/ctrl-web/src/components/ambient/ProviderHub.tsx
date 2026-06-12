// ProviderHub — cc-switch-style provider manager with a user-friendly
// config flow (bao 2026-06-11: "not just the style, the way you pick + a
// user-friendly config"). Card grid of providers (your Volc / Zhipu /
// Claude float to the top); pick one and you ONLY fill the API key —
// endpoint + model are pre-filled and folded into "Advanced". Zhipu offers
// an International / China region toggle instead of typing a URL (and the
// key hint follows the toggle). Configured providers switch in one click.
//
// Two surfaces (bao 2026-06-11): modal (first-run / Connect-AI) and inline
// (embedded in Settings → Providers — no backdrop, applies in place).
//
// Real kernel commands: list_provider_templates + config_set_provider_key
// + provider_set_active (1-token trial). Browser/dev falls back to bundled
// templates (lib/kernel) so the UI renders outside Tauri.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { listProviderTemplates, setProviderKey, type ProviderTemplate } from '@/lib/kernel';
import { providerSetActive, providerList, type ProviderListRow } from '@/lib/provider-config';
import { invoke } from '@tauri-apps/api/core';
import styles from './ProviderHub.module.css';

interface ActiveView {
  roles: Record<string, { id: string; label: string; model_id: string | null }>;
}

interface ProviderHubProps {
  /** Inline mode (embedded in Settings → Providers): no modal backdrop /
   *  close button; applying a provider refreshes in place instead of
   *  closing. Default false = modal (first-run / Connect-AI). */
  inline?: boolean;
  onClose?: () => void;
  onActivated?: (label: string, model: string) => void;
}

// Your common providers float to the top of the grid.
const PRIORITY = ['anthropic', 'volc', 'zhipu'];

// Zhipu has two regions with different OpenAI-compatible endpoints — offer a
// toggle instead of making the user type a base URL. The key-issuing page
// differs per region too, so the key hint follows the toggle.
const ZHIPU_REGIONS: Record<'intl' | 'cn', string> = {
  intl: 'https://api.z.ai/api/paas/v4',
  cn: 'https://open.bigmodel.cn/api/paas/v4',
};
const ZHIPU_KEY_HINTS: Record<'intl' | 'cn', string> = {
  intl: 'create an API key at z.ai → API Keys',
  cn: 'create an API key at open.bigmodel.cn/usercenter/apikeys',
};

export function ProviderHub({ inline = false, onClose, onActivated }: ProviderHubProps): ReactElement {
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

  const reload = useCallback(() => {
    void listProviderTemplates().then(setTemplates).catch(() => setTemplates([]));
    void providerList().then(setConfigured).catch(() => setConfigured([]));
    void invoke<ActiveView>('get_active_providers')
      .then((v) => setActive(v.roles['irisy.primary'] ?? null))
      .catch(() => setActive(null));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  // After activating: refresh in place (inline) or close the modal.
  const finish = useCallback(
    (label: string, modelId: string) => {
      onActivated?.(label, modelId);
      if (inline) {
        setSelectedId(null);
        setApiKey('');
        reload();
      } else {
        onClose?.();
      }
    },
    [inline, onActivated, onClose, reload],
  );

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
      finish(t.defaultName, reply.model_id ?? model);
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
      finish(label, reply.model_id ?? '');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
              'Pick a provider and paste your API key — that’s it.'
            )}
          </p>
        </div>
        {!inline && (
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>

      <div className={styles.grid}>
        {cards.map((t) => {
          const status = statusOf(t.id);
          const isSel = selectedId === t.id;
          const keyHint = t.id === 'zhipu' ? ZHIPU_KEY_HINTS[zhipuRegion] : t.keyHint;
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
                      placeholder={keyHint || 'paste your key — kept in your Keychain'}
                    />
                    {keyHint && <span className={styles.keyHint}>{keyHint}</span>}
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
  );

  return inline ? inner : (
    <div className={styles.backdrop} onClick={onClose}>
      {inner}
    </div>
  );
}
