// WorkspacePanel — the configurable default-workspace action panel.
//
// The home screen's "what do you want to do" surface (Quicker-style). It reads
// a user-owned layout (workspace-layout.ts) and renders grouped action cards.
// View mode = clean, clickable cards that pre-fill the composer. "Customize"
// flips to edit mode: pin / remove / drag-reorder / add — each edit mutates the
// plain layout object, which persists locally. No new capability system; every
// card resolves to a catalog capability (the SSOT).

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Capability } from '@/lib/capability-catalog';
import {
  addAction,
  availableActions,
  defaultWorkspaceLayout,
  loadWorkspaceLayout,
  moveAction,
  PINNED_GROUP_ID,
  removeAction,
  resolveAction,
  saveWorkspaceLayout,
  togglePinned,
  type WorkspaceLayout,
} from '@/lib/workspace-layout';
import styles from './WorkspacePanel.module.css';

interface WorkspacePanelProps {
  /** Run an action — pre-fills the composer with the capability's starter. */
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

function glyph(id: string): string {
  return GLYPHS[id] ?? '◆';
}

export function WorkspacePanel({ onRun, onConnectTools }: WorkspacePanelProps): ReactElement {
  const [layout, setLayout] = useState<WorkspaceLayout>(() => loadWorkspaceLayout());
  const [editing, setEditing] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [pickerGroup, setPickerGroup] = useState<string | null>(null);

  // Commit a layout change: update state + persist. One funnel so every edit
  // is saved (local-is-truth) without scattering saveWorkspaceLayout calls.
  const commit = useCallback((next: WorkspaceLayout) => {
    setLayout(next);
    saveWorkspaceLayout(next);
  }, []);

  const onDrop = useCallback(
    (groupId: string, index: number) => {
      if (!dragId) return;
      commit(moveAction(layout, dragId, groupId, index));
      setDragId(null);
    },
    [dragId, layout, commit],
  );

  const resetLayout = useCallback(() => {
    commit(defaultWorkspaceLayout());
    setPickerGroup(null);
  }, [commit]);

  // Quicker-style number shortcuts: the first 9 actions (in display order) get
  // ordinals 1–9; pressing that digit runs the action. The flat order follows
  // the rendered groups so the badge a user sees matches the key they press.
  const orderedIds = useMemo(
    () => layout.groups.flatMap((g) => g.actionIds).filter((id) => resolveAction(id)),
    [layout],
  );
  const ordinalOf = useMemo(() => {
    const m = new Map<string, number>();
    orderedIds.slice(0, 9).forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [orderedIds]);

  useEffect(() => {
    if (editing) return; // arranging, not running
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // Never hijack a digit the user is typing into the composer / a field.
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      ) {
        return;
      }
      if (e.key < '1' || e.key > '9') return;
      const id = orderedIds[Number(e.key) - 1];
      const cap = id ? resolveAction(id) : undefined;
      if (cap) {
        e.preventDefault();
        onRun(cap);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, onRun, orderedIds]);

  const available = availableActions(layout);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.headLabel}>Workspace</span>
        {!editing && <span className={styles.headHint}>press 1–9 to run</span>}
        <div className={styles.headActions}>
          {editing && (
            <button type="button" className={styles.headBtn} onClick={resetLayout}>
              Reset
            </button>
          )}
          <button
            type="button"
            className={styles.headBtn}
            data-active={editing}
            onClick={() => {
              setEditing((v) => !v);
              setPickerGroup(null);
            }}
          >
            {editing ? 'Done' : 'Customize'}
          </button>
        </div>
      </div>

      {layout.groups.map((group) => {
        const isPinned = group.id === PINNED_GROUP_ID;
        return (
          <section key={group.id} className={styles.group}>
            <div className={styles.groupHead}>
              <span className={styles.groupTitle}>{group.title}</span>
              <span className={styles.groupRule} />
              {editing && <span className={styles.groupMeta}>drag to arrange</span>}
            </div>

            <div
              className={`${styles.grid} ${isPinned ? styles.compact : ''}`}
              onDragOver={(e) => editing && e.preventDefault()}
              onDrop={() => editing && onDrop(group.id, group.actionIds.length)}
            >
              {group.actionIds.map((id, index) => {
                const cap = resolveAction(id);
                if (!cap) return null;
                const pinned =
                  layout.groups.find((g) => g.id === PINNED_GROUP_ID)?.actionIds.includes(id) ??
                  false;

                if (!editing) {
                  const num = ordinalOf.get(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={styles.card}
                      onClick={() => onRun(cap)}
                      title={num ? `${cap.hint}  ·  press ${num}` : cap.hint}
                    >
                      <span className={styles.icon} aria-hidden>
                        {glyph(id)}
                      </span>
                      {num && (
                        <span className={styles.num} aria-hidden>
                          {num}
                        </span>
                      )}
                      <span className={styles.label}>{cap.label}</span>
                      {!isPinned && <span className={styles.hint}>{cap.hint}</span>}
                    </button>
                  );
                }

                return (
                  <div
                    key={id}
                    className={`${styles.card} ${styles.editing} ${
                      dragId === id ? styles.dragging : ''
                    }`}
                    draggable
                    onDragStart={() => setDragId(id)}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.stopPropagation();
                      onDrop(group.id, index);
                    }}
                  >
                    <span className={styles.icon} aria-hidden>
                      {glyph(id)}
                    </span>
                    <span className={styles.label}>{cap.label}</span>
                    {!isPinned && <span className={styles.hint}>{cap.hint}</span>}
                    <div className={styles.cardTools}>
                      <button
                        type="button"
                        className={styles.cardTool}
                        data-on={pinned}
                        title={pinned ? 'Unpin' : 'Pin to top'}
                        onClick={() => commit(togglePinned(layout, id))}
                      >
                        {pinned ? '★' : '☆'}
                      </button>
                      <button
                        type="button"
                        className={styles.cardTool}
                        title="Remove"
                        onClick={() => commit(removeAction(layout, group.id, id))}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}

              {editing && (
                <button
                  type="button"
                  className={`${styles.card} ${styles.add}`}
                  onClick={() => setPickerGroup((g) => (g === group.id ? null : group.id))}
                  data-open={pickerGroup === group.id}
                >
                  <span className={styles.addPlus}>+</span>
                  <span className={styles.addLabel}>Add action</span>
                </button>
              )}
            </div>

            {editing && pickerGroup === group.id && (
              <div className={styles.picker}>
                {available.length === 0 ? (
                  <p className={styles.pickerEmpty}>Every action is already placed.</p>
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
                              commit(addAction(layout, group.id, cap.id));
                              setPickerGroup(null);
                            }}
                          >
                            <span aria-hidden>{glyph(cap.id)}</span>
                            {cap.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>
        );
      })}

      <button type="button" className={styles.connect} onClick={onConnectTools}>
        Connect your tools →
      </button>
    </div>
  );
}
