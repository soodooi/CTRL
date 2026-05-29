---
adr_id: 023
title: Skill discovery — kernel-local first (走通), ctrl-cloud Worker for production; Irisy-led, over MCP registries + GitHub SKILL.md
status: accepted
date: 2026-05-29
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/decisions/021-irisy-brain-switcher-and-surfaces.md
  - .olym/decisions/022-workbench-composition-canvas.md
  - .olym/specs/workbench/spec.md
scope: framework
supersedes: []
superseded_by: []
amends: []
---

## Context

The first-keycap pipeline (ADR-022 / brief §9) starts with **discovery**: the
user finds a skill. bao's standing requirement is *"支持全球用户"* — discovery
must be fast worldwide.

Two course-corrections from bao shaped this ADR:

1. **Research first** (bao: *"你没有调研吗?"*). The web research changed the
   design:
   - **MCP registries are mature + API-accessible.** The official MCP Registry
     (`registry.modelcontextprotocol.io`, built for programmatic discovery),
     Glama (~27k servers), and PulseMCP (~11k) already index the MCP-server
     ecosystem. Since keycaps are MCP (ADR-013) and CLAUDE.md's keycap source #1
     is "MCP servers (10,000+ Day-1)", **these registries ARE that source** —
     MCP-server keycap discovery should reuse them, not re-crawl GitHub.
   - **GitHub code search for `SKILL.md` is rate-limit-fragile.** The GitHub
     issue `cli/cli#13293` is literally titled *"gh skill: rate limiting makes
     skill discovery unusable"* — uncached code search "is hit almost
     immediately". So a shared edge cache is not an optimization, it is the
     thing that makes GitHub-based SKILL.md discovery viable at all.

2. **Irisy participates** (bao: *"应该要让 Irisy 参与"*). Per ADR-021, Irisy is
   a Personal Assistant — *"the user tells Irisy what they want done; if a
   suitable keycap isn't installed, Irisy installs it and operates it."* So
   discovery is not primarily a search box; it is **Irisy-driven**: the user
   describes a need, Irisy searches, recommends, and installs. ADR-021 §5
   already reserves `search_pool` / `install_keycap_from_pool` as Irisy tools
   (TODO) — this ADR fills them.

ctrl-cloud does not exist yet (no `soodooi/ctrl-cloud`, not local). So this
stands up the CF Workers backend with its first tenant.

## Decision

### 1. Phasing — kernel-local first (走通), cloud for production

bao's calls (2026-05-29): *"本地先走通"* + *"不是每个用户都有 github repo 的"*.
Two facts drive the phasing:
- Skills live in their **authors'** public GitHub repos (e.g.
  `zarazhangrui/frontend-slides`) — not "our repo", not per-user repos. We
  *discover* across GitHub; we never store skills.
- **Installing** a public skill needs **no token** (anonymous clone / raw
  fetch). Only **searching** (GitHub code search API) needs one — and the
  general user has **no GitHub account/token**.

**Phase 1 — kernel-local (走通, this work, zero cloud):** the kernel runs the
whole first-keycap pipeline locally. Search = GitHub code search using a
**dev/BYOK PAT in the macOS Keychain** (bao's token for the walk-through; an
advanced user's own later). Install = anonymous public clone/fetch →
`~/.ctrl/keycaps/<id>/`. Run = Pi. This proves frontend-slides end-to-end.
(Does NOT violate "no local `wrangler dev`" — that bans running the Worker
locally; the kernel making an HTTPS call is not that.)

**Phase 2 — ctrl-cloud Worker (production, deferred):** because most users have
no GitHub token, production search MUST go through a shared `ctrl-skills` Worker
that carries **our** token on their behalf (§2–§5) — that is the real reason for
the Worker, not just caching/latency. One shared Worker for all users (not
per-user, not skill storage). Install stays token-free + local for everyone.
Stand up `soodooi/ctrl-cloud` only after Phase 1 走通. Until then, the kernel-
local path is the truth; the Worker is augmentation (端侧化 / 本地是 truth).

### 2. Discovery substrate = one Worker (`ctrl-skills`), two source legs

A single Cloudflare Worker, deployed to `*.workers.dev` staging (CLAUDE.md: **no
local `wrangler dev`**). It unifies two discovery legs behind one CTRL-shaped
API so callers (Irisy + the Pool UI) don't care about the source:

- **Leg A — MCP registries** (for MCP-server keycaps, the bulk / "10k+ Day-1"):
  aggregate the official MCP Registry (+ Glama/PulseMCP as needed). Robust,
  API-native, no GitHub rate-limit exposure. *(Exact registry API shape is a
  pre-build deep-dive — see follow-up 1.)*
- **Leg B — GitHub `SKILL.md` code search** (for agent-skills like
  frontend-slides, which registries don't index): proxy GitHub
  `/search/code?q=filename:SKILL.md ...` with a server-side token, **heavily
  edge-cached** (the rate-limit mitigation — load-bearing, not optional).

**Endpoints**:
- `GET /skills/search?q=<query>&source=<registry|skill|all>&page=<n>`
- Returns the CTRL envelope (`{ success, data, error }`); never raw upstream
  JSON. `data.results[]` items are normalized across both legs:
  `{ kind: "mcp"|"skill", id, name, description, source, install_ref, stars?, url }`
  where `install_ref` is what the install step consumes (registry id / package,
  or `owner/repo` + `skillmd_raw_url`).

### 3. Irisy is the ONLY discovery surface (bao 2026-05-29: "保留一个 Irisy 搜索就行")

There is exactly **one** search surface — Irisy. Discovery is conversational,
never a search box. Per ADR-021 (Personal Assistant):
- Irisy gains `search_skills` (Phase 1: kernel `search_skills` command; Phase 2:
  the `ctrl-skills` Worker) and `install_skill_as_keycap` (clone/fetch → write a
  `skill`-variant manifest, ADR-022) in its tool registry
  (`packages/ctrl-web/src/lib/irisy-tools.ts` — the ADR-021 §5 TODOs). The user
  says "I want HTML slide decks" → Irisy turns it into keywords, searches,
  reasons over the (keyword-matched, coverage-limited) results, recommends
  frontend-slides, and installs it → it lands on the keyboard. Irisy IS the
  intelligence layer that makes a blunt keyword search usable.
- **No manual search box.** Pool stays a browse view of *installed* keycaps; it
  does NOT get a GitHub-skill search box. Finding new skills is Irisy's job —
  one path, no redundant surface (`feedback_no_redundancy_one_ssot`).

### 4. Token handling — server-side only

GitHub token (Leg B) + any registry key live as CF **secrets**
(`wrangler secret put`), never in code, never client-side (olym rule; the whole
point of the proxy). A fine-grained PAT with `public_repo` read suffices.

### 5. Edge cache (load-bearing) + CORS + abuse posture

- Cache each `q`+`source` in the CF Cache API (~5 min TTL). Shared globally, so
  popular queries hit the edge — survives GitHub code-search rate limits and
  gives worldwide low latency (the reason to use a Worker at all).
- CORS allows the CTRL app origins (PWA dev origin, the Tauri scheme, deployed
  PWA), not a wildcard.
- Light per-IP token-bucket to protect the GitHub budget from abuse. No
  end-user auth on the endpoint for v1 (public discovery isn't sensitive).

## Consequences

**Good**
- MCP-server discovery reuses mature registries (the Day-1 10k+) instead of
  re-crawling GitHub — robust, no rate-limit hell.
- SKILL.md discovery is viable because the shared edge cache absorbs the GitHub
  code-search rate limit (the documented failure mode of uncached search).
- Discovery is Irisy-native (ADR-021): conversational find-and-install, with the
  Pool/workbench as the manual alternative — one substrate serves both.
- ctrl-cloud now exists with a clean first tenant patterning the rest.

**Cost / risk**
- Net-new repo + deploy + secrets (accepted; bao chose the complete path).
- GitHub code search only indexes default branches of public repos with coverage
  gaps; SKILL.md discovery is "good", not exhaustive — registries carry the bulk.
- Two legs to maintain; the normalized envelope is where they must stay aligned.

**Hard rules (this ADR holds)**
- Tokens NEVER leave the Worker.
- No local `wrangler dev`; staging on `*.workers.dev`.
- Desktop must still create a keycap from `owner/repo` without ctrl-cloud.
- Worker returns the normalized CTRL envelope, not raw upstream JSON.
- Edge caching on Leg B is mandatory, not optional.

## Open follow-ups (build order)

**Phase 1 — kernel-local 走通 (this work, zero cloud):**
1. Kernel `search_skills { query }` — GitHub code search `filename:SKILL.md`
   using a PAT from the Keychain; returns the normalized CTRL envelope. Document
   the PAT-in-Keychain setup (don't make bao guess the service name).
2. Kernel install-from-skill — anonymous public clone/fetch →
   `~/.ctrl/keycaps/<id>/` + write a `skill`-variant manifest (ADR-022 SDK).
3. Irisy tools `search_skills` + `install_skill_as_keycap` (ADR-021 §5) →
   conversational find-and-install. Irisy is the only search surface; no manual
   Pool search box (§3).
4. Kernel `run_keycap` skill dispatch (Pi reads SKILL.md) + viewer render →
   frontend-slides end-to-end.

**Phase 2 — production (deferred, only after 走通):**
5. Deep-dive registry APIs (official MCP Registry / Glama / PulseMCP).
6. Create `soodooi/ctrl-cloud` + the `ctrl-skills` Worker (Leg B GitHub + Leg A
   registries) per §2–§5; `GITHUB_TOKEN` secret; staging deploy. Switch
   production search from the kernel-local PAT path to the Worker (users have no
   GitHub token); install stays token-free + local.
