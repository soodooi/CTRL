# MEMORY.md — CTRL session-start pointer

> Olym protocol expects this file at repo root. It is an **index**, not a memory store.
> Auto-memory (cross-session persistence) lives at `~/.claude/projects/-Users-mac-Documents-coding-CTRL/memory/MEMORY.md`.

## Read order at session start

1. **`CLAUDE.md`** — project entry; rules, philosophy, stack, working mode (灵活开发)
2. **`.olym/decisions/INDEX.md`** — 7 module ADRs (single source of truth)
3. **`.olym/decisions/001-spine.md`** — architecture lock (Pi-centric 5 blocks, 4 layers, 5 primitives)
4. **`.olym/handoffs/INDEX.md`** — active handoffs (currently empty — 灵活模式, ADR + 代码 + PR only)

## Where what lives

| Topic | Location |
|---|---|
| Project rules + philosophy | `CLAUDE.md` |
| Architecture decisions | `.olym/decisions/*.md` (7 module ADRs) |
| ADR amendment process | `.olym/decisions/PROCESS.md` |
| Active work | `.olym/handoffs/H-*.md` (灵活模式期间为空) |
| Lane ownership (multi-persona guard) | `.olym/steering/lane-ownership.yaml` |
| Zeus self-audit log | `.olym/audits/zeus-quality/` |
| Olym framework | `.claude-plugin/` (Claude Code plugin, no npm runtime dep) |
| Olym version lockfile | `.olym/VERSION` (0.7.10-alpha) |
| Cross-session memory (auto) | `~/.claude/projects/-Users-mac-Documents-coding-CTRL/memory/` |

## Current operating mode

**灵活开发** (bao 2026-05-25 lock): only ADR + code + PR. Spec/handoff/main-loop/RFC suspended.
Hard rules (English-only code, no `--no-verify`, lockfiles committed, ADR-001 spine v1 immutable, Keychain secrets) still enforced.

Run `bash scripts/fleet-status.sh` for tree state. Run `bash scripts/olym-doctor.sh` for install health.
