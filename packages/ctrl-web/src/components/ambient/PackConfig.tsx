// PackConfig — configure a feature pack's secrets after install (action 2).
// Secret fields go STRAIGHT to the keychain via store_key; Irisy / the LLM
// never sees the value (decision 0004 — secrets never touch Irisy).

import { useState, type ReactElement } from 'react';
import { storePackSecret, type SecretField } from '@/lib/feature-pack';
import styles from './PackCreator.module.css';

interface Props {
  mcpId: string;
  packName: string;
  fields: SecretField[];
  onClose: () => void;
  onDone: () => void;
}

export function PackConfig({ mcpId, packName, fields, onClose, onDone }: Props): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      for (const f of fields) {
        const v = (values[f.key] ?? '').trim();
        if (v) await storePackSecret(mcpId, f.key, v);
      }
      onDone();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>🔑 Configure {packName}</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={styles.sub}>
          Paste your key — it goes straight to your keychain. Irisy never sees it.
        </p>
        {fields.map((f) => (
          <label key={f.key} className={styles.field}>
            <span className={styles.fieldLabel}>{f.label}</span>
            <input
              type="password"
              className={styles.input}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              placeholder="••••••••••"
              autoComplete="off"
            />
            {f.description != null && <span className={styles.fieldHint}>{f.description}</span>}
          </label>
        ))}
        <button
          type="button"
          className={styles.primary}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save to keychain'}
        </button>
        {error != null && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
