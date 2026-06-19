// ProviderPicker — opencode-style provider/model selector (bao 2026-06-11
// "I like opencode's provider UI"). One searchable list of providers; pick
// one, set the model id + paste the key once, it becomes irisy.primary.
//
// This is the single place a user configures their model. Once the unified
// injection lands (agent_launcher), the same choice drives Irisy chat,
// opencode, and hermes — configure once, every face uses it (ADR-002 §1.3).
//
// Uses existing kernel commands only: list_provider_templates +
// config_set_provider_key + provider_set_active (1-token trial verify).

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { listProviderTemplates, setProviderKey, type ProviderTemplate } from '@/lib/kernel';
import { providerSetActive } from '@/lib/provider-config';
import { useActiveProvider } from '@/hooks/useActiveProvider';
import styles from './ProviderPicker.module.css';

interface ProviderPickerProps {
  onClose: () => void;
  onActivated?: (label: string, model: string) => void;
}

export function ProviderPicker({ onClose, onActivated }: ProviderPickerProps): ReactElement {
  const [templates, setTemplates] = useState<ProviderTemplate[]>([]);
  // Decision 0007 §display (2026-06-19): single hook instead of a
  // mount-once invoke; refreshes in lockstep when Settings / another
  // tab mutates the SSOT.
  const { active } = useActiveProvider();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ProviderTemplate | null>(null);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listProviderTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter(
      (t) => t.label.toLowerCase().includes(q) || t.id.toLowerCase().includes(q),
    );
  }, [templates, query]);

  const pick = (t: ProviderTemplate): void => {
    setSelected(t);
    setModel(t.defaultModel);
    setBaseUrl(t.baseUrl);
    setApiKey('');
    setError(null);
  };

  const apply = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await setProviderKey({
        provider: selected.id,
        api_key: apiKey, // empty = keep existing keychain entry
        base_url: (baseUrl.trim() || selected.baseUrl).replace(/\/$/, ''),
        default_model: model.trim() || selected.defaultModel,
        display_name: selected.defaultName,
        api_protocol: selected.protocol,
      });
      const reply = await providerSetActive({ role: 'irisy.primary', provider_id: selected.id });
      onActivated?.(selected.defaultName, reply.model_id ?? model);
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
          <span className={styles.title}>Choose a model</span>
          {active && (
            <span className={styles.current}>
              Now: {active.label}
              {active.model_id ? ` · ${active.model_id}` : ''}
            </span>
          )}
          <button type="button" className={styles.close} onClick={onClose}>
            ✕
          </button>
        </div>

        <input
          className={styles.search}
          placeholder="Search providers…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />

        <div className={styles.list}>
          {filtered.map((t) => {
            const isActive = active?.id === t.id;
            const isSel = selected?.id === t.id;
            return (
              <div key={t.id} className={styles.rowWrap}>
                <button
                  type="button"
                  className={`${styles.row} ${isSel ? styles.rowSel : ''}`}
                  onClick={() => pick(t)}
                >
                  <span className={styles.rowName}>{t.label}</span>
                  <span className={styles.rowMeta}>
                    {isActive && <span className={styles.activeTag}>active</span>}
                    <span className={styles.rowModel}>{t.defaultModel}</span>
                  </span>
                </button>
                {isSel && (
                  <div className={styles.config}>
                    <label className={styles.field}>
                      <span>Model</span>
                      <input
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={t.defaultModel}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>Base URL (e.g. international endpoint)</span>
                      <input
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder={t.baseUrl}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>API key</span>
                      <input
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={t.keyHint || 'paste your key (kept in keychain)'}
                      />
                    </label>
                    {error && <div className={styles.error}>{error}</div>}
                    {/* A key is required unless this provider is already the
                        active one (then an empty field keeps the stored key). */}
                    <button
                      type="button"
                      className={styles.use}
                      onClick={() => void apply()}
                      disabled={busy || (!apiKey.trim() && active?.id !== t.id)}
                    >
                      {busy ? 'Verifying…' : 'Use this provider'}
                    </button>
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
