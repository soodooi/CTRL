// BlockAiOps — floating menu over a Tiptap selection that runs Pi-driven
// block-level rewrites in place.
//
// (Product spec §5.2 + decision P2 inline streaming + P7 dual trigger.
// Brainstorm `.olym/brainstorm/vault-irisy-product-design-2026-06-03.md`.)
//
// Trigger surface:
//   - `Cmd+K` (Mac) / `Ctrl+K` (Win/Linux) anywhere with a non-empty
//     selection → opens the action picker.
//   - `/` when followed by a selection → same picker. (Plain `/` typing
//     in source-code blocks is unaffected because the trigger requires
//     a current selection.)
//
// Lifecycle:
//   1. selection in the host Tiptap editor → menu anchors above the
//      selection rect.
//   2. user picks an action. If `requiresInput`, an input field expands
//      inline; otherwise the call fires.
//   3. streaming output flows into a preview pane next to the menu.
//   4. Accept → editor commands replace the selection text with the
//      rewrite. Reject → discard and close.
//
// AI block metadata (ADR-002 v5 §10 + product §6.4) is emitted to the
// parent via `onAccept(result, metadata)` — the parent (NotesEditor)
// stamps the host note's frontmatter `ai_blocks:` array.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  BLOCK_ACTIONS,
  type BlockAction,
  type BlockActionId,
  runBlockAction,
} from '@/lib/block-ai-ops';
import styles from './Notes.module.css';

export interface BlockAiResult {
  action: BlockActionId;
  original: string;
  rewritten: string;
  user_input?: string;
}

interface BlockAiOpsProps {
  /** Live Tiptap editor. We read selection from it and replace it on accept. */
  editor: {
    state: { selection: { from: number; to: number; empty: boolean } };
    view: { coordsAtPos: (pos: number) => { left: number; top: number; bottom: number } };
    chain: () => {
      focus: () => { insertContentAt: (range: { from: number; to: number }, content: string) => { run: () => void } };
    };
  } | null;
  onAccept?: (result: BlockAiResult) => void;
}

interface MenuAnchor {
  left: number;
  top: number;
  selection: { from: number; to: number; text: string };
}

const isMac = typeof navigator !== 'undefined' &&
  navigator.platform.toLowerCase().includes('mac');

export const BlockAiOps = ({ editor, onAccept }: BlockAiOpsProps): ReactElement | null => {
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const [picked, setPicked] = useState<BlockAction | null>(null);
  const [userInput, setUserInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  /** Compute anchor from the current Tiptap selection. */
  const computeAnchor = useCallback((): MenuAnchor | null => {
    if (!editor) return null;
    const { from, to, empty } = editor.state.selection;
    if (empty) return null;
    // Snap to the START of the selection so the menu sits above
    // text consistently regardless of selection direction.
    const coords = editor.view.coordsAtPos(from);
    const dom = window.getSelection();
    const text = dom ? dom.toString() : '';
    if (!text.trim()) return null;
    return {
      left: coords.left,
      top: coords.top - 8, // 8px above the selection
      selection: { from, to, text },
    };
  }, [editor]);

  /** Global keyboard listener: Cmd+K / Ctrl+K to open with current selection. */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isOpen = anchor !== null;
      // Escape closes the menu when open.
      if (isOpen && e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      // Open trigger: Cmd+K (Mac) or Ctrl+K (others).
      const isOpenKey = e.key === 'k' && (isMac ? e.metaKey : e.ctrlKey);
      if (isOpenKey) {
        const next = computeAnchor();
        if (next) {
          e.preventDefault();
          setAnchor(next);
          setPicked(null);
          setUserInput('');
          setPreview('');
          setError(null);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, computeAnchor]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setAnchor(null);
    setPicked(null);
    setUserInput('');
    setPreview('');
    setStreaming(false);
    setError(null);
  }, []);

  const startAction = useCallback(
    async (action: BlockAction, inputValue?: string) => {
      if (!anchor) return;
      setPicked(action);
      setStreaming(true);
      setPreview('');
      setError(null);
      abortRef.current = new AbortController();
      try {
        await runBlockAction(
          action.id,
          anchor.selection.text,
          inputValue,
          (chunk) => setPreview((prev) => prev + chunk),
          abortRef.current.signal,
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'failed';
        if (msg !== 'aborted') setError(msg);
      } finally {
        setStreaming(false);
      }
    },
    [anchor],
  );

  const handlePick = (action: BlockAction) => {
    setPicked(action);
    setUserInput('');
    setPreview('');
    setError(null);
    if (!action.requiresInput) {
      void startAction(action);
    }
  };

  const handleSubmitInput = (e: React.FormEvent) => {
    e.preventDefault();
    if (picked) void startAction(picked, userInput);
  };

  const accept = () => {
    if (!anchor || !picked || !editor) return;
    editor
      .chain()
      .focus()
      .insertContentAt(
        { from: anchor.selection.from, to: anchor.selection.to },
        preview,
      )
      .run();
    onAccept?.({
      action: picked.id,
      original: anchor.selection.text,
      rewritten: preview,
      user_input: userInput || undefined,
    });
    cancel();
  };

  if (!anchor) return null;

  return (
    <div
      className={styles.blockAiOps}
      style={{
        left: Math.max(8, anchor.left),
        top: Math.max(8, anchor.top),
      }}
      role="dialog"
      aria-label="Block AI ops"
    >
      <div className={styles.blockAiOpsHeader}>
        <span className={styles.blockAiOpsTitle}>Irisy block ops</span>
        <button
          type="button"
          className={styles.blockAiOpsClose}
          onClick={cancel}
          aria-label="Close"
        >
          ×
        </button>
      </div>
      {!picked ? (
        <ul className={styles.blockAiOpsList}>
          {BLOCK_ACTIONS.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={styles.blockAiOpsItem}
                onClick={() => handlePick(a)}
                title={a.description}
              >
                <span className={styles.blockAiOpsLabel}>{a.label}</span>
                <span className={styles.blockAiOpsDesc}>{a.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : picked.requiresInput && !preview && !streaming ? (
        <form onSubmit={handleSubmitInput} className={styles.blockAiOpsForm}>
          <label className={styles.blockAiOpsLabel}>{picked.label}</label>
          <input
            type="text"
            className={styles.blockAiOpsInput}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            placeholder={picked.inputPlaceholder}
            autoFocus
          />
          <div className={styles.blockAiOpsActions}>
            <button type="button" onClick={cancel} className={styles.blockAiOpsBtn}>
              Cancel
            </button>
            <button type="submit" className={styles.blockAiOpsBtnPrimary}>
              Run
            </button>
          </div>
        </form>
      ) : (
        <div className={styles.blockAiOpsPreview}>
          <div className={styles.blockAiOpsPreviewLabel}>
            {picked.label}
            {streaming ? ' · streaming…' : ''}
          </div>
          <pre className={styles.blockAiOpsPreviewBody}>
            {preview || (streaming ? '…' : '(empty)')}
          </pre>
          {error ? <p className={styles.blockAiOpsError}>{error}</p> : null}
          <div className={styles.blockAiOpsActions}>
            <button type="button" onClick={cancel} className={styles.blockAiOpsBtn}>
              {streaming ? 'Stop' : 'Discard'}
            </button>
            <button
              type="button"
              onClick={accept}
              className={styles.blockAiOpsBtnPrimary}
              disabled={streaming || !preview}
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
