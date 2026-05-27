---
module: cap
purpose: Keycap mechanism — manifest schema, source dispatch, install/upgrade, Pool, brain-as-keycap
lane_owner: hephaestus
sub_specs:
  - .olym/specs/tool-manifest/
  - .olym/specs/keycap-base-layer/
  - .olym/specs/creator-economy/
---

# cap — module SPEC

> Entry page. Everything keycap-related: manifest, sources, install layout, upgrade, brain-as-keycap.

---

## What this module is

Keycap is CTRL's extension primitive. 5 source types (`source: mcp | oauth | local-agent | stss | builtin`) all reduce to one manifest schema. Brain is a special keycap with `target: brain`. Pool lists installable keycaps; Keyboard pins active ones.

## Code paths

- `packages/ctrl-keycap-sdk/` — manifest Zod schema (`KeycapTarget` enum: `mcp-tool | hermes-skill | brain`)
- `packages/ctrl-keycaps/` — builtin v1 starter pack (skeleton, mostly empty as of 2026-05-26)
- `packages/ctrl-pi-plugin/` — Pi default brain keycap (`target: brain`)
- `packages/ctrl-hermes-plugin/` — hermes optional personal-assistant keycap (Python, lazy `pip install`)
- `~/.ctrl/keycaps/<id>/` — per-user installed keycaps (canonical layout in ADR-001 §5.3)
- `CTRL.app/Contents/Resources/keycaps/` — bundled starter pack (first-run copy to `~/.ctrl/keycaps/`)
- `src-tauri/src/kernel/mcp_host.rs` — kernel side: spawn keycap subprocess + speak MCP outward

## Owned ADRs

| ADR | Title | Status |
|---|---|---|
| [010](../../decisions/010-keycap-execution-model.md) | Keycap execution — MCP outward, Actor inward | accepted |
| [011](../../decisions/011-update-channel-and-delivery.md) | Tauri 2 updater + three-mirror channel | accepted |
| [018](../../decisions/018-auto-update-strategy.md) | Auto-update — 4 layers × 3 tiers (Config/Patch/Fork) | accepted |

Cross-references: ADR-001 §1.3 (5 sources), §1.4 (brain as keycap), §4 (10 file-system invariants), §5.3 (canonical keycap dir).

## Adjacent sub-specs (drill down)

- `.olym/specs/tool-manifest/spec.md` — manifest Zod schema + frontmatter contract
- `.olym/specs/keycap-base-layer/spec.md` — base substrate audit (gap analysis per source)
- `.olym/specs/creator-economy/` — pricing / market / royalty (future)

## Current state (2026-05-26)

✅ shipped:
- Manifest schema with `target` enum + `config_schema` + `patches/` + `upstream.json` fields
- Pi keycap (`@ctrl/pi-plugin`) — v1 default brain via lazy npm install
- hermes keycap (`@ctrl/hermes-plugin`) — optional personal-assistant via lazy pip install
- Canonical keycap dir layout (10 invariants, ADR-001 §4)
- Tauri 2 updater @ app level (ADR-018 layer 1)

⚠️ open:
- **v1 starter keycap pack**: `packages/ctrl-keycaps/` skeleton only — 0 of ~15 v1 starter shipped. (Tracked in `doc/brainstorm-workbench-flexibility-2026-05-26.md` G1, lane = cap.)
- 3-tier adjustment runtime (Config/Patch/Fork) — schema has fields, runtime/UI not wired
- Keycap upstream channel (ADR-018 layer 3) — not implemented
- Pool starter pack 0 entries — Pool UI exists, content missing

## Known drift / dead refs

- `.olym/specs/keycap-base-layer/spec.md` references hermes/VMark substrates that have been reframed (hermes = keycap not brain; VMark = compatibility not dependency). Spec still readable but partially superseded by ADR-001 amendments. Refactor when re-spec'ing.
