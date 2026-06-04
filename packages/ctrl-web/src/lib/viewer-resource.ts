// viewer-resource — helpers that turn a tab into a ViewerResource for
// the registry. Keeps the resource-building logic out of UI components
// so the same mapping is reusable from drag-drop / vault navigation /
// Pool detail panel etc.

import type { Tab } from './tab-store';
import { keycapAssetUri } from './asset-uri';
import { vaultUri } from './viewer-uri';
import type { ViewerResource } from './viewer-registry';

/** Guess content type from a file extension. */
export const inferContentTypeFromPath = (path: string): string => {
  const lower = path.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'text/yaml';
  if (lower.endsWith('.toml')) return 'text/toml';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'text/html';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.mmd') || lower.endsWith('.mermaid')) return 'text/mermaid';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'text/typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'text/javascript';
  if (lower.endsWith('.css')) return 'text/css';
  if (lower.endsWith('.rs')) return 'text/rust';
  if (lower.endsWith('.py')) return 'text/python';
  if (lower.endsWith('.sh')) return 'text/shell';
  return 'text/plain';
};

/** Companion (sidecar) helper — PDF gets `.pdf.md` text companion. */
export const inferCompanionUri = (uri: string): string | undefined => {
  if (uri.toLowerCase().endsWith('.pdf')) return `${uri}.md`;
  return undefined;
};

/** Convert a vault-md tab into a viewer resource.
 *
 * Uses `vault://` (routed through `vault_read`) rather than
 * `ctrl-asset://vault/...` — bao 2026-06-02 LOAD FAILED root cause:
 * `asset_scheme.rs` only serves `ctrl-asset://keycaps/<id>/...`, every
 * other host is rejected. The original `vaultAssetUri` produced a URI
 * that the protocol handler had no clause for, so every Notes editor
 * load failed silently. `vault://` is handled in `fetchUriAsText`
 * (`viewer-uri.ts`) by delegating to `readVault` → `vault_read`. */
export const resourceFromVaultPath = (vaultPath: string): ViewerResource => ({
  location: 'vault',
  contentType: inferContentTypeFromPath(vaultPath),
  uri: vaultUri(vaultPath),
  editable: true,
  companion: inferCompanionUri(vaultPath),
});

/** Convert a keycap-internal asset (prompt.md, manifest, etc) into a
 *  viewer resource. Editable maps to writing back via Config-tier patch. */
export const resourceFromKeycapAsset = (
  keycapId: string,
  relPath: string,
  editable = true,
): ViewerResource => ({
  location: 'keycap',
  contentType: inferContentTypeFromPath(relPath),
  uri: keycapAssetUri(keycapId, relPath),
  editable,
  companion: inferCompanionUri(relPath),
});

/** Best-effort: pull a viewer resource out of a Tab. Returns null when
 *  the tab kind has no static resource (streams / embeds / routes). */
export const resourceFromTab = (tab: Tab): ViewerResource | null => {
  if (tab.kind === 'vault-md' && tab.vaultPath) {
    return resourceFromVaultPath(tab.vaultPath);
  }
  return null;
};
