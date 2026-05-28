// Icon — discriminated union consumed by the keycap surface, workshop
// preview cards, and Irisy mascot. Single rendering target: ThorVG WASM
// (via @lottiefiles/dotlottie-react) when animated; native browser SVG /
// CSS span when static. No mixed React-SVG + lottie-web stacks.
//
// kernel-side schema mirrors this union (handoff: thorvg-icon-schema).
// Until the kernel ships the new payload, `normalizeIcon` accepts the
// legacy `string` glyph and lifts it into a `glyph` variant.

import { z } from 'zod';

// `src` accepts http(s) URLs, app-static paths (`/lottie/foo.json`), and
// `ctrl-asset://...` URIs (resolved by the Tauri protocol handler — see
// `lib/asset-uri.ts`). All three reach the renderer as ordinary URLs.
const iconSrc = z
  .string()
  .url()
  .or(z.string().startsWith('/'))
  .or(z.string().startsWith('ctrl-asset:'));

export const iconSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('glyph'),
    char: z.string().min(1).max(4),
  }),
  z.object({ kind: z.literal('svg'), src: iconSrc }),
  z.object({ kind: z.literal('lottie'), src: iconSrc }),
  z.object({ kind: z.literal('dotlottie'), src: iconSrc }),
]);

export type Icon = z.infer<typeof iconSchema>;

// Derive a 1-2 char glyph from a keycap name when no real icon ships.
// Used by both the legacy back-compat path and as the WASM-loading
// fallback for lottie/dotlottie variants.
export const deriveGlyph = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const first = trimmed[0];
  if (first && /[\u4e00-\u9fff]/.test(first)) return first;
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase();
};

// Accept the legacy kernel payload (`icon: string`) plus the new union.
// `null` / `undefined` / empty string → glyph derived from `fallbackName`.
export const normalizeIcon = (
  raw: Icon | string | null | undefined,
  fallbackName: string,
): Icon => {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return { kind: 'glyph', char: raw.trim() };
  }
  return { kind: 'glyph', char: deriveGlyph(fallbackName) };
};

// `.lottie` is a zip bundle (themes / state machines / slots inside);
// `.json` is raw Lottie data; `.svg` is browser-native. Used by the
// renderer when only a URL is known (the legacy kernel field).
export const inferIconKindFromUrl = (url: string): Icon['kind'] => {
  const lower = url.toLowerCase();
  if (lower.endsWith('.lottie')) return 'dotlottie';
  if (lower.endsWith('.json')) return 'lottie';
  if (lower.endsWith('.svg')) return 'svg';
  return 'glyph';
};
