# Skills

> Per-lane SKILL.md files — lane owner 维护. zeus 维护 cross-cutting skills (e.g., `dike/`).

## Structure

```
.olym/skills/
├── <lane-A>/
│   └── SKILL.md       # operational SOPs for lane-A (lane owner writes)
├── <lane-B>/
│   └── SKILL.md
└── dike/              # zeus stewardship — review quality skill
    └── SKILL.md
```

## What goes in SKILL.md

- Lane-specific SOPs (deploy / migration / hot path)
- Operational patterns (累积 3+ 次操作经验, 提炼自 handoff body 操作经验段)
- Lane-specific debug recipes
- Tooling cheatsheet for the lane

## Writer responsibility

- **Lane SKILL.md** — lane owner 写 (allowlist via `lane-ownership.yaml` lane.files glob)
- **Cross-cutting skills (e.g., dike)** — zeus 写 (denylist_explicit blocks fleet)
- **Skill changes affecting fleet behavior** — bao approve mandate

详 `.olym/steering/protocol/knowledge.md` §3.
