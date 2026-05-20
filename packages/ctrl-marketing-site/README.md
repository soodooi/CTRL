# @ctrl/marketing-site

Public marketing landing for CTRL — deploys to `ctrlapplab.com` via Cloudflare Pages.

- Stack: Astro 5 + native CSS (no React, no Tailwind)
- Bundle target: ≤ 30 KB gzip first-paint (system fonts; no woff2 self-host yet)
- Functions: `functions/api/waitlist.ts` (CF Pages Function, no DB binding v0)
- Tokens: vendored from `doc/visual-identity/brand-tokens.md` (single source of truth)

## Local

```
npm install
npm run dev --workspace @ctrl/marketing-site
```

## Build

```
npm run build --workspace @ctrl/marketing-site
# output: packages/ctrl-marketing-site/dist
```

## Deploy

Cloudflare Pages. Settings in `.olym/handoffs/H-2026-05-17-apollo-marketing-v0.md` §"CF Pages deployment settings".

## Constraints

- Copy is English-only v0; Chinese bilingual = v0.1.
- No weight claims (`fast`, `tiny`, MB / startup time) without Zeus sign-off.
- v1.1 features (multi-model routing, screenshot → Irisy, doubao perf) NOT in copy.
