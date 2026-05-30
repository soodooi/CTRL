# `packages/ctrl-keycaps/builtin/` — CTRL built-in keycaps (source of truth)

Each subfolder under `packages/ctrl-keycaps/builtin/<id>/` is one built-in keycap shipped with CTRL. They use the same manifest shape as user-installed keycaps (ADR-024 6-axis composition model). At first launch the kernel copies these into `~/.ctrl/keycaps/<id>/`; on every launch missing builtin folders are re-seeded so the user can never permanently delete a builtin.

The only architectural distinction between builtin and user keycaps is `"builtin": true` in the manifest. Routing, dispatch, capability gating, vault scoping all work identically.

## Layout

```
packages/ctrl-keycaps/builtin/
  <id>/                           # kebab-case (no slashes — kernel id validator rejects '/')
    manifest.json                 # ADR-024 v2 fields (top-level), JSON for now
    assets/
      icon.svg                    # cap_asset.files entry — Keyboard cell glyph
      persona.md                  # cap_asset.files entry — Irisy voice in this keycap
      ...                         # other static bundled files (templates, prompts)
```

## v1 manifest shape (transitional, ADR-024 v2 additive)

- Top-level `id` / `name` / `keycap_color` / `icon` — kept for v1 `list_keycaps` backwards-compat (the JSON shape `manifest_to_summary` reads).
- Top-level `builtin: true` — the routing flag.
- Top-level `cap_asset`, `brain_capabilities`, `ui_surface`, `capabilities` — the ADR-024 v2 axes (consumed by the v2 loader as it lands in Phase 1).

When Phase 1 lands the full ADR-024 loader, the kernel will read `cap_asset.files` to find `persona.md` and resolve the user-override path; until then `assets/persona.md` is the only persona source.

## Shipped builtins

| id | label | pattern | What it does |
|---|---|---|---|
| `builtin-assist` | Assist | G | Irisy's default companion. Reads the whole vault; writes session state under `keycaps/builtin-assist/`. |
| `builtin-create` | Create | G | Irisy in keycap-designer mode — talks user through making a new keycap, writes manifest, installs it. |

## See also

- `.olym/decisions/024-substrate-composition-model.md` — the law
- `.olym/decisions/010-keycap-execution-model.md` — 7 patterns
- `.olym/decisions/004-kernel-capability-surface.md` — 8 kernel namespaces
- `src-tauri/src/commands/kernel.rs` — install_keycap + list_keycaps
- `doc/audit-2026-05-30-phase-1-readiness.md` — Phase 1 implementation plan
