# OpenClaw compat — ecosystem positioning + 3 strategic moves

**Date**: 2026-06-03
**Trigger**: bao 2026-06-03 — research dump on OpenClaw / WorkBuddy / work-buddy.ai / 得到大脑 + directive "需要增加 openclaw 的兼容层"
**Status**: strategy locked in this doc, ADR-005 amendment landed, code deferred to next session

---

## TL;DR

OpenClaw (Peter Steinberger, 2026-01 - 03) went from 0 to 250k stars in 60 days (now 350k+, beat React); ClawHub has 2,999+ community skills; **Tencent WorkBuddy 已经兼容 OpenClaw skill 格式**. **SOUL.md** (aaronjmars/soul.md) is the shared persona/memory config spec recognized by *both* OpenClaw and Claude Code — it has crossed from "one project" to "personal AI agent protocol standard", same shape MCP took for tool calling.

CTRL has already half-committed (memory `decision_pi_is_sole_brain_hermes_is_keycap` references `vault/irisy/SOUL.md`) but never formalized. Continuing without explicit compat = standing outside a 350k-star standard. Embracing = "OpenClaw-compatible brain + Ctrl-hotkey ambient shell + keycap marketplace + plain-text vault" — clean positioning, the niches OpenClaw doesn't fill.

**Three strategic moves** (locked in this doc; ADR + code follow-up):

1. **Brain layer**: lock SOUL.md as the canonical Irisy persistent-memory format. ADR-005 § soul-md-compat v1.
2. **Marketplace bridge**: keycap manifest ↔ OpenClaw skill (ClawHub) bidirectional bridge. One skill ships to both registries. ADR-002 §7 composition amendment, follow-up session.
3. **Positioning**: stop framing CTRL as "yet another AI assistant"; brand it as **ambient Ctrl-hotkey shell + OpenClaw-compatible brain + creator marketplace + native macOS/Windows/Linux**. (No code, just messaging.)

---

## 1 Competitive landscape (bao's research, restated)

| Dim | CTRL (us) | OpenClaw | WorkBuddy (Tencent) | work-buddy.ai (indie) | 得到大脑 |
|---|---|---|---|---|---|
| Origin | bao self-build 2026 | Steinberger 2025-11 (joined OpenAI Feb 14, 2026) | Tencent Cloud 2026-03 | Solo dev 2026 | 罗振宇 得到 2024+ |
| Position | Ambient AI workbench + creator substrate | Personal AI agent (channel inbox) | Office AI agent (B2B SaaS) | Local-first AI assistant | AI 记录 + 内容创作 (PKM tool) |
| Entry | Ctrl key (global) + Irisy | Messaging channel (20+ inbox) | Web/desktop + WeChat | Chrome ext + Obsidian | iOS app |
| Architecture | Tauri shell + Rust kernel + PWA, Pi-centric, 5 primitives | 3-layer (channel + brain + body) | Cloud-native SaaS + MCP layer | Python service + Obsidian + Chrome | iOS native + cloud AI |
| Brain | Pi (MIT) + provider router (CLI primary, Volc fallback) | Model-agnostic (Claude/GPT/Gemini/Ollama), SOUL.md driven | 多模型切换 (混元 + ?) | Claude Code (subscription reuse) | Closed (得到 own + ?) |
| Config | TOML manifest (provider) + Zod manifest (keycap) | **SOUL.md plain markdown** | UI + MCP server config | YAML | In-app UI |
| Extension | keycap (5 sources: builtin/MCP/OAuth/local/STSS) | tool layer (body), MCP-compat | MCP servers (GitHub/Jira/Notion/Slack/Drive) | MCP-style but closed | Built-in only |
| Data | local truth + cloud mirror, plain-text vault | Local self-hosted | Cloud-native (Tencent) | Local + Obsidian | Cloud (得到 DC) |
| License | ARR (Apache 2.0 under discussion per OSS doc) | MIT | Closed SaaS | Unclear | Closed |
| Scale | Pre-launch | 350k stars, 70k forks, 1.6k contributors, 2,999+ skills | Tencent product line | Indie | 2000 万 MAU |
| Monetisation | TBD (cloud + market + ent) | Free + NemoClaw (NVIDIA partnership) | B2B SaaS subscription | "No fees" for individuals | Knowledge subscription |

Sources cited at bottom.

---

## 2 Why OpenClaw is the right ecosystem to align on

### 2.1 It crossed the protocol-standard threshold

In ~10 weeks, OpenClaw went from solo side project → 350k GitHub stars + Tencent compat. Indicators of "protocol standardization":

- **Multi-vendor adoption**: WorkBuddy 兼容 + NemoClaw (NVIDIA partnership) + multiple skill registries (ClawHub, awesome-openclaw-agents, will-assistant/openclaw-agents).
- **Cross-tool spec**: SOUL.md is recognized by both OpenClaw *and* Claude Code (independent tools, same config file). That's the same pattern MCP took: a spec that crosses tool boundaries becomes the standard, not the original tool.
- **2,999+ third-party skills**: any creator writing personal AI tooling already aims at OpenClaw.

Standing outside this and writing CTRL-only manifest formats means: every creator who writes for ClawHub has to port to write for CTRL; we get 0 creator inertia.

### 2.2 OpenClaw doesn't fill the niches CTRL claimed

OpenClaw is messaging-channel-centric ("answer on the channels you already use"). CTRL is **hotkey ambient + creator workbench**. These are complementary, not competing.

| What OpenClaw owns | What CTRL owns |
|---|---|
| Messaging-channel ambient ("WhatsApp/iMessage as inbox") | Hotkey ambient ("Ctrl key as launcher") |
| Cross-OS personal agent | macOS/Windows/Linux native shell + creator marketplace |
| SOUL.md persona/memory standard | Plain-text vault substrate + Pi brain + Tauri shell |
| ClawHub skill registry (open distribution) | Keycap marketplace (creator economy + monetization layer) |
| Local-first by default | Local truth + opt-in cloud mirror |

Embracing SOUL.md doesn't compete with OpenClaw — it lets CTRL **inherit the standard** and add hotkey + creator economy on top.

### 2.3 The alternative (don't compat) is much harder

If CTRL doesn't adopt SOUL.md, then to build creator inertia we'd need to convince every skill author to:
- Write a CTRL-specific keycap manifest
- Maintain it alongside any OpenClaw / Claude Code config they already wrote
- Trust an ARR-licensed product (CTRL) over a 350k-star MIT-licensed protocol

This is a 10x harder ecosystem play than "we accept SOUL.md + ClawHub skills directly".

---

## 3 The three moves (lock here, ADR + code follow)

### Move 1 — Brain layer: SOUL.md is the canonical Irisy memory format

**What's locked**: Irisy persistent memory (`vault/irisy/SOUL.md` + `vault/irisy/.irisy-memory/`) follows the SOUL.md spec at github.com/aaronjmars/soul.md verbatim. Any extensions CTRL needs go into a documented `x-ctrl:` frontmatter namespace, never breaking forward-compatibility with vanilla SOUL.md readers.

**Why**: aligns Irisy with the 350k-star standard. Users who already wrote a SOUL.md for OpenClaw or Claude Code can drop it into CTRL vault and it Just Works.

**Lands in ADR**: **ADR-005 irisy v1 → v2, NEW § soul-md-compat v1**. See `vault/ctrl/adrs/005-irisy.md`.

**Code follow-up**:
- Add a seeded `vault/irisy/SOUL.md` template to `src-tauri/src/kernel/vault_seed/` so first-boot creates the file.
- Add a kernel command `irisy_soul_read()` / `irisy_soul_write()` that exposes the file as a structured object (frontmatter + sections), so the Settings → Irisy panel can edit it visually without forcing the user into vim.
- Add MCP tool `irisy.soul_get` / `irisy.soul_set` so Pi / external agents can read+update the soul.

### Move 2 — Marketplace: keycap manifest ↔ OpenClaw skill bridge

**What's locked**: A keycap manifest (`packages/ctrl-keycap-sdk/src/manifest-schema.ts`) is convertible to an OpenClaw skill manifest, and vice versa, with a documented lossless subset. Creators write once, ship to both registries (CTRL keycap pool + ClawHub).

**Why**: Creators don't have to choose. CTRL inherits ClawHub's 2,999+ existing skills as "openclaw-source" keycaps on day one; ClawHub creators see CTRL as a new distribution channel without rewriting.

**Lands in ADR**: **ADR-002 substrate v4 → v5, § composition v1 amendment**. New keycap source kind `openclaw-skill` added to the existing 5 (`builtin / mcp / oauth / local_agent / stss` → 6).

**Code follow-up**:
- Add `packages/ctrl-keycap-sdk/src/openclaw-bridge.ts` — bidirectional manifest transformer.
- Add a CLI `npx @ctrl/keycap-cli export-openclaw <keycap-id>` that emits a ClawHub-shaped skill bundle.
- Add a Pool import flow that pulls a ClawHub skill URL and registers it as a keycap.
- Document the lossless subset + the `x-ctrl:` extension namespace.

### Move 3 — Positioning (no code, just messaging)

**What's locked**: CTRL's tagline / docs / pitch lead with **"ambient Ctrl-hotkey shell + OpenClaw-compatible brain + creator marketplace + native desktop"**. Stop saying "yet another AI assistant"; stop saying "Pi is our own brain". Say "Pi runs your OpenClaw soul".

**Why**: removes the cognitive load of "is CTRL competing with OpenClaw?" — they see "CTRL extends OpenClaw with hotkey + marketplace + native shell" and immediately know if it's for them.

**Lands in**: marketing site copy + README + brainstorm doc on OSS business model when bao writes that.

---

## 4 Competitive responses

### 4.1 vs work-buddy.ai

Direct collision: local-first + Obsidian vault + Claude Code subscription reuse + Python service + Chrome ext + "no fees".

**Our differentiators**:
- Native Tauri shell (not Chrome extension)
- Global Ctrl-key (not browser-bound)
- Keycap marketplace + creator economy
- Pi brain with provider router (not Claude Code only)
- Plain-text vault substrate (Obsidian-compatible by accident, not by design)

work-buddy.ai is the closest existing product; our positioning paragraph should explicitly call out "if you want browser+Obsidian, use work-buddy.ai; if you want native desktop ambient + creator economy, use CTRL".

### 4.2 vs 得到大脑

Adjacent: PKM tool for Chinese knowledge economy, 得到 ecosystem leverage, 2000万 MAU.

**Short-term**: not a competitor — different language market, different distribution.
**Long-term (i18n Chinese)**: 得到 owns the "AI 记录 → 作品" PKM workflow inside their 10-year content library. CTRL's positioning needs to be "I work *across* my whole life, not inside 得到 content"; that's clean.

### 4.3 vs WorkBuddy (Tencent)

Tencent's enterprise SaaS layer on top of OpenClaw — they sell to B2B (企业版). CTRL is consumer + creator economy. Not a head-on collision unless Tencent moves down-market.

Tactical: WorkBuddy compat with OpenClaw skills means **CTRL adopting SOUL.md also gives us hypothetical interop with WorkBuddy's enterprise installs**. That's a future B2B distribution channel we'd never have if we stayed proprietary.

### 4.4 Strategic implication for ADR-008 (OSS model)

bao's earlier OSS doc (drafted but not numbered) was contemplating Apache 2.0 vs ARR. **This research strengthens the Apache 2.0 case**: standing alongside MIT OpenClaw + MIT SOUL.md as "compatible OSS shell + brand-licensed cloud + marketplace revenue" is much more credible than ARR.

Action: when bao writes the OSS model ADR, this brainstorm doc is the input to its § ecosystem-compat section.

---

## 5 Risks

- **OpenClaw spec churns**: SOUL.md is young, breaking changes possible. Mitigation: pin SOUL.md upstream commit in ADR-005 § soul-md-compat; review on each upstream tag.
- **OpenClaw drifts away from OSS / messaging-channel positioning**: Steinberger joined OpenAI; community could fork or vendor could pivot. Mitigation: SOUL.md is maintained by aaronjmars (separate project) and recognized by Claude Code too, so it's not single-point-of-failure on Steinberger.
- **ClawHub TOS may limit redistribution**: need to verify before we auto-import skills into CTRL Pool. Mitigation: cite ClawHub TOS in the bridge doc; import only with explicit user gesture.

---

## 6 ADR commitments (this session)

| ADR | Change | Status |
|---|---|---|
| **ADR-005 irisy** v1 → v2 | NEW § soul-md-compat v1 — Irisy memory = SOUL.md spec, `x-ctrl:` extension namespace for CTRL-only fields | landing this session |
| **ADR-002 substrate** v4 → v5 | NEW keycap source kind `openclaw-skill` in §7 composition; bridge contract reference | next session (paired with bridge code) |
| **memory** `decision_openclaw_compat_layer.md` | pointer | landing this session |
| **INDEX.md** | bump ADR-005 row | landing this session |

---

## Sources

- [openclaw/openclaw on GitHub](https://github.com/openclaw/openclaw)
- [aaronjmars/soul.md on GitHub](https://github.com/aaronjmars/soul.md) — "Let Claude Code / OpenClaw ingest your data & build your AI soul"
- [mergisi/awesome-openclaw-agents](https://github.com/mergisi/awesome-openclaw-agents) — "162 production-ready AI agent templates for OpenClaw. SOUL.md configs across 19 categories"
- [will-assistant/openclaw-agents](https://github.com/will-assistant/openclaw-agents) — curated collection of OpenClaw agent personalities (SOUL.md / AGENTS.md / IDENTITY.md)
- [OpenClaw official site](https://openclaw.ai/)
- [OpenClaw Just Became GitHub's Most-Starred Project — DEV Community](https://dev.to/derivinate/openclaw-just-became-githubs-most-starred-project-heres-why-2ii0)
- [OpenClaw Self-Hosted AI Agent GitHub: The Definitive 2026 Guide — OneClaw blog](https://www.oneclaw.net/blog/openclaw-ai-agent-self-hosted-github)
- [The Phenomenon of OpenClaw GitHub Stars in 2026 — skywork.ai](https://skywork.ai/skypage/en/openclaw-github-stars-guide/2037428622809894912)
- [OpenClaw AI Platform Statistics 2026 — getpanto.ai](https://www.getpanto.ai/blog/openclaw-ai-platform-statistics)
