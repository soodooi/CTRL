# @ctrl/mcps

Source-of-truth for CTRL's bundled builtin mcps (15 v1 starter set).

## Layout

Each mcp is a self-contained directory under `mcps/<id>/` matching the
canonical layout per ADR-001 amendment 2026-05-25 invariant #1:

```
mcps/<id>/
├── mcp.md            # manifest (YAML frontmatter + markdown body)
├── mcp-server.{ts,js}   # entry executable (kernel spawn)
├── assets/
│   ├── icon.svg
│   ├── prompt.md        # vim-editable prompt template
│   └── few-shots.json
├── skills/<sub-id>/     # bundled SKILL.md (brain consumes via env)
└── README.md
```

## Bundling

At release time, `scripts/release.sh` (or `cargo tauri build`) copies the
contents of `mcps/` into the app bundle Resources directory:

```
CTRL.app/Contents/Resources/mcps/
```

At first run, the kernel's `ensure_mcps_seeded()` copies the bundled
mcps to `~/.ctrl/mcps/` (idempotent — already-present, user-modified
mcps are preserved via `.ctrl-user-modified` marker file).

## Versioning

Builtin mcp versions track CTRL releases. A mcp's `version` in
`mcp.md` frontmatter bumps when its behavior changes; the app version
bumps on every release.

## Current status

This package is a **placeholder** as of 0.1.37. Builtins currently install
directly into `~/.ctrl/mcps/` at runtime via kernel command without a
source-of-truth source directory. Migration to source-bundle layout is
tracked separately.

For now, the 15 v1 starter builtins live in `~/.ctrl/mcps/ctrl.builtin.*`
on the dev machine. Future PR moves them into this package directory + adds
the first-run bundle copy logic to `kernel/bootstrap.rs`.
