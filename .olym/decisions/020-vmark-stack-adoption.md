---
id: 020
title: VMark stack adoption — viewer registry + vault browser + smart table
status: superseded
date: 2026-05-25
superseded_by: memory decision_vmark_not_substrate_use_open_stack
amends: 015-obsidian-philosophy
relates: 002-pwa-pivot
module: frontend
---

> **SUPERSEDED 2026-05-25 (same-day reversal)** — bao called: VMark is itself built on Tiptap + CodeMirror 6 + Tailwind. CTRL adopts those open-source primitives directly, NOT VMark as a substrate / MCP sidecar. See memory `decision_vmark_not_substrate_use_open_stack`. Acceptance items below frozen; this ADR no longer drives implementation.

---

## Context

bao 2026-05-25: "做 vmark 的模块抽出来，做我们的前端 ux，还有智能表格"

ADR-015 (Plain-text philosophy, formerly Obsidian-grade) commits CTRL
to the same open-source vault stack VMark / Obsidian use. CLAUDE.md
stack table names the libraries: **Tiptap** (markdown WYSIWYG+source) +
**CodeMirror 6** (JSON / YAML / TOML / HTML / code) + **mermaid.js** +
**iframe+CSP** (HTML sandbox) + browser-native (SVG / images / PDF) +
SQLite FTS5 (kernel `vault_index.rs`).

The frontend has the viewer-registry foundation from PR #44 but the
actual viewer modules haven't been written, and there's no VMark-style
browser into the vault directory. PR #46's workspace workflow can drive
the new viewers, but the vault as a navigable surface is missing.

Smart-table (Notion-style structured table) was bao's third explicit
ask. The decision needs to land WITHOUT violating the plain-text vim
test: if a smart table file is just a `.json` blob, vim opens nothing
useful.

## Decision

### 1. Viewer registry implementations — bake in v0.4

Each content-type maps to a lazy-loaded viewer module. The registry's
3-dimensional resource model (location × editable × companion) drives
save-back routing. Viewers ship now:

| Content-type | Module | Lib |
|---|---|---|
| `text/markdown` | `MarkdownViewer` | Tiptap + StarterKit (WYSIWYG + Source toggle) |
| `application/json` | `JsonViewer` | CodeMirror 6 + lang-json |
| `text/yaml` | `YamlViewer` | CodeMirror 6 + lang-yaml |
| `text/toml` | `TomlViewer` | CodeMirror 6 + legacy-modes/toml |
| `text/html` | `HtmlViewer` | iframe `sandbox=""` + CodeMirror source mode |
| `image/svg+xml` | `SvgViewer` | inline render + CodeMirror source |
| `text/mermaid` | `MermaidViewer` | mermaid.js (init once, render per resource) |
| `text/x-ctrl-smart-table` | `SmartTableViewer` | Tanstack Table (see §3) |
| `application/pdf` | `PdfViewer` | browser-native `<embed>` + companion `.md` link |
| `image/*` | `ImageViewer` | `<img>` + zoom toggle (no lightbox dep) |
| `text/*` (generic) | `CodeViewer` | CodeMirror 6 no lang pack |

All viewers are `lazy()` boundaries — critical-path bundle stays under
the 200KB mobile cap. Loaders fire only on first matching tab.

### 2. Vault browser at `/vault`

A three-pane VMark-style entry point into `~/Documents/CTRL/`:

```
[ Tree + search (220px) ] [ Preview via ViewerHost ] [ Backlinks (220px) ]
```

- Tree groups paths by top-level folder (notes / assets/images / …)
- Search hits `vault_search` FTS5 (≥ 2 chars debounced)
- Click selects (preview); double-click opens in active workspace
  instance as a `vault-md` tab; Cmd/Ctrl-click opens in new instance
- Preview uses the same `ViewerHost` as workspace tabs — content-type
  inferred from file extension via `inferContentTypeFromPath()`
- Save handler delegates to `vault_write` (preserves frontmatter via
  read-then-write round trip)
- Backlinks pane scans the vault client-side for `[[stem]]` wikilinks
  and `[label](path.md)` markdown links. Naive O(N) — replaced when
  kernel exposes a backlink index (hephaestus follow-up).

`VaultBrowser` is reused inside Pool's keycap detail panel for the
"edit prompt.md" flow once that lands.

### 3. Smart table = markdown + frontmatter schema

vim test must pass. The on-disk file is plain markdown — a YAML
frontmatter `schema:` block declares column types, the body holds an
ordinary pipe-table:

```markdown
---
title: Reading list
schema:
  - { key: title, label: Title, type: text }
  - { key: rating, label: ★, type: number, min: 0, max: 5 }
  - { key: done, label: Done, type: checkbox }
  - { key: tags, label: Tags, type: tags }
---

| Title    | ★ | Done | Tags        |
|----------|---|------|-------------|
| Anathem  | 5 |      | scifi       |
```

- vim opens this as markdown with a working table.
- Obsidian / VMark render it as a markdown table (no smart features).
- CTRL's `SmartTableViewer` renders it as an editable Tanstack Table
  with per-column cell editors (text / number / date / checkbox / tags
  / select / url).
- Edit → re-serialize → `vault_write` writes the file back, preserving
  the schema block + frontmatter.

Schema language is intentionally minimal (key / label / type /
options? / min? / max?). Anything more complex stays user-edited via
markdown / yaml viewers.

### 4. Permanent rail navigation for vault + pool

L1 rail's level-1 nav (left edge as of 2026-05-29 — was right edge when
this ADR was written) gains two permanent items above route-pushed
ones: **Vault** → `/vault`, **Pool** → `/pool`. Settings stays in the
footer slot. Route-pushed items (from `useRailItems`) render between
the two permanents and the footer. The rail auto-flips `activeRailId`
when the pathname enters `/vault/*` or `/pool/*`.

> **Amendment 2026-05-29**: L1 rail position flipped right → left. See
> memory `feedback_l1_nav_left_and_fixed` for the binding rule. The
> nav-items decision in this section is unchanged; only the side moves.

## Consequences

- New dependencies (all installed): `@tiptap/react`, `@tiptap/starter-kit`,
  `@tiptap/pm`, `@uiw/react-codemirror`, `@codemirror/lang-{json,yaml,html,
  markdown,css}`, `@codemirror/legacy-modes`, `@codemirror/state`,
  `@codemirror/view`, `mermaid`, `@tanstack/react-table`. All sit
  inside lazy chunks per content-type.
- `tab-store.ts` Tab kinds (`vault-md`, `keycap-output`, etc) unchanged
  — the viewer registry sits over them.
- VMark is NOT a dependency. The PWA does not import any VMark code;
  it implements the same open-source primitives end-to-end. ADR-015's
  "VMark/Obsidian as compatibility promise, not dependency" intact.
- Smart-table's schema parser is a hand-roll (`lib/smart-table.ts`) —
  not a full YAML library. Anything beyond the documented shape falls
  through to the markdown viewer; users with complex YAML edit it as
  YAML directly.
- BacklinksPanel is O(N) client-side. Acceptable for vaults up to a
  few hundred notes; kernel-side backlink index is the follow-up.

## Follow-ups

- `keycap-output` and `session-stream` tab bodies still placeholder —
  wires to `useCellStream` come with kernel stream contract finalize.
- Backlinks index in kernel (`vault_index.rs` extension)
- Schema editor UI for smart tables (today users hand-edit the schema
  block; later a column-definition mini-form)
- Drag a vault file from VaultBrowser tree into workspace = adds tab
  (consistent with keycap-drag-to-compose pattern)
