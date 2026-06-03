// Shared hook: fetch a viewer resource's text content + expose save +
// loading/error state. Used by every text-based viewer (Markdown,
// CodeMirror-driven ones, etc.) so the fetch + ctrl-asset:// fallback
// behavior lives in one place.
//
// bao 2026-06-03 — VAULT LOAD FAILED root cause: `vault://` is a JS-side
// scheme (not a registered Tauri protocol). `fetch('vault://…')` throws
// before reaching network. All scheme routing lives in `fetchUriAsText`
// (`viewer-uri.ts`) which dispatches `vault://` to `vault_read`. Earlier
// commit fixed the URI **generation** (vaultUri instead of vaultAssetUri)
// but this consumer was still calling raw `fetch()`.

import { useEffect, useState } from 'react';
import { isCtrlAssetUri } from '@/lib/asset-uri';
import { fetchUriAsText } from '@/lib/viewer-uri';
import type { ViewerResource } from '@/lib/viewer-registry';

interface UseViewerResourceState {
  content: string | null;
  error: string | null;
  setContent: (next: string) => void;
  save: () => Promise<void>;
  saving: boolean;
  dirty: boolean;
}

export const useViewerResource = (
  resource: ViewerResource,
): UseViewerResourceState => {
  const [content, setContentState] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setContentState(null);
    setOriginal(null);
    setError(null);
    fetchUriAsText(resource.uri)
      .then((text) => {
        if (cancelled) return;
        setContentState(text);
        setOriginal(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : 'failed to load';
        const hint = isCtrlAssetUri(resource.uri)
          ? `${msg} — ctrl-asset:// handler not yet registered`
          : msg;
        setError(hint);
      });
    return () => {
      cancelled = true;
    };
  }, [resource.uri]);

  const save = async (): Promise<void> => {
    if (!resource.editable || !resource.onSave || content == null) return;
    setSaving(true);
    try {
      await resource.onSave(content);
      setOriginal(content);
      setError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'save failed';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return {
    content,
    error,
    setContent: setContentState,
    save,
    saving,
    dirty: content !== null && content !== original,
  };
};
