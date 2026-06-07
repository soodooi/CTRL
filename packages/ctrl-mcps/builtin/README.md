# `packages/ctrl-mcps/builtin/` — CTRL built-in mcps (source of truth)

Each subfolder under `packages/ctrl-mcps/builtin/<id>/` is one built-in mcp shipped with CTRL. They use the same manifest shape as user-installed mcps (ADR-024 6-axis composition model). At first launch the kernel copies these into `~/.ctrl/mcps/<id>/`; on every launch missing builtin folders are re-seeded so the user can never permanently delete a builtin.

The only architectural distinction between builtin and user mcps is `"builtin": true` in the manifest. Routing, dispatch, capability gating, vault scoping all work identically.

## Layout

```
packages/ctrl-mcps/builtin/
  <id>/                           # kebab-case (no slashes — kernel id validator rejects '/')
    manifest.json                 # ADR-024 v2 fields (top-level), JSON for now
    assets/
      icon.svg                    # cap_asset.files entry — Keyboard cell glyph
      persona.md                  # cap_asset.files entry — Irisy voice in this mcp
      ...                         # other static bundled files (templates, prompts)
```

## v1 manifest shape (transitional, ADR-024 v2 additive)

- Top-level `id` / `name` / `mcp_color` / `icon` — kept for v1 `list_mcps` backwards-compat (the JSON shape `manifest_to_summary` reads).
- Top-level `builtin: true` — the routing flag.
- Top-level `cap_asset`, `brain_capabilities`, `ui_surface`, `capabilities` — the ADR-024 v2 axes (consumed by the v2 loader as it lands in Phase 1).

When Phase 1 lands the full ADR-024 loader, the kernel will read `cap_asset.files` to find `persona.md` and resolve the user-override path; until then `assets/persona.md` is the only persona source.

## Shipped builtins

| id | label | pattern | What it does |
|---|---|---|---|
| `builtin-irisy` | Irisy | G | CTRL's single user-facing companion. Reads the whole vault; writes session state and mcp drafts under `mcps/builtin-irisy/`. Internally dispatches between conversational mode and mcp-designer mode based on context (invisible to the user). |

`builtin-assist` + `builtin-create` were merged into `builtin-irisy` on 2026-05-30 per ADR-002 amendment (Irisy-as-sole-entry). The two-mcp split exposed an internal mode switch the user had to make — Irisy now picks per turn, so there is one persona, one chip, one folder.

## See also

- `.olym/decisions/024-substrate-composition-model.md` — the law
- `.olym/decisions/010-mcp-execution-model.md` — 7 patterns
- `.olym/decisions/004-kernel-capability-surface.md` — 8 kernel namespaces
- `src-tauri/src/commands/kernel.rs` — install_mcp + list_mcps
- `doc/audit-2026-05-30-phase-1-readiness.md` — Phase 1 implementation plan
