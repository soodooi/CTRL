# CTRL — Visual Identity

Single source of truth for brand assets + design tokens. Everything CTRL-branded references this directory.

## Files

| File | Purpose |
|---|---|
| `brand-tokens.md` | Color / typography / spacing / radius / shadow / motion — token-canonical |
| `logo.svg` | Primary wordmark (CTRL + 4 LED bars) |
| `logo-mark.svg` | Mark only (single keycap with embossed "C") — favicon / tray / installer |
| `../reference/logo-reference.png` | bao 's original hand-off (kept for diff reference) |

## Where these get used

- **Desktop installer icon** — `logo-mark.svg` rasterized to 16/32/64/256/512 PNG via `src-tauri/icons/`
- **Tray icon** — `logo-mark.svg` at 16/32 px
- **PWA app icon** (P3.8) — `logo-mark.svg` rasterized to 192/512/maskable in `packages/ctrl-web/public/icons/`
- **PWA design tokens** (P3.8) — `brand-tokens.md` exported to `packages/ctrl-web/src/styles/tokens.css` as CSS custom properties
- **Marketing site** (later) — same SVGs + tokens

## Edit rules

1. **Never edit token hex / values without ADR-amendment-style discipline**. Add new tokens; deprecate old ones.
2. **Don't hardcode color / spacing anywhere in code**. Always reference `var(--token-name)`.
3. **SVG changes** require visual diff in PR description (paste before/after rendering).
4. **bao approves color shifts**. zeus implements.

## Status

`v0.1` — first lock 2026-05-13. Will mature to `v1.0` when PWA scaffold (P3.8) consumes tokens end-to-end.
