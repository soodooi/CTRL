---
adr_id: 022
title: Workbench is a sanctioned keycap-composition canvas (React Flow + dnd-kit, CTRL-owned thin orchestrator)
status: accepted
date: 2026-05-29
deciders: [bao, zeus]
related:
  - .olym/decisions/001-system-architecture.md
  - .olym/decisions/010-keycap-execution-model.md
  - .olym/decisions/013-kernel-as-mcp-server.md
  - .olym/specs/workbench/spec.md
scope: framework
supersedes: []
superseded_by: []
amends:
  - .olym/decisions/001-system-architecture.md
---

## Context

The session-long product goal is the pipeline `source/SKILL.md → ctrl skill →
工作台 (workbench) → 键帽`. bao wants a level-1 **workbench**: a visual surface
to (a) configure a skill into a keycap and (b) wire **multiple keycaps + a
smart table into a system** (e.g. a simple ERP). The full technical selection
is locked in `.olym/specs/workbench/spec.md` (build brief).

This collides with two standing CTRL positions:

- `CLAUDE.md` → **"What CTRL is NOT: Workflow editor (Coze / n8n 已经做了)"**
- Design philosophy **#4 "One-shot, not flows"** (one keycap = one atomic
  action; no wizard / multi-step / dialog tree).

bao resolved the tension explicitly (2026-05-29): *"连线这种 workflow，目前看是
需要的；现成的，我们做集成。"* — the wiring/connection workflow IS needed now;
use ready-made libraries and integrate (do not build a node editor from
scratch).

## Decision

### 1. Two distinct surfaces — they coexist, they are not the same thing

- **Keycap = one-shot (unchanged).** A single keycap pressed from the keyboard
  is one atomic action. Philosophy #4 still holds *for the keycap itself*. No
  keycap becomes a multi-step wizard.
- **Workbench = composition canvas (new, power-user, level-1 `/workbench`).**
  A place to assemble keycaps into a **durable workspace / mini-app**, not a
  per-invocation flow you rebuild each time.

This amends the blanket "CTRL is NOT a workflow editor": CTRL is not a
**generic** workflow editor (we don't compete with Coze/n8n on arbitrary API
orchestration). CTRL **does** have a **keycap-composition canvas** — it wires
*keycaps* (which are themselves MCP tools / skills), not raw nodes, and the
output is a standing workspace.

### 2. Reuse, don't build — ratify the brief's stack (bao: "现成的做集成")

Per `.olym/specs/workbench/spec.md` §1 (researched + locked):

- **React Flow** (`@xyflow/react`, MIT) — the wiring canvas, **as a library we
  integrate**, lazy-loaded into `/workbench` only. Custom nodes render the real
  keycap card. We do **not** write our own node editor.
- **dnd-kit** (MIT) — Pool→keyboard palette drag + reorder.
- **JSON Schema** — I/O port types (aligns with MCP tool I/O, ADR-013).
- **Forbidden**: any library's built-in dataflow *engine* (Flowise / Langflow /
  n8n / ComfyUI / Dify) and any GPL / fair-code dep. React Flow is canvas-only.

### 3. Execution stays in CTRL — a thin orchestrator, not a borrowed engine

React Flow is design-time only. The graph compiles to a clean execution IR;
a **thin CTRL-owned orchestrator** topologically walks it, calling each keycap
through the existing executor (subprocess + mcp_host + sandbox), routing I/O
edge-by-edge with a JSON Schema check per hop. This is the real component that
makes "multiple keycaps → a system" work; it is thin (read graph → topo →
call executor → route I/O), not an n8n-class engine.

### 4. Two legs of composition

- **In-app**: the workbench orchestrator (§3) wires keycaps on the canvas.
- **Outsourced**: an external workflow engine (n8n / Zapier / Make) the user
  already runs is wrapped as a **single keycap** via MCP Server Trigger
  (`install_keycap_from_mcp`) or webhook. The whole flow collapses to one
  one-shot keycap; execution stays on the external instance. This is how CTRL
  gets "flows" without embedding a workflow engine (brief §4b).

### 5. Keycap object is standardized + incremental

`create keycap` produces a standardized, declarative keycap **object** (Zod
manifest, ADR-010 / `@ctrl/keycap-sdk`). It gains a `skill` source type and an
`io` block (JSON Schema input/output ports) — re-added to the SDK (these were
removed to keep PR #62 a clean slate). The full "all components of a keycap"
list and the I/O schema vocabulary are built **incrementally** (per keycap),
recorded to memory `decision_keycap_workbench_composition_model`.

## Consequences

**Good**
- The keycap-composition vision (simple ERP from keycaps + smart table) has a
  sanctioned home without forking CTRL's identity into a generic flow tool.
- Zero net-new node-editor code; ~76 KB gzip lazy-loaded, off the critical path.
- One correctness edge over every surveyed tool: JSON Schema **structural**
  connection validation in `isValidConnection` (not string type names).

**Cost / tension (acknowledged, not hidden)**
- The thin orchestrator is, by definition, a flow runtime — it stretches
  philosophy #4. Accepted: #4 governs the *single keycap*; the workbench is an
  explicit upper layer the user opts into. This ADR is where that line is drawn.
- A node canvas can drift toward Coze/n8n feature-creep. Guard: the canvas only
  composes **keycaps** (MCP tools/skills), never raw API nodes; if a need looks
  like "arbitrary API orchestration", the answer is "wrap it as an external-
  engine keycap" (§4), not "add a node type".

**Hard rules (this ADR holds)**
- React Flow is canvas-only; execution NEVER leaves the CTRL executor.
- No GPL / fair-code deps; no borrowed dataflow engine.
- Ports are JSON Schema, validated structurally at connect-time.
- A single keycap stays one-shot; composition is an additive layer.

## Open follow-ups (incremental, per brief §8)

1. Re-add `skill` source + `io` (JSON Schema ports) to `@ctrl/keycap-sdk`
   (foundation; first code step).
2. `/workbench` route scaffold (lazy React Flow + dnd-kit + Irisy side-pane).
3. Thin orchestrator (graph IR → topo walk → executor → I/O routing).
4. Global skill discovery (Pool upstream — GitHub `filename:SKILL.md`); GitHub
   API direct vs CF Worker proxy is bao's call (brief §8).
5. Keycap "all components" list + I/O schema vocabulary — fill as keycaps ship.
