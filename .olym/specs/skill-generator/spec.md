# SKILL.md Generator — Keycap → Hermes Skill

- **Status**: v0.1 (2026-05-22)
- **Parent**: ADR-010 amend (target field) + tool-manifest spec v0.3 §0.3
- **Audience**: kernel `skill_generator` module, keycap creators with `target: "hermes-skill"`

---

## 1. Purpose

When a keycap declares `target: "hermes-skill"`, the kernel generates a Hermes Agent skill (`SKILL.md` + assets) at install time. Hermes picks up the skill on next session and the user can invoke it via natural language.

## 2. Layout

```
~/.hermes/skills/<keycap-id>/
├── SKILL.md         (generated, 80% of content)
├── assets/          (copied from manifest.assets[])
│   ├── style-guide.md
│   └── examples.json
└── _manifest.json   (verbatim copy for kernel audit)
```

## 3. SKILL.md template

The generator fills a fixed template from the manifest:

- **Frontmatter** — `name`, `version`, `description` (mirrored from manifest), plus `keycap_id` and `ctrl_managed: true` to mark CTRL-owned skills.
- **`# <name>`** heading + manifest description body.
- **`## When to use`** — derived from `manifest.flow` (intent inference) OR an explicit `manifest.skill_when_to_use` field when the author wants to override.
- **`## How to invoke`** — `manifest.config_schema.documentation` if present, else default text.
- **`## Inputs`** — derived from `manifest.config_schema.properties`.
- **`## Examples`** — sourced from `manifest.examples[]` if present.
- **`## Constraints`** — natural-language render of `manifest.capabilities[]` (what the skill can / cannot do).
- **`## Related tools`** — auto-listed CTRL kernel MCP tools the skill can call (`vault.*` / `kv.*` / `llm.chat` / `mcp.proxy_*`).

*(SKILL.md template body elided. Implementation: `src-tauri/src/kernel/skill_generator.rs` + TS mirror in `packages/ctrl-keycap-sdk/src/skill-generator.ts`.)*

## 4. Update behavior (per ADR-018 3-tier)

- Config tier: clean overwrite of SKILL.md from new manifest
- Patch tier: 3-way merge of user-edited SKILL.md (some users tune the skill text)
- Fork tier: SKILL.md frozen; Irisy stage 7 prompts cherry-pick on upstream changes

## 5. Uninstall

- Kernel removes `~/.hermes/skills/<keycap-id>/` directory
- Hermes detects on next session
- User's per-keycap config + vault writes are NOT deleted (data ownership per ADR-015)

## 6. Constraints

- Skills are auto-loaded by Hermes at session start — generation must be deterministic so re-installs produce byte-identical files (modulo `version`)
- Asset paths in SKILL.md must use relative refs (`./assets/style-guide.md`) so the skill works regardless of installation prefix
- Generator does NOT call an LLM — pure template fill from manifest fields, so install is fast + offline-capable

## 7. Constraint: no Hermes source modification (MIT compliance)

- CTRL does NOT fork hermes-agent (per `decision_hermes_mit_compliance`)
- All extension via the skill convention (which Hermes ships native support for) + MCP server (ADR-013) — no Python imports into hermes module space
