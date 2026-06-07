// viewer-uri — URI scheme resolution for viewer resources.
//
// The viewer registry accepts heterogeneous URIs because vault notes,
// mcp bundle assets, system-temp paths, and remote previews all share
// the same render surface. This module hides the dispatch so each viewer
// stays focused on its content-type concerns instead of fetch plumbing.
//
// Supported schemes:
//   vault://<rel/path>   — markdown / asset under the user's vault root,
//                          loaded via vault_read Tauri command (text body
//                          only; frontmatter is exposed separately).
//   ctrl-asset://...     — mcp-bundled or vault-asset URI per
//                          asset-uri.ts. Today depends on the protocol
//                          handler (zeus gap D2); falls back to a clear
//                          error in the viewer until that lands.
//   data:                — inline data URI.
//   http(s)://           — remote fetch (used for kernel-served streams
//                          and PWA-cached resources).
//   file:// / blob:      — passthrough, browser-handled.
//
// Writes round-trip back through whichever channel the URI implies:
// vault:// → vault_write, ctrl-asset:// → (not writable yet — error so
// callers expose the read-only badge), others → console.warn + reject.

import { invoke } from '@tauri-apps/api/core';
import { isCtrlAssetUri } from './asset-uri';

export type UriKind = 'vault' | 'ctrl-asset' | 'data' | 'http' | 'file' | 'blob' | 'unknown';

export const classifyUri = (uri: string): UriKind => {
  if (uri.startsWith('vault://')) return 'vault';
  if (isCtrlAssetUri(uri)) return 'ctrl-asset';
  if (uri.startsWith('data:')) return 'data';
  if (uri.startsWith('http://') || uri.startsWith('https://')) return 'http';
  if (uri.startsWith('file://')) return 'file';
  if (uri.startsWith('blob:')) return 'blob';
  return 'unknown';
};

/** Strip `vault://` prefix to get the vault-relative path. */
export const vaultRelativePath = (uri: string): string => {
  if (!uri.startsWith('vault://')) {
    throw new Error(`not a vault URI: ${uri}`);
  }
  return uri.slice('vault://'.length);
};

/** Build a `vault://` URI from a vault-relative path. */
export const vaultUri = (relativePath: string): string =>
  `vault://${relativePath.replace(/^\/+/, '')}`;

/**
 * VaultEntry — shape returned from the `vault_read` Tauri command, kept
 * in sync with `src-tauri/src/kernel/vault.rs`. `frontmatter` is `null`
 * for non-markdown files (no `---\n` opener); `content` is the raw body
 * (everything after the frontmatter block, or the whole file).
 */
export interface VaultEntry {
  path: string;
  frontmatter: unknown;
  content: string;
}

/**
 * Read a vault file via Tauri. Throws a typed Error so the caller can
 * decide between "vault not initialised" (Settings link) and "file not
 * found" (offer to create).
 */
export const readVault = async (relativePath: string): Promise<VaultEntry> =>
  invoke<VaultEntry>('vault_read', { args: { path: relativePath } });

/**
 * Write a vault markdown file. The Rust side always emits a YAML
 * frontmatter block; pass `{}` to write an empty block. **NB**: writing
 * a non-markdown file (e.g. raw `.csv`) through this command pollutes
 * the file with the frontmatter fence — a Tauri command for raw writes
 * is on zeus' list (referenced in `SmartTableViewer` save error path).
 */
export const writeVault = async (
  relativePath: string,
  content: string,
  frontmatter: Record<string, unknown> = {},
): Promise<void> => {
  await invoke('vault_write', {
    args: { path: relativePath, content, frontmatter },
  });
};

/**
 * Fetch URI as text. Supports vault/data/http/blob/file. ctrl-asset
 * goes through fetch() and will fail until the protocol handler ships;
 * the caller's error UI should surface that gap distinctly.
 */
export const fetchUriAsText = async (uri: string): Promise<string> => {
  const kind = classifyUri(uri);
  if (kind === 'vault') {
    const entry = await readVault(vaultRelativePath(uri));
    return entry.content;
  }
  if (kind === 'unknown') {
    throw new Error(`unsupported URI scheme: ${uri}`);
  }
  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error(`fetch ${uri} → ${res.status}`);
  }
  return res.text();
};

/**
 * Persist plain text back to a URI. Only vault:// is writable today.
 *
 * **Markdown-only guard**: `vault_write` on the Rust side always prepends
 * a `---\n…\n---\n\n` frontmatter block. For non-markdown extensions
 * (`.csv`, `.json`, `.yaml`, `.toml`), that would corrupt the file (vim
 * test would fail — opening the CSV in vim would show stray frontmatter
 * markers). Until kernel adds a raw-write command (tracked alongside the
 * SmartTableViewer save path), we reject those writes loudly so the user
 * sees the gap rather than discovering a corrupted vault file later.
 *
 * `.md` files (including markdown tables that round-trip through
 * SmartTableViewer) save normally — the frontmatter contract is part of
 * the markdown format CTRL standardises on.
 */
export const writeUriText = async (
  uri: string,
  content: string,
  frontmatter?: Record<string, unknown>,
): Promise<void> => {
  const kind = classifyUri(uri);
  if (kind !== 'vault') {
    throw new Error(`write not supported for ${kind} URIs`);
  }
  const path = vaultRelativePath(uri);
  if (!isMarkdownExtension(path)) {
    throw new Error(
      `raw write for ${extensionOf(path)} files awaits kernel raw-write ` +
        `command. ${path} would be corrupted by the markdown frontmatter ` +
        `prepend on the existing vault_write surface. ` +
        `Tip: save as a .md file with a markdown table block to round-trip ` +
        `today, or wait for the raw-write follow-up.`,
    );
  }
  await writeVault(path, content, frontmatter ?? {});
};

/**
 * True if writing through `writeUriText` is currently possible for this
 * URI scheme + extension. Use to gate the save button in viewer chrome
 * rather than surprising the user with a runtime error.
 */
export const isWritable = (uri: string): boolean => {
  if (classifyUri(uri) !== 'vault') return false;
  return isMarkdownExtension(vaultRelativePath(uri));
};

const extensionOf = (path: string): string => {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return '';
  return path.slice(dot).toLowerCase();
};

const isMarkdownExtension = (path: string): boolean => {
  const ext = extensionOf(path);
  return ext === '.md' || ext === '.markdown' || ext === '';
};
