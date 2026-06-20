// TemplatesModal — wizard for "+ Note" with template selection.
//
// (ADR-002 substrate § vault v1 §8.6 v5, 2026-06-02 — kairo feature
// parity batch.)
//
// Scans `vault/templates/*.md` (seeded with `daily.md` + `meeting.md`
// on first boot; user-extendable per vim test) and lets the user pick
// one before creating a new note. Placeholders `{{date}}`, `{{title}}`,
// `{{time}}` are substituted on insert. Selecting "Blank" creates an
// empty note with just the `created` frontmatter scalar.

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type ReactElement,
} from 'react';
import { useQuery } from '@tanstack/react-query';
import { vaultList, vaultRead, vaultWrite } from '@/lib/kernel';
import styles from './Notes.module.css';

interface TemplatesModalProps {
  open: boolean;
  defaultPath?: string;
  onClose: () => void;
  onCreated: (path: string) => void;
}

const baseName = (path: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
};

const stem = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const substitute = (raw: string, title: string): string => {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return raw
    .replace(/\{\{date\}\}/g, `${yyyy}-${mm}-${dd}`)
    .replace(/\{\{time\}\}/g, `${hh}:${mi}`)
    .replace(/\{\{title\}\}/g, title);
};

const BLANK_KEY = '__blank__';

export const TemplatesModal = ({
  open,
  defaultPath = 'notes/untitled.md',
  onClose,
  onCreated,
}: TemplatesModalProps): ReactElement | null => {
  const [path, setPath] = useState(defaultPath);
  const [templateKey, setTemplateKey] = useState<string>(BLANK_KEY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // List `vault/templates/*.md` — driven by the same kernel `vault_list`
  // used elsewhere; staleTime keeps it cheap when the user open/close
  // the modal repeatedly without changing files.
  const { data: templatePaths = [] } = useQuery({
    queryKey: ['vault-templates'],
    queryFn: () => vaultList('templates'),
    staleTime: 30_000,
    enabled: open,
  });

  const templateOptions = useMemo(
    () => templatePaths.filter((p) => p.endsWith('.md')).sort(),
    [templatePaths],
  );

  // Reset state every time the modal opens so a previous failed attempt
  // doesn't leave stale path / template selection behind.
  useEffect(() => {
    if (!open) return;
    setPath(defaultPath);
    setTemplateKey(BLANK_KEY);
    setError(null);
    setBusy(false);
  }, [open, defaultPath]);

  const handleCreate = useCallback(async () => {
    const trimmed = path.trim();
    if (!trimmed) {
      setError('Path is required');
      return;
    }
    const safePath = trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
    setBusy(true);
    setError(null);
    try {
      let body = '';
      if (templateKey !== BLANK_KEY) {
        try {
          const tpl = await vaultRead(templateKey);
          const tplBody = typeof tpl.content === 'string' ? tpl.content : '';
          const title = stem(baseName(safePath));
          body = substitute(tplBody, title);
        } catch {
          body = '';
        }
      }
      await vaultWrite({
        path: safePath,
        content: body,
        frontmatter: { created: new Date().toISOString() },
      });
      onCreated(safePath);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [path, templateKey, onClose, onCreated]);

  if (!open) return null;

  return (
    <div className={styles.modalBackdrop} onClick={onClose} role="presentation">
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="templates-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.modalHeader}>
          <h2 id="templates-modal-title" className={styles.modalTitle}>
            New note
          </h2>
          <button
            type="button"
            className={styles.modalClose}
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className={styles.modalBody}>
          <label className={styles.modalLabel}>
            <span className={styles.modalLabelText}>Path</span>
            <input
              className={styles.modalInput}
              type="text"
              value={path}
              autoFocus
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleCreate();
                }
                if (e.key === 'Escape') onClose();
              }}
            />
          </label>
          <label className={styles.modalLabel}>
            <span className={styles.modalLabelText}>Template</span>
            <select
              className={styles.modalInput}
              value={templateKey}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setTemplateKey(e.target.value)}
            >
              <option value={BLANK_KEY}>(Blank)</option>
              {templateOptions.map((tpl) => (
                <option key={tpl} value={tpl}>
                  {stem(baseName(tpl))}
                </option>
              ))}
            </select>
          </label>
          <p className={styles.modalHint}>
            Placeholders <code>{'{{date}}'}</code>, <code>{'{{time}}'}</code>,{' '}
            <code>{'{{title}}'}</code> are substituted on insert. Drop new
            templates into <code>templates/</code> to extend the list.
          </p>
          {error ? <p className={styles.modalError}>{error}</p> : null}
        </div>
        <footer className={styles.modalFooter}>
          <button type="button" className={styles.modalSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.modalPrimary}
            onClick={() => void handleCreate()}
            disabled={busy}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
};
