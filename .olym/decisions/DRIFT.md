<!-- ADR↔code conformance ledger. Owned by zeus (dike / quality). Not an ADR — no version frontmatter. One row per detected drift between a locked ADR and the running code. Direction column = which side is truth (bao ruling). Resolved drifts stay for provenance with their fix link. -->

# CTRL drift ledger — ADR ↔ 实装 conformance

> Per CLAUDE.md「ADR 跟实装不允许漂移 — 发现冲突立刻 superseded / amend」. zeus logs every detected divergence here, records bao's reconciliation direction, and closes it once ADR or code conforms.

## Open

| ID | Drift | ADR truth | Code reality | Direction (bao) | Owner / fix |
|---|---|---|---|---|---|
| **D5** | Stale FE comment claims "Pi default" brain | ADR-002 v20 §1.5: Pi MCP hop removed; Irisy chat routes through in-process provider router | `lib/llm-transport.ts:329` (+ stale copy at :174) comment still reads "active brain mcp (Pi default) via BrainRouter" — doc-rot, the Rust `irisy_chat_stream` actually calls `provider/routing.rs`. Cosmetic, no functional impact | code-fix (trivial) | dev: refresh the comment to "provider router (Pi exited, ADR-002 v20)" |
## Resolved

| ID | Drift | Resolution |
|---|---|---|
| **D1** | Default home = Ambient morphing (`AmbientWorkbench`), but ADR-003 v7 locked §7 4-col + 明令 "do NOT ship §8 as home" | **代码赢** (bao 2026-06-16). ADR-003 amended → **v8**: §8.5 records as-shipped Ambient home; §7 demoted to `ctrl:legacy-shell='1'` fallback. |
| **D2** | L1 chip set (`Sidebar.tsx`: Irisy/Tools/Notes/Coding/Packs/Discover/Settings/Model) matches neither §7.1 nor § nav-l1 | Folded into **D1 / ADR-003 v8 §8.5** — capability-agnostic §8.1 chip set recorded as truth; earlier specs = provenance. |
| **D3** | Irisy pane width: §7.8 says 380–430, changelog-v7 says 480/320–820, code says 480/300–640 | Folded into **D1 / ADR-003 v8 §8.5** — code (480, clamp 300–640) recorded as truth; both stale figures marked SUPERSEDED. |
| **D4** | (WITHDRAWN 2026-06-16) "Home chat still runs Pi" | **False premise** — re-verification of `irisy_chat.rs` + ADR-002 v20 §1.5 showed Pi already exited the hot path; home chat = in-process provider router. hermes is wired (install / one-shot / dashboard / hermes-first branch) but interception is intentionally **gated off** per bao 2026-06-12 decision A pending hermes ACP streaming — an ADR-002 v20 intended interim, NOT a drift. Residual cosmetic comment → D5. |
| **D8** | opencode wired up despite truth-source saying "未接线" | Truth-source (`architecture-byo-cli-driver.md` §2 / CLAUDE.md §7) recorded opencode as **未接线（保留作未来 coding 路径）**, but the implementation had grown a full opencode stack (installer / launcher / coding 路由 / UI). bao 2026-06-25 ruling: **opencode 下线,回归未接线** — opencode code removed; truth-source + CLAUDE.md descriptions updated to "已下线 (2026-06-25, bao 裁决;曾误接线,已移除)". Resolved this pass. |
| **D6** | hermes online via ACP — built + validated | **ADR + code shipped.** kernel `shell/acp_client.rs` (persistent hermes-acp + streaming) wired into `irisy_chat_stream`; JS probe + Rust `acp_smoke` both stream "ACP OK"; cargo + tsc green. Original premise `§1.8 v23 "ACP single door"` has since evolved: v27 demoted ACP to a future channel, **v38 re-promoted ACP** as the mechanism for the selectable right-region Irisy engine — code matches the current v38 §brain, not the old v23. Residual items (live GUI click-through, http `mcpServers` handshake against a live :17873) are runtime checks, not an ADR↔code divergence. Moved to Resolved 2026-06-30. |

| **D7** | Notes layer = Obsidian; kairo (SilverBullet) bundling retired (bao 2026-06-17 "用 obsidian 不要重复造轮子") | ADR-002 v24/v25 / ADR-001 v6 / ADR-003 v9 locked | **Backend SilverBullet bundle REMOVED 2026-06-17** (`AgentName::Kairo` + `install_via_binary` + `agent_launcher` webview branch + `AgentEndpoint::Webview` + supervisor prefetch + `list_agents` kairo). cargo + tsc green; ACP smoke still "ACP OK". Frontend untouched (bao: "前端尽量不动") — NotesApp + use-agent.ts kairo/webview types remain (dead, harmless). | **Backend切净 ✓; connector cargo-green (live-unverified)** | Done: (1) SilverBullet retired; (2) Obsidian connector built — `commands/obsidian.rs` + HTTP MCP client transport in `mcp_host` (P4 unblocked); cargo+tsc green. (3) NotesApp KEEP (§1.9 resolved). **Open**: live round-trip needs a machine with Obsidian + Local REST API plugin (no Obsidian here); verify streamable-HTTP vs older-SSE shape of plugin `/mcp/`; binary-size: 2nd reqwest 0.13 (`rmcp-reqwest`) added — consider unifying CTRL on 0.13. `/notes` "open in Obsidian" button = frontend, later. |

## Process

- A new drift → add an **Open** row before any fix, with file:line evidence + the conflicting ADR §.
- bao rules direction (代码赢 → amend ADR; ADR 赢 → code fixes, ADR untouched).
- On close → move to **Resolved** with the ADR version or commit that reconciled it.
- Reviewed each EOD audit (dike phase).
