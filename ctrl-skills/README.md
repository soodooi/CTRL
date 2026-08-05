# ctrl-skills

Official **CTRL skills for Irisy and Coding/OpenCode**. These teach each agent
how to drive CTRL's `:17873` gate tools—smart tables, explicit LibreOffice
selections, and research-first feature-pack creation with backend discovery,
real-software verification, semantic artifact checks, and truthful previews—so
the guidance stays owned by CTRL and in sync with the tools instead of drifting
in a local copy.

## Why this exists (the architecture)

CTRL adds a gate tool (e.g. `smart_table_base_scaffold`) → the "how to use it"
playbook must be **owned by CTRL and distributed to whatever brain uses it**. If
that guidance lives only as a stray skill inside `~/.hermes/skills/`, it is
un-owned: the Hermes Curator can prune/regenerate it, it drifts from the tools,
and it is not versioned or shareable. This repo is the single source of truth.

## Distribution

Two paths from this one source:

- **Local (CTRL's own Irisy)** — CTRL registers this repo's `skills/` directory
  in the local Hermes config under `skills.external_dirs`. Hermes then *discovers*
  these skills read-only (the Curator only manages the primary `~/.hermes/skills/`
  tree, so external-dir skills are never pruned). Works offline; no GitHub needed.
- **Share (any Hermes / Claude Code / Cursor user)** — this is a standard Hermes
  **Skills Hub tap**. Subscribe with:

  ```
  hermes skills tap add soodooi/ctrl-skills
  ```

## Layout

```
ctrl-skills/
├── skills.sh.json                 # Skills Hub category groupings
└── skills/
    ├── create-feature-pack/SKILL.md # Coding/OpenCode pack lifecycle
    ├── office/SKILL.md              # LibreOffice explicit-selection reads
    └── vault-smart-tables/
        ├── SKILL.md                 # required
        ├── references/            # supporting detail
        └── templates/             # copy-ready scaffolds
```

## License

MIT — CTRL commons (`ctrl-*` packages are MIT so guidance is freely shared;
ADR-006 §5.1).
