# Workshop UX — research note 01

> Author: zeus · Status: open research, not a spec · Continued from `00-framing-and-inventory.md` §9.
> Goal: figure out **where the user stands** when they say "I want to make a keycap" — what surface they're on, what they see, what the first 30 seconds feel like. The §9 material-supplier framing (底座+base keycap / UX-UI / Irisy each ship raw material) only becomes concrete once the creator's surface is pinned. This doc explores 5 candidate shapes; doesn't decide yet.

---

## 1. The first-30-seconds constraint

Whatever the workshop looks like, the user must reach **first successful keycap** in roughly half a minute. Definition of "successful": new keycap shows up in the keyboard, pressing it actually does the thing the user wanted, and the user understands why it works.

If that loop takes longer, the workshop loses to:
- Asking Irisy to do the thing once (no keycap saved — costs the user nothing to retry).
- Copying a sibling base keycap's manifest by hand (advanced creators).
- Just not bothering — most creators are not professional developers.

Sub-constraints derived from CTRL philosophy / memory:
- **One-shot, not wizard** (CLAUDE.md philosophy #4). Workshop must avoid the multi-step dialog tree pattern.
- **User never writes JSON unless they want to** (CLAUDE.md keycap manifest section). Authoring is conversational + form-driven; JSON is an escape hatch.
- **AI is pipe, not sidebar** (philosophy #5). Irisy doesn't ride in a sidebar separate from the workshop — Irisy IS the workshop's animating intelligence.
- **Local-first, vim test** (philosophy meta). The saved manifest must be a markdown / YAML / JSON file under the user's vault or `~/.ctrl/keycaps/`, readable in vim, diffable in git.

---

## 2. The 8-stage lifecycle, focused on Creation (memory `decision_irisy_keycap_lifecycle`)

Irisy spans Discovery / **Creation** / Config / Invoke / Collab / Debug / Improvement / Retire. The workshop is the Creation surface; it must also smoothly hand off to Config (refine an existing keycap), Debug (a keycap is misbehaving), and Improvement (user wants v2).

Realistic Creation flow:

1. **Trigger** — user has a felt need ("I'm tired of copy-pasting to a translator"). They press the Ctrl summon, are now staring at CTRL.
2. **Surface entry** — they navigate to the workshop somehow. This is what we're designing.
3. **Intent capture** — they describe what they want. In natural language, ideally — they don't know which substrate to call.
4. **Material assembly** — Irisy + the workshop reach into the three suppliers and assemble: a manifest skeleton, a renderer pick, a prompt, an icon.
5. **Preview / test** — the user sees a draft running. They tweak the prompt or the icon or the input.
6. **Commit** — keycap saves to `~/.ctrl/keycaps/<id>/manifest.json` (or vault, TBD), appears in keyboard.

Stages 1, 4, 5, 6 are well-defined infrastructure questions. **Stage 2 is the workshop's UX-surface choice. Stage 3 is the workshop's intent-capture UI.** Those two are the explore-space.

---

## 3. The five candidate shapes

For each shape: where it lives, what the user sees, what's pre-built that supports it, the killer pro, the killer con, and how it integrates Irisy.

### Shape A — Pure Irisy chat (the `/irisy` route is the workshop)

**Where**: today's `/irisy` route, no new surface. The user types "I want a keycap that translates clipboard and pastes back". Irisy interviews briefly ("which direction by default? where should it paste — clipboard, vault, or both?") and emits a manifest. The workshop is the chat transcript.

**Pre-built**: `IrisyChat`, `chat_stream`, `irisy_chat_hermes`, sub-panel. Nothing new on the UI side.

**Killer pro**: zero surface to learn. Same place the user already chats with Irisy. Reuses existing infrastructure.

**Killer con**: hard to **preview** a half-built keycap inside a chat bubble. You can show a fake keycap card image, but the user can't *press it* and feel it run. Live-test loop is awkward — chat is sequential, the workshop loop is iterative.

**Irisy role**: total. Irisy is the workshop. The user never touches a form.

**8-stage hand-off**: Creation → Debug works (same chat thread). Improvement (v2) means going back to the chat history, which is fine for short-lived edits but bad for big refactors.

### Shape B — Dedicated `/forge` route (workshop as a standalone room)

**Where**: new top-level route `/forge` (or `/workshop`, `/creator`, naming TBD). User navigates here. Layout: left = parts shelf (existing base keycaps + substrate capabilities, draggable), center = canvas (the keycap being assembled), right = preview pane (live test). Irisy lives as an inline chat strip at the bottom or as a floating helper.

**Pre-built**: TanStack Router supports adding the route trivially. Sub-panel pattern (`useRailSubPanel`) gives a precedent for left-shelf interaction. IconRenderer is already a ready primitive for the parts shelf.

**Killer pro**: full power for advanced creators. Sit-down build experience, visual composition, see your keycap take shape spatially.

**Killer con**: another surface for the user to learn. CTRL's whole identity is "no workflow editor" (memory `What CTRL is NOT`: Workflow editor — Coze / n8n 已经做了). Building `/forge` risks crossing that line.

**Irisy role**: assistant. Irisy explains, suggests, autofills — but the user holds the mouse. Probably bottom-of-screen chat strip + inline tooltips on the canvas.

**8-stage hand-off**: dedicated room, clean handoffs. Creation lives here; Config = re-open this keycap in the same room. Debug = open this keycap with the last-failure transcript loaded.

### Shape C — Workspace-tab creator (the right pane becomes a creator)

**Where**: inside the existing keyboard + workspace 2-panel layout. The user clicks "+" on the keyboard (or types `/new` in Irisy). The right workspace pane switches to creator mode — like a special "keycap" that builds a new keycap. Sub-panel may show "your drafts" list.

**Pre-built**: 2-panel layout shipped; workspace tab registry being built per `decision_pwa_two_panel_layout`. Sub-panel API ready.

**Killer pro**: lives in the user's current surface. No navigation cost. The keyboard is still visible — the user can press another keycap mid-creation to peek at how a sibling looks.

**Killer con**: real estate. The workspace pane is 600px-ish wide. A drag-drop part shelf + canvas + preview is cramped. Possibly solved by sub-panel taking the "parts shelf" role.

**Irisy role**: speaks via ChatInput at the bottom of workspace (already there for chat). Same input — Irisy switches modes when in creator workspace.

**8-stage hand-off**: any keycap can open in its workspace tab "in Config mode" (vs Invoke mode), reusing the same creator pane logic. Config / Improvement / Debug all flow through the same surface as Creation, just with different starting state.

### Shape D — Sub-panel creator (the workshop is a drawer)

**Where**: existing right-side sub-panel (`useRailSubPanel`) extends to host a creator form. User clicks "+ new keycap" on the keyboard, sub-panel opens with a 3-question form: "What does this keycap do? What does it produce? What's a good name?". Irisy fills the rest.

**Pre-built**: sub-panel infrastructure ships today. KeycapCard, IconRenderer, ChatInput primitives ready.

**Killer pro**: tightest, fastest first-30-seconds. Three questions, one button. The user never leaves the keyboard view; they see the new keycap pop in next to the existing ones the instant it commits.

**Killer con**: tight surface, less room for advanced power. Power creators outgrow it within a week.

**Irisy role**: writes the manifest behind the form. Refines on subsequent invocations of the same keycap from the keyboard's "Edit" affordance.

**8-stage hand-off**: Creation here is great. Config / Improvement may want to graduate to Shape C or B once the keycap is non-trivial. Sub-panel form has a "more options" link that opens Shape C/B for power users.

### Shape E — Hybrid (Irisy chat starts, hand-off to canvas)

**Where**: user is in `/irisy`, says "I want a keycap that...". Irisy interviews briefly, then says "I'll set this up — let me drop you into the workshop where you can preview and tweak". A canvas opens (Shape B-style room, but contextual — only the materials Irisy already chose are visible). User refines in the visual surface; Irisy stays as a strip.

**Pre-built**: needs Shape B's `/forge` infrastructure AND the Irisy hand-off contract (Irisy → workshop with state).

**Killer pro**: best of both worlds. Natural language onboarding for first-timers, visual refinement for serious work. Matches GPT Builder's pattern (chat → "Configure" tab).

**Killer con**: two surfaces to maintain. Hand-off seam is risky — if the user clicks back into chat mid-edit, do they lose the canvas state?

**Irisy role**: starts as the workshop (in chat), gracefully transitions to assistant (in canvas). Same instance, different posture.

**8-stage hand-off**: Creation = chat → canvas. Config / Improvement = canvas direct, no chat needed unless user explicitly opens it.

---

## 4. Comparative references — friends who've built creator surfaces

| Tool | Surface | Intent capture | Test loop | Notable choice |
|---|---|---|---|---|
| **OpenAI GPT Builder** | Dedicated route in ChatGPT | Two tabs: "Create" (chat) + "Configure" (form). Chat builds the configure tab in real time. | Right pane is a live preview of the GPT chatting with itself / user. | Tab-toggle pattern: same room, two views. Lands close to Shape E. |
| **Coze (字节)** | `/workspace/<bot>` editor | Pure form + drag-drop nodes for workflow agents | Right pane preview, but heavyweight (full bot env). | Wizard-style; CTRL rejects this. Pattern to avoid. |
| **Anthropic Skills (agentskills.io)** | Markdown files in `~/.hermes/skills/<name>/SKILL.md` + assets | User writes markdown directly in editor of choice. No GUI. | Run-in-terminal loop. | Power-users-only; not for the CTRL creator persona. |
| **Raycast Extensions** | Developer flow: TypeScript project + `raycast extensions develop` | None — pure code. | Hot-reload in Raycast itself. | Code-first; not for non-developers. CTRL wants non-developer creators too. |
| **Linear Command Palette / Templates** | In-app modal | Form fields | Single click to use template | Linear's commodity workflow templates are close to "preset functional keycaps". |
| **n8n workflow editor** | Standalone canvas | Drag-drop nodes | Inline test per node + full-flow run | Pure visual; CTRL philosophy rejects "workflow editor" framing. Pattern to avoid framing-wise, but the live-node-test idea is useful. |
| **Notion Database Templates** | Modal flow inside Notion | Form + template picker | Instantiate to a page | Templates are pre-built; creation is just instantiation. Useful for **base keycap fork**, not for full creation. |
| **iOS Shortcuts** | Dedicated app + sheet | Drag-drop blocks | Run-in-app + Share Sheet | Power-user friendly; Apple's curated gallery hides complexity until needed. Close to Shape B but mobile-first. |
| **Make.com / Zapier** | Standalone canvas | Drag-drop + heavy config forms | Per-step test | Workflow editor framing. CTRL avoids. |

Two patterns emerge:
1. **Chat-first, canvas-second** (GPT Builder, iOS Shortcuts intro flow) — for non-developer creators.
2. **Pure code / markdown** (Raycast, agentskills) — for developers.

CTRL targets the **first** group, with an escape hatch for the second (the manifest JSON is editable in vim).

---

## 5. Mapping each shape against the §9 M-seam list

Each candidate shape implies which M-seams (cross-block material agreements) need to exist for the workshop to work. Where the seam is present today, the shape is easier to ship.

| M-seam | Description | Shape A needs | Shape B | Shape C | Shape D | Shape E |
|---|---|---|---|---|---|---|
| **M1** Composes-this-keycap reference | Manifest schema: `composes: [B1, B2]` field | ✓ (Irisy walks the chain through ChatInput) | ✓ (drag-drop on canvas) | ✓ (drag in workspace) | partial (less canvas room) | ✓ (canvas after chat) |
| **M2** Manifest's UI primitive picker | Field for `workspace.primitive: 'chat' / 'form' / 'image-grid'` | (Irisy decides) | (user picks visually) | (user picks visually) | (form field) | (Irisy then user) |
| **M3** Prompt registry → Irisy's pen | G10 prompt fragments + Irisy authors | strongly needed | nice-to-have | nice-to-have | nice-to-have | strongly needed |
| **M4** Icon picker | Asset catalog + Irisy suggester | (Irisy auto-picks) | (gallery on canvas) | (gallery in workspace) | (3 quick options form) | (Irisy then gallery) |
| **M5** Creator workspace render | A surface to BE the workshop | already exists | new `/forge` | new workspace mode | new sub-panel mode | new + handoff |
| **M6** Live test harness | Run draft manifest sandboxed | very awkward in chat | clean (right pane preview) | clean (right preview within workspace) | tight (sub-panel preview) | clean (canvas pane) |
| **M7** Forks lineage | Manifest provenance + diff | hard in chat | clean | clean | tight | clean |
| **M8** Marketplace browse | Pool surface integration | partial (Irisy describes) | embedded shelf | sub-panel | sub-panel | embedded after chat |

Shape A is fastest to ship (zero new surface, all reuse) but weakest on M5 / M6 — the live test loop. Shape B has highest creator power but biggest surface cost. Shape C and D share infrastructure with the existing PWA layout best. Shape E is the OpenAI-style pattern but most complex.

---

## 6. Pressure test — 3 ambition cases through each shape

The cases from §9 conclusion. For each: how easy does Creation feel in each shape? Mark on a 1-5 (5 = effortless).

### Case 1 — "Daily journal: summarize today's clipboard + screenshots into one note"

This functional keycap needs to compose: B13 (Clip to Vault, with date filter) + B14 (Screen Capture history) + Quick Ask (with summarize prompt) + B10 (New Note). State: "today" filter. Multi-step.

| Shape | Score | Why |
|---|---|---|
| A | 2 | Composition through chat is fine but **state-aware "today" filter** is hard to express in plain chat without going circular |
| B | 4 | Drag the 4 base keycaps into a linear flow, set the "today" var. Canvas wins. |
| C | 4 | Same as B, workspace pane handles the canvas |
| D | 2 | Sub-panel too small for a 4-step flow |
| E | 5 | Chat-only first ("I want to summarize my day"), Irisy generates the 4-step skeleton, user refines in canvas |

### Case 2 — "Translate Feishu messages I receive into English"

Needs: a Feishu trigger / poll + B1 Translate + maybe write back to Feishu via reply. Third-party integration heavy.

| Shape | Score | Why |
|---|---|---|
| A | 3 | Chat can ask "what's your Feishu setup", lead to OAuth flow, generate the manifest — but the trigger ("when message arrives") is a non-trivial concept for chat |
| B | 4 | Canvas with "Feishu trigger" node and "Translate" node draws the trigger as a step |
| C | 3 | Same as B but tighter |
| D | 1 | Sub-panel can't hold a trigger setup wizard |
| E | 5 | Chat starts ("I want translation on Feishu"), surfaces OAuth flow → canvas → done |

### Case 3 — "Generate a poster from a tweet"

Needs: B5 Poster + a "pull tweet content" pre-step (single base keycap call). Linear, 2 steps.

| Shape | Score | Why |
|---|---|---|
| A | 4 | Short pipeline, chat handles fine. Irisy picks the right base keycaps, user clicks "save" |
| B | 4 | Canvas works, but feels heavyweight for a 2-step keycap |
| C | 4 | Sweet spot for a 2-step keycap |
| D | 5 | 3-question form is perfect: what's the input (a tweet URL), what's the output (a poster), where do you want it saved (vault). Irisy fills the rest. |
| E | 4 | Hybrid works but unnecessary overhead for 2-step |

### Score totals (informal — these are gut estimates, not measurements)

| Shape | Case 1 | Case 2 | Case 3 | Total | Notes |
|---|---|---|---|---|---|
| A | 2 | 3 | 4 | 9 | Best for 1-2 step keycaps and quick experiments |
| B | 4 | 4 | 4 | 12 | Heavyweight ground for serious creators |
| C | 4 | 3 | 4 | 11 | Same as B but cramped |
| D | 2 | 1 | 5 | 8 | Killer for thin atomic keycaps; useless beyond |
| E | 5 | 5 | 4 | 14 | Most flexible, but most complex to build |

Shape E wins on simulated user experience. Shape A is the fastest to ship and still good for short keycaps. Shape D is excellent for the *first* keycap a user makes (low complexity = perfect).

---

## 7. Provisional lean (research-mode, not a decision)

Three things stand out:

1. **There's no single shape that wins across all keycap complexities.** Short atomic keycaps want Shape D's three-question form. Complex compositions want Shape B's canvas. Hybrid Shape E covers both but doubles the build cost.

2. **Shape A (pure Irisy chat) is the cheapest to ship today and is genuinely competitive on short keycaps.** It also serves the §9 framing best — Irisy as production-material supplier becomes literal: every reply is a material delivery.

3. **A staged path is plausible**: ship Shape A first (zero new surface), then observe usage. If many users hit "I wanted to preview / tweak", graduate to Shape E by attaching a canvas mode. If many users want to skip the chat for trivial keycaps, add Shape D's sub-panel quick form. This avoids over-building.

This is research, not a recommendation. The next two notes (02-manifest-schema-audit, 03-irisy-emits-manifest-protocol) will sharpen these into concrete proposals.

---

## 8. Open questions (collect, defer answers)

1. **Where does a draft keycap live before commit?** `~/.ctrl/keycaps/.drafts/`? Vault? LocalStorage? Mesh-synced?
2. **Naming the route**: `/forge` / `/workshop` / `/creator` / `/+` (top bar "new" affordance with no dedicated route)? Naming locks in mental model.
3. **Multi-keycap concurrent editing**: tab support in Shape B / C? Or single-keycap-at-a-time?
4. **Discoverability of the workshop itself**: how does a first-time user even know they can make keycaps? Pool already has a "Create" affordance? The first-run prompt mentions it?
5. **Power-user escape to vim**: when the user wants to edit the manifest JSON by hand, where does that flow live? "Show in Finder" button on the saved keycap?
6. **Irisy's reach in the workshop vs in Invoke mode**: same Irisy or different? If the user has been chatting with Irisy in `/irisy` and then switches to workshop, does Irisy bring the conversation context?
7. **Versioning**: when the user iterates, do we track history? Auto-save? Manual snapshot? Vault-level git?
8. **3rd-party keycaps**: a marketplace surface (Pool) lets the user *install* someone else's keycap. Does the workshop also support *forking* that keycap? Per memory `decision_keycap_3_tier_adjustment` Config / Patch / Fork — Patch is the friction point.

---

## 9. Material-supplier readiness — what to build for each shape

The §9 framing said three blocks (底座+base / UX / Irisy) supply production materials. For each shape, the per-block readiness checklist:

| Material need | Shape A | Shape B | Shape C | Shape D | Shape E |
|---|---|---|---|---|---|
| Manifest schema `composes` field | needed | needed | needed | needed | needed |
| Manifest schema `workspace.primitive` field | needed | needed | needed | needed | needed |
| Prompt fragment registry (G10) | strongly needed | nice-to-have | nice-to-have | nice-to-have | strongly needed |
| Asset catalog (icons + lottie) | needed | needed (shelf) | needed (sub-panel) | needed (3-icon pick) | needed |
| `propose_manifest` Irisy tool call | strongly needed | nice-to-have | optional | optional | strongly needed |
| Live test harness (sandboxed run) | hard | core | core | partial | core |
| Drag-drop UI primitive | — | core | core | — | core |
| New `/forge` route | — | core | — | — | core |
| New workspace tab type | — | — | core | — | partial |
| New sub-panel template | — | — | partial | core | — |

Shape A's cost: prompt-registry + propose_manifest tool call + manifest-schema fields. Smallest delta from today.

Shape E's cost: everything Shape A needs + Shape B's canvas + the hand-off contract between them. Largest delta.

---

## 10. Next research moves

1. **02-manifest-schema-audit.md** — read what `@ctrl/keycap-sdk/src/manifest-schema.ts` ships today (just landed on keycap-dev), list every field, mark which Block 1 / 2 supplies each, mark missing fields needed for each Shape.
2. **03-irisy-emits-manifest-protocol.md** — draft the LLM contract for Irisy to emit a manifest. Tool-call vs free-form vs hybrid. References: OpenAI's structured-output `response_format`, Anthropic's tool use.
3. **04-asset-catalog-shape.md** — what does the icon / lottie catalog look like? Where do CC0 assets come from? Are user-uploaded assets supported, or curated only?
4. **05-shape-AB-prototype-sketch.md** — pick top two shapes (A + E based on §6 scores) and sketch a one-screen mockup for each. Pressure test feel.

---

## 11. Shape F — bao's initial layout choice (2026-05-23)

> bao 2026-05-23: "workshop 的页面，初步想法是左侧是工作区 右侧是 Irisy 原料要用户伸手就能取用"

Sixth shape, distinct from A–E. The defining differences:
- **Persistent two-pane**, not sequential. Irisy is always visible on the right; the canvas is always present on the left. No mode toggle, no hand-off.
- **Materials within arm's reach**, not buried in menus. The user shouldn't have to open a drawer / submenu / dialog to pick a capability, a base keycap, an icon, or a prompt — they should be ambient on the canvas.

### Layout sketch

```
┌──────────────────────────────────────────────┬──────────────────────────┐
│  TOOLBAR — material palettes (collapsible)   │  Irisy header            │
│  [底座 cap ▾] [base keycap ▾] [icons ▾] [prompt ▾] [primitive ▾] │  · status pill         │
├──────────────────────────────────────────────┤                          │
│                                              │  ┌────────────────────┐  │
│   ┌────────────────────────────────────┐    │  │ Irisy says:        │  │
│   │  Canvas — the keycap being built   │    │  │ I drafted the      │  │
│   │                                    │    │  │ Translate step.    │  │
│   │  [drop input here]                 │    │  │ Want me to add a   │  │
│   │     ↓                              │    │  │ vault.write next?  │  │
│   │  ┌─────────┐                       │    │  │                    │  │
│   │  │ Trans-  │ ← step 1              │    │  └────────────────────┘  │
│   │  │ late    │                       │    │                          │
│   │  └─────────┘                       │    │  ┌────────────────────┐  │
│   │     ↓                              │    │  │ User reply:        │  │
│   │  [drop next step…]                 │    │  │ yes, save it to    │  │
│   │                                    │    │  │ today's journal    │  │
│   └────────────────────────────────────┘    │  └────────────────────┘  │
│                                              │                          │
│  ┌────────────────────────────────────┐     │  ┌────────────────────┐  │
│  │ Preview pane — runs draft live     │     │  │ ChatInput          │  │
│  └────────────────────────────────────┘     │  │                    │  │
│                                              │  └────────────────────┘  │
└──────────────────────────────────────────────┴──────────────────────────┘
   ~70% width                                       ~30% width
```

### "Materials within arm's reach" — four UI mechanisms

The toolbar at the top isn't the only access path. Users get materials four ways, all visible without digging:

1. **Top toolbar palettes** — one button per supplier category (capability / base keycap / icon / prompt fragment / UI primitive). Click expands a pop-down with sub-items, type-to-filter, drag-out-to-canvas. Like Figma's left toolbar but horizontal.
2. **Inline canvas "+" affordance** — when a step on the canvas has no next, a `+` slot appears with the most-likely-next-material suggested by Irisy. Click → 3-item shortcut menu (most recent / Irisy-suggested / search).
3. **Cmd+K command palette** — typed name search across all materials, all suppliers. Fastest for power users who know what they want.
4. **Drag-from-keyboard** — the left-side keyboard from the main CTRL layout may still be visible (TBD: shrunk, parked, or full hide). Dragging an existing base keycap from the keyboard onto the workshop canvas makes that keycap a step. This is the "I want to compose with what I already have" path.

The "伸手就能取用" target — under 2 seconds from intent to material in canvas, for any of the four mechanisms.

### Where does this live in the PWA?

Route: `/forge` (placeholder name, see open Q in §8). The whole window switches to forge layout — the normal 2-panel (keyboard + workspace) shell is **paused** for this route. Reasoning:

- Forge needs the horizontal real estate. Trying to compress forge into the workspace pane of the existing 920×560 shell makes the canvas too cramped (~600px wide).
- The "left keyboard" of the normal shell loses its meaning in forge — users aren't browsing keycaps to invoke, they're building one. If we still need access to existing keycaps (for the drag-from-keyboard mechanism), a thin **secondary palette** at the far left can serve that.

Possible refinement:

```
┌──────┬──────────────────────────────────┬──────────────────────────┐
│      │  TOOLBAR — material palettes     │  Irisy header            │
│ KB   ├──────────────────────────────────┤                          │
│ refs │   Canvas                         │   Irisy chat             │
│ (thin)│  Preview                        │                          │
│      │                                  │   ChatInput              │
└──────┴──────────────────────────────────┴──────────────────────────┘
```

A 48px left strip showing recent keycaps as drag handles, 70% middle canvas, 30% right Irisy. Three columns total.

### Irisy's posture in Shape F

Persistent, ambient, two-way. Irisy:
- **Watches the canvas state**. As the user drops a step, Irisy can comment / suggest in the right pane without being prompted.
- **Accepts orders**. User types "add a step that saves to vault" → Irisy adds it to the canvas (visible state change in left pane).
- **Refines materials**. User picks the Translate base keycap → Irisy asks "in/out language?" inline in the canvas step, or via the right chat — both work; the canvas form takes priority for typed fields, the chat for free-form refinement.

This is the cleanest manifestation of the §9 framing: Irisy as a production-material supplier sits literally next to the canvas where the materials are consumed.

### Sub-shape decisions still open (added to §8)

- **F1**: 48px keyboard strip on the far left — present from the start, or only when the user invokes "use existing keycap"?
- **F2**: Preview pane — under the canvas (vertical layout) or alongside it (horizontal)? Or floating modal on "test run"?
- **F3**: Irisy width — fixed 30%? Resizable? Collapsible to a thin strip when user wants more canvas?
- **F4**: Material palettes in top toolbar — always expanded ("ribbon"), or collapsed buttons (current sketch)?
- **F5**: Drafts management — left side panel listing in-progress keycaps, like Figma's file tree?

### Scoring Shape F against the 3 ambition cases

| Shape | Case 1 (Daily journal) | Case 2 (Feishu translate) | Case 3 (Tweet → poster) | Total |
|---|---|---|---|---|
| F | 5 | 5 | 5 | **15** |

It beats Shape E's 14 because:
- The persistent Irisy right pane removes E's hand-off seam — no risk of losing canvas state when switching modes.
- "Materials within arm's reach" makes the 30-second target plausible for *all three* cases, not just the simple ones.

But Shape F's build cost is the highest of all 6:
- Needs Shape B's canvas infrastructure (drag-drop, step graph, preview)
- Needs Shape E's continuous Irisy presence + canvas-aware Irisy
- Needs new material-palette UI (4 access mechanisms)
- Needs new top-bar layout, distinct from current `/irisy` and DefaultWorkspace

### Shape F readiness — what to build

Re-cut §9 readiness table for Shape F:

| Material need | Shape F status |
|---|---|
| Manifest schema `composes` field | **needed** |
| Manifest schema `workspace.primitive` field | **needed** |
| Prompt fragment registry (G10) | **strongly needed** (drives the prompt palette) |
| Asset catalog (icons + lottie) | **strongly needed** (drives icon palette) |
| `propose_manifest` Irisy tool call | **strongly needed** (canvas-aware Irisy must add steps via tool call) |
| Live test harness (sandboxed run) | **strongly needed** (preview pane) |
| Drag-drop step graph UI | **core new build** |
| Top-toolbar palette UI | **core new build** |
| Persistent Irisy right pane | extends existing IrisyChat — partial reuse |
| Cmd+K command palette | helpful, not blocking |
| `/forge` route + layout | **core new build** |
| Drafts management UI | **needed** for revisiting |

Shape F = ~70% net-new UI on top of the existing primitives + the entire §9 material-supplier wiring. Largest delta of any shape, also the cleanest creator experience.

### Provisional lean update

Shape F is bao's directional choice (2026-05-23). Earlier provisional lean (ship A first, graduate to E) is **superseded by Shape F**. The staged path becomes:

1. **Stage 1 (foundation)** — manifest schema additions (`composes`, `workspace.primitive`) + propose_manifest Irisy tool call. These are shape-agnostic; needed by everything from F downward. Build first.
2. **Stage 2 (Shape F minimum viable)** — `/forge` route + canvas + drag-drop step graph + top-toolbar palettes + persistent Irisy right pane. No preview yet. User can compose and save.
3. **Stage 3 (Shape F live preview)** — live test harness, drafts management, Cmd+K.
4. **Stage 4 (polish + Shape F fork tooling)** — Patch / Fork (per `decision_keycap_3_tier_adjustment`) tooling, marketplace browse integration.

Per memory `feedback_no_planning_no_phasing`: these "stages" aren't fixed phases. They're shipping order — each commit-ready slice can ship to main and reach the user via the in-app updater. Shape F isn't shipping in one big-bang PR.

## Changelog

| Date | Author | What |
|---|---|---|
| 2026-05-23 | zeus | First pass — 5 candidate shapes, 9-tool comparative, 3-case pressure test, provisional lean toward staged A → E. Open. |
| 2026-05-23 | zeus | §11 — Shape F per bao (左工作区 + 右 Irisy, 原料伸手取用). Persistent two-pane, materials accessed 4 ways (palette/inline/CmdK/drag-from-keyboard). Scores 15/15 on the 3 ambition cases but largest build delta. Shape F now the directional choice; A–E retained as alternatives for trade-off context. |
