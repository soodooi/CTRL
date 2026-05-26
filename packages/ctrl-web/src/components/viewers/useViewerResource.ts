// useViewerResource — shared load/save plumbing for every viewer.
//
// Centralising load + dirty tracking + save invocation here means each
// individual viewer (markdown / code / smart-table / …) just renders
// content and reports edits. The hook handles:
//   - URI scheme dispatch (vault / ctrl-asset / http) via viewer-uri
//   - in-flight save serialisation (no concurrent writes)
//   - dirty flag relative to the last persisted snapshot
//   - error surfacing (load failures stay visible until next reload)
//   - readiness gating (non-editable resources never expose `save`)
//
// Returned `setContent` is the viewer's source-of-truth setter; calling
// it sets `dirty=true`. `save()` returns a Promise so the caller can
// chain UI feedback (toast, tab title star, etc.) on the result.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewerResource } from '@/lib/viewer-registry';
import {
  fetchUriAsText,
  isWritable,
  writeUriText,
} from '@/lib/viewer-uri';

export interface ViewerResourceState {
  /** Current buffer content. `null` while loading or after an error. */
  content: string | null;
  /** Replace the buffer (sets dirty=true). */
  setContent: (next: string) => void;
  /** Persist the buffer through the configured save channel. */
  save: () => Promise<void>;
  /** True when the buffer differs from the last persisted snapshot. */
  dirty: boolean;
  /** True during the in-flight save. */
  saving: boolean;
  /** Last load or save error. Cleared on successful operation. */
  error: string | null;
  /** True if this URI scheme accepts writes (gates save button). */
  writable: boolean;
}

export const useViewerResource = (
  resource: ViewerResource,
): ViewerResourceState => {
  const [content, setContentState] = useState<string | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Prevent stale fetches from clobbering newer ones when the resource
  // URI flips mid-load (e.g. user clicks between vault notes rapidly).
  const reqIdRef = useRef(0);

  useEffect(() => {
    const myReq = ++reqIdRef.current;
    setContentState(null);
    setSavedSnapshot(null);
    setError(null);
    fetchUriAsText(resource.uri)
      .then((text) => {
        if (reqIdRef.current !== myReq) return;
        setContentState(text);
        setSavedSnapshot(text);
      })
      .catch((err: unknown) => {
        if (reqIdRef.current !== myReq) return;
        const msg = err instanceof Error ? err.message : 'failed to load';
        setError(msg);
      });
  }, [resource.uri]);

  const setContent = useCallback((next: string) => {
    setContentState(next);
  }, []);

  const writable = isWritable(resource.uri) && resource.editable;

  const save = useCallback(async (): Promise<void> => {
    if (!writable) {
      throw new Error('resource is read-only');
    }
    if (content === null) return;
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      if (resource.onSave) {
        // Custom save handler — caller wires routing (e.g. keycap patch).
        await resource.onSave(content);
      } else {
        await writeUriText(resource.uri, content);
      }
      setSavedSnapshot(content);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'failed to save';
      setError(msg);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [content, resource, saving, writable]);

  const dirty = content !== null && content !== savedSnapshot;

  return {
    content,
    setContent,
    save,
    dirty,
    saving,
    error,
    writable,
  };
};
