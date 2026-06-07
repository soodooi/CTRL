// asset-uri — CTRL asset URI scheme resolver.
//
// The `ctrl-asset://` custom scheme lets mcp-bundled assets at
// `~/.ctrl/mcps/<id>/assets/<path>` and vault assets at
// `~/Documents/CTRL/assets/<path>` be fetched without an `invoke` round-trip.
//
// Stub status (2026-05-25): the Tauri protocol handler that resolves
// `ctrl-asset://` to file:// is a zeus-lane blocker (gap D2). Until it
// lands, any `<img src="ctrl-asset://...">` will fail to load and the
// caller's fallback (glyph / placeholder) is what renders. The PWA can
// safely emit these URIs today; the moment zeus registers the handler
// every consumer goes live with zero PWA change.

export const CTRL_ASSET_SCHEME = 'ctrl-asset:' as const;

export type AssetRoot = 'mcps' | 'vault' | 'brand' | 'cache';

/**
 * Build a `ctrl-asset://<root>/<rest>` URI. No path encoding is applied
 * to the segments — callers pass already-safe path components.
 */
export const buildAssetUri = (root: AssetRoot, ...segments: string[]): string =>
  `${CTRL_ASSET_SCHEME}//${root}/${segments.join('/')}`;

/** Convenience: mcp-bundled asset path. */
export const mcpAssetUri = (mcpId: string, relPath: string): string =>
  buildAssetUri('mcps', mcpId, 'assets', relPath);

/** Convenience: vault-side asset path under `~/Documents/CTRL/assets/`. */
export const vaultAssetUri = (relPath: string): string =>
  buildAssetUri('vault', 'assets', relPath);

/** True for any `ctrl-asset://...` URI. */
export const isCtrlAssetUri = (uri: string): boolean =>
  uri.startsWith(CTRL_ASSET_SCHEME);

export interface ParsedAssetUri {
  root: AssetRoot;
  path: string;
}

/**
 * Split `ctrl-asset://<root>/<rest>` into its parts. Returns null on
 * malformed input — callers should branch (fallback render) rather than
 * throw, since asset URIs come from kernel data that may lag the spec.
 */
export const parseAssetUri = (uri: string): ParsedAssetUri | null => {
  if (!isCtrlAssetUri(uri)) return null;
  const after = uri.slice(CTRL_ASSET_SCHEME.length + 2); // skip '//'
  const slash = after.indexOf('/');
  if (slash <= 0) return null;
  const root = after.slice(0, slash) as AssetRoot;
  const path = after.slice(slash + 1);
  if (!path) return null;
  if (
    root !== 'mcps' &&
    root !== 'vault' &&
    root !== 'brand' &&
    root !== 'cache'
  ) {
    return null;
  }
  return { root, path };
};
