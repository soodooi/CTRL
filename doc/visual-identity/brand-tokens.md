# CTRL — Brand Tokens (Visual Identity)

**Single source of truth** for all design tokens. PWA / desktop shell / installer icons / marketing materials all derive from here.

- **Date**: 2026-05-13
- **Owner**: bao (decisions), zeus (implementation)
- **Status**: v0.1 — first lock; refine via PR + diff
- **Anti-pattern**: do NOT hardcode color hex / spacing px / font-weight anywhere else. Always reference tokens by name.

---

## 1. Logo

| Asset | File | Use |
|---|---|---|
| Primary wordmark | `logo.svg` | App splash, marketing, README header |
| Mark only | `logo-mark.svg` | Favicon, tray icon, installer icon base, social avatar |
| Reference (raster) | `../reference/logo-reference.png` | bao-supplied original |

**Clear-space rule**: no element within 1× LED-bar height of the logo bounding box.
**Minimum size**: wordmark 80 px wide, mark 16 px square.
**Color modes**: full-color (default), mono-blue, mono-black on light, mono-white on dark.

---

## 2. Color

### Primary

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `--ctrl-blue` | `oklch(0.45 0.19 264)` | `#1E3FB0` | Logo, primary brand, focus rings, active keycap state |
| `--ctrl-blue-dark` | `oklch(0.32 0.16 264)` | `#16267D` | Hover/pressed states, bevels |
| `--ctrl-blue-light` | `oklch(0.65 0.16 252)` | `#5A8AEF` | Hover surfaces, soft accents, focus halos |

### Keycap colors (per `tool-manifest/spec.md` §2 `keycap_color` enum)

| Token | OKLCH | Hex | Identity |
|---|---|---|---|
| `--keycap-cobalt` | `oklch(0.45 0.19 264)` | `#1E3FB0` | = `--ctrl-blue` (primary built-in) |
| `--keycap-amber` | `oklch(0.78 0.16 80)` | `#E59F2B` | Warm / writing / chat keycaps |
| `--keycap-jade` | `oklch(0.65 0.15 162)` | `#1FA570` | Success / completed / safe ops |
| `--keycap-platinum` | `oklch(0.85 0.005 264)` | `#D5D6DA` | Neutral / system / built-in default |
| `--keycap-graphite` | `oklch(0.32 0.005 264)` | `#3E4046` | Dev / advanced / power-user keycaps |

### Neutrals

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `--ink` | `oklch(0.18 0 0)` | `#1B1B1B` | Body text on light |
| `--ink-soft` | `oklch(0.42 0 0)` | `#5C5C5C` | Secondary text |
| `--ink-faint` | `oklch(0.65 0 0)` | `#A0A0A0` | Disabled / muted |
| `--paper` | `oklch(0.98 0 0)` | `#FAFAFA` | Light-mode background |
| `--paper-soft` | `oklch(0.95 0 0)` | `#F0F0F0` | Light-mode surface |
| `--graphite` | `oklch(0.13 0.005 264)` | `#131517` | Dark-mode background (default) |
| `--graphite-soft` | `oklch(0.17 0.005 264)` | `#1E2024` | Dark-mode surface |
| `--graphite-soft-2` | `oklch(0.22 0.005 264)` | `#2B2D33` | Dark-mode elevated surface |

### Semantic

| Token | OKLCH | Hex | Use |
|---|---|---|---|
| `--status-success` | `oklch(0.65 0.15 162)` | `#1FA570` | OK / success / done |
| `--status-warning` | `oklch(0.78 0.16 80)` | `#E59F2B` | Caution / pending |
| `--status-danger` | `oklch(0.55 0.22 27)` | `#D6383A` | Error / destructive |
| `--status-info` | `oklch(0.65 0.16 252)` | `#5A8AEF` | Informational hint |

### Default theme = dark (deliberate, **not** auto-OS)

App default ships as dark (graphite background + paper text). Light mode toggle in settings. Anti-pattern: `@media (prefers-color-scheme)` auto-switch — bao 's directive: choose, don't follow.

---

## 3. Typography

### Font stacks

| Token | Stack | Use |
|---|---|---|
| `--font-sans` | `"Inter", "SF Pro Text", system-ui, -apple-system, sans-serif` | UI body, content, descriptions |
| `--font-mono` | `"JetBrains Mono", "SF Mono", Consolas, "Roboto Mono", monospace` | Keycap labels, code, hotkey display, clock strip |
| `--font-display` | `"Inter", "SF Pro Display", system-ui, sans-serif` | Logo wordmark, marketing H1 |

Bundling: PWA self-hosts Inter Variable (subset to Latin + CJK Simplified Chinese, ~80 kB woff2) and JetBrains Mono Variable (subset Latin, ~30 kB). Fall back to system fonts if load fails.

### Type scale (fluid, clamps)

| Token | Min → Max | Use |
|---|---|---|
| `--text-xs` | `clamp(0.75rem, 0.7rem + 0.1vw, 0.8125rem)` | Captions, badges |
| `--text-sm` | `clamp(0.875rem, 0.83rem + 0.2vw, 0.9375rem)` | Secondary body |
| `--text-base` | `clamp(1rem, 0.95rem + 0.2vw, 1.0625rem)` | Body |
| `--text-lg` | `clamp(1.125rem, 1.05rem + 0.4vw, 1.25rem)` | Lead, callouts |
| `--text-xl` | `clamp(1.5rem, 1.3rem + 0.8vw, 1.875rem)` | Section heads |
| `--text-2xl` | `clamp(2rem, 1.6rem + 1.6vw, 2.75rem)` | Page heads |
| `--text-clock` | `clamp(2.5rem, 2rem + 2.5vw, 3.5rem)` | ClockStrip HH:MM display |
| `--text-hero` | `clamp(3rem, 2rem + 4vw, 5.5rem)` | Marketing only |

### Weight tokens

| Token | Weight |
|---|---|
| `--weight-regular` | 400 |
| `--weight-medium` | 500 |
| `--weight-semibold` | 600 |
| `--weight-bold` | 700 |
| `--weight-black` | 900 (logo, hero) |

---

## 4. Spacing

4 px base scale:

```
--space-0   0
--space-1   4px
--space-2   8px
--space-3   12px
--space-4   16px
--space-6   24px
--space-8   32px
--space-12  48px
--space-16  64px
--space-24  96px
--space-32  128px
```

Section spacing (per `web/coding-style.md`):
```
--space-section: clamp(4rem, 3rem + 5vw, 10rem)
```

---

## 5. Radius

| Token | Value | Use |
|---|---|---|
| `--radius-xs` | 2px | Inline tags |
| `--radius-sm` | 4px | Input fields, small buttons |
| `--radius-md` | 8px | Buttons, cards |
| `--radius-lg` | 12px | Keycap, modal, surface |
| `--radius-xl` | 16px | Hero surface, marketing |
| `--radius-pill` | 9999px | Pills, capsule buttons |

**Keycap visual lock**: `--radius-lg` = 12px is the canonical keycap corner radius (industrial / OP-1 / mechanical-keyboard feel).

---

## 6. Shadow

| Token | Value | Use |
|---|---|---|
| `--shadow-sm` | `0 1px 2px oklch(0 0 0 / 0.06)` | Subtle surface lift |
| `--shadow-md` | `0 4px 12px oklch(0 0 0 / 0.10)` | Card, dropdown |
| `--shadow-lg` | `0 8px 32px oklch(0 0 0 / 0.16)` | Modal, popover |
| `--shadow-xl` | `0 24px 64px oklch(0 0 0 / 0.24)` | Hero surface, full-screen overlay |
| `--shadow-glow-blue` | `0 0 24px oklch(0.45 0.19 264 / 0.35)` | Focus / active keycap halo |

---

## 7. Motion

### Duration

| Token | Value | Use |
|---|---|---|
| `--duration-instant` | 80ms | Hotkey press feedback, keypress micro-interactions |
| `--duration-fast` | 150ms | Hover state transitions |
| `--duration-normal` | 220ms | Modal open/close, panel slide |
| `--duration-slow` | 380ms | Page transitions, hero reveal |

### Easing

| Token | Value |
|---|---|
| `--ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-out-quart` | `cubic-bezier(0.25, 1, 0.5, 1)` |
| `--ease-in-out-quart` | `cubic-bezier(0.76, 0, 0.24, 1)` |
| `--ease-spring` | (Framer Motion spring; mass 1 stiffness 220 damping 26) |

**Reduced-motion respect**: when `prefers-reduced-motion: reduce` set, durations fall to 0 / 50ms, springs disabled. Mandatory per `web/testing.md` §2.

---

## 8. Layout

### Breakpoints (mobile-first)

| Token | Min width |
|---|---|
| `--bp-sm` | 480px |
| `--bp-md` | 768px |
| `--bp-lg` | 1024px |
| `--bp-xl` | 1280px |
| `--bp-2xl` | 1536px |

### Container

```
--container-narrow  640px
--container-content 920px
--container-wide   1280px
--container-full   100%
```

### Keycap grid (Pool page)

- Desktop: 8 cols × N rows (per W3.4 `KeycapPool` 落地)
- Tablet (`--bp-md`): 6 cols
- Phone (`--bp-sm`): 4 cols
- Keycap card: 88 × 88 px, `--radius-lg`, 12 px gap

---

## 9. Icon

| Set | Use |
|---|---|
| **Lucide React** | UI icons (per `package.json` already pinned) |
| **Logo mark** | App / tray / installer |
| Keycap glyph | Per manifest (emoji / SVG URL — see `tool-manifest/spec.md` §2 `icon`) |

Sizing: 14 / 16 / 20 / 24 / 32 px. Stroke width 1.5–2 px. Color = `currentColor` (inherits text).

---

## 10. Voice / Tone (non-visual but VI-adjacent)

- Voice = **product-y, calm, technical-warm**. Reference Linear, Cursor changelogs.
- Sentence length: short → medium. Cut filler ("simply", "easily", "powerful", "revolutionary").
- Microcopy: imperative for buttons ("Install", "Try now"), descriptive for state ("Connected", "Last synced 2 min ago").
- No emoji in product UI (use icons). Emoji acceptable in marketing/social.
- Chinese OPC market — body copy is Simplified Chinese, terms (`keycap`, `manifest`, `Ctrl`) stay English.

---

## 11. Anti-template guardrails (enforced)

Per `CLAUDE.md` design-quality rule + `web/design-quality.md`:

| Banned | Why |
|---|---|
| Default Tailwind `bg-gray-50 rounded-xl shadow` cards-grid look | Generic AI-generated SaaS template |
| Generic gradient hero (purple→pink) | ChatGPT clone aesthetic |
| Auto-dark via `prefers-color-scheme` | Defaults are decisions — bao 's directive |
| Library default themes (shadcn green/orange/red presets) | Templating |
| `bg-blue-500` / `text-blue-600` hardcoded | Bypass tokens; breaks rebrand |
| 3+ accent colors in same view | Cobalt + 1 semantic max |

Required (per `web/design-quality.md` checklist):

- [ ] Hierarchy via scale contrast (not only weight)
- [ ] Hover / focus / active feel **designed**, not default
- [ ] Keycap = the visual ground truth — every card / button echoes its radius + shadow
- [ ] Dark default + intentional light mode (both feel deliberate)
- [ ] Typography pairing = mono labels + sans body (visible at a glance)

---

## 12. References

- `doc/reference/logo-reference.png` — bao 's hand-off logo
- ADR-001 §2 — visual direction lock (Linear / Cursor / OP-1 / Braun)
- ADR-002 §5 — PWA stack + anti-template guardrails
- `~/.claude/rules/web/coding-style.md` — token-driven CSS approach
- `~/.claude/rules/web/design-quality.md` — anti-template + required qualities checklist

---

## 13. Versioning

This file follows ADR lifecycle: `v0.1` → first PR ship. Increments via PR + diff, never silent edits. Major bump (`v1.0`) when full PWA scaffold (P3.8) consumes tokens end-to-end.

Token **renames** require migration note; token **values** can change freely if no rename.
