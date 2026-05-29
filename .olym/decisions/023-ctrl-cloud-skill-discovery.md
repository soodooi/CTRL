---
adr_id: 023
title: Stand up ctrl-cloud backend; global skill discovery via a CF-Worker-proxied GitHub search
status: accepted
date: 2026-05-29
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/022-workbench-composition-canvas.md
  - .olym/specs/workbench/spec.md
scope: framework
supersedes: []
superseded_by: []
amends: []
---

## Context

The first keycap pipeline (ADR-022 / brief §9) is
`discover skill → clone → workbench → keycap → keyboard → run (Pi) → render`.
Step 1 is **discovery**: the user finds a skill. bao's standing requirement —
*"支持全球用户"* — means discovery must be fast worldwide.

Skills live on GitHub as `SKILL.md` files. Finding them needs the GitHub code
search API (`GET /search/code?q=filename:SKILL.md ...`), which **requires
authentication** — there is no unauthenticated code search. Putting a GitHub
token in the desktop client is a non-starter (it ships to every user, can't be
rotated, leaks). bao chose (2026-05-29) to **proxy search through a CF Worker**
that holds the token server-side, over the lighter "paste owner/repo + direct
fetch" MVP.

Reality check that shaped this ADR: **ctrl-cloud does not exist yet** — neither
on GitHub (`soodooi/ctrl-cloud` absent) nor locally. CLAUDE.md's repo topology
lists it as a planned separate repo. So "CF Worker search first" means *standing
up the ctrl-cloud backend from scratch*, of which this skill-discovery worker is
the first tenant. bao confirmed: do it properly + completely.

## Decision

### 1. ctrl-cloud is a standalone repo — stand it up now

`ctrl-cloud` (new repo `soodooi/ctrl-cloud`, private) is the CF Workers backend
for the CTRL ecosystem (eventual: auth / billing / market / relay / push per
CLAUDE.md topology). It is **separate** from the CTRL desktop repo — the desktop
app must run fully without it (端侧化 / augmentation: cloud is augmentation, not
dependency, per ADR-001 design philosophy). Skill discovery is an *augmentation*:
if ctrl-cloud is down, the user can still hand-add a skill by `owner/repo`
(the MVP path stays as the offline/degraded fallback).

### 2. First worker — `ctrl-skills` (skill discovery)

A single Cloudflare Worker, deployed to `*.workers.dev` staging (CLAUDE.md:
**no local `wrangler dev`**; staging only).

**Endpoint**: `GET /skills/search?q=<query>&page=<n>`
- Proxies GitHub `GET /search/code?q=filename:SKILL.md ${query}` (+ pagination).
- Returns a cleaned, CTRL-shaped list (not raw GitHub JSON).

**Response envelope** (olym API format — success / data / error):
```jsonc
{
  "success": true,
  "data": {
    "skills": [{
      "repo": "zarazhangrui/frontend-slides",   // owner/name
      "owner": "zarazhangrui",
      "name": "frontend-slides",
      "description": "…",                        // repo description
      "stars": 42,
      "path": "SKILL.md",                        // path within the repo
      "skillmd_raw_url": "https://raw.githubusercontent.com/…/SKILL.md",
      "html_url": "https://github.com/…/SKILL.md",
      "updated_at": "2026-05-20T…Z"
    }],
    "total": 123,
    "page": 1
  },
  "error": null
}
```
On failure: `{ "success": false, "data": null, "error": "<message>" }` + an
appropriate HTTP status. Errors are explicit, never silently swallowed.

### 3. Token handling — server-side only

The GitHub token lives as a CF **secret** (`wrangler secret put GITHUB_TOKEN`),
never in code, never in KV that the client can read, never shipped to the
client (olym rule: API keys in CF, not hardcoded; the whole point of the proxy).
A fine-grained PAT with only `public_repo` read scope is sufficient — skills are
public repos. Rotation = re-run `wrangler secret put`.

### 4. Edge cache for global low-latency

GitHub authenticated code search is rate-limited (~10 req/min). The worker
caches each `q` in the **CF Cache API** (~5 min TTL) so repeated/global queries
hit the edge, not GitHub. This both respects the rate limit and gives worldwide
low latency (the reason to use a Worker over direct GitHub at all).

### 5. CORS + abuse posture

- CORS allows the CTRL app origins (the PWA dev origin, the Tauri custom
  scheme/`tauri://`, and the deployed PWA origin). Not a wildcard.
- A light per-IP token-bucket (CF) guards the GitHub rate budget from abuse.
- No auth on the endpoint for v1 (public skill search is not sensitive); revisit
  if abuse appears.

### 6. How CTRL consumes it (next increment, not this ADR's code)

The PWA Pool route (`routes/pool.tsx`, today only filters installed keycaps)
gains a "search skills" mode that fetches `${CTRL_SKILLS_URL}/skills/search?q=`.
Results render as installable cards; picking one feeds the clone/install step.
The worker URL is config, not hardcoded in components.

## Consequences

**Good**
- Discovery works globally, fast, with no token on the client.
- ctrl-cloud exists — the backend the topology always assumed, now real, with a
  clean first tenant to pattern the rest (auth/billing/market/relay/push) on.
- Desktop stays cloud-independent: search degrades to the `owner/repo` MVP path
  when ctrl-cloud is unreachable.

**Cost**
- Net-new repo + deploy pipeline + a secret to manage (accepted; bao chose the
  complete path over the MVP).
- GitHub code-search REST API only indexes default branches of public repos and
  has coverage gaps — discovery is "good", not exhaustive. Acceptable for v1.

**Hard rules (this ADR holds)**
- GitHub token NEVER leaves the Worker. No token in the client, ever.
- No local `wrangler dev`; staging on `*.workers.dev`.
- Desktop must still create a keycap from `owner/repo` without ctrl-cloud
  (cloud is augmentation, not dependency).
- Worker returns the CTRL envelope, not raw GitHub JSON.

## Open follow-ups

1. Create `soodooi/ctrl-cloud` + the `ctrl-skills` worker; deploy to staging.
2. Provision `GITHUB_TOKEN` secret (fine-grained PAT, `public_repo` read).
3. Wire the PWA Pool search-skills mode to the worker.
4. Clone/install path: pick a skill → fetch SKILL.md + clone repo into
   `~/.ctrl/keycaps/<id>/` → write a `skill`-variant manifest (ADR-022 SDK work).
5. Kernel `run_keycap` skill dispatch (Pi reads SKILL.md) + viewer render.
6. Later: fold discovery into a broader `ctrl-market` worker if the marketplace
   (paid listings / ratings) materializes; or keep `ctrl-skills` dedicated.
