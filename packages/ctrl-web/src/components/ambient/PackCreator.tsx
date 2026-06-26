// PackCreator — the "create one" flow: describe a tool → Irisy drafts a pack →
// review → install. No JSON by hand (ADR-002 substrate § composition v21 §7.3).

import { useState, type ReactElement } from 'react';
import {
  generatePack,
  draftToManifest,
  type DraftPack,
} from '@/lib/feature-pack-create';
import { installPack } from '@/lib/feature-pack';
import styles from './PackCreator.module.css';

interface Props {
  onClose: () => void;
  onInstalled: () => void;
}

export function PackCreator({ onClose, onInstalled }: Props): ReactElement {
  const [desc, setDesc] = useState('');
  const [draft, setDraft] = useState<DraftPack | null>(null);
  const [generating, setGenerating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    setDraft(null);
    try {
      setDraft(await generatePack(desc.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const install = async (): Promise<void> => {
    if (!draft) return;
    setInstalling(true);
    setError(null);
    try {
      await installPack(draftToManifest(draft));
      onInstalled();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setInstalling(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.head}>
          <span className={styles.title}>✦ Create a feature pack</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className={styles.sub}>
          Describe a tool — Irisy drafts it, you review and install. No JSON.
        </p>
        <textarea
          className={styles.input}
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={'e.g. "show my largest folders" or "which ports are listening"'}
          rows={3}
          disabled={generating}
        />
        {draft == null && (
          <button
            type="button"
            className={styles.primary}
            disabled={!desc.trim() || generating}
            onClick={() => void generate()}
          >
            {generating ? 'Drafting…' : 'Generate'}
          </button>
        )}
        {draft != null && (
          <div className={styles.review}>
            <div className={styles.reviewHead}>
              <span className={styles.reviewIcon}>{draft.icon}</span>
              <div>
                <div className={styles.reviewName}>{draft.name}</div>
                <div className={styles.reviewSummary}>{draft.summary}</div>
              </div>
            </div>
            <div className={styles.actions}>
              {draft.actions.map((a) => (
                <div key={a.id} className={styles.action}>
                  <span className={styles.actionName}>{a.name}</span>
                  <code className={styles.actionCmd}>{a.command}</code>
                </div>
              ))}
            </div>
            {draft.knowledge_base != null && draft.knowledge_base !== '' && (
              <div className={styles.reviewSummary}>Data → {draft.knowledge_base}/</div>
            )}
            {draft.secrets != null && draft.secrets.length > 0 && (
              <div className={styles.reviewSummary}>
                Needs after install: {draft.secrets.map((s) => s.label).join(', ')}
              </div>
            )}
            <div className={styles.reviewBtns}>
              <button
                type="button"
                className={styles.secondary}
                onClick={() =>
                  void navigator.clipboard?.writeText(
                    JSON.stringify(draftToManifest(draft), null, 2),
                  )
                }
                disabled={installing}
                title="Copy the pack JSON to share with someone"
              >
                Copy
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void generate()}
                disabled={generating || installing}
              >
                Regenerate
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => void install()}
                disabled={installing}
              >
                {installing ? 'Installing…' : 'Install'}
              </button>
            </div>
          </div>
        )}
        {error != null && <div className={styles.error}>{error}</div>}
      </div>
    </div>
  );
}
