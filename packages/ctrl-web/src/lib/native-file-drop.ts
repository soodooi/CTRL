// Native file drop — shared Tauri window-level drag-drop primitive.
//
// Extracted from Coding's original `coding-drop.ts` (ADR-002 substrate
// §1.8.6 v75; ADR-003 frontend §8.5 v35) once Irisy's own composer needed the
// SAME mechanism (bao "Irisy的页面...attachments等等模块都要"; ADR-005 irisy
// §8.7 v32). The underlying Tauri event plumbing was already 100% generic —
// only the calling component's business logic ("what does a drop MEAN here")
// differs between Coding (authoring reference material for opencode) and
// Irisy (its own, still-being-defined semantic). Sharing the mechanism does
// NOT merge the semantics: each caller still supplies its own handlers and
// decides what a drop means for its surface.

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { platform } from './bridge';

interface NativeDropPayload {
  type: string;
  paths?: string[];
}

function isNativeDropPayload(payload: unknown): payload is NativeDropPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { type?: unknown }).type === 'string'
  );
}

export interface NativeFileDropHandlers {
  /** Fires once per completed drop with the dropped files' absolute paths. */
  onDrop: (paths: string[]) => void;
  /** Fires when a drag enters/hovers the window, for a drag-over highlight. */
  onDragOver?: () => void;
  /** Fires when a drag leaves the window (cancel or moved elsewhere). */
  onDragLeave?: () => void;
}

/**
 * Calls `onDrop(paths)` with the absolute filesystem paths of files dropped
 * anywhere inside `targetRef`'s element, via Tauri's native window-level
 * drag-drop event (real OS file paths, not the browser `DataTransfer` File
 * API — CTRL reads the file server-side per ADR-002 §1.8.6). `onDragOver`/
 * `onDragLeave` are optional and only drive a visual highlight; they carry no
 * path data. No-op outside the desktop app (`platform() !== 'tauri'`).
 */
export function useNativeFileDrop<T extends HTMLElement>(
  targetRef: RefObject<T | null>,
  handlers: NativeFileDropHandlers,
  disabled = false,
): void {
  const handlersRef = useRef(handlers);
  const disabledRef = useRef(disabled);

  useLayoutEffect(() => {
    handlersRef.current = handlers;
    disabledRef.current = disabled;
  }, [handlers, disabled]);

  useEffect(() => {
    if (platform() !== 'tauri') return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const handle = await getCurrentWindow().onDragDropEvent((event) => {
        if (disabledRef.current) return;
        const payload: unknown = event.payload;
        if (!isNativeDropPayload(payload)) return;
        // No position hit-testing: whichever scene mounts this hook is
        // assumed to be the sole drop target in the window at that time —
        // the element ref only gates "are we mounted at all", not "did it
        // land HERE". A future surface that needs true multi-target hit
        // testing (e.g. Irisy and Coding visible side-by-side) would need
        // to extend this, not work around it per-caller.
        if (!targetRef.current) return;
        const kind = payload.type;
        if (kind === 'drop') {
          const paths = (payload.paths ?? []).map((p) => p.trim()).filter(Boolean);
          if (paths.length > 0) handlersRef.current.onDrop(paths);
          return;
        }
        if (kind === 'enter' || kind === 'over') {
          handlersRef.current.onDragOver?.();
        } else if (kind === 'leave') {
          handlersRef.current.onDragLeave?.();
        }
      });
      if (cancelled) {
        handle();
      } else {
        unlisten = handle;
      }
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // targetRef is a ref object — stable identity, intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
