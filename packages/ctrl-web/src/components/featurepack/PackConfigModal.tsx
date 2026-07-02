// PackConfigModal — the generic post-install config wizard. A feature pack
// declares what it needs from the user in its manifest `config_schema`
// (Ghostfolio: instance URL + security token); this walks those fields and
// stores each under `mcp:<id>:<key>`, where the kernel resolves the pack's
// creds (e.g. resolve_ghostfolio_creds). Secret fields are masked and, like all
// values, go to the credential store — never the LLM (ADR-006 decision 0004).
//
// Generic by design: zero per-pack code. Any pack with a config_schema gets a
// working configure flow (ADR-002 §7.4 systematization).

import { useState, type ReactElement } from 'react';
import { storePackSecret, type PackConfigField } from '@/lib/feature-pack';
import styles from './PackConfigModal.module.css';

interface PackConfigModalProps {
  packId: string;
  packName: string;
  fields: PackConfigField[];
  onClose: () => void;
  onSaved?: () => void;
}

export function PackConfigModal({
  packId,
  packName,
  fields,
  onClose,
  onSaved,
}: PackConfigModalProps): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missingRequired = fields.some(
    (f) => f.required && !(values[f.key] ?? '').trim(),
  );

  const save = async (): Promise<void> => {
    if (busy || missingRequired) return;
    setBusy(true);
    setError(null);
    try {
      // Store every filled field under mcp:<id>:<key> (the kernel resolve point).
      for (const f of fields) {
        const v = (values[f.key] ?? '').trim();
        if (v) await storePackSecret(packId, f.key, v);
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Configure ${packName}`}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>Configure {packName}</h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className={styles.fields}>
          {fields.map((f) => (
            <label key={f.key} className={styles.field}>
              <span className={styles.label}>
                {f.label}
                {f.required && <span className={styles.req}> *</span>}
                {f.kind === 'secret' && <span className={styles.secretTag}>keychain</span>}
              </span>
              {f.description && <span className={styles.desc}>{f.description}</span>}
              <input
                className={styles.input}
                type={f.kind === 'secret' ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.kind === 'url' ? 'http://127.0.0.1:3333' : ''}
                autoComplete={f.kind === 'secret' ? 'new-password' : 'off'}
              />
            </label>
          ))}
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <footer className={styles.foot}>
          <button type="button" className={styles.cancel} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.save}
            onClick={() => void save()}
            disabled={busy || missingRequired}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
}
