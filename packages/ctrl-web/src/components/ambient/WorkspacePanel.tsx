// WorkspacePanel — the number-row action panel (the home's Quicker surface).
//
// One row of keycap tiles laid out to mirror the keyboard's number row: tile 1
// sits under key "1" … tile 10 under key "0". Pressing the digit runs the tile.
// Minimal text by design — a keycap shows its number, an icon, and a one-word
// label, nothing more. "Customize" flips to edit mode: remove / add / drag.
// Every tile resolves to a catalog capability (the SSOT).

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Capability } from '@/lib/capability-catalog';
import {
  addAction,
  availableActions,
  defaultWorkspaceLayout,
  indexForKey,
  loadWorkspaceLayout,
  MAX_SLOTS,
  moveAction,
  removeAction,
  resolveAction,
  saveWorkspaceLayout,
  slotKey,
  type WorkspaceLayout,
} from '@/lib/workspace-layout';
import styles from './WorkspacePanel.module.css';

interface WorkspacePanelProps {
  /** Run an action — pre-fills the composer, or fires a native utility. */
  onRun: (cap: Capability) => void;
  /** Open Discover to connect more tools (MCP). */
  onConnectTools: () => void;
}

// Presentational glyphs, keyed by capability id (kept here, not in the catalog
// SSOT, so the prompt-facing catalog stays pure data). Falls back to a mark.
const GLYPHS: Record<string, string> = {
  'draft-polish': '✎',
  'tone-translate': '⇄',
  resume: '▤',
  'marketing-copy': '◔',
  summarize: '≣',
  'transcribe-meeting': '◉',
  'extract-actions': '☑',
  'how-to': '➜',
  tutor: '✦',
  'research-web': '⌕',
  'html-artifact': '◧',
  'image-generate': '◑',
  'photo-edit': '✄',
  'video-generate': '▷',
  'voice-tts': '♫',
  slides: '▦',
  coding: '⟨⟩',
  plan: '☰',
  'scheduled-task': '↻',
  'analyze-table': '▥',
  'screenshot-ocr': '⛶',
  'ocr-extract': '⎙',
};

// One-word labels for the keycaps — minimal text (bao 2026-06-19). Falls back
// to the first word of the catalog label.
const SHORT: Record<string, string> = {
  'screenshot-ocr': 'Capture',
  'draft-polish': 'Write',
  'tone-translate': 'Translate',
  summarize: 'Summary',
  'extract-actions': 'Tasks',
  'how-to': 'Advise',
  tutor: 'Tutor',
  'html-artifact': 'Build',
  slides: 'Slides',
  'analyze-table': 'Data',
  'ocr-extract': 'Extract',
  'research-web': 'Research',
  plan: 'Plan',
  'image-generate': 'Image',
  'photo-edit': 'Retouch',
  'video-generate': 'Video',
  'voice-tts': 'Voice',
  resume: 'Resume',
  'marketing-copy': 'Copy',
  'transcribe-meeting': 'Recap',
  coding: 'Code',
  'scheduled-task': 'Routine',
};

const glyph = (id: string): string => GLYPHS[id] ?? '◆';
const short = (cap: Capability): string =>
  SHORT[cap.id] ?? cap.label.split(/[\s/]/)[0] ?? cap.label;

export function WorkspacePanel({ onRun, onConnectTools }: WorkspacePanelProps): ReactElement {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspaceLayout());
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const commit = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
    saveWorkspaceLayout(next);
  }, []);

  const slots = useMemo(
    () => layout.slots.filter((id) => resolveAction(id)),
    [layout],
  );

  // Number-key shortcuts: the digit under a tile runs it. View mode only, and
  // never while a digit is typed into a field (the composer).
  useEffect(() => {
    if (editing) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return;
      }
      const idx = indexForKey(e.key);
      if (idx === null) return;
      const id = slots[idx];
      const cap = id ? resolveAction(id) : undefined;
      if (cap) {
        e.preventDefault();
        onRun(cap);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onRun, slots]);

  const onDrop = useCallback(
    (index: number) => {
      if (!dragId) return;
      commit(moveAction(layout, dragId, index));
      setDragId(null);
    },
    [dragId, layout, commit],
  );

  const available = availableActions(layout);
  const full = layout.slots.length >= MAX_SLOTS;

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        {!editing && <span className={styles.headHint}>press 1–0</span>}
        <div className={styles.headActions}>
          {editing && (
            <button
              type="button"
              className={styles.headBtn}
              onClick={() => {
                commit(defaultWorkspaceLayout());
                setPickerOpen(false);
              }}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            className={styles.headBtn}
            data-active={editing}
            onClick={() => {
              setEditing((v) => !v);
              setPickerOpen(false);
            }}
          >
            {editing ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      <div
        className={styles.row}
        onDragOver={(e) => editing && e.preventDefault()}
        onDrop={() => editing && onDrop(slots.length)}
      >
        {slots.map((id, index) => {
          const cap = resolveAction(id);
          if (!cap) return null;
          const key = slotKey(index);

          if (!editing) {
            return (
              <button
                key={id}
                type="button"
                className={styles.cap}
                onClick={() => onRun(cap)}
                title={cap.hint}
              >
                {key && <span className={styles.key}>{key}</span>}
                <span className={styles.icon} aria-hidden>
                  {glyph(id)}
                </span>
                <span className={styles.label}>{short(cap)}</span>
              </button>
            );
          }

          return (
            <div
              key={id}
              className={`${styles.cap} ${styles.editing} ${
                dragId === id ? styles.dragging : ''
              }`}
              draggable
              onDragStart={() => setDragId(id)}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.stopPropagation();
                onDrop(index);
              }}
            >
              {key && <span className={styles.key}>{key}</span>}
              <button
                type="button"
                className={styles.remove}
                title="Remove"
                onClick={() => commit(removeAction(layout, id))}
              >
                ✕
              </button>
              <span className={styles.icon} aria-hidden>
                {glyph(id)}
              </span>
              <span className={styles.label}>{short(cap)}</span>
            </div>
          );
        })}

        {editing && !full && (
          <button
            type="button"
            className={`${styles.cap} ${styles.add}`}
            data-open={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
          >
            <span className={styles.addPlus}>+</span>
          </button>
        )}
      </div>

      {editing && pickerOpen && (
        <div className={styles.picker}>
          {available.length === 0 ? (
            <p className={styles.pickerEmpty}>Every action is already on the row.</p>
          ) : (
            available.map((cat) => (
              <div key={cat.title} className={styles.pickerCat}>
                <span className={styles.pickerCatTitle}>{cat.title}</span>
                <div className={styles.pickerItems}>
                  {cat.capabilities.map((cap) => (
                    <button
                      key={cap.id}
                      type="button"
                      className={styles.pickerItem}
                      title={cap.hint}
                      onClick={() => {
                        commit(addAction(layout, cap.id));
                        setPickerOpen(false);
                      }}
                    >
                      <span aria-hidden>{glyph(cap.id)}</span>
                      {short(cap)}
                    </button>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      <button type="button" className={styles.connect} onClick={onConnectTools}>
        Connect your tools →
      </button>
    </div>
  );
}
