// UniverSheetViewer — the Excel-style spreadsheet surface (ADR-002 §14, plan
// `plan-univer-formula-augment.md`). Self-built smart-table stays the spine
// (multi-dimensional / relations / 8 views); Univer fills the formula +
// free-grid gap it can't cover (400+ functions, canvas rendering).
//
// vim test: the file on disk is `<name>.sheet.md` — YAML frontmatter
// `{kind: univer-sheet}` + a body holding the Univer workbook snapshot as
// JSON. It round-trips through the existing `vault_write` (a .md file, so no
// raw-write kernel gap) and stays a plain-text, git-diffable vault file.
//
// Univer mounts its OWN React root into the container div — it does not share
// CTRL's React tree, so there is no dual-instance hazard (unlike the notes
// iframe). We only own create + dispose.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/presets/preset-sheets-core';
import sheetsCoreEnUS from '@univerjs/presets/preset-sheets-core/locales/en-US';
import type { IWorkbookData, Univer } from '@univerjs/core';
import type { FUniver } from '@univerjs/core/facade';
import '@univerjs/presets/lib/styles/preset-sheets-core.css';
import type { ViewerProps } from '@/lib/viewer-registry';
import { readVault, writeVault, vaultRelativePath } from '@/lib/viewer-uri';
import styles from './UniverSheetViewer.module.css';

/** Content type for a Univer spreadsheet stored as `<name>.sheet.md`. */
export const UNIVER_SHEET_CONTENT_TYPE = 'application/vnd.ctrl.univer-sheet';

/** Frontmatter marker written on save so the file self-identifies. */
const SHEET_KIND = 'univer-sheet';

/** An empty single-sheet workbook (new / unparseable file). */
const emptyWorkbook = (id: string): Partial<IWorkbookData> => ({
  id,
  name: id,
  sheetOrder: ['sheet-01'],
  sheets: { 'sheet-01': { id: 'sheet-01', name: 'Sheet1', cellData: {} } },
});

const parseSnapshot = (id: string, body: string): Partial<IWorkbookData> => {
  const trimmed = body.trim();
  if (!trimmed) return emptyWorkbook(id);
  try {
    const data = JSON.parse(trimmed) as Partial<IWorkbookData>;
    return data && typeof data === 'object' ? data : emptyWorkbook(id);
  } catch {
    return emptyWorkbook(id);
  }
};

export function UniverSheetViewer({ resource }: ViewerProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const univerRef = useRef<Univer | null>(null);
  const apiRef = useRef<FUniver | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const relPath = vaultRelativePath(resource.uri);

  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (container == null) return;
    setStatus('loading');
    setMessage(null);

    void (async () => {
      let snapshot: Partial<IWorkbookData>;
      const id = relPath.replace(/[^A-Za-z0-9_-]/g, '_') || 'sheet';
      try {
        const entry = await readVault(relPath);
        snapshot = parseSnapshot(id, entry.content);
      } catch {
        // New file that does not exist yet → start from an empty workbook.
        snapshot = emptyWorkbook(id);
      }
      if (disposed) return;

      try {
        const { univer, univerAPI } = createUniver({
          locale: LocaleType.EN_US,
          locales: { [LocaleType.EN_US]: mergeLocales(sheetsCoreEnUS) },
          presets: [UniverSheetsCorePreset({ container })],
        });
        univerRef.current = univer;
        apiRef.current = univerAPI;
        univerAPI.createWorkbook(snapshot);
        setStatus('ready');
      } catch (e) {
        setMessage(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      univerRef.current?.dispose();
      univerRef.current = null;
      apiRef.current = null;
    };
    // Re-mount only when the underlying file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relPath]);

  const save = async (): Promise<void> => {
    const api = apiRef.current;
    if (api == null) return;
    const workbook = api.getActiveWorkbook();
    if (workbook == null) return;
    setSaveState('saving');
    try {
      const snapshot = workbook.save();
      await writeVault(relPath, JSON.stringify(snapshot, null, 2), { kind: SHEET_KIND });
      setSaveState('saved');
      window.setTimeout(() => setSaveState('idle'), 1500);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      setStatus('error');
      setSaveState('idle');
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <span className={styles.title}>{relPath.split('/').pop()}</span>
        {resource.editable !== false && (
          <button
            type="button"
            className={styles.saveBtn}
            onClick={() => void save()}
            disabled={saveState === 'saving' || status !== 'ready'}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save'}
          </button>
        )}
      </div>
      {status === 'error' && <div className={styles.error}>{message}</div>}
      {status === 'loading' && <div className={styles.loading}>Loading spreadsheet…</div>}
      <div ref={containerRef} className={styles.univerHost} data-status={status} />
    </div>
  );
}
