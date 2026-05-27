---
id: H-2026-05-17-apollo-marketing-v0
owner: Apollo (marketing / brand)
status: in-flight
created: 2026-05-17
reviewer: bao
related-adr: 001, 006 (pending)
---

# H-2026-05-17 — Marketing v0 (ctrlapplab.com)

## Locked decisions (bao, 2026-05-17)

| # | Decision | Notes |
|---|---|---|
| 1 | **Slogan**: `Share & be shared.` (English) | Marketing-only; does NOT pre-decide ADR-006 product positioning (工具中枢 vs 承载平台). When ADR-006 lands, hero copy revisits. |
| 2 | **Language**: English-only v0 | Chinese sub-copy + bilingual hero deferred to v0.1. |
| 3 | **Waitlist**: email placeholder | CF Pages Function accepts POST, logs (no DB binding). v0.1 wires Resend or CF KV. |
| 4 | **Hero demo**: static CSS keycap row | Real Ctrl-press capture deferred — bao building HTML→video pipeline next. |
| 5 | **Deploy**: Cloudflare Pages | Revised from initial Tokyo Caddy plan. Domain `ctrlapplab.com` (CF DNS already configured). |

## Stack

- **Astro 5** — SSG, zero-JS default; islands available if needed later
- **Native CSS** — consumes `brand-tokens.md` via vendored `src/styles/tokens.css`
- **CF Pages Functions** — `/functions/api/waitlist.ts` for form POST
- No React. No Tailwind. No Vue.

## Why

- Marketing page < 80 KB gzip first-paint vs PWA's 500 KB budget → they MUST stay separate bundles.
- React stays in `packages/ctrl-web`. Two codebases = landing-page cruft cannot pollute product PWA.
- Astro MD content collections give us changelog / dev-docs later without stack switch.
- Tailwind banned by `brand-tokens.md §11` (anti-template guardrail).

## File layout

```
packages/ctrl-marketing-site/
├── package.json
├── astro.config.mjs
├── tsconfig.json
├── README.md
├── .gitignore
├── public/                        favicon.svg / logo.svg / robots.txt
├── src/
│   ├── layouts/Base.astro
│   ├── pages/index.astro
│   ├── components/{Hero,KeycapRow,HowItWorks,Waitlist,Footer}.astro
│   └── styles/{tokens.css,global.css}
└── functions/api/waitlist.ts      CF Pages Function (POST)
```

## CF Pages deployment settings (for Zeus / dashboard)

| Setting | Value |
|---|---|
| Repository | `soodooi/CTRL` |
| Production branch | `main` |
| Build command | `npm install && npm run build --workspace @ctrl/marketing-site` |
| Build output | `packages/ctrl-marketing-site/dist` |
| Root directory | `/` (monorepo) |
| Functions root | `packages/ctrl-marketing-site/functions` *(see note)* |
| Node version | 20.x |
| Custom domain | `ctrlapplab.com` (Zeus binds) |

**Note on functions root**: CF Pages auto-detects `/functions` at the deployed root. If monorepo build doesn't auto-pick it up, switch CF Pages root dir to `packages/ctrl-marketing-site` and build command to `npm run build`.

## v0 acceptance

- [x] `npm install` succeeds at workspace
- [x] `npm run build --workspace @ctrl/marketing-site` succeeds
- [ ] Hero renders `Share & be shared.` at `--text-hero`, brand cobalt accent
- [ ] One CSS keycap row visible (cobalt / amber / jade)
- [ ] Waitlist form POSTs to `/api/waitlist` and returns 200 (verified via `wrangler pages dev` or after CF Pages preview)
- [ ] CF Pages preview URL works
- [ ] `ctrlapplab.com` resolves to Pages project
- [ ] First-paint bundle < 80 KB gzip

## Deferred to v0.1

- Inter Variable woff2 self-host (~80 KB subset)
- Waitlist persistence (Resend Audience or CF KV — Zeus picks binding)
- Chinese bilingual layout under English hero
- HTML→video hero demo (bao project)
- Privacy page (one-paragraph)
- OpenGraph social card
- Sitemap.xml + meta robots
- Lighthouse audit gate

## Open questions

1. **Functions root + monorepo build** — does CF Pages auto-detect `/functions/` when build output is nested? If not, may need to flatten or use `_worker.js`. Will verify on first deploy.
2. **Email destination** — bao's preference: Resend (transactional) vs CF KV (cheap store) vs both? Defer to v0.1.
3. **GitHub repo visibility for CF Pages** — repo is private; CF Pages needs the GitHub App installed on `soodooi/CTRL`. Zeus to confirm.

## Branch

`feat/apollo-marketing-v0` (per CLAUDE.md branch prefix rule for this role).
