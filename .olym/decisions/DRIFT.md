<!-- ADR↔code conformance ledger. Owned by zeus (dike / quality). Not an ADR — no version frontmatter. One row per detected drift between a locked ADR and the running code. Direction column = which side is truth (bao ruling). Resolved drifts stay for provenance with their fix link. -->

# CTRL drift ledger — ADR ↔ 实装 conformance

> Per CLAUDE.md「ADR 跟实装不允许漂移 — 发现冲突立刻 superseded / amend」. zeus logs every detected divergence here, records bao's reconciliation direction, and closes it once ADR or code conforms.

## Open

| ID | Drift | ADR truth | Code reality | Direction (bao) | Owner / fix |
|---|---|---|---|---|---|
| **D5** | Stale FE comment claims "Pi default" brain | ADR-002 v20 §1.5: Pi MCP hop removed; Irisy chat routes through in-process provider router | `lib/llm-transport.ts:262` comment still reads "active brain mcp (Pi default) via BrainRouter" — doc-rot, the Rust `irisy_chat_stream` actually calls `provider/routing.rs`. Cosmetic, no functional impact | code-fix (trivial) | dev: refresh the comment to "provider router (Pi exited, ADR-002 v20)" |
| **D6** | hermes online = **in progress (ACP)** | ADR-002 §1.8 v23: hermes assistant brain via **ACP single door** + 3-face MCP passthrough + KB=kairo/Notes-MCP + upgrade规范 | Today: `HERMES_FIRST=false`, hermes one-shot only (install / `assistant_oneshot` / dashboard `:17890`); no ACP client. Architecture locked, not yet built | **ADR locked (bao 2026-06-17), code TODO** | dev (hephaestus): build kernel ACP client + `hermes-acp-probe` + face passthrough wiring + version lockfile; remove dead `HERMES_FIRST` one-shot branch. 5-step shape in ADR-002 §1.8 |

## Resolved

| ID | Drift | Resolution |
|---|---|---|
| **D1** | Default home = Ambient morphing (`AmbientWorkbench`), but ADR-003 v7 locked §7 4-col + 明令 "do NOT ship §8 as home" | **代码赢** (bao 2026-06-16). ADR-003 amended → **v8**: §8.5 records as-shipped Ambient home; §7 demoted to `ctrl:legacy-shell='1'` fallback. |
| **D2** | L1 chip set (`Sidebar.tsx`: Irisy/Tools/Notes/Coding/Packs/Discover/Settings/Model) matches neither §7.1 nor § nav-l1 | Folded into **D1 / ADR-003 v8 §8.5** — capability-agnostic §8.1 chip set recorded as truth; earlier specs = provenance. |
| **D3** | Irisy pane width: §7.8 says 380–430, changelog-v7 says 480/320–820, code says 480/300–640 | Folded into **D1 / ADR-003 v8 §8.5** — code (480, clamp 300–640) recorded as truth; both stale figures marked SUPERSEDED. |
| **D4** | (WITHDRAWN 2026-06-16) "Home chat still runs Pi" | **False premise** — re-verification of `irisy_chat.rs` + ADR-002 v20 §1.5 showed Pi already exited the hot path; home chat = in-process provider router. hermes is wired (install / one-shot / dashboard / hermes-first branch) but interception is intentionally **gated off** per bao 2026-06-12 decision A pending hermes ACP streaming — an ADR-002 v20 intended interim, NOT a drift. Residual cosmetic comment → D5. |

## Process

- A new drift → add an **Open** row before any fix, with file:line evidence + the conflicting ADR §.
- bao rules direction (代码赢 → amend ADR; ADR 赢 → code fixes, ADR untouched).
- On close → move to **Resolved** with the ADR version or commit that reconciled it.
- Reviewed each EOD audit (dike phase).
