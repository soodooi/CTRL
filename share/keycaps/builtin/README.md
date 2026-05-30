# share/keycaps/builtin/ — CTRL built-in keycaps

Each subfolder under `share/keycaps/builtin/` is one **built-in keycap** shipped with CTRL. They use the same manifest shape as user-installed keycaps (ADR-024 6-axis composition model); the only architectural difference is `manifest.builtin = true`, which makes the keycap:

- copied at app launch from `share/keycaps/builtin/<id>/` → `~/.ctrl/keycaps/<id>/`
- self-repaired if the user deletes the user-side copy (next launch re-provisions)
- not removable through the Pool / Settings uninstall UI

User-installed keycaps live at `~/.ctrl/keycaps/<id>/` with `builtin = false`.

## Layout

```
share/keycaps/builtin/
  <id>/
    manifest.toml            # ADR-024 v2 manifest (6 axes + pattern)
    assets/
      icon.svg               # cap_asset.files entry — appears on the Keyboard
      persona.md             # cap_asset.files entry — Irisy's voice in this keycap
      ...                    # any other static bundled file (templates, prompts, ...)
```

At install time the runtime reads `manifest.toml` and atomically:

1. copies `assets/*` to `~/.ctrl/keycaps/<id>/assets/` (immutable; re-copied if missing)
2. creates the vault folder declared in `cap_asset.vault.path` (e.g. `~/Documents/CTRL/keycaps/<id>/`) with any seed sub-folders and seed files (READMEs, settings)

If the user edits `~/Documents/CTRL/keycaps/<id>/persona.md`, the runtime prefers the user copy over `assets/persona.md` — one lookup chain, no global persona library (per ADR-024 §1).

## Currently shipped builtin

| id | label | pattern | What it does |
|---|---|---|---|
| `builtin/assist` | Assist | G | Irisy's default companion mode. Active when no other keycap is invoked. Reads the whole vault; writes session state under `~/Documents/CTRL/keycaps/assist/`. |
| `builtin/create` | Create | G | Irisy in keycap-designer mode. Talks the user through making a new keycap, writes the manifest, installs it. |

The 16 G text-transform builtins (markdown-quote / base64 / urlencode etc.) ship from elsewhere in v1; their migration to this layout is a Phase 2 PR (per ADR-024 "实施时决" Q6).

## See also

- `.olym/decisions/024-substrate-composition-model.md` — the law
- `.olym/decisions/010-keycap-execution-model.md` — 7 patterns A-G
- `.olym/decisions/004-kernel-capability-surface.md` — 8 kernel ns
- `packages/ctrl-keycap-sdk/src/manifest-schema.ts` — Zod SSOT (Phase 2 will absorb ADR-024 v2 fields)
