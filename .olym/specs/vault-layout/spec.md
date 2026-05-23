# Vault Layout — Default Policies + User Override

- **Status**: v0.1 (2026-05-22)
- **Parent**: ADR-015 (Obsidian philosophy)
- **Audience**: kernel `vault` module, keycap creators (`path_glob` capability declarations), Irisy companion (vault writes)

---

## 1. Purpose

Per ADR-015, the user's vault is the user's data — CTRL provides default layout policies but does NOT hardcode a directory structure. Users can swap policies; keycaps declare `path_glob` capability scopes against any layout.

## 2. Default policies (templates)

CTRL ships 3 layout templates the user picks at first launch (or any time in Settings):

### 2.1 Flat (default for v1)

```
~/.ctrl/vault/
├── inbox.md
├── 2026-05-22 meeting notes.md
├── refactor ideas.md
└── todo.md
```

- Simplest mental model
- Suits casual / individual users
- Search-driven retrieval (FTS5 + vault_index)

### 2.2 By-day (journaling)

```
~/.ctrl/vault/
├── daily/
│   ├── 2026-05-22.md
│   ├── 2026-05-23.md
│   └── ...
├── projects/
│   └── ctrl-v1.md
└── people/
    └── bao.md
```

- Suits daily-journal-first workflows
- Keycaps can append to `daily/<today>.md` via `path_glob: "daily/*"`

### 2.3 By-entity (project/people/topic)

```
~/.ctrl/vault/
├── projects/
│   ├── ctrl-v1/
│   │   ├── _index.md
│   │   ├── kernel-adr-013.md
│   │   └── notes.md
│   └── mamamiya/
├── people/
│   └── bao.md
├── topics/
│   └── mcp-protocol.md
└── inbox.md
```

- Suits PKM-heavy workflows (think Obsidian power users)
- Higher cognitive load
- Best with Irisy-companion file placement (Irisy suggests target subdir at write time)

## 3. User override

- User picks layout at first launch; setting persisted in `~/.ctrl/state/vault-policy.json`
- User can rename/move files freely after the fact — kernel reads on-demand, no index lock-in
- Keycap `path_glob` capability is GLOB-MATCHED against whatever the actual layout is; mismatch surfaces as a capability error at install (UX: "this keycap expects `daily/*` — your layout doesn't have a `daily/` dir; OK to create it?")

## 4. Constraints (cross-cutting)

- All entries are markdown (`*.md`) — no binary blobs, ADR-015 §3
- Frontmatter is YAML (Obsidian-compatible) — kernel `vault::write` always wraps content in `---\n<yaml>\n---\n\n<body>`
- Filenames safe per OS (kernel `sanitize_relative_path` strips path traversal + reserved chars)
- Directory depth unbounded but no `..` traversal beyond vault root

## 5. Migration

- Switching layouts does NOT auto-move files (user's data, user's call)
- Settings UI offers a migration helper ("move daily/* into root?") with diff preview before applying
- Irisy suggests target subdir on write to nudge users toward their chosen layout

## 6. Vault index

- FTS5 SQLite index at `~/.ctrl/state/vault-index.db` (vault_index.rs)
- Reindex on demand via `vault::rebuild_index`
- Index path independent of vault layout — same query works across all 3 default templates
