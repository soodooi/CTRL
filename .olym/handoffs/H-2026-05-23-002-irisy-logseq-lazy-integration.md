---
id: H-2026-05-23-002
status: open
priority: P1
lane: keycap (Hephaestus)
worktree: .worktrees/keycap
branch: keycap-dev
owner: hephaestus
created: 2026-05-23
dispatched-by: zeus
ship-mode: 灵活开发 / no PR / direct commit to keycap-dev
touches:
  - doc/setup-logseq-lazy-install.md        # NEW (user-facing setup flow doc)
  - THIRD_PARTY_LICENSES.md                  # NEW or AMEND (AGPL-3.0 Logseq entry + upstream source URL)
  - src-tauri/src/commands/                  # NEW logseq install / status command
  - packages/ctrl-web/src/...                # About panel: "Powered by Logseq · AGPL-3.0 · github.com/logseq/logseq"
  - packages/ctrl-web/src/components/manifest/registry.ts  # new "Open in Logseq" keycap (target=mcp-tool)
---

# Irisy ← Logseq lazy-install integration

## Why

CTRL Obsidian-philosophy locks markdown vault as user's truth. Logseq is the closest OSS spirit-twin (AGPL-3.0, local markdown vault, bidirectional links). bao 2026-05-23: "可以 作为asset在用户安装后立即安装" + "给Irisy lane 让他集成"。

Irisy should be able to read/write the same vault that Logseq edits, so the user can flip between Irisy (ambient AI companion) and Logseq (full GUI) on the **same files**. No import/export, no proprietary blob — vim test passes.

## Single ship goal

After installing CTRL, the user can opt-in to `Install Logseq` (one click in About / Settings or first-run flow). Once installed:

- Logseq lives as an **independent** AGPL-3.0 program on the user's machine (separate binary, not bundled).
- CTRL kernel's `vault.*` MCP tools point at the **same** directory Logseq is configured to use.
- A new keycap `Open in Logseq` (target=mcp-tool) deep-links to Logseq with the currently-focused note.
- Irisy can mention Logseq features in natural language ("open this in Logseq", "what's in my journal today") and route through MCP tools.
- AGPL §6 compliance: license file + upstream source URL + visible identity in About panel.

## Hard constraints (read before designing)

1. **Downloader not distributor** — do NOT bundle Logseq's binary in CTRL.app. Two acceptable install paths:
   - Preferred: shell out to `brew install --cask logseq` (mac) / winget / apt
   - Acceptable: fetch upstream GitHub release `.dmg` / `.exe` unmodified, run native installer
   - Never repackage, re-sign, patch, or fork Logseq's source
2. **AGPL §13 trap** — mesh viewer must NOT proxy Logseq's UI to remote devices (would force CTRL's mesh code to become AGPL). Mesh stays on CTRL's own cell streams.
3. **No combined-work appearance** — About panel must say "Powered by Logseq · AGPL-3.0 · github.com/logseq/logseq" so users know it's an independent component.
4. **No DRM / feature locks layered on Logseq** — AGPL §7 prohibits.
5. **Vault layout policy is the user's choice** — CTRL provides 3 options (flat / by-day / by-entity per CLAUDE.md philosophy), user picks; CTRL configures Logseq to match. Do not hardcode vault structure.
6. **No mock data anywhere** — first-run flow must hit real install commands, real Logseq probe, real vault read.

## Soft constraints (default but justify if you change)

- First-run prompt is **opt-in**, not mandatory. CTRL works fully without Logseq.
- The new keycap is **single-target** (`target=mcp-tool` per ADR-019), not a hermes-skill.
- Mac-first; Win/Linux follow once mac works.

## Open design questions (hephaestus decides, commit reasoning)

- **Vault overlap**: share one dir, or CTRL vault has Logseq subdir, or symlink? Pick + write down why.
- **First-run trigger**: setup wizard offers it, or Irisy nudges on first vault question?
- **Install detection**: how does CTRL know Logseq is installed? `brew list --cask | grep logseq`, AppKit path probe, or Logseq HTTP API ping?
- **Uninstall path**: if user removes Logseq, CTRL must keep working. Verify.

## Steps to start (hephaestus agent reads this top-to-bottom)

1. **Reconcile WIP** — there's an unstaged change in `src-tauri/src/commands/irisy.rs` in the keycap-dev worktree. Read it, decide commit-now / amend-into-prior-commit / discard, then proceed.
2. **Bring branch up to date** — merge `feat/h-2026-05-22-kernel-mcp-server` (or rebase) into keycap-dev so you have the kernel MCP server (ADR-013), composition runtime, and `Hide` button base. Resolve conflicts in `irisy.rs` carefully — hermes-update-detection commit and current `irisy.rs` both touch the same file.
3. **Write `doc/setup-logseq-lazy-install.md`** first — list every command, every fallback, every license obligation. bao reads docs, not commits. Per memory `feedback_document_setup_flows`.
4. **Implement install command** — `installs_logseq()` Tauri command that wraps the shell-out + status report.
5. **Wire the keycap** — `Open in Logseq` manifest entry, mcp-tool target.
6. **About panel update** — third-party attribution + link to Logseq source.
7. **`THIRD_PARTY_LICENSES.md`** — full AGPL-3.0 text + source URL.
8. **Verify in dev** — `bun tauri dev`, install Logseq via the new button, write a note in CTRL → see it in Logseq → edit in Logseq → see in CTRL.

## Non-goals (don't expand into these)

- Don't add SiYuan / AppFlowy integration in this handoff. Logseq first, generic framework comes later if pattern proves out.
- Don't write a Logseq plugin (the integration goes through Logseq's existing API + vault files).
- Don't proxy Logseq UI cross-device (AGPL §13).
- Don't refactor kernel vault.* tools — they're already correct from `feat/h-2026-05-22-kernel-mcp-server`.

## Acceptance

- bao runs `Install Logseq` from About panel, Logseq lands, opens, user picks vault dir, CTRL kernel vault.* reads/writes the same dir.
- Irisy answers "open the latest journal in Logseq" by calling `Open in Logseq` keycap.
- `THIRD_PARTY_LICENSES.md` + About panel show Logseq's AGPL identity.
- No fork, no patch, no bundled binary.
- bao approves: integration feels effortless, Logseq feels like an independent program CTRL just happens to know about.

## bao approval

bao 2026-05-23 verbal: "可以 作为asset在用户安装后立即安装" + "给Irisy lane 让他集成". Inherited approval.
