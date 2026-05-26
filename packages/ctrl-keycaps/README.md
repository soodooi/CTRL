# @ctrl/keycaps

Source-of-truth for CTRL's bundled builtin keycaps (15 v1 starter set).

## Layout

Each keycap is a self-contained directory under `keycaps/<id>/` matching the
canonical layout per ADR-001 amendment 2026-05-25 invariant #1:

```
keycaps/<id>/
├── keycap.md            # manifest (YAML frontmatter + markdown body)
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
contents of `keycaps/` into the app bundle Resources directory:

```
CTRL.app/Contents/Resources/keycaps/
```

At first run, the kernel's `ensure_keycaps_seeded()` copies the bundled
keycaps to `~/.ctrl/keycaps/` (idempotent — already-present, user-modified
keycaps are preserved via `.ctrl-user-modified` marker file).

## Versioning

Builtin keycap versions track CTRL releases. A keycap's `version` in
`keycap.md` frontmatter bumps when its behavior changes; the app version
bumps on every release.

## Current status

This package is a **placeholder** as of 0.1.37. Builtins currently install
directly into `~/.ctrl/keycaps/` at runtime via kernel command without a
source-of-truth source directory. Migration to source-bundle layout is
tracked separately.

For now, the 15 v1 starter builtins live in `~/.ctrl/keycaps/ctrl.builtin.*`
on the dev machine. Future PR moves them into this package directory + adds
the first-run bundle copy logic to `kernel/bootstrap.rs`.
