# Three-layer keycap model — research note 00

> Author: zeus · Status: open research, not a spec · Started 2026-05-23.
> Goal: figure out the boundary between **底座** / **base keycap** / **functional keycap** by classifying every shipped + planned capability in CTRL. No conclusions yet — this is a working document; append, don't restructure.

> **2026-05-23 reframe (bao)**: classification alone isn't the goal. The real goal is **what the user touches** — three blocks, each independently flexible, all coupled:
>
>   1. **底座 + base keycap** (the building-block layer — invisible substrate + visible atomic tools)
>   2. **UX / UI** (keyboard, workspace, sub-panel, mascot, themes, hotkeys — everything the user *sees*)
>   3. **Irisy** (the AI companion — discovery, orchestration, suggestion, memory)
>
> Each block has its own flexibility surface, and the three couple at well-defined seams. The research target is now: map the flex surface of each block, then map the coupling seams. The 3-layer-inside-keycap stuff above is a sub-question of block 1.

(Sections 1-7 below were written before the reframe and stay relevant for block 1. Section 8 is the new entry point.)

---

## 1. bao's framing (the 2026-05-23 conversation, verbatim where possible)

> 底座，譬如Irisy现在在做的vmark，提供html，md，json文件的支持，知识库的管理，图片管理， 譬如大模型接入的底座 譬如st-ss这种基础的通讯协议，底座接Irisy和用户工作台；
>
> base keycap是造车的轮子，functional keycap是成品的用户可使用的键帽；
>
> 具体，我们需要多做调研。

Three things this nails:

1. **底座** has no UI. It's the substrate the workshop sits on (power, water, floor). It is *consumed by* Irisy and the workbench, never selected by the user directly. Examples bao gave: VMark (file format support + knowledge-base mgmt + image mgmt), LLM-provider gateway, ST-SS.

2. **base keycap** are the *wheels / screws / wood blocks* you compose to build something useful. A base keycap is a single-purpose atomic tool — `Translate this`, `Generate image from prompt`, `Capture region of screen`. It sits on the keyboard, the user can press it directly, but its real power is being reusable by …

3. **functional keycap** = a *finished product* (car / desk / chair). It's a higher-order keycap that orchestrates several base keycaps + adds business context. Example shape: "Take this meeting recording → transcribe → extract action items → post to Feishu Tasks" is one functional keycap; it consumes the base keycaps `audio.transcribe`, `text.extract-actions`, `feishu.post-task`.

The framing is consistent with the existing memory `decision_keycap_base_vs_functional_layer` (2026-05-23) which had a two-layer model (`base substrate` + `functional keycap`); bao's clarification today inserts the middle layer that the old memory was missing.

## 2. Reclassification table — what we have today

Reading the codebase (`src-tauri/src/commands/*.rs`, `src-tauri/src/kernel/*.rs`, `packages/ctrl-web/src/components/manifest/registry.ts`, `seed_keycaps()` in `kernel.rs`) and the spec `keycap-base-layer/spec.md` v0.1.0:

### 底座 (substrate — no UI, consumed by Irisy + workbench + keycaps)

| # | Substrate | Form | Status |
|---|---|---|---|
| S1 | Vault (markdown + FTS5 + sidecar) | `vault.*` Tauri commands; `src-tauri/src/kernel/vault.rs` + `vault_index.rs` | ✅ |
| S2 | LocalStorage / Cache (per-keycap KV + LRU blob) | `localstorage.*` + `cache.*`; `kernel/local_storage.rs` + `cache.rs` | ✅ |
| S3 | LLM gateway — text.chat | `chat_stream`; `kernel/llm_port.rs` + `llm_adapters/` | ✅ |
| S4 | LLM gateway — image.generate (Volc) | `kernel/llm_adapters/volc.rs` | ✅ |
| S5 | LLM gateway — image.{ocr, edit} + audio.{tts, stt} | (gaps G3–G6 in spec v0.1.0) | ❌ |
| S6 | Clipboard | (gap G7) | ❌ |
| S7 | Screen capture | (gap G8) | ❌ |
| S8 | Shell.open (URL scheme + path) | (gap G9) | ❌ |
| S9 | MCP host (CTRL hosting keycap = MCP server) | `kernel/mcp_host.rs` + `mcp_server.rs` | ✅ |
| S10 | MCP client (CTRL calling external MCP server) | (gap G2; new) | ❌ |
| S11 | ST-SS bridge (Cell/Op stream @ :17872) | `kernel/stss_bridge.rs` + `stss.*` commands | ✅ |
| S12 | Capability broker (permission gating) | `kernel/capability.rs` + `capability_resolver.rs` | ✅ |
| S13 | Keychain (BYOK secret store) | `keychain.*` commands; macOS Security framework | ✅ |
| S14 | hermes-agent runtime + plugin bridge | `irisy_init` / `irisy_chat_hermes` / `irisy_upgrade_hermes` | ✅ |
| S15 | VMark integration (lazy install + URL scheme + sidecar MCP server) | (gap G1; new) | ❌ |
| S16 | Mesh sync (cross-device, ADR-003) | spec phase | 🚧 |
| S17 | Code Space subprocess + PTY | `kernel/subprocess_actor.rs` + `kernel/subprocess_stss_adapter.rs` | ✅ |
| S18 | Composition runtime (linear flow + var interpolation) | `kernel/composition.rs` | ✅ |
| S19 | Prompt registry (template + persona + few-shot + hermes-skill bridge) | (G10; new) | ❌ |
| S20 | Image library index (sidecar metadata for vault images) | (G11.c; new) | ❌ |

Note on bao's "VMark provides html/md/json + 知识库 + 图片管理": this is **one external program** (VMark.app) that internally provides 3+ capabilities. From CTRL's substrate POV it's a single MCP-client surface (S15) — but the **user-visible capabilities** VMark contributes are:
- file-format rendering (html / md / json viewers via VMark's content-type viewer registry)
- knowledge-base navigation (VMark's vault tree + backlinks)
- image library (VMark's image inventory)

CTRL doesn't re-implement these; it delegates to VMark when the user has chosen to install. The substrate is "MCP client wire to VMark" — singular. The capabilities behind that wire are VMark's domain. *Open question: do we model each VMark-provided capability as a separate substrate in our list, or as feature-flags on S15? Probably the latter for simplicity, but flag for future research.*

### base keycap (single-purpose, atomic, presses-as-tool)

| # | Base keycap | Consumes | Status today |
|---|---|---|---|
| B1 | Translate (`ctrl.text.translate`) | text.chat | ✅ ready |
| B2 | Quick Ask | text.chat | ✅ ready |
| B3 | Clipboard AI (process clipboard → text.chat → write back) | clipboard + text.chat | needs S6 |
| B4 | Generate Image (prompt → image) | image.generate | ✅ Poster validates |
| B5 | Poster | image.generate + template | ✅ shipped |
| B6 | OCR | screen.capture + image.ocr | needs S5 + S7 |
| B7 | Speak (TTS) | audio.tts | needs S5 |
| B8 | Transcribe (STT) | vault.read + audio.stt | needs S5 |
| B9 | Mermaid Diagram | text.chat + vault.write | ✅ ready |
| B10 | New Note | vault.write | ✅ ready |
| B11 | Search Vault | vault.search | ✅ ready |
| B12 | Open Vault Folder | shell.open_path | needs S8 |
| B13 | Clip to Vault | clipboard + vault.write | needs S6 |
| B14 | Screen Capture (region → vault) | screen.capture + vault.write | needs S7 |
| B15 | Open in VMark | shell.open_path + VMark URL scheme | needs S15 + S8 |
| B16 | Insert at VMark cursor | mcp.client.call (VMark sidecar) + text.chat | needs S10 + S15 |
| B17 | Code Space (open coding tile) | ST-SS + subprocess + PTY | 🚧 in_progress |

Spec v0.1.0 § 4 listed these as "functional keycap". Per bao's clarification today they are **base keycaps** — each is a single atomic action, reusable across many functional keycaps.

### functional keycap — the v1 corpus is empty

I cannot find a single example in the codebase today. The 16 + 4 things in `seed_keycaps()` + manifest registry are all base keycaps by the new definition.

Hypothetical examples (not built, sketched here for boundary-testing):

| F# | Functional keycap | Composes which base keycaps + sources |
|---|---|---|
| F1 | "Meeting notes → action items → Feishu Tasks" | B8 (Transcribe) → B# (text.extract-actions, base keycap not yet defined) → feishu.post-task (3rd-party MCP keycap) |
| F2 | "Customer email translate → draft reply" | B1 (Translate) → B2 (Quick Ask, with reply-draft prompt) → vault.write (via S1) |
| F3 | "Screenshot → OCR → translate → save to vault" | B14 (Screen Capture) → B6 (OCR) → B1 (Translate) → B10 (New Note) |
| F4 | "Daily journal — collect today's clipboard history + screenshots, generate summary" | B13 (Clip to Vault, multiple invocations during day) → B# (vault.list-today base keycap) → text.chat |
| F5 | "Weibo thread → pull thread → translate → archive as vault note" | network.http (S?) → B1 → B10 |

Patterns I see in the sketches:
- Functional keycaps **always** chain ≥2 base keycaps OR a base keycap + a 3rd-party-source keycap.
- Functional keycaps have **business context** (a specific platform / role / domain) that base keycaps don't.
- Functional keycaps may have **state** (multi-step, conversational, can resume) — base keycaps are one-shot.

## 3. Boundary heuristics — what makes X a base keycap vs functional keycap?

Working list, not authoritative yet.

| Test | base keycap | functional keycap |
|---|---|---|
| Number of distinct *capabilities* consumed | 1–2 substrate calls | ≥2 base keycaps composed |
| Reusability | Many functional keycaps could use it | Specific to one user workflow / platform |
| Has the word "to" or "into" in the natural name | usually no (`Translate`, `OCR`) | usually yes (`Email → Translate → Reply`) |
| User mental model | "I want to do X to this" | "I want to accomplish business outcome Y" |
| Time horizon | One-shot, returns immediately | Spans seconds-to-hours; may suspend |
| Output | A single artifact (text / image / file) | A multi-step trace, possibly with external side effects (posted, sent, filed) |

Counter-examples (things that break the heuristic):

- "Poster" — composes (text prompt → image.generate → template overlay → vault.write). It chains 3 substrates. By the "≥2 base keycap composition" rule it should be functional, but it has no business context and feels atomic to the user. So the boundary is **business context + reusability**, not raw chain length.
- "Code Space" — opens a PTY, hosts a long-running editor. Has state (the running shell). But there's no business context — it's a base tool. So **state** alone doesn't make something functional.

Refined heuristic: **functional keycap = base keycap composition + business/platform context**. Without business context, even long chains stay base.

## 4. Where VMark fits, broken down

bao said VMark provides "html / md / json 文件的支持，知识库的管理，图片管理". Cross-referencing with VMark's actual feature set:

- **html viewer + md viewer + json viewer**: VMark renders these content types when CTRL invokes `vmark://open?path=...`. CTRL's substrate (S15) is the install + URL scheme; the renderers are VMark-internal.
- **知识库 manager**: VMark has a vault tree, backlinks, tag index. CTRL doesn't need its own — when the user wants this, CTRL forwards to VMark.
- **image library**: VMark has an image inventory grid. *This overlaps with our planned S20 / G11* — should CTRL build its own image library (G11) or rely on VMark's? If user hasn't installed VMark, they need a fallback. So G11 is a **CTRL-native fallback** for users without VMark; if VMark is installed, the "Open Image Library" base keycap may forward to VMark instead.

Action: **two substrates, not one**. S20 (CTRL-native image library) is the floor; S15 (VMark wire) is an optional upgrade. The "Open Image Library" base keycap routes to whichever is available.

Tentative routing:
```
B-image-library (base keycap)
  → if VMark installed && user prefers VMark: shell.open("vmark://images")
  → else: open PWA /library/images route (uses S20)
```

This is the first concrete case where a base keycap has **a fallback chain** based on substrate availability. Worth pattern-locking as a general rule: base keycaps that have a "preferred external substrate" should specify a fallback `routing` array in their manifest.

## 5. Open questions (collect, don't try to answer yet)

1. **Does each base keycap need its own MCP-server registration?** Per `decision_keycap_is_mcp_server_only` memory, all keycaps register as MCP servers. Does this still hold for base keycaps that are tiny wrappers (like `B10 New Note` = single `vault.write` call)? Or do tiny base keycaps stay as direct kernel command invocations, with MCP only used by larger / 3rd-party keycaps?
2. **How does Irisy address base keycaps?** Irisy is the user's AI companion. When the user types "translate this", Irisy invokes B1 directly. When the user types "draft a reply to this email in Chinese", Irisy needs to know F2 doesn't exist yet, but can be composed from B1 + B2. Does Irisy have planning capability for composing base keycaps into ad-hoc functional flows? Or do functional keycaps need to be **pre-defined manifests**?
3. **Is a hermes skill a base keycap or a functional keycap?** Hermes skills can be either small tools (= base keycap) or large multi-step agents (= functional keycap). Probably both, with `target: 'hermes-skill'` and a `composition: 'atomic' | 'workflow'` flag in the manifest.
4. **What about 3rd-party platform keycaps (Feishu / Notion / Linear)?** A keycap that posts a message to Feishu — is that base or functional? It's a single API call (atomic), but it has a specific platform context. By the heuristic in §3 it's **base** (atomic, reusable). The functional layer composes Feishu-post with translate, summarize, etc.
5. **Where do "data normalizer" keycaps fit?** E.g., "extract action items from text" is a primitive that several functional keycaps would compose. It feels like a base keycap, but it's not in the 16 + 4 v1 corpus. Add as B# when first functional consumer needs it.
6. **How does the keyboard surface display these?** If base keycaps are the "wheels and screws", does the user see all 17 of them on the keyboard, or only the most-used? And functional keycaps — do they live on the same surface or in a "workflows" panel?
7. **Composition runtime (S18) already exists.** It does linear flow + var interpolation. Is this the natural substrate for functional keycap execution? Probably yes — a functional keycap's manifest declares a linear sequence of base keycap invocations, the composition runtime walks it.

## 6. Boundary test — 5 ambiguous items, classified

Pressure-test the framing by classifying 5 things I'm not sure about.

| Candidate | My classification | Reasoning |
|---|---|---|
| **"Send to Feishu chat" keycap** | base keycap | Single atomic API call. Has platform context but no orchestration. |
| **"Summarize today's clipboard activity"** | functional keycap | Composes (B13 history query → text.chat summarize → B10 new note). Has business context ("today's activity"). |
| **"Open coding companion (Code Space)"** | base keycap | Atomic action, opens a PTY. Reusable across many flows ("debug this", "show me the diff", etc. are functional keycaps that compose Code Space). |
| **"Daily standup writer"** | functional keycap | Multi-step (read yesterday's commits → summarize → format for standup → push to Feishu). Business workflow context. |
| **"Read clipboard"** | substrate (底座), not keycap | Pure capability, no UI of its own. Many base keycaps consume it (B3, B13). |

This run feels consistent with §3's heuristics. The hardest distinction is between a thin-base-keycap (single platform call) and a one-call functional keycap. I'm landing on: if the user could write it down as "do X" without "to" / "into" / "then" — it's base.

## 7. Action items (for me, future sessions)

These are research follow-ups, not implementation tasks. Listed in the order I'd visit them.

1. **Re-read VMark's actual MCP server tool surface** (`@vmark/mcp-server` npm package) — confirm what tools it exposes; refine the §4 split between "S15 substrate" vs "VMark-provided capabilities".
2. **Read hermes skills documentation** — confirm whether a hermes skill maps to base keycap, functional keycap, or both.
3. **Survey 5–10 hypothetical functional keycaps** that bao + creators might want by end of v1 / start of v1.1 — see if the framing supports them; flag mis-classifications.
4. **Inventory 3rd-party platform integrations** (Feishu / Notion / Linear / Slack / etc.) — each is one base keycap per atomic platform action; map at least 3 platforms.
5. **Write a §6 follow-up doc** with the keyboard / pool surface implications — does the user see substrate? No. Base keycaps? Probably yes by default. Functional keycaps? In a separate panel?
6. **Reconcile with `decision_keycap_base_vs_functional_layer` memory** — the memory's "Functional 层" section lists base keycaps under the wrong label. Update the memory to reflect three layers, citing this research note.
7. **Re-do spec keycap-base-layer §3 + §4 + §6** with the three-layer split — but only after the framing settles; not now.

---

## 8. User-facing three-block model (bao 2026-05-23 reframe — new entry point)

### Block 1 — 底座 + base keycap

User-visible part: base keycaps on the keyboard.
User-invisible part: substrate (the kernel capability namespaces + external substrates like VMark / hermes / ST-SS).

Flexibility surface:

| Axis | Today | Open |
|---|---|---|
| Install / uninstall base keycap | manifest registry; `install_keycap` / `uninstall_keycap` shipped (PR #35) | Are non-builtin base keycaps user-installable from a marketplace? `install_keycap_from_mcp` exists — what's the discovery UX? |
| Adjust an installed base keycap | 3-tier model per memory `decision_keycap_3_tier_adjustment` — **Config** (fill schema fields), **Patch** (override layer, cherry-pick upstream), **Fork** (independent) | Patch layer / Fork tooling not implemented yet |
| Switch substrate provider (BYOK) | text.chat / image.generate route through `kernel/llm_port.rs` — provider preference at config level | Per-keycap override? Per-capability override? Currently global. |
| Create a new base keycap | Irisy assist via manifest writing — partial | Does the keycap creator UI exist? Where does it live (Pool? `/irisy` route? new `/creator` route?) |
| Compose base keycaps into functional flow | composition runtime ships (`kernel/composition.rs`); linear flow + var interpolation | Functional keycap manifest schema NOT YET DESIGNED. This is the v1.1 boundary. |

### Block 2 — UX / UI

The user's keyboard + workspace + sub-panel + mascot live here.

Flexibility surface:

| Axis | Today | Open |
|---|---|---|
| Keyboard layout (slots × positions) | Daedalus shipped TabBar + RightRail sub-panel (pwa-dev 9683087); keyboard is left grid, sub-panel slides out | User-reorderable? Sticky favorites? Per-context (work / writing / video) layouts? |
| Workspace area (right pane) | DefaultWorkspace = mascot + greeting + ChatInput; keycap workspace = per-keycap UI | Multi-tab IDE-style workspace (memory `decision_pwa_two_panel_layout`) — when does this ship? Tab persistence across launches? |
| Sub-panel content | History list (chat sessions); each route can register via `useRailSubPanel` | Can a base keycap claim the sub-panel for context? E.g., OCR keycap could show "OCR history" in sub-panel |
| Mascot (IrisyMascot) | dotLottie, 6-state machine, brand theme via tokens (commit 28d6873 + 9683087) | Size, position, persona toggle? Per memory `decision_one_persona_irisy` no persona switching — but mood + style might still be adjustable. |
| Theme | OKLCh brand theme; dark / light / manual toggle | User-pickable palette? Per-keycap accent color (already supported by manifest `keycap_color` field) extending to overall theme? |
| Hotkeys | `Ctrl` summon (lone-tap detector); no other hotkeys exposed | Per-keycap hotkey? Modifier+letter for top-5 favorites? |
| Window placement | Single floating window, 920×560 default | Multi-window for workspaces (already shipped via `open_workspace` command)? Window snap / pin / always-on-top toggle (already shipped but bao turned off)? |
| First-run + onboarding | First-launch detection (`is_first_launch`); AX prompt | Game-style first-run prompt for optional assets — Q4 from spec, no impl yet |

### Block 3 — Irisy

The AI companion that lives at `/irisy` route + invisible everywhere else (Irisy-aware actions in ChatInput, RightRail mascot, base keycaps Irisy hints).

Flexibility surface:

| Axis | Today | Open |
|---|---|---|
| Persona | Single — Irisy (memory `decision_one_persona_irisy`); specialists Janus/Talos/Mnemosyne are internal modes | Can power users override the persona prompt? (Maps to S19 prompt registry.) Does Irisy's tone adapt to user role? |
| Discovery of base keycaps | manifest registry; `list_keycaps`, `mcp_call`, `read_keycap_manifest` shipped | Does Irisy reason about what's installed when answering? "I can do X with the OCR keycap you have" vs guessing? |
| Orchestration | hermes-agent path (`irisy_chat_hermes`) + simple `chat_stream` for non-tool turns; one-click hermes upgrade per session 2105c1c+0c4dcb4 | When does Irisy chain base keycaps autonomously vs ask the user? Functional-keycap composition by Irisy not yet wired |
| Active vs passive | Currently passive — Irisy waits for the user to type in ChatInput | bao memory `decision_irisy_keycap_lifecycle`: Irisy spans 8 lifecycle stages (Discovery / Creation / Config / Invoke / Collab / Debug / Improvement / Retire). Most stages still mute. |
| Memory (user-side, not the auto-memory I have) | `kernel/persistence.rs` event log; `query` / `read_log` / `append_event` commands ship | Does Irisy reference past conversations naturally? Cross-session? Cross-device (mesh)? |
| Subprocess wire (hermes / claude-code / cursor-cli) | hermes-agent integrated; Code Space hosts subprocess for coding companion | Multi-subprocess (Irisy + Code Space + a Python REPL all at once)? Subprocess discovery beyond hermes? |

### Block 2-3 coupling — examples of where flexibility decisions interact

- **Mascot mood ↔ Irisy state**: IconRenderer §3.4 state machine drives mood from `irisyState` prop. The Irisy state machine on the AI side (idle / thinking / happy / sleeping) needs to be the source. Today: the `thinking` mood fires when `chat_stream` is streaming — works for chat, not for non-chat Irisy actions (e.g., orchestrating a base keycap chain).
- **Base keycap → sub-panel**: when the user presses OCR, the sub-panel could show OCR's recent results. The sub-panel API (`useRailSubPanel`) is per-route. Does each keycap workspace also register a sub-panel? Need a coupling rule.
- **Irisy suggests a base keycap → user clicks → workspace opens**: requires Irisy to know which base keycap is right, the keyboard to highlight it, and the workspace to open with the right context. Three blocks talking. Today: Irisy can describe but not directly invoke + highlight + open. This is the killer demo we don't have yet.
- **Theme change ↔ mascot color**: 28d6873 wired brand OKLCh into dotLottie themeData. When bao changes theme via Settings, mascot recolors. Coupling already clean — good template.
- **Hotkey → workspace tab focus**: if the user is in workspace with 3 tabs (a coming UX), `Ctrl` should focus CTRL window AND restore last-active tab. Doesn't exist yet; the hotkey just toggles visible/hidden.

### Coupling-seam inventory (incomplete — will append as I find more)

| # | Seam | Block A | Block B | Today | Risk |
|---|---|---|---|---|---|
| K1 | Mascot mood ← Irisy state | UX | Irisy | wired for chat-stream only | Non-chat Irisy actions don't update mood |
| K2 | Sub-panel ← base keycap context | base | UX | not implemented | Sub-panel feels under-utilized; per-keycap context is the obvious fill |
| K3 | Keyboard highlight ← Irisy suggestion | base | UX + Irisy | not implemented | "Killer demo" is blocked on this seam |
| K4 | Base keycap registration → Irisy discovery | base | Irisy | manifest registry exists; Irisy uses `list_keycaps` | Irisy needs to also consult `list_mcp_servers` for external + `read_keycap_manifest` for config schema; partial |
| K5 | Theme tokens → mascot + base keycap accents | UX intra-coupling | — | wired (OKLCh tokens flow to keycap_color + mascot themeData) | Solid template for future block-intra coupling |
| K6 | Hotkey → workspace tab restore | UX intra | — | Ctrl just toggles window; no tab state | Coming when multi-tab workspace ships |
| K7 | Functional-keycap composition → base keycap orchestration | base intra | — | composition runtime ships, no functional keycap manifest schema | Decides whether Irisy composes ad-hoc OR functional keycaps are pre-defined static manifests |
| K8 | First-run prompt (assets) ← Block 1 substrate status | base | UX | not impl | Q4 from spec; needs cross-block hand-off (substrate decides what to prompt, UX renders, Irisy explains) |

### Research direction (what I do next, in this doc + the next)

1. **Block 1 deep dive** — already started (sections 2-6 above). Need to finish: marketplace install UX, patch / fork tooling design.
2. **Block 2 deep dive** (`01-ux-flexibility.md` next file) — map every UI surface, list current rigid points + cheap-to-flex points + expensive-to-flex points. Crystal clear: what can a user customize today, what could they tomorrow, what's never going to be flexible.
3. **Block 3 deep dive** (`02-irisy-flexibility.md`) — based on memory `decision_irisy_keycap_lifecycle` 8-stage lifecycle, audit which stages are wired today and what flexibility each affords the user.
4. **Coupling matrix** (`03-coupling-seams.md`) — extend the K1-K8 list to all pairs; for each, write a one-page "today / target / risk" note.
5. **Reconcile-with-spec pass** — once blocks are mapped, revisit `keycap-base-layer/spec.md` v0.1.0 and see if §6 ownership matrix already accounts for cross-block work or if it's mostly Block 1.

This research doc is the **front door** — once the four blocks (1, 2, 3, coupling) are mapped, an updated spec will follow, not the other way around.

## 9. Re-reframe (bao 2026-05-23 #2): "flexibility" = production-material supply for creators

§8 walked in the wrong door. bao corrected:

> 我说的灵活性是用户工作台做keycap的时候，要用到的生产原料来源

The "three blocks" aren't three system surfaces with their own settings panels. They are **three suppliers of production materials** for a user who's *making a keycap inside the workshop*.

**The workshop framing** (memory `decision_ctrl_is_ai_workshop_not_chat` + `decision_ctrl_is_hermes_workbench`):

- CTRL is a workshop. The user is a craftsperson.
- "Making a keycap" (whether base or functional) is the primary creative act in this workshop.
- The three blocks each ship raw material to that act.
- "Flexibility" = the variety, accessibility, and composability of materials the user can grab.

This is **creator-flexibility**, not **user-config-flexibility**. The user-config angle I drafted in §8 is a side question, useful but secondary.

### Block 1 (底座 + base keycap) as a material supplier

What it ships into a new-keycap build:

| Material | What user grabs | Today |
|---|---|---|
| **Existing base keycap (drop-in)** | A finished tool to embed as a step. e.g., "my new keycap calls Translate, then writes to vault" | Manifest can reference other keycap IDs; `composition.rs` runtime walks linear chains. Schema for "this keycap composes that keycap" is partial. |
| **Raw substrate capability** | Direct `text.chat` / `image.generate` / `clipboard.read` / `vault.write` calls without going through another base keycap | Capability invocation via Tauri commands + MCP host; capability broker gates per manifest declaration |
| **Manifest template** | A starting JSON / TS scaffold to copy and edit | seed_keycaps in `kernel.rs` + manifest registry give 5 builtins as implicit templates; no explicit "duplicate this manifest" UX |
| **Prompt fragments** | Reusable system-prompt / few-shot chunks | G10 (Prompt substrate) not yet built; prompts currently inlined in Rust code or per-keycap |
| **Icon + visual identity** | A glyph / lottie / color for the new keycap | `keycap_color` palette (cobalt/amber/jade/platinum/graphite); IconRenderer renders svg/lottie/dotlottie at 28/48/180 px; user has no asset library to pick from yet |

Gaps that block creator velocity:
- No **"composes-this-keycap"** field in manifest schema → can't easily reference another base keycap as a step
- No **prompt fragment library** (G10) → every new LLM keycap re-writes system prompt
- No **icon library** → every new keycap improvises a glyph; brand consistency suffers
- No **provenance / lineage** → if I fork a base keycap, the original can't push updates (memory `decision_keycap_3_tier_adjustment` Config / Patch / Fork) — Patch + Fork tooling not built

### Block 2 (UX / UI) as a material supplier

What it ships:

| Material | What user grabs | Today |
|---|---|---|
| **Workspace render mode** | "When my keycap runs, the right pane should show: a chat / a form / a single-button / a custom HTML / a code editor" | Workspace tab type registry (renderer enum) per `decision_pwa_two_panel_layout` — partially implemented; renderer set unbounded today |
| **UI primitives** | ChatInput, KeycapCard, IconRenderer, IrisyMascot, Sparkline, Gauge, Led — drop-in React components | Shipped in `packages/ctrl-web/src/components/primitives/`; addressable by name in manifest? **No** — manifest doesn't currently reference primitives |
| **Brand tokens** | OKLCh palette (cobalt / amber / jade / platinum / graphite + dark/light variants); spacing scale; type scale; motion easing | Live in `tokens.css`; flow through to IconRenderer themeData (commit 28d6873) — auto-pickup for primitive-built UI |
| **Animation kit** | dotLottie state machines (idle / thinking / happy / sleeping); reduce-motion gate; pulse on LIVE | Shipped per SKILL.md §3.4 / §4.3; manifest can pick lottie src + state machine ID |
| **Layout building blocks** | Left keyboard / right workspace / sub-panel — the 2-zone shell | Shipped; new keycap's workspace renders into the right zone, sub-panel is optional via `useRailSubPanel` |
| **Sub-panel templates** | A history-list / a config-form / a contextual-help drawer the keycap can claim while active | History list primitive shipped; config-form + contextual-help templates not built |

Gaps:
- **Manifest can't address UI primitives by name** — a keycap manifest defines `workspace: { ui: 'none' | 'sample' }` today; needs a `workspace: { primitive: 'chat' | 'form-renderer' | 'image-grid' | ... }` field
- **No "custom HTML"** escape hatch — keycaps locked to manifest-defined renderers; advanced creators want React+TS workspace
- **Asset catalog** (icons / illustrations / lottie packs) doesn't exist as a thing creators browse

### Block 3 (Irisy) as a material supplier

What it ships:

| Material | What user grabs | Today |
|---|---|---|
| **Manifest writer** | "I want a keycap that translates clipboard to English and pastes back" → Irisy emits a manifest | Concept exists; not implemented as a dedicated UI flow. Today: user types into ChatInput, Irisy answers in prose, no manifest-emit step |
| **Prompt designer** | Irisy crafts the system prompt + few-shots given user intent | Same — conceptual, not wired |
| **Composition reasoner** | "Chain Translate → New Note" — Irisy figures out the linear flow, fills the var-passing | Composition runtime exists; Irisy doesn't yet plan against installed base keycaps |
| **Skill knowledge base** | Drop-in hermes skill templates (when target=hermes-skill) | hermes integration ships; skill discovery via agentskills.io is upstream — CTRL doesn't yet expose a "browse skills" surface |
| **Debugging companion** | User runs new keycap → it errors → Irisy reads trace + suggests fix | Not implemented |
| **Suggestion / dedup** | "You're trying to build X — but Y already exists, want to fork?" | Not implemented; would need Irisy to read manifest registry + match intent |
| **8-stage lifecycle hand-off** | Discovery / Creation / Config / Invoke / Collab / Debug / Improvement / Retire (memory `decision_irisy_keycap_lifecycle`) | Stage entry-points are sketched in spec; only Invoke + partial Collab wired today |

Gaps:
- **No creator UI route** — there's no `/creator` or `/forge` page where you sit down to make a keycap. User has nowhere to start the build process.
- **No Irisy-emits-manifest contract** — Irisy can't yet write `keycap.json` files; LLM output → manifest validation → save is not a flow.
- **No keycap test harness in PWA** — to iterate, a creator needs "run this draft keycap once, see the output, refine".

### Cross-block material seams — where two suppliers must agree

These are the coupling seams from the §8 K-list, re-read through the creator-material lens. A new seam list:

| # | Seam | Block A supplies | Block B supplies | Today |
|---|---|---|---|---|
| M1 | Composes-this-keycap reference | Block 1 — the referenced base keycap's manifest + capabilities | Block 3 — Irisy resolves the chain at design-time | Composition runtime ships; design-time chain auth not |
| M2 | Manifest's UI primitive picker | Block 1 — manifest schema field for "workspace primitive name" | Block 2 — the registered primitive set | Schema field missing; primitives unaddressed |
| M3 | Prompt registry → Irisy's pen | Block 1 — G10 prompt fragments | Block 3 — Irisy reads them when authoring | Both blocks gap |
| M4 | Icon picker | Block 2 — asset catalog | Block 3 — Irisy suggests an icon by keycap intent | No catalog, no suggester |
| M5 | Creator workspace render | Block 2 — `/creator` route + drag-drop / form / chat UI | Block 1 — manifest schema being built | Doesn't exist |
| M6 | Live test harness | Block 1 — kernel runs draft manifest sandboxed | Block 2 — workspace shows result + tweak | Doesn't exist |
| M7 | Forks lineage | Block 1 — manifest provenance pointer + diff | Block 3 — Irisy explains upstream changes | Doesn't exist |
| M8 | Marketplace browse | Block 1 — manifest registry + MCP marketplace | Block 2 — Pool surface | Pool exists per memory `project_keyboard_vs_pool`; marketplace browse partial |

### Concrete next research moves (creator-flexibility lens)

1. **Pick 3 ambition cases** (real creators' first 3 keycap they'd build), trace what each supplier needs to ship for the build to feel effortless. Candidates: (a) "Daily journal — summarize my clipboard + screenshots into one note", (b) "Translate Feishu messages I receive into English", (c) "Generate a poster from a tweet". For each, list the material draw from each block + the seams that fire.
2. **Workshop UX surface** — where is the user when they say "make a new keycap"? The `/irisy` route? A new `/forge`? A modal? Map 3 candidate UIs.
3. **Manifest schema audit** — what fields exist today (`@ctrl/keycap-sdk/src/manifest-schema.ts` was just added on keycap-dev) and what fields the creator-supplier model requires.
4. **Test-harness shape** — what's the minimum loop for "edit manifest → run → see output → refine"? Hot reload? Save + invoke? Sandbox vs real?
5. **Irisy-emits-manifest protocol** — what does the LLM call look like? Tool call with `propose_manifest` schema? Free-form JSON + validation? Mixed dialogue?

These are the doors to walk through, in order. Sections 2-7 (Block 1 internal layering) and §8 (system-block flexibility) stay as background research but are no longer the active surface.

## Changelog

| Date | Author | What |
|---|---|---|
| 2026-05-23 | zeus | Initial framing + inventory + 5-item pressure test. Open. |
| 2026-05-23 | zeus | Add §8 — three-block user-facing model + 8-seam coupling inventory per bao reframe. Sections 2-7 retained as Block 1 sub-research. |
| 2026-05-23 | zeus | Add §9 — creator-flexibility re-reframe per bao. The three blocks are now **suppliers of production materials**, not config surfaces. §8 retained for history. New 8-seam M-list (M1-M8) frames what cross-block agreements the creator needs. Next 5 research moves listed at bottom. |
