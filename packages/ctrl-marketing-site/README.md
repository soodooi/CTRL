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

Cloudflare Pages. The original setup was recorded in a former Olym handoff that is not retained in this repository; current deployment settings live in the Cloudflare Pages project configuration.

## Constraints

- Copy is English-only v0; Chinese bilingual = v0.1.
- No weight claims (`fast`, `tiny`, MB / startup time) without Zeus sign-off.
- v1.1 features (multi-model routing, screenshot → Irisy, doubao perf) NOT in copy.

## v0 themis deferrals (bao-waived 2026-05-21 → tracked in H-2026-05-19-004)

- **HIGH-1** `functions/api/waitlist.ts` — `onRequest` catch-all returns 405 for OPTIONS preflight.
  v0 is same-origin only; cross-origin embed will need an explicit OPTIONS handler.
- **HIGH-2** `functions/api/waitlist.ts` — `console.log` with PII (email + IP + UA).
  v0 "log only, no DB" trade-off; CF Worker log retention ≤ 7d. v0.1 replaces with structured
  Tail Worker sink + D1 / KV with at-rest encryption before real traffic lands.
