---
adr_id: 003
module: frontend
title: CTRL frontend — single PWA + 5-chip L1 nav (3-agent aggregator) + Keyboard drag-install + 4-col shell
version: 37
status: accepted
last_updated: 2026-07-28
deciders: [bao, zeus, daedalus]
sections:
  - { id: pwa,           source: orig-002 }
  - { id: nav-l1,        source: H-2026-06-09-002 校准 (replaces nav-keyboard single-Irisy v2) }
  - { id: vault-stack,   source: orig-020 — RETIRED in v5 (kairo replaces) }
  - { id: shell-4col,    source: new-2026-06-01 }
  - { id: agent-routes,  source: H-2026-06-09-002 校准 }
  - { id: macos-shell,   source: bao-2026-07-26-hidden-before-first-order-fullscreen-machine-proof-v29 (amends v28 fixed Accessory shell) }
  - { id: diagnostics-surface, source: new-2026-07-25-v26, note: "Developer-facing local diagnostics client for Irisy/Coding/Notes; typed Tauri only for capture/export controls, no duplicate runtime or raw log console." }
changelog:
  - v37 2026-07-28: **§8.5 amendment — Coding's composer `+` is one native macOS selection panel that permits multiple files and directories together (bao approved).** `@tauri-apps/plugin-dialog` cannot express this interaction because it exposes mutually exclusive file or directory modes; the PWA calls one typed Tauri command backed by `NSOpenPanel` with both selection modes and multi-select enabled. The command returns a typed split: regular files enter the unchanged shared ACP capability-negotiated ContentBlock attachment path and appear as removable chips; directories are inserted as explicit paths in the turn for OpenCode to inspect through its own filesystem tools. CTRL never recursively enumerates, reads, encodes, or uploads a selected directory: ACP attachments remain regular files with the existing size and capability limits. This replaces the two file/folder path-menu entries without adding a second transport, a new gate surface, or a parallel agent path. Pairs ADR-002 substrate §1.8.6 v75 and ADR-001 spine §4 v18.
  - v36 2026-07-27: **§8.6 amendment — Irisy's chat surface gains a session tab bar above the role switcher and relocates the agent/model selector below the composer (Kiro-parity redesign, bao "session，model，attachments等等模块都要"; pairs ADR-005 irisy §8.7 v32).** New `SessionTabs.tsx` renders one tab per entry in the new `lib/irisy-sessions.ts` store, mounted directly below `ChatHeaderControls` — a distinct row from the (still design-only, unimplemented) persona/feature-pack role switcher this section otherwise describes. `AgentSelector` moves from above the composer to a new `.bottomToolbar` row below it; the component and its selection logic are unchanged, only its position. Verified: `npm run typecheck` clean; `vitest run` 243/243 (22 new for the session store).
  - v35 2026-07-27: **§8.5 Coding composer gains drag-drop file attachments, consuming the ACP protocol layer's new capability-negotiated ContentBlocks (bao "拖拽要的"; governing decision at ADR-002 substrate §1.8.6 v75, pairs ADR-001 spine §4 v18, ADR-005 irisy §8.7 v31).** Files dropped onto `CodingScene`'s chat area are read client-side (native Tauri drag-drop path, not the browser `DataTransfer` File API) and rendered as removable chips above the composer before the user sends; on send they travel with the message as an attachment list, passed through `coding_chat_stream` to `AcpClient::prompt()`. Whether an attachment becomes an inline `Image`/`EmbeddedResource` ContentBlock or a text fallback notice is decided entirely by the protocol layer's capability negotiation (ADR-002 §1.8.6) — this scene does not duplicate that logic, it only supplies file bytes + MIME type. Scope: attachments are authoring reference material for opencode (a competitor screenshot, an API doc, a design reference) — not a data-import path, and not built for Irisy's own composer in this amendment (a distinct semantic, unscoped).
  - v34 2026-07-27: **§8.5 fix — `CodingScene.module.css`'s `.root` used `flex:1` outside a flex parent, so long assistant replies were clipped with no working scrollbar (bao report: "没法看到下方的内容").** `CodingScene` mounts inside `AmbientHome`'s `.scenePane` (`position:relative; overflow:hidden` only — NOT a flex container), so `.root`'s `flex:1; min-height:0` never had a flex parent to size against and the element fell back to shrink-to-fit block layout instead of filling scenePane's height. `.scroller`'s own `overflow-y:auto` therefore had no real height budget to scroll within, and content taller than the visible area was silently clipped by `.scenePane`'s `overflow:hidden` — a genuine bug, not just the (separately real, upstream) Chromium IME candidate-popup limitation reported the same session. Fix: `.root` now uses `height:100%` (matching `FeaturePackScene.module.css`'s `.scene`, the sibling component mounted in the exact same `.scenePane` slot, which already used this pattern for this reason) instead of `flex:1`. Verified: `npm run typecheck` clean, `vitest run` 221/221 (no regressions), Playwright visual check via the real Sidebar → Coding path with a 40-line mocked reply confirms the scroller's `scrollHeight` (1527px) now exceeds `clientHeight` (488px) and is reachable (auto-scroll lands at `scrollTop` 1039, the full "Line 40" tail renders on screen) — previously this content existed in the DOM but was geometrically unreachable.
  - v33 2026-07-27: **§7.6 amendment — the Coding composer shipped without the shared IME guard, so a CJK candidate-confirm Enter mis-fired submit instead of confirming the character (bao report: "为什么输入法会出现问题，没有提示的文字" — pinyin composition with no candidate popup, confirmed as the Chromium-webview candidate-window rendering gap PLUS a real missing-guard bug in the new composer).** §7.6 already locked ONE shared guard (`isImeComposing` in `lib/ime.ts`) every Enter-handling input must reuse — 2026-06-14's audit found 6 of 7 Enter inputs lacked it at the time; the Coding composer added in ADR-001 §4 v16/v17 (this same day) is a SEVENTH Enter-handling input that shipped without calling it, reproducing the exact class of bug §7.6 exists to prevent. `CodingScene.tsx`'s composer `onKeyDown` now calls `isImeComposing(e)` and returns before the Enter-submit branch, matching `IrisyChat.tsx`'s existing usage — no new guard invented, the existing one wired in. Separately: the Chromium-webview candidate-POPUP not rendering during composition (only the underline shows) is a documented upstream Chromium/WKWebView limitation (observed in other Chromium-webview products, e.g. Claude Code's desktop panel) that CTRL's frontend code cannot fix; the guard fix here only prevents Enter from mis-firing submit mid-composition, it does not restore the missing candidate popup rendering. Verified: `npm run typecheck` clean; `vitest run` 221/221 (4 new — `lib/ime.test.ts`, the guard function itself had ZERO test coverage anywhere in the codebase before this bug, despite being a locked shared contract since v24; covers the standard `isComposing` path, the legacy keyCode-229 fallback for IMEs that confirm without firing compositionend, the non-IME Enter case, and the raw-KeyboardEvent call shape).
  - v32 2026-07-27: **§8.5 Coding switches its primary surface from an embedded PTY (v31, same session) to opencode driven over Agent Client Protocol — no PTY, no terminal emulation (bao: verify against real products before committing further; pairs ADR-001 §4 v16, ADR-005 §8.7 v30).** v31's embedded xterm reproduced an actual rendering failure on the real machine — the Coding scene's terminal area stayed solid black even though kernel logs confirmed `opencode` was alive and its MCP handshake completed (`cs_spawn ok`, `client initialized`) — the SAME class of failure the v13/v27 external-terminal move had tried to duck. Root-caused via a real capability probe rather than patched a third time: a direct Node.js JSON-RPC probe against the installed `opencode acp` subcommand confirmed it speaks genuine ACP (`initialize` -> `session/new` -> `session/prompt`, streaming `agent_thought_chunk`/`agent_message_chunk` identically to hermes/codex/claude-code), and a survey of real third-party OpenCode desktop clients (`opencode-nexus` — Tauri + Astro/Svelte, `Services/OpenCodeClient (HTTP + SSE)`) confirmed none of them render the CLI's own TUI inside a host app; they all integrate via `opencode serve`'s REST+SSE or ACP. `CodingScene`'s main area now renders a native chat UI (message list + composer) fed by `coding_chat_stream` (new Tauri command, `src-tauri/src/commands/coding_chat.rs`), which drives a SECOND, independent `AcpClient` singleton (`coding_singleton()`) rooted at the selected workspace — deliberately separate from Irisy's own engine singleton so the two can never evict each other. Conversation state is kept per-workspace path in React state (not the engine's own session persistence) so returning to a workspace shows its prior transcript. Switching workspace while a session is live still confirms first, then calls `coding_reset_engine` (ends the ACP process) before starting the new one — same UX contract as v31, different mechanism underneath. `CodingTerminal.tsx` and `lib/coding-session.ts` (the PTY/xterm machinery and its Irisy-ambient-context coupling in AmbientHome) are deleted — there is no PTY left in the Coding module to expose. Verified: `cargo test --lib` 505/505 (3 new: `opencode_engine_argv_is_native_acp_subcommand`, `resolve_engine_binary_never_looks_up_opencode`, `irisy_and_coding_singletons_are_independent_slots`), plus a REAL end-to-end smoke (`opencode_acp_smoke`, `--ignored`) that spawns the actual installed `opencode acp` binary through the exact `AcpClient::start_in` path `coding_chat.rs` uses and receives a genuine streamed reply (`stopReason=end_turn`); `npm run typecheck` clean; `vitest run` 217/217 (no regressions).
  - v31 2026-07-27: **§8.5 Coding returns to an embedded PTY as the primary surface (bao: Coding must match every other module's [work area | Irisy] shape — content left, Irisy always right; not a new interaction, restoring v18's shape with v27's stability fixes actually applied — pairs ADR-001 §4 v15, ADR-005 §8.7 v29).** `CodingScene`'s main area now mounts `CodingTerminal` running the user's `opencode` directly, keyed by `command:cwd`, once the selected workspace has a projected `opencode.json`; the workspace `<select>` from v30 stays, now switching it (while a session is live) shows a confirm bar instead of silently killing the PTY. The v27/v30 external-terminal launch and the v30 launcher-hide behavior survive as a collapsed `<details>` "Open externally instead" — still available, no longer primary. Fixed the TWO real bugs that made v18's original embedded approach unstable rather than fixing them: `CodingTerminal`'s spawn effect now keys on `command + args.join('\0') + cwd` instead of the `args` array's object reference (a parent passing `args={[]}` as a fresh literal every render was respawning the PTY on every re-render, not just real changes), and the resident Irisy column is completely unmodified — no collapse/fold behavior was introduced (a prior draft of this amendment proposed folding Irisy into a narrow rail; bao corrected that Irisy is always-resident, not collapsible, before this landed). Verified: `npm run typecheck` clean, `vitest run` 217/217 (no regressions — `coding-launcher.ts`'s `selectWorkspaceId`/`selectTerminalId` are reused unchanged), Playwright visual check via the ACTUAL user path (Sidebar → AmbientHome's `scene==='coding'` embedded panel, not the orphaned standalone `/coding` route) confirms the embedded terminal renders left of an unchanged, always-visible Irisy column with the Coding role auto-linked.
  - v30 2026-07-26: **§8.5 Coding launcher gains a workspace selector — installed feature-pack scopes join the configured root as launch targets (bao "A"; pairs ADR-001 §4 v14, ADR-002 §1B.8 v74, ADR-005 §8.7 v28) — and now hides the launcher panel on launch (bao reported the always-on-top §1.1 v29 NSPanel visually overlapping the just-opened Terminal/OpenCode window).** `CodingScene.launch()` now calls the existing `hide_window` command (the same one the StatusBar × button and Ambient's Ctrl-hide already use) immediately after a successful `open_code` / `shell` / `editor` launch — every one of those brings a separate external app to the front, and CTRL's `PanelLevel::Status` + `CanJoinAllSpaces` panel (§1.1 v29) would otherwise keep floating over it. This does not change §1.1's hide/show mechanism, only adds one more caller of the existing `WindowController::hide` path; the Ctrl hotkey and tray remain the recovery route back to CTRL. Verified: `tsc --noEmit` clean; the WS/browser-dev fallback (`platform() !== 'tauri'`) makes this a no-op outside the desktop app, matching the existing StatusBar hide button's guard. `CodingScene` now shows a Workspace `<select>` (only rendered when more than one workspace exists, so the single-root case is visually unchanged) populated from `coding_launcher_status`'s `workspaces[]`, which the kernel now discovers as the configured root plus every direct child directory carrying `opencode.json`. Switching the selector re-scopes every launch/shell/editor action and the Quick Terminal (already keyed by `workspace.path`, so it remounts on workspace change per v27). `selectWorkspaceId`/`selectTerminalId` were extracted to `lib/coding-launcher.ts` as pure, unit-tested cross-refresh selection helpers (keep the current pick if it still exists, else fall back to the first one, else empty) so the fallback semantics don't rely on a DOM/Tauri harness to verify. Verified: `npm run typecheck` clean, `vitest run` 217/217 (8 new: `coding-launcher.test.ts`), Playwright visual check against a mocked `coding_launcher_status`/`launch_coding_workspace` confirms the selector lists both the root and a mock `ctrl-ghostfolio` pack workspace and that switching updates the shown path with no regression to the single-workspace layout. `LSUIElement=true` and fixed `ActivationPolicy::Accessory` apply before shell boot; the JSON-configured main window starts `visible:false` and `focus:false`, is converted and configured as the input-capable all-Spaces `NSPanel` while hidden, and is never generically shown before that conversion. `show_and_make_key()` is the sole macOS presentation path. A visible/focused configured `NSWindow` was rejected after reproducing `visible=true, active_space=false`; destroying and immediately rebuilding the same Tauri label was also rejected because webview destruction is asynchronous. Windows preserves WebView2 prewarm and missing-window recovery by building hidden, cloaking the HWND before first `show()`, then uncloaking. Fresh canonical `/Applications/CTRL.app` evidence after restart and immediate Ctrl hide/show reported `active_space=true` and `kCGWindowIsOnscreen=1`; a prior long-lived process later degraded to false/0, so cross-Space durability remains open Design Acceptance rather than a completed claim.
  - v28 2026-07-26: **§1.1 restores the fixed Accessory shell after real full-screen Space failure.** Fresh machine evidence showed lone-Ctrl delivery and toggle state were correct while a Regular process's panel remained `visible=true, active_space=false` and did not appear over another app's full-screen Space. CTRL now fixes `ActivationPolicy::Accessory` before shell boot, keeps the input-capable `CanJoinAllSpaces + FullScreenAuxiliary` NSPanel, and uses tray/LaunchServices reopen as recovery. Runtime activation-policy switching remains forbidden. This supersedes v25's Regular-app assumption while preserving one app, one kernel, and the canonical install.
  - v27 2026-07-25: **§8.5 Coding route becomes an external-terminal-first launcher (bao approved option A).** Both Ambient and `/coding` render one `CodingScene`. It shows the configured root, detected allowlisted terminal/editor targets, OpenCode executable/config presence, a manual command, explicit Refresh, and an explicit Launch action; it never auto-opens an app or starts OpenCode on mount. The embedded terminal is a disclosure-style Quick Terminal fallback with accurate expanded state and cwd-bound remounting. Pack directories are not shown because accepted pack projection does not include `opencode.json`. Loading is a live status; launch failures are alerts. Pairs ADR-001 §4 v13 and ADR-005 §8.7 v27.
  - v26 2026-07-25: **NEW § diagnostics-surface — minimal local developer harness.** The PWA may render one module selector plus status, non-mutating smoke results, and a bounded correlated timeline from ADR-010 §diagnostics. Capture controls are explicit and time-boxed; export first renders a redacted preview and only then allows the user to save locally. The surface is not a raw log viewer, does not expose content, and never starts or supervises ACP/PTY/watcher/index work.
  - v25 2026-07-22: **§1.1 scope correction — Regular macOS app + full-screen NSPanel.** bao accepted the smaller boundary after reviewing two days of launcher work: CTRL keeps its normal Dock, Command-Tab, and application menu recovery paths; only the Ctrl-summoned launcher surface is converted to an input-capable `NSPanel` with `CanJoinAllSpaces + FullScreenAuxiliary`. The process no longer sets Accessory activation policy and `LSUIElement` is removed. The tray and in-window Hide control remain conveniences, not mandatory recovery infrastructure. Daily `tauri:build` explicitly skips code signing; stable identity enforcement belongs only to the release/update path governed by ADR-004. This retires v24's no-Dock Accessory behavior without changing the one-app/one-kernel boundary.
  - v24 2026-07-20: **§1.1 NEW — macOS fixed Accessory shell.** bao accepted a single installed `CTRL.app` with no Dock or Command-Tab presence: `LSUIElement=true` plus a fixed `NSApplicationActivationPolicyAccessory`, never runtime policy switching. The lone-Ctrl launcher is an input-capable `NSPanel` with `CanJoinAllSpaces + FullScreenAuxiliary`; the menu-bar icon is the recovery surface (`Open CTRL`, `Open Config`, `Reload PWA`, `Quit`). Spotlight/Application relaunch reveals the existing singleton. This preserves one PWA, one kernel, and one installer; a separate helper app is explicitly deferred unless future workspace usability proves Dock/Command-Tab indispensable.
  - v23 2026-07-13: **§2 is explicitly historical/non-binding.** Its Pi-era single-entry navigation is retained only as provenance; the current frontend authority is §8.5 Ambient/Irisy/Hermes navigation plus §8.6's role model. No runtime or layout change.
  - v22 2026-06-25: **§8.6 NEW — 对话框上方角色切换器 (bao 理念「每个功能 = 角色 + 功能包,灵活配置不焊死」,配对 ADR-005 v6).** home 两正交轴:**L1 rail (左) = 数据/模块导航**(notes/tables/coding/…,`Sidebar.tsx` 不变);**角色切换器 (对话框上方) = Irisy 当前功能角色 = 每个 L1 一份 `(persona, 功能包[])` 灵活配置**,显示 + 切换在对话框上方,切角色对话流持续(不重置会话)。锁:(1) **角色 = (persona, 功能包) 配置,非焊死单元** —— persona 池 (`lib/irisy-prompts.ts`+`personas/irisy/*`) ⊥ 功能包池 (`lib/feature-pack.ts`+ 已装 MCP actions),各自可选项池,L1 用声明式配置组合,换 persona/加包 = 改配置不动代码,跨 L1 可复用;(2) **L1 ≠ 角色** —— L1 比角色大(含数据 + workspace),角色只是 L1 的 persona 面;有些 L1 不挂角色(discover/settings = 纯导航);(3) **位置 = 对话框上方**(`AmbientHome.tsx` 形变列头部);(4) **单一品牌声音不变**(ADR-005 单一品牌锁),切角色 ≠ 多重人格(始终是 Irisy)。bao 同步拍板 3 决策:**L1↔角色联动 = 是**(输入框上方显示现行角色 + 可手动切,切角色不改对话);**角色 = (persona, 功能包[], 知识库)** 三维,同 persona 按功能包+知识库派生(默认 = 个人知识库助理,股票角色 = 同 KB persona + 股票包 + 股票库);**v1 不做新建角色**(注册表留接口)。设计 SSOT = `vault/ctrl/irisy-roles.md`。本节锁设计,实装 = 后续切片(v1 未发)。NOT 改 spine;NOT 改单一品牌锁。
  - v21 2026-06-25: **Notes 模块收敛为薄 KB 层 + vault 根可配置 + 同步=组合(bao 多轮校准,事实源 `vault/ctrl/notes-module-plan.md`).** 重申 v9/v33「Notes = Obsidian 兼容、CTRL 不自带编辑器」并据业界调研(AI×Obsidian:无一工具重造编辑器,皆用 Obsidian 或操作 vault 文件)落地三块:(1) **Notes = 薄查看/导航层,不是 Obsidian 克隆** —— 废掉未提交 WIP 的 GraphView(中心图谱)+ CommandPalette(交给 Obsidian);保留树/搜索/标签/反链(只读导航)+ 轻量内联 markdown 编辑;**auto-save**(停手 700ms 自存,无手动 save);**文件夹管理**(新建/重命名/删除,右键文件夹头);树**可折叠**(120 文件平铺 → 折叠树);frontmatter 面板默认折叠。**修关键 bug**:`MarkdownViewer.isSmartTable` 因 `ensureRowIds` 注入系统 ID 列而恒真 → 每个笔记(含 README/空笔记)都开成智能表格 → 改判「有非系统列」。(2) **vault 根 = 用户配置**(非写死)—— `default_vault_root()` 改读 `~/.ctrl/config.json`,首次运行**原生文件夹选择器**(Tauri dialog 插件)引导用户指向自己的 Obsidian vault,`~/Documents/CTRL/` 退为 fallback;Settings→General→Vault 可切换。这样「CTRL 与 Obsidian 同 vault」靠配置成立 = 数据主权护城河。(3) **vault 同步 = 组合不自建** —— CTRL 不造同步;用户的 Obsidian Sync/Syncthing/iCloud/git 搬运文件即顺带同步 CTRL 读写(CTRL 不在数据路径);唯一助手 = 薄 `vault_git_sync`(init→add→commit→push,无 origin 降本地)+ Auto-sync 开关(定时+切走触发);**完整 mesh(ADR-002 §4 Automerge CRDT)留 v1.1+ 且仅给 CTRL 自有跨设备态,不碰 vault 文件**(两个 merge owner 损坏文件)。落点:`kernel/vault.rs`(configured/set vault_root + auto_sync)、`commands/{vault,git}.rs`、`components/{VaultSetup,notes/*}.tsx`、`hooks/useAutoSync.ts`、`viewers/{MarkdownViewer,useViewerResource}`。NOT 改 spine;NOT 自造编辑器/同步协议;收敛不推倒(废的是未入册 WIP)。
  - v1 2026-05-31: module reorg — merged orig-002 (PWA pivot + Irisy-as-sole-entry + Keyboard drag-install) + orig-020 (VMark stack adoption: Tiptap + CodeMirror 6 + mermaid + smart table + vault browser).
  - v2 2026-05-31: § nav-keyboard — Settings enters L1 (bao "L1 上的 setting 页面, 点击打开就是 setting 页面, 其中一个页面就是 providers"). Replaces v1 "Settings via StatusBar cog". L1 buttons under `▾`: [Chat] [New] [Vault] [Coding] [Settings]. Each opens its route in workspace EXPANDED area; no floating cog.
  - v3 2026-06-01: NEW § shell-4col — 4-column shell `[L1 | L2 | Tab | Irisy]` lock-in. bao multi-message校准 in workspace tab refactor (2026-06-01 session, ~$720 cost). Mcp surface (separate Tauri child window) retired in concept; ship still has bugs (see § shell-4col known-bugs list). v0.1.127 → v0.1.132 released during this session.
  - v4 2026-06-01: § shell-4col §7.1 column-order amendment — bao "顺序是工作区（内有tab），L2，L1，Irisy". Column model reordered LEFT→RIGHT to `[Tab | L2 | L1 | Irisy]`. L1 is now anchored immediately left of Irisy (not far-left). Rationale: Irisy + L1 stay visually pinned at the monitor's right; Workspace grows leftward when expanded, with L2 sandwiched between Workspace and L1. Compact mode still renders only L1 (48) + Irisy (430) = 478 px because Workspace and L2 collapse to 0. Anti-pattern §7.8 entry added: do NOT render L1 at column index 1.
  - v5 2026-06-09: **§ nav-keyboard → § nav-l1 — 5-chip 3-agent aggregator L1 (H-2026-06-09-002).** bao 2026-06-09 校准: 3 agents (hermes / opencode / kairo) are external; CTRL is the aggregator壳. L1 chips reorganized as 5 first-class routes mapping directly to capability surfaces: **Irisy** (PWA persona shell, default chat) / **Mcp pool** (MCP face discovery) / **Notes** (kairo webview) / **Coding** (opencode HTTP API + xterm) / **Assistant** (hermes MCP stdio). § vault-stack RETIRED — kairo owns markdown editor + wiki-link + backlink + git; CTRL doesn't ship its own editor. § agent-routes NEW: lock per-route agent endpoint contracts (kairo webview path / opencode HTTP port discovery / hermes MCP stdio handshake). Settings + Pool stay as before. § shell-4col 4-column shell preserved — agent routes render inside `[Tab]` column. Pre-v5 components retired in PWA: `IrisyChat forceMode="coding"` wrapper, `NotesApp` 3-pane (NotesTree/NotesEditor/NotesBacklinks), `MarkdownViewer` Tiptap shell, `BacklinksPanel`. PWA picks up sycophancy filter (relocated from `packages/ctrl-pi-bridge/data/persona-patterns.md` → `packages/ctrl-web/src/lib/persona-filter/patterns.md`).
  - v6 2026-06-11: **§8 NEW — morphing-conversation rebuild.** bao 2026-06-11 校准: CTRL is not a shell, it's an advanced UX paradigm at the app layer (UX + 通讯 + agent optimization); domain breadth via MCP/CLI/Skills, not built verticals. Synthesized from a 6-track product benchmark (launcher/routing/cockpit + marketing/office/finance verticals). Locks: one ambient morphing conversation (input-first floating surface), intent routing with visible pill + ambiguity-adaptive response (Lovable 3-way), morph-to-output-type via the 12-viewer registry, agent-workspace pane + tool stream, 3-layer drill-down, point-edit + checkpoint + accept/reject gate, capability-agnostic routing to the open MCP/CLI/Skill set, ambient scheduled tasks. §7 4-col shell + § nav-l1 5-chip SUPERSEDED for the home surface (chips survive as morph-layer shortcuts). 6-slice build sequence in §8.4. Invariants preserved: Ctrl summon · floating popup · Irisy(hermes) · coding(opencode) · kairo(notes).
  - v20 2026-06-21: **§6 smart-table minimal UI (reference getgrist) + own `tables/` folder + no doc-mixing.** bao 校准: the smart-table workspace must look like getgrist (minimal) and must NOT collide with the user's Obsidian notes. Three changes, no kernel change, no testid loss: (1) **Minimal Grist-style toolbar** — Filter / Sort / Group / Fields collapse from an inline control row into flat icon buttons + popovers (`SmartTableView` unified `openMenu` state); view switch = flat underline tabs (not a boxed segmented control); all controls borderless with a hover wash only; glide grid lines → hairline (`SmartTableGrid` theme `borderColor`/`horizontalBorderColor`). (2) **Own `tables/` folder** — `listSmartTables` now scans ONLY `tables/` (createSmartTable/importCsv already write there), so smart tables never collide with Obsidian notes elsewhere in the vault. (3) **No doc-mixing** — the §079e17c "unified workspace" Tables/Docs/Templates tree DROPS the Docs section (it scanned the whole vault = every Obsidian note, violating the per-L1 module boundary); the sidebar is now Tables + Templates only (docs belong to the Notes module). Closes a prior decision vacuum (there was no recorded "minimal UI / reference getgrist" decision; only code-level Grist borrowing in `smart-table-opensource-eval-and-plan.md`). Truth source: `vault/ctrl/smart-table-minimal-ui.md`.
  - v19 2026-06-20: **§6.2 view-state read/write loop CLOSED + doc sync (architecture-conformance review).** Independent review confirmed §14 PASS but flagged a real drift: kernel `add_view` wrote frontmatter `views` while the frontend viewer used ephemeral `useState` + `parseSmartTable` never read `views` — the §6.2 "view state in frontmatter" lock was not closed-loop (Irisy-set views invisible, user views lost on refresh). FIXED: `smart-table.ts` parses + serializes `views` (handles the kernel JSON-emit form via key-unquote); `SmartTableView` initializes from `views[0]` and persists via a "Save view" button → frontmatter. +2 round-trip vitest. Also: `ai_column.rs` module doc corrected (async triple is shipped, not "next slice"). NOTE: sync `run_ai_column` intentionally coexists with the async triple for small (<100-row, cost-gated) batches. Remaining deferred: produce review gate (ADR-006 §4), QuotaExhausted backoff, TextSource/BlobSource.
  - v18 2026-06-20: **§6.5.4 merge-by-row identity via plan-time snapshot (closes the last merge divergence).** `plan_rows` snapshots each row; `apply_results` writes back to an index only if the row still matches its snapshot (ignoring target) — an edited/shifted row mid-run is safely skipped, not mis-targeted. +1 kernel test (`apply_skips_when_row_changed_under_it`), 181 green. Remaining open: `QuotaExhausted` backoff, produce review gate (ADR-006 §4).
  - v17 2026-06-20: **§6.5.4 closes 2 shipped-divergences (bounded concurrency + AuthFailed-stop).** Async AI-column job now runs the plan in chunks of MAX_CONCURRENCY=6 via `futures::future::join_all` (bounded fan-out lock satisfied; rate-limit safety) with cancel+AuthFailed checked between chunks; `complete_row` returns a typed `ProviderError` so an `AuthFailed` row stops the whole job. Remaining open: merge-by-`row_id` (no row-identity primitive), `QuotaExhausted` backoff, produce review gate (ADR-006 §4). 180 kernel tests green.
  - v16 2026-06-19: **§6.5.4-shipped as-built reconcile (independent-checker review of full §14 branch).** Full §14 implementation shipped + reviewed PASS (`feat/unified-query`, 11 commits, 180 kernel tests): 4 RecordSources (smart-table/KB/registry/providers) on one shared `run_query` engine, smart-table full produce surface, run_ai_column sync + async job triple, `complete_row` provider-drain now unit-tested with a fake Provider (closed the checker's "real path untested" Should-fix — the schema-bug lesson). Documents what the shipped AI-column job DIVERGES from the §6.5.4 locks (do not mark satisfied): concurrency is **sequential** not Semaphore-bounded; merge-by-row uses row **index** not `row_id` (no identity primitive yet — row insert/delete mid-run mis-targets); error policy is **record+continue for all** (no QuotaExhausted backoff / AuthFailed-stop); **produce review gate not implemented** (parity with `vault::write`, §14.6 gate clause unmet, ADR-006 §4 future). Also fixed: smart-table schema survives the real `vault::read`/`write` YAML round-trip (unit tests had masked the on-disk path).
  - v15 2026-06-19: **§6.5.1 describe = TOOL not resource (impl-shipped reconcile, independent-checker flag).** First §14 vertical shipped (`feat/unified-query`: `kernel/query.rs` QuerySource + shared filter/sort/group engine, `kernel/vault_smart_table.rs` first RecordSource, gate tools `smart_table.{describe,query,update_cell,append_row}`, 14 kernel tests green, code-reviewer PASS). Reconciles the §6.5.1/.2 "schema resource" wording: as built, the type layer is the TOOL `smart_table.describe`, not an MCP resource — rmcp 1.7 resources are not enabled in the kernel (`enable_tools()` only) + a tool is guaranteed model-visible (Hermes `list_tools`). §14 "describe verb" governs; anti-hallucination unchanged (Irisy calls describe before query). produce write-path piggybacks `vault::write` (review-gating still ADR-006 §4 future). run_ai_column async-job trio + add_view remain unimplemented (next slices).
  - v14 2026-06-19: **§6.5 reframed — smart-table = first implementation of the Unified Operation Interface (ADR-002 §14, bao「修改架构」).** The query engine generalized from a smart-table feature to a substrate-level contract: all content-type feature points (md/html/table/pdf/connector) operated via ONE interface — `describe`/`query`/`produce` — on the :17873 gate. §6.5's machinery is now the first `QuerySource` (RecordSource) instance: `get_schema`→`describe`, the filter/sort/group query → RecordSource `query` profile, write tools + `run_ai_column` job → `produce` (through review gate). Notes=TextSource, html/pdf=BlobSource follow the same 3 verbs (zero bespoke tools). Query is a kernel service, not a table feature. No content change to §6.5.1–.7 mechanics; this is the altitude/ownership reframe. Research source adds `research-unified-operation-interface.md`.
  - v13 2026-06-19: **§6.5.4 AI column = async job + hard-problem locks (impl research: rmcp-1.7 probe + Airtable production lessons + MCP SEP-1686).** `run_ai_column` is NOT one sync write tool (would block minutes on a big table) — it's a **call-now/fetch-later job triple** `.start`(→job_id)/`.status`(poll-for-truth)/`.cancel` (§6.5.2 updated), forward-compatible with MCP SEP-1686 Tasks. Locks: bounded concurrency via `tokio::sync::Semaphore` (rate limits are Airtable's real failure mode); partial-failure ≠ abort (`errors[]` + backoff on `QuotaExhausted`, stop on `AuthFailed`); **idempotent resume via row-level state** (re-run only non-complete rows, no duplicate spend); cancellation token; **write-back = merge-by-row + re-read-at-write, NOT whole-file overwrite** (else a mid-run user edit is clobbered — `vault::write` is lock-free last-write-wins); **cost gate = 100 rows** (bao: >100 rows needs explicit user confirm before spend, `.start` returns `needs_confirmation{row_count}`). Widens the narrow surface by 3 tools — justified: no correct *synchronous* form exists. Research source: `vault/ctrl/research-ai-data-platforms.md`.
  - v12 2026-06-19: **§6.5.2/.3 mechanism correction — ADR↔impl drift fix (rmcp static-schema probe).** Impl research (`mcp_server.rs`: rmcp `#[tool]` generates each tool's JSON schema at COMPILE time, no runtime dynamic schema) invalidated v11's "field/group_by enums dynamically generated from the live table schema". Corrected: table-INDEPENDENT fixed sets (`op`, view `kind`, ai `op`) stay genuine static enums; table-DEPENDENT params (`field`/`group_by`/`inputs`/`target_field`) become **validated strings** — Irisy reads the `smart_table.schema` **resource** first (ChatBI schema-injection) and a non-existent field is rejected at parse time with `field_not_found{valid:[…]}` for self-correction. Core principle (Irisy fills constrained params, schema=semantic layer) unchanged; enforcement moves compile-time-enum → resource-injection + runtime-validation (one notch softer, standard MCP-database pattern). Injection point = MCP resource (bao chose, option 1).
  - v11 2026-06-19: **NEW §6.5 Irisy operation surface — benchmarked vs Dify / Coze / ChatBI / Airtable + MCP resource-vs-tool pattern (bao 2026-06-19「联网深入研究 + 给实现思路 + 落盘」).** Core principle: **Irisy fills enum-constrained tool params, never free-generates a query** (convergent lesson of all 5 benchmarks; CTRL has no SQL backstop so it's load-bearing). Locks: schema as MCP *resource* + `smart_table.*` *tools* (query/upsert_row/update_cell/add_view/run_ai_column), all params enum-validated from the live frontmatter schema (= lightweight semantic layer, ChatBI lesson); AI column = Airtable `{field}`-token per-row batch; business layer = MCP connectors via `mcp_proxy_*` not built-in verticals; structural anti-hallucination (enum fields + param-object queries + structured returns). **OPEN DECISION §6.5.6**: deterministic multi-step orchestration A(hand-off)/B(markdown `task:` spec ★)/C(pure brain) — bao to rule. Build order §6.5.7. Research source: `vault/ctrl/research-ai-data-platforms.md`.
  - v10 2026-06-19: **§6 Smart table → intelligent table — benchmarked vs Feishu Bitable (bao 2026-06-19「实现飞书的一些功能」+「落盘到 ADR 唯一真相」).** §6.1 on-disk shape unchanged; NEW §6.2 field sub-formats (rating/progress/currency/percent) + multiselect + email/phone/attachment + grid+kanban multi-view with `view.*` in frontmatter (view-state ≠ data) + record card; NEW §6.3 **AI field shortcuts** (column-bound batch AI: classify/tag/extract/summarize/translate, routed through Irisy + `:17873` gate, honest-degrade when gated — the table-surface realization of §8.2-F AI-as-column); NEW §6.4 out-of-scope locks: automation-flow + button-trigger fields PERMANENTLY excluded (不做清单 / one-shot), relational = `[[wikilink]]` soft links only (NO FK — deliberate fork from Feishu's relational core), formula/lookup/rollup/dashboard/gallery/calendar/gantt/form/templates deferred v1.x. Research fact source: `vault/ctrl/research-feishu-bitable.md` (8 Feishu official docs + 4 woshipm deep articles, web-verified 2026-06-19).
  - v9 2026-06-17: **Notes layer = Obsidian, kairo retired (bao 2026-06-17; pairs ADR-002 v24 / ADR-001 v6).** `/notes` = inline md viewer + "open in Obsidian" (CTRL bundles no editor — don't reinvent the wheel); §8 invariant "kairo notes" → "Obsidian notes (user's own)". Data access stays editor-independent on kernel notes-MCP :17873. Historical "kairo" in earlier changelog rows (v5/v6) is provenance, superseded here.
  - v8 2026-06-16: **§8 morphing-conversation REINSTATED as the SHIPPED home surface — code-won reconciliation (zeus drift review 2026-06-16).** The `ui/v1-editorial` branch (v0.1.260→**v0.1.276**) shipped the Ambient morphing home as the default render path, reversing v7's §7-4col lock WITHOUT amending this ADR — a 17-version ADR↔code drift caught in zeus's全局 review. bao 2026-06-16 ruling: **代码赢** — Ambient morphing IS the truth; this ADR conforms to reality. Locks the SHIPPED implementation (§8.5 NEW): home = `AmbientWorkbench` (3-zone `[Sidebar L1 | AmbientHome morphing column | routed-page Outlet]`, mounted across every route); `AmbientHome` morphing column = Irisy chat pane right-anchored, width **480px** default, divider-draggable **300–640** (`AmbientHome.tsx:147,201`); §7 4-col shell DEMOTED to legacy fallback behind `localStorage ctrl:legacy-shell='1'` (`app.tsx:50`). L1 = `Sidebar.tsx` icon rail (~52px), chips: Irisy / dynamic connector Tools / Notes / Coding / dynamic Feature Packs / [spacer] / Discover / Settings / Model badge — all unified-size inline-SVG icons (bao 2026-06-16 "L1 icons must all be the SAME size"). Routed pages (Settings/Coding/Notes/Pool) render via `<Outlet>` inside a `.routeHost` with a `← Irisy` back bar — this is now intended, not the v7 "open item". Editorial commits folded in: whole first line = window drag region, minimal action bar above composer, single vertical grid line, hermes dashboard iframe in Settings → Irisy (`:17890`). §7.8 Irisy-width anti-pattern (380–430) SUPERSEDED by the 480/300–640 range. The §nav-l1 5-chip and §7 4-col are NO LONGER the home truth; both retained as provenance.
  - v7 2026-06-13: **§7 shell-4col REINSTATED — bao reverts the v6 §8 morphing home surface back to the locked 4-column shell. RE-REVERTED by v8 (Ambient morphing is the shipped home).** bao 2026-06-13: "我一直要的是这个布局… Irisy常驻", pointing back to §7 v4 `[Tab | L2 | L1 | Irisy]`. The v6 morphing-conversation home was a detour; the SHIPPED home is the §7 4-col shell. Implementation (v0.1.255→v0.1.259, PWA `AmbientHome`/`AmbientWorkbench`): L1 rail moved from the workbench far-left INTO AmbientHome's middle column, glued to Irisy's left (honours §7.8 anti-pattern: L1 never far-left); Irisy pane ALWAYS pinned far-right, widened 430→**480px**, divider-draggable 320–820; work area (Tab) leftmost, L2 collapsed by default; window total width 1280→**1480**. CTRL logo top-left of window; "Irisy" label inside the right Irisy pane. Markdown reply styling + per-reply Copy / Copy-conversation added. **Open item**: route pages (Settings/Coding) render with AmbientHome hidden → they currently lose the in-layout L1 and navigate back via the route topbar back bar; decide whether to restore a route-level L1. §8 morphing-conversation retained as a future direction, no longer the shipped home surface. **LESSON (process)**: read ADR-003 §7 BEFORE touching layout — skipping it cost a long detour of ad-hoc layout edits (Irisy left/right/centered) that merely re-derived the already-locked §7 spec.
related:
  - vault/ctrl/adrs/001-spine.md
  - vault/ctrl/adrs/002-substrate.md
  - vault/ctrl/adrs/005-irisy.md
---

## §1 Single PWA codebase

UI layer = single `packages/ctrl-web` (React 18 + Vite 5 + TanStack Router/Query + Zustand + Framer Motion + vite-plugin-pwa). Same bundle runs in Tauri 2 WebView on desktop AND any browser on mobile. Bridge: Tauri 2 `invoke()` on desktop (intra-process), WebSocket + token on mobile (127.0.0.1:17872, intra-device).

L0 native shell (`src-tauri/src/shell/`) stays ≤ ~500 LOC Rust — hotkey / tray / window / keychain / kernel_supervisor only. All UI / settings / mcp workspace live inside PWA — no native UI windows beyond shell-summoned WebView.

## §1.1 macOS fixed Accessory shell + hidden-before-first-order launcher panel

macOS ships as one installed `CTRL.app`. The bundle declares `LSUIElement=true`, and the process fixes `ActivationPolicy::Accessory` before shell boot; runtime activation-policy switching is forbidden. The process intentionally has no Dock or Command-Tab entry. The tray (`Open CTRL`, `Open Config`, `Reload PWA`, `Quit`) and launching the canonical app again through Applications, Launchpad, or Spotlight are recovery paths that reveal the existing singleton.

The configured main window MUST start with `visible:false` and `focus:false`. While it is still hidden, shell prewarm converts the Tauri-created `NSWindow` to an input-capable nonactivating `NSPanel` and applies Status level plus `CanJoinAllSpaces + Stationary + FullScreenAuxiliary`. No macOS path may order, focus, or generically `show()` the configured window before conversion and panel configuration complete. Destroying that window and immediately rebuilding label `main` is not an alternative: Tauri webview destruction is asynchronous and leaves the label occupied during setup.

`NSPanel::show_and_make_key()` is the sole macOS presentation authority for Ctrl toggle, tray open, single-instance reveal, LaunchServices reopen, and recovery rebuilds. Generic `WebviewWindow::show()` is forbidden on the macOS presentation path because it can bind the original window to the startup Space before AppKit orders the all-Spaces panel. Hide uses the panel path; visibility remains the toggle source of truth, while `isOnActiveSpace` is presentation telemetry only.

This fixed Accessory + hidden-before-first-order NSPanel contract is the authority for appearing over another application's native full-screen Space. The rejected visible-first Regular-window state delivered the lone-Ctrl event and reached `visible=true` but reported `active_space=false` and remained off the active full-screen Space. After restarting the canonical `/Applications/CTRL.app`, a fresh show and immediate Ctrl hide/show cycle each reported `active_space=true` and CoreGraphics `kCGWindowIsOnscreen=1`. That evidence proves the startup and immediate-cycle path only: an earlier long-lived process later degraded to `active_space=false` / `kCGWindowIsOnscreen=0`, and its cause is unresolved.

### §1.1 Design Acceptance (non-release)

- [x] Fresh canonical-app startup, first Ctrl show, and immediate hide/show over another application's native full-screen Space report `active_space=true` and CoreGraphics `kCGWindowIsOnscreen=1`.
- [ ] The same canonical process remains onscreen after a real user work session that includes switching away from and back to at least one native full-screen Space; capture both panel telemetry and CoreGraphics state without restarting.

The shared Tauri window configuration remains hidden on Windows too. Windows MUST cloak the HWND before its first `show()` so WebView2 can prewarm without exposing pixels; missing-window recovery MUST also build hidden, cloak before first show, then uncloak. Subsequent presentation remains DWM cloak/uncloak. The PWA, kernel, resource packs, updater, local data, and workspace content remain in one process. A separate helper app or parallel development app remains out of scope. Daily unsigned builds are compile evidence only; canonical installation identity remains governed by ADR-004.

## §2 L1 navigation — historical Pi-era model (retired, non-binding)

> **Historical only.** This section records the pre-v8 Pi-based navigation model and is not a
> current implementation requirement. The governing home/navigation model is §8.5
> (`AmbientWorkbench`, capability-agnostic Sidebar, Irisy/Hermes path) with the role context in
> §8.6. References to Pi below are preserved solely as provenance.

User-facing single entry: **Irisy** (Pi's expression). User does NOT switch between assistant/creator/coding modes — Pi internally dispatches based on conversation context + active mcps' skills.

L1 nav lives on the left rail (48 px, ADR-001 §4 ui-ux), top to bottom:

```
[▾ / ▴]        ← workspace toggle (always top, never goes away)
[Chat]         ← builtin-assist persona (Irisy default chat)
[New]          ← builtin-create persona (make a mcp)
[Vault]        ← /vault browser
[Coding]       ← Code Space (ADR-005 § remote-view surface)
   (spacer)
[Settings]     ← always bottom
```

Each L1 button (NOT just `▾`) opens the workspace area in EXPANDED state and renders the corresponding route as the workspace content. Settings is no exception — clicking L1 Settings opens `/settings` in the workspace area; `/settings/providers` / `/settings/brain` / etc. are sub-pages inside the Settings page. There is NO floating cog in StatusBar / corner — the workspace IS the design target for these pages (bao 2026-05-31: "L1 上的 setting 页面, 点击打开就是 setting 页面, 其中一个页面就是 providers").

User-facing intents only; never expose mcp ids like "Assist" / "Create" / "Pool" / "Provider" — internal codenames stay internal (ADR-005 § persona v1).

Workspace layout — 2 visual states only:
- **COMPANION** (default, 430 px): `[L1 48] [Irisy chat 382]`
- **EXPANDED** (1800 px, clamp to monitor): `[L1 48] [workspace area 1370] [Irisy chat 382]`

Window right edge anchored top-right of primary monitor. Expansion grows leftward (Irisy stays visually). L1 `▾`/`▴` chevron toggles the workspace area; clicking any other L1 button while in COMPANION expands automatically. Independent Tauri windows for workspace are forbidden (0.1.95 user feedback "关都不知道怎么关").

## §3 Keyboard = drag-install dock

The Keyboard (always-on left grid) is the **drag-target for mcp installation**. Replaces Pool's install-button flow.

| Drag source → Keyboard | Effect |
|---|---|
| Pool mcp card | Installs to `~/.ctrl/mcps/<id>/`, runs ADR-002 § composition cap_asset provisioning, mcp appears on grid |
| External `.zip` / `mcp.json` | Same after manifest validation |
| GitHub URL | Fetch manifest, validate, install (ADR-007 § skill-discovery path) |
| Mcp → trash zone | Uninstall (`rm -rf ~/.ctrl/mcps/<id>/`) |
| Mcp → reorder | Persists Keyboard layout state |

Drop-zone highlights on valid drag; reject + toast on invalid manifest. Post-install: Irisy detects new active skills in next turn. No restart, no "enable" toggle.

Pool stays as **browse surface** (preview only); install path always Keyboard drop.

## §4 Vault viewer stack (CTRL-native, NOT VMark dep)

VMark is a **compatibility commitment, not a substrate** (memory `decision_vmark_not_substrate_use_open_stack`). CTRL uses the same open-source primitives VMark uses, imported directly:

| Content-type | Viewer | Lib |
|---|---|---|
| `text/markdown` | `MarkdownViewer` | Tiptap + StarterKit (WYSIWYG + Source toggle) |
| `application/json` | `JsonViewer` | CodeMirror 6 + lang-json |
| `text/yaml` | `YamlViewer` | CodeMirror 6 + lang-yaml |
| `text/toml` | `TomlViewer` | CodeMirror 6 + legacy-modes/toml |
| `text/html` | `HtmlViewer` | iframe `sandbox=""` + CodeMirror source mode |
| `image/svg+xml` | `SvgViewer` | inline render + CodeMirror source |
| `text/mermaid` | `MermaidViewer` | mermaid.js |
| `text/x-ctrl-smart-table` | `SmartTableViewer` | Tanstack Table |
| `application/pdf` | `PdfViewer` | browser `<embed>` + companion `.md` link |
| `image/*` | `ImageViewer` | `<img>` + zoom toggle |
| `text/*` (generic) | `CodeViewer` | CodeMirror 6 no lang |

All viewers `lazy()` — critical-path stays under 200 KB mobile cap. Triple-axis viewer resource model: `source ∈ {vault, mcp, system}` × `editable: bool` × `companion?: string`.

## §5 Vault browser `/vault`

Three-pane VMark-style entry into `~/Documents/CTRL/`:

```
[ Tree + search 220px ] [ Preview via ViewerHost ] [ Backlinks 220px ]
```

- Tree groups paths by top-level folder
- Search hits `vault_search` FTS5 (≥2 chars debounced)
- Click selects (preview); double-click opens in active workspace as `vault-md` tab; Cmd-click opens new instance
- Save delegates to `vault_write` (preserves frontmatter)
- Backlinks scans client-side for `[[stem]]` + `[label](path.md)` — kernel index follow-up

`VaultBrowser` reused inside Pool mcp detail panel ("edit prompt.md").

## §7 Shell 4-col layout (v3 2026-06-01; v4 column order 2026-06-01) — `[Tab | L2 | L1 | Irisy]`

> **STATUS (v8, 2026-06-16): LEGACY FALLBACK — no longer the shipped home.** The shipped home is now §8.5 (Ambient morphing, `AmbientWorkbench`). This 4-col shell renders ONLY behind `localStorage ctrl:legacy-shell='1'` (`app.tsx:50`). Retained as provenance + escape hatch. Its §7.8 Irisy-width 380–430 constraint is SUPERSEDED by §8.5's 480/300–640. See changelog v8.

**Why this section exists**: bao 2026-06-01 multi-message refactor (`你怎么这么蠢？无非就是最简单的tab和导航` + `L2和tab，是两个东西` + `mcp这个是pool` + 5 release iterations v0.1.127 → v0.1.132). The previous 2-col `[L1 | Irisy]` shell could not host the workspace tab paradigm; an ad-hoc Tauri child window (`WorkspaceSurface` + `toggle_workspace_window`) was filling that role and conflicting with the inline cockpit. This section locks the canonical 4-column shell.

### §7.1 Column model (v4 ordering — bao 2026-06-01 `顺序是工作区（内有tab），L2，L1，Irisy`)

LEFT → RIGHT:

| Column | Width | Role |
|---|---|---|
| **Tab** (leftmost) | 0 (no workspace) / 1fr (any workspace instance open) | Workspace tab content — `<WorkspaceShell />` from `components/workspace/`. Renders `InstanceSwitcher` (pill row) + `TabBar` (horizontal tabs) + active tab body. Grows leftward when expanded. |
| **L2** | 0 (compact) / 200px (when active L1 has sub-nav) | Secondary nav for the active L1 item — VS Code-style sidebar. Reserved column; sub-nav components land per L1 item as needed. **L2 and Tab are two separate things** (bao explicit). |
| **L1** | 48px fixed | Primary nav rail. Vertical icon-only chips: ▾ (window expand toggle, top), Irisy, Mcp pool, Coding, Settings (bottom). Anchored immediately left of Irisy. Always visible. |
| **Irisy** (rightmost) | 430px fixed | Always-on right pane. `<IrisyChat />` + `<InfraBar />` (kernel/MCP/vault chips at bottom). Anchored to monitor right edge. |

CSS file: `packages/ctrl-web/src/app.module.css`. Driven by `--l1-width / --l2-width / --tab-width / --irisy-pane-width` CSS vars + `data-workspace-open / data-l2-open` attributes on `.shell`. Status bar spans all 4 columns at top via `grid-template-areas`. v3 had columns in `[L1 L2 Tab Irisy]` order; v4 reorders to `[Tab L2 L1 Irisy]` per bao spec — L1 stays glued to Irisy's left, Tab grows leftward.

### §7.2 Window-size states

- **Compact**: window ≈ 478px. Only L1 (48) + Irisy (430) render. No workspace open. Sufficient for "ask Irisy a question, dismiss" loop.
- **Expanded**: window ≈ 1100px+. All 4 columns visible. Toggled via the `▾` chevron at the top of L1 (calls Tauri `toggle_workspace_window` which slides the main window's left edge 430 ↔ 1600). User-driven; L1 chip clicks do NOT auto-expand or auto-compact the window (bao 2026-06-01 `L1切换为什么要关掉工作区？`).

### §7.3 L1 click semantics

| L1 chip | Behaviour |
|---|---|
| ▾ (top) | Tauri `toggle_workspace_window` — manual window expand/compact only. |
| Irisy | `navigate('/')` — Irisy is always rendered in the .irisy column; clicking refocuses route only. |
| Mcp pool | `openSystemTab({id:'pool', path:'/pool', title:'Mcp pool'})` — opens a route tab in the singleton "system" workspace instance. Window is NOT auto-expanded. |
| Coding | `openSystemTab({id:'coding', path:'/coding', title:'Coding'})`. |
| Settings (bottom) | `openSystemTab({id:'settings', path:'/settings/ctrl', title:'Settings'})`. |

System instance: `workspace-store.ts::openSystemTab(tab)` — singleton id `ws-system`, layout `tabs`, idempotent on `tab.id`. Non-mcp L1 chips share this instance.

### §7.4 Mcp page = Pool route (NOT a separate Tauri window)

bao 2026-06-01: `mcp这个是pool，用于管理mcps`. The legacy `WorkspaceSurface` (separate Tauri child window opened by `toggle_workspace_window` with `?surface=workspace`) is **retired in concept**. The mcp grid view is the `/pool` route, opened as a Tab in the main window via the L1 "Mcp pool" chip.

`main.tsx` no longer branches on `?surface=workspace` — it always renders `<App />`. The Rust `toggle_workspace_window` command was repurposed to drive main-window left-edge resize (per the system.rs comment); future work should rename it to `toggle_main_window_expanded` and retire `?surface=workspace` query handling end-to-end.

### §7.5 Persistence + rehydration

`workspace-store.ts` uses zustand `persist` middleware (key `ctrl-workspace-store`, version 2). A stale shape from earlier sessions immediately flipped `data-workspace-open=true` on boot which collapsed the StatusBar grid row at compact 430px window width ("can't see version" symptom). Resolved at v0.1.132 via `version: 2` + `migrate` that returns an empty store for any pre-v2 payload. Any future change to `WorkspaceInstance` MUST bump this version.

### §7.6 IME input

`IrisyChat.tsx` textarea uses `onCompositionStart` / `onCompositionEnd` + `isComposingRef` to skip `setInput` while the IME is composing (Chinese / Japanese / Korean). The final string commits on `compositionend`. Without this React's controlled `value` round-trip closes the IME popup mid-keystroke. The shared Enter-submit guard is `isImeComposing` (`lib/ime.ts`, v24) — EVERY Enter-handling input in the app must call it before treating Enter as submit, including the Coding composer (v33).

### §7.7 Known bugs (ship-blockers for v1)

These were surfaced during the 2026-06-01 refactor session and are NOT yet resolved as of v0.1.132. A follow-up session must address them before the shell is considered stable:

1. **Duplicate cockpit window** (v0.1.132 screenshot) — `toggle_workspace_window` Rust command still opens a Tauri child window with `?surface=workspace` URL. With v3 `main.tsx` removing the WorkspaceSurface branch, that URL falls through to `<App />`, producing a second full cockpit. Fix: either retire the child-window code path in Rust entirely, or have `main.tsx` render `null` for `?surface=workspace`.
2. **Stale localStorage** — even with v2 migration in place, users on v0.1.131 with active sessions may have cached zustand state pre-rehydration. Future schema changes should bump again and tolerate orphaned keys.
3. **Comprehensive frontend review pending** — the `ecc:react-reviewer` agent stopped at $720 session cost. A fresh-session full audit of all ~25 frontend files is required before further refactor.

### §7.8 Anti-patterns (do NOT do)

- Do NOT call `toggle_workspace_window` from L1 click handlers — it is a toggle, will collapse an already-expanded window (bao 2026-06-01 `L1切换为什么要关掉工作区？`).
- Do NOT render `<WorkspaceShell />` outside the `.tab` grid area — the hidden `<Outlet />` was double-mounting it via `/` route until v0.1.130 (`routes/default.tsx` now returns `<></>`).
- Do NOT add new route components inside `<Outlet />` that mount heavy stateful chat / poll loops — they will run hidden and race against the shell-level mount (bao 2026-06-01 BUG 1: `/irisy` route mounted second `IrisyChat`).
- Do NOT widen the Irisy column past 430px or shrink it under 380px — chat readability is calibrated to that range.
- Do NOT render L1 at column index 1 (leftmost). L1 sits at column index 3, immediately left of Irisy (v4, bao 2026-06-01 `顺序是工作区（内有tab），L2，L1，Irisy`). Workspace tab area grows leftward from L1.
- Do NOT spawn a Tauri child window for the workspace (pre-v3 path). The workspace tab area renders inside main window's `.tab` grid cell; `toggle_workspace_window` resizes main's left edge 478 ↔ 1600 only.

## §6 Smart table → intelligent table (v10 — 2026-06-19, benchmarked vs Feishu Bitable)

> **STATUS (v10):** smart-table grows from a single-view markdown grid into the
> **intelligent-table capability**. Scope below is benchmarked against Feishu
> Bitable (research fact source: `vault/ctrl/research-feishu-bitable.md`) and
> deliberately trimmed to CTRL philosophy (plain-text / one-shot / local-truth /
> AI-is-pipe). The §6.1 base (on-disk shape) is unchanged; §6.2–§6.4 are new.
> The AI-field-shortcut decision is the table-surface realization of §8.2-F
> "AI-as-column".

### §6.1 On-disk shape (unchanged — vim test passes)

On-disk file = plain markdown with YAML frontmatter `schema:` block + pipe table body:

```markdown
---
title: Reading list
schema:
  - { key: title,  label: Title, type: text }
  - { key: rating, label: ★,     type: number, min: 0, max: 5 }
  - { key: done,   label: Done,  type: checkbox }
  - { key: tags,   label: Tags,  type: tags }
---

| Title    | ★ | Done | Tags  |
|----------|---|------|-------|
| Anathem  | 5 |      | scifi |
```

vim opens as markdown table. Obsidian/VMark render as plain markdown table. CTRL `SmartTableViewer` = editable Tanstack Table with per-column cell editors (text/number/date/checkbox/tags/select/url). Edit → re-serialize → `vault_write` preserves schema block + frontmatter.

Schema language minimal (key/label/type/options?/min?/max?). Anything more complex stays markdown/yaml viewer.

### §6.2 Fields + multi-view (v10)

- **Field types** extend the 7 base cell editors (`text/number/date/checkbox/tags/select/url`)
  with: number sub-formats (`rating` / `progress` / `currency` / `percent`),
  `multiselect`, and `email` / `phone` / `attachment-path`. Storage stays the raw
  scalar; the sub-format is a **render hint** in the schema, never a new on-disk
  encoding (vim still sees the plain value).
- **Multi-view, one file**: a single `.md` derives **grid + kanban** views
  (kanban groups by a `select`/`checkbox` field; dragging a card rewrites that
  field's cell). Calendar / gallery / gantt / form views are backlog (§6.4).
- **View state is not data**: sort / filter / group / hidden-columns / column-width
  persist in frontmatter `view.*` and **never mutate the markdown table body**.
  Round-trip rule extends: parse → edit (cell *or* view state) → serialize keeps
  the table body byte-stable except edited cells; `view.*` lives only in
  frontmatter.
- **Record card**: a row expands into a detail card (reuses the cell editors).

### §6.3 AI field shortcuts ★ (v10 — the differentiator, realizes §8.2-F)

Feishu's lesson we adopt: **AI lives *on the column* as a "field shortcut", not
in a side chat.** An AI field is a schema column bound to an instruction that
**batch-runs the whole column** ("auto-update" on new rows): classify / tag /
extract / summarize / translate.

- **Every AI call routes through Irisy + the `:17873` gate** — NOT a direct
  provider call from the viewer (cross-ref ADR-005 § irisy, ADR-002 § provider
  gate). This is the table-surface form of §8.2-F "AI-as-column" + §8.2-D
  transparency.
- **Honest degrade**: with the gate closed (ADR-002 v20 hermes interim) the AI
  column renders read-only — it must not silently fall back to a raw provider
  call (consistent with §6 ADR-006 §6 cold-start honest-degrade posture).
- Result cells **land in the markdown body** like any other cell (drill-down to
  the raw model output stays available per §8.2-D 3-layer), with the schema
  marking the column AI-derived so a hand-edit is distinguishable.

### §6.4 Out of scope (philosophy, not backlog gaps)

- **Automation flow editor + button-trigger fields** — collide with the 不做清单
  (workflow editor = Coze/n8n) and the one-shot rule (§8.3 ban). **Permanently
  excluded**, not deferred.
- **Relational = soft links only**: cross-table references use `[[wikilink]]` +
  vault backlinks (§5 / kernel `vault_index.rs`), **not** database foreign keys.
  This is the deliberate fork from Feishu's relational core (link / lookup /
  rollup) — the price of staying single-file plain-text. Real FK relations
  re-evaluated in v1.x, never at the cost of the vim test.
- **Deferred to v1.x** (kept on the capability list, not v1): formula engine,
  lookup/rollup, dashboard charts, gallery/calendar/gantt/form views, templates,
  real-time co-edit/comments/cell-permissions (the last gated behind the Automerge
  CRDT substrate, ADR-002 § crypto).

### §6.5 Irisy operation surface (v19 — 2026-06-20, benchmarked vs Dify / Coze / ChatBI / Airtable)

> **v14 reframe (bao「修改架构」2026-06-19):** smart-table is now the **first implementation
> of the Unified Operation Interface — ADR-002 §14** (describe / query / produce over all
> content-type feature points). What §6.5 specifies below is no longer table-specific
> machinery — it is the **first `QuerySource` (RecordSource)** instance of a substrate-level
> contract. Terminology maps onto §14: `smart_table.schema`/`get_schema` → **`describe`**;
> `smart_table.query` → the RecordSource **`query`** profile (filter/sort/group); the write
> tools + `run_ai_column` job → **`produce`** (through the review gate). Later sources (notes
> = TextSource, html/pdf = BlobSource, CRM = RecordSource) implement the same three verbs, so
> they need zero bespoke tools. The query engine is a **kernel service** (ADR-002 §14.1), not
> a smart-table feature.
>
> How Irisy actually *operates* a smart table. §6.1–§6.4 said what the table is;
> this says how the brain reads/writes/queries it. Research fact source:
> `vault/ctrl/research-ai-data-platforms.md` + `research-unified-operation-interface.md`
> (Dify/Coze/ChatBI/Airtable + GraphQL/Plan9/agentic-AI; MCP resource-vs-tool pattern).
>
> **v12 correction (impl-grounded, `mcp_server.rs` probe 2026-06-19):** rmcp's
> `#[tool]` macro generates each tool's JSON schema **at compile time** from a static
> struct — there is no runtime/per-call dynamic schema. So v11's "field/group_by enums
> *dynamically generated from the live table schema*" is **not implementable**.
> Mechanism corrected below: **table-INDEPENDENT** fixed sets (`op`, view `kind`,
> ai `op`) stay genuine static enums; **table-DEPENDENT** params (`field`,
> `group_by`, `inputs`) become **validated strings** — the model sees the valid set
> via the `smart_table.schema` **resource** (ChatBI schema-injection) and a wrong
> field is rejected at runtime with a structured error to self-correct. The Core
> principle is unchanged; only the enforcement moves from "compile-time enum" to
> "resource-injection + runtime validation" (one notch softer, and the standard MCP
> database pattern).

**Core principle (the convergent lesson of all 5 benchmarks):**
> **Irisy fills *constrained tool parameters*; it never free-generates a query or
> logic.** ChatBI's semantic layer, MCP's enum-constrained tool args, Coze's
> description-matched dispatch, and Airtable's `{field}` tokens all converge here.
> CTRL has no SQL engine to backstop a bad query, so this rule is load-bearing,
> not optional.

**§6.5.1 Layering.** The type layer (describe) and the actions (query/produce)
are projected on the :17873 gate. MCP's canonical pattern is schema-as-*resource*
+ actions-as-*tools*; **as SHIPPED (v15, 2026-06-19), describe is a TOOL**
(`smart_table.describe`), NOT an MCP resource — because (a) rmcp 1.7 resources are
not enabled in the kernel (`mcp_server.rs` declares `enable_tools()` only) and
(b) a tool is guaranteed model-visible (Hermes discovers tools via `list_tools`;
it may not auto-read resources). The §14 "describe verb" framing governs; the
earlier "schema resource" wording is superseded. Anti-hallucination is unaffected:
Irisy calls `smart_table.describe` before querying, exactly the ChatBI
schema-injection move.

```
Irisy (Hermes brain) — calls describe first, then fills validated params, never raw queries
  │
:17873 gate ── smart_table.describe (TOOL — fields/types/operators → the "semantic layer")
           └─ smart_table.{query,update_cell,append_row,…} (TOOLS — all params validated)
  │
kernel smart_table ops (parse / query / mutate / ai-column) — NEW kernel surface
  │
vault/*.md (plain-text + frontmatter schema) = truth
  │
MCP connectors (CRM/ERP) → gate mcp_proxy_* → mirrored into smart-tables
```

**§6.5.2 Tool surface — deliberately narrow, param-constrained, structured returns**
(per "minimize tool surface / use static enums where the set is fixed / avoid
free-form query strings / return JSON"). Notation: `‹enum›` = genuine compile-time
enum (table-independent); `‹str✓›` = static string validated at runtime against the
table's frontmatter schema (table-dependent, so it cannot be a per-call enum — see
v12 correction):

| tool | kind | params |
|---|---|---|
| `smart_table.schema` | resource | field keys / types / `options` values / `{field}` ref tokens — **Irisy reads this first**; the semantic layer |
| `smart_table.query` | tool (read) | `filters:[{field‹str✓›, op‹enum: eq/contains/gt/lt/within/…›, value}]`, `sort`, `group_by‹str✓›`, `limit` — Irisy fills a **filter object**, not logic |
| `smart_table.upsert_row` | tool (write) | row object; field keys validated against schema |
| `smart_table.update_cell` | tool (write) | `row_id` + `field‹str✓›` + `value` (type-checked) |
| `smart_table.add_view` | tool (write) | `kind‹enum: grid/kanban›` + `group_by‹str✓›` → writes frontmatter `view.*` |
| `smart_table.run_ai_column.start` | tool (write, **async job**) | `target_field‹str✓›` + `prompt` (`{field}` tokens) + `inputs:[field‹str✓›]` + `op‹enum: classify/extract/summarize/translate/generate›` → returns `job_id` (call-now/fetch-later — a single sync tool would block 17 min on a big table; see §6.5.4) |
| `smart_table.run_ai_column.status` | tool (read) | `job_id` → `{state, rows_done, rows_total, errors:[{row, msg}]}` — **poll-for-truth** (rmcp 1.7 has no progress notifications) |
| `smart_table.run_ai_column.cancel` | tool (write) | `job_id` → cooperative cancel |

Anti-hallucination is layered (resource-injection + runtime validation, not a hard
compile-time wall): (1) Irisy reads `smart_table.schema` (resource) first, so it
**sees** the valid field names + `options` before composing a call — the standard
ChatBI schema-injection move; (2) `query` is a structured **parameter object**, not a
query string — there is no free-form query language to hallucinate; (3) a
table-dependent `field` that doesn't exist is **rejected at parse time with a
structured `field_not_found` error** listing valid fields, so Irisy self-corrects on
the next turn; (4) the table-independent sets (`op`, view `kind`, ai `op`) are real
static enums the model literally cannot stray from; (5) returns are structured JSON +
match-count so Irisy can verify the result.

**§6.5.3 frontmatter schema = the lightweight semantic layer.** CTRL ships no
database, but the frontmatter `schema:` (keys / types / `options` values) already IS
a semantic layer — exposed via the `smart_table.schema` **resource** that Irisy reads
before querying. Seeing `next_followup:date` + `status:select[新线索|跟进中|…]`, "show
this week's follow-ups" resolves to `{field:next_followup, op:within, value:this_week}`.
A hallucinated field is **not unrepresentable** (rmcp can't pin a per-table enum) but
is **caught**: the kernel validates `field` against the parsed schema and returns
`field_not_found{valid:[…]}` for self-correction. This is ChatBI's "narrow
open-generation into constrained selection" — achieved via schema-injection +
validation rather than SQL, the standard MCP-database pattern.

**§6.5.4 AI column** (`run_ai_column`) = Airtable/Feishu's proven form: prompt with
`{field}` reference tokens, applied per-row down the column, routed gate→provider
(BYOK key in keychain), result lands in the markdown cell with `derived:true` in
schema (visible + hand-editable = transparency); honest read-only degrade when the
gate is closed (no silent direct-provider fallback). Realizes §6.3 + §8.2-F.

**§6.5.4-impl — it's an async *job*, not a sync tool** (v13, impl-grounded:
`mcp_server.rs` rmcp-1.7 probe + Airtable production lessons + MCP SEP-1686). A
column run is 50–500 provider calls; a single synchronous tool would block the MCP
call for minutes. So it is a **call-now / fetch-later job** — the recognized MCP
long-running pattern (`.start`→`job_id`, `.status` poll, `.cancel`), forward-compatible
with MCP SEP-1686 Tasks once rmcp adopts it. "**Poll-for-truth**": `.status` is
authoritative; CTRL ships no progress notifications (rmcp 1.7 lacks them) and doesn't
fake them. Hard-problem locks:

- **Bounded concurrency**: a `tokio::sync::Semaphore` caps in-flight completions
  (≈4–8); unbounded fan-out hits provider rate limits (Airtable's real failure mode:
  a 200-row batch drops requests). Per-row deadline via `ChatOpts.deadline_ms`.
- **Partial failure ≠ abort**: a failed row is recorded in `errors[{row,msg}]` and the
  run continues. `QuotaExhausted` → exponential backoff; `AuthFailed` → stop the whole
  job (user must fix the key); others → record + skip. Reuses `provider/routing.rs`
  cooldown/failover, `provider/types.rs` error classes.
- **Idempotency / resume = row-level state** (Airtable lesson: a per-row Pending/Done/
  Error status is what makes re-run safe). Re-running an AI column **only processes rows
  not already complete** (empty target cell or an error marker); filled cells are left
  untouched unless the user forces a full re-run. No duplicate spend on a resume.
- **Cancellation**: a `CancellationToken`/`AtomicBool` polled in the row loop; `.cancel`
  flips it; already-written cells stay (they're complete).
- **Write-back = merge-by-row, re-read at write time — NOT whole-file overwrite.**
  `vault::write` is whole-file, lock-free, last-write-wins; writing the whole table from
  a job-start snapshot would **clobber a user edit made mid-run** (the user may edit row 5
  while the AI processes row 200). So the job writes back by **re-reading the file and
  merging only the target column's cells by `row_id`**, never a stale full-table
  overwrite. (Batched flush is fine — flush every K rows — as long as each flush re-reads
  + merges.)
- **Cost gate = 100 rows** (bao 2026-06-19): a column run over **> 100 rows** must get an
  explicit user confirm before starting (Irisy asks; the `.start` tool refuses an
  unconfirmed over-threshold run and returns a `needs_confirmation{row_count}` signal).
  BYOK is the user's own money; a 5000-row run is a real bill. ≤ 100 rows runs directly.

This job model adds 3 tools (§6.5.2) — a deliberate, justified widening of the otherwise
narrow surface, because there is no correct *synchronous* way to do it.

**§6.5.4-shipped (v16, 2026-06-19 — as-built reconcile, independent-checker review).**
The job triple shipped (`feat/unified-query`: `kernel/ai_column.rs` + `run_ai_column_start/
status/cancel` + a sync `run_ai_column`; `complete_row` provider-drain unit-tested with a
fake Provider). What MATCHES the locks above: call-now/fetch-later, poll-for-truth status,
cooperative cancel (flag polled per row, written cells kept), idempotent resume (skips
filled cells), cost gate = 100 rows, write-back re-reads fresh before applying. What
DIVERGES (honest, like the v15 describe-as-tool reconcile — do not mark the locks
satisfied):
- **Concurrency: bounded (chunked, max 6) — DONE (v17).** The background job runs the plan in
  chunks of `MAX_CONCURRENCY=6` via `futures::future::join_all`, satisfying the bounded-fan-out
  lock (rate-limit safety). Cancel + AuthFailed are checked between chunks. (A `Semaphore` would
  give finer-grained streaming parallelism; chunked join_all is the bounded form shipped.)
- **Merge-by-row identity via plan-time SNAPSHOT — DONE (v18).** `plan_rows` captures each
  row's snapshot; `apply_results` writes the AI result back to row `index` ONLY when that row
  still matches the snapshot (ignoring the target field). A row edited / shifted (insert/delete)
  mid-run no longer matches → its result is safely DROPPED, never mis-written. This is the safe
  "by row identity" form without an explicit id column.
- **Error policy: AuthFailed stops the whole job — DONE (v17); QuotaExhausted backoff still
  deferred.** `complete_row` now returns a typed `ProviderError`; an `AuthFailed` row breaks the
  chunk loop (the key is broken — retrying every row is waste). Other per-row failures are
  recorded in `errors[]` and the run proceeds ("partial-failure ≠ abort"). `QuotaExhausted`
  exponential backoff is the remaining deferred piece.
- **Produce review gate: not implemented** (parity with `vault::write`; ADR-006 §4 future).
  §14.6's "produce always passes the review gate" clause is NOT yet satisfied for any write.

**§6.5.5 Business layer = MCP connectors, not built-in verticals.** CRM/ERP arrive
as MCP connector modules proxied through the gate (`mcp_proxy_*`; `notes_connector.rs`
is the precedent). Data either stays in the source system (connector reads/writes,
local = mirror) or is mirrored into a local plain-text smart-table (local = truth).
Cleaner than Dify custom-API-tools / Coze plugins: MCP is an open standard and
data/credentials stay local, not custom plugin formats with cloud-hosted data.

**§6.5.6 OPEN DECISION — deterministic multi-step orchestration (bao to rule).**
Dify and Coze both keep a *dual track* (chat + visual workflow) because reproducible
multi-step business flows need determinism that autonomous-agent orchestration can't
guarantee. CTRL cut the visual workflow editor (§6.4 / 不做清单). That leaves a gap
for "every Monday: pull → tag → report → push". Three options:

| opt | meaning | cost |
|---|---|---|
| **A** hand it off | multi-step flows live in the user's own Coze/n8n, triggered via a connector | keeps 不做; CTRL can't run "recurring" tasks itself |
| **B** declarative one-shot spec ★ | a `task:` block written in markdown (trigger + steps, text not flowchart), scheduled by the kernel | restores determinism, honors plain-text (vim test), does NOT break "no visual editor" — but needs a new scheduler |
| **C** pure brain | push all multi-step onto Hermes autonomous orchestration | simplest; same instability as Coze's agent mode |

Recommendation **B** (markdown `task:` spec = vault-native, deterministic, no
flowchart). **Not yet decided — this is a direction call for bao.**

**§6.5.7 Build order (smallest slice first).**
1. `smart_table.schema` resource + `query` tool (anti-hallucination floor — Irisy reads/queries correctly).
2. Read loop through the gate end-to-end (also exercises the P2 gate / function-calling path).
3. Write tools (`upsert_row` / `update_cell` / `add_view`).
4. `run_ai_column` (most proven, but depends on the provider loop).
5. One CRM connector mirror as the business-layer demo.
6. (If B chosen) declarative `task:` scheduler.

## §8 Morphing-conversation rebuild (v6 — 2026-06-11)

> **STATUS (v8, 2026-06-16): SHIPPED home surface.** bao 2026-06-16 ruled 代码赢 — the Ambient morphing home (`AmbientWorkbench`) is the default render path; §7 4-col is the legacy fallback. The conceptual §8.1–§8.4 locks below stand; §8.5 (NEW) records the as-shipped implementation truth. See changelog v8.

bao 2026-06-11: CTRL is NOT a shell wrapping 3 OSS agents — that's commodity. The product is an **advanced UX interaction paradigm at the application layer**, core = UX + communication (通讯) + agent optimization. The engines (hermes assistant / opencode coding / **Obsidian** notes — user's own, v24, not CTRL-bundled) are swappable; domain breadth (marketing/office/finance/anything) comes from the open ecosystem of **MCP servers + CLI + Skills** (3-capability-face, ADR-002), NOT from CTRL building verticals. This section locks the rebuild, synthesized from a 6-track product benchmark (Raycast/Spotlight/Alfred/ChatGPT/Cursor/Warp/Zed; ChatGPT-Canvas/Claude-Artifacts/Perplexity/Replit/Lovable/v0; Manus/Devin/Flowith/public.com/TradingView/Bloomberg; Gamma/Jasper/Descript/HeyGen; M365-Copilot/Gemini/Coda/Rows/Granola). Invariants (fixed): Ctrl-key summon · floating popup form · Irisy 助理 (hermes) · Irisy coding (opencode) · Obsidian notes (user's own, v24 — not CTRL-bundled) · everything else rebuildable.

### §8.1 Concept — one ambient morphing conversation

Ctrl summons a floating, input-first, ephemeral surface. The user talks to **one** Irisy. CTRL classifies intent and ROUTES it — to a core agent OR any installed MCP/CLI/Skill — shown transparently. The surface MORPHS to the output type (chat inline; coding/notes/data/html open a side panel via the content-type viewer registry). The conversation is the spine/transcript; artifacts leave reopenable chips. The frontend is **capability-agnostic**: it routes + renders + lets the user install missing capabilities, and hardcodes no vertical.

### §8.2 Locked decisions (each backed by ≥2 benchmarked products)

**A. Shell (summon + surface)**
- Input-first, always-focused, vertically anchored; empty state = bare input bar; surface height animates to content; auto-collapse on blur. *(Raycast Compact, Spotlight)*
- Esc = back one level / dismiss at root; Enter = primary action; modifier-Enter = secondary; every action shows its shortcut. *(Raycast Action Panel)*

**B. One conversation → intelligent routing (the core)**
- One universal input, intent-routed, NOT a tab per capability. `@` grounds on vault files (cap ~20 refs); `/` invokes actions/skills/mcp. *(Warp universal input, Word `/file`, Raycast)*
- **Routing pill shown before work starts** — `→ Coding` / `→ Notes` / `→ <mcp>` / `Answering`. Hidden routing is the #1 anti-pattern. *(Perplexity modes, Zed tool indicators)*
- **Ambiguity-adaptive response** (the answer to "how does Irisy decide"): intent clear → do it directly; visually/strategically open → show 2-5 variant cards side-by-side; key decision missing → ask ONE tight structured question set. Never a mandatory wizard. *(Lovable 3-way fork)*
- Capabilities = open set: 3 core agents + any installed MCP/CLI/Skill. Missing capability → Irisy discovers + suggests install (Mcp pool / Discover). *(ADR-002 3-capability-face)*

**C. Morph to output type (the "functional windows")**
- **Render the answer AS the native artifact**, not a chat bubble describing it (a chart object, a table, an editable doc, an HTML view). *(Excel charts/pivots, Rows cells)*
- One neutral content model → many render targets; flip target without regenerating; output-type switch on the artifact. *(Gamma cards, Canva Magic Switch)*
- Conversation drives the artifact; artifact stays primary in a side panel beside the chat. The 12 existing viewers (Markdown/Code/Html/Json/Yaml/Toml/Svg/Image/Pdf/Mermaid/SmartTable/Fallback) are the morph targets. *(Claude Artifacts, ChatGPT Canvas, TradingView)*

**D. Transparency + agent workspace (the "通讯" core)**
- **Agent-workspace side pane ("X's Computer")**: live step/activity stream of what the engine is doing, with mid-task take-over/interrupt. *(Manus, Devin, ChatGPT virtual computer)*
- Capability/tool selection shown, not hidden; tool calls render inline as they fire. *(Zed)*
- **3-layer drill-down**: processed result → raw model output → sources/prompt/context injected. Every figure/summary keeps a provenance link to the raw vault item. *(Anthropic visible thinking, Perplexity citations, Outlook summary)*

**E. Edit + safety (the "trust")**
- Inline-targeted edit + scoped regenerate (smallest unit), never destructive full-regenerate. *(Gamma per-card, Excel per-cell)*
- Point-don't-describe: select element on the artifact → edit inline / property panel / NL-with-selection-attached / annotate-sketch. *(Lovable, v0)*
- Stage-then-apply (pending edits) + version history; checkpoint-restore on every file/vault mutation → maps to vault git. *(v0 pending-edits, Zed checkpoints)*
- Accept/reject/iterate gate (Keep it / Regenerate / Discard); consequential actions (money/destructive) → "intent → reviewable workflow → approve → execute". Never silent overwrite. *(Word, public.com, ChatGPT permission gates)*
- Fixed quick-action chips for the common 80% (Rephrase/Shorten/Summarize/Action-items); free-text for the rest. *(Gemini Docs, Granola)*

**F. Ambient / OS-level (the ambition)**
- Recurring/scheduled tasks from the conversation ("every Mon 9:00 refresh these metrics"); async heavy jobs you can leave and return to. *(ChatGPT tasks, public.com, HeyGen jobs)*
- Capture sparse → enhance async, local-first, no bot joins; AI-as-pipe over clipboard/screen/audio. *(Granola)*
- Persistent brand/voice/style + saved context as **markdown+frontmatter in the vault** (vim test). *(Jasper Brand Voice, Lovable design brief)*
- AI-as-column: one instruction applied per-row across structured vault data. *(Coda, Rows, Notion)*

### §8.3 Anti-patterns (hard bans — all converged across tracks)
Feature potpourri / tab-soup / disconnected point-solutions (Genspark cautionary, Copy.ai thesis, Warp critique) · hidden/silent routing · sidebar-only AI that describes instead of producing the artifact · black-box agent with no visible plan/tools/takeover · destructive full-regenerate or silent overwrite · mandatory wizards / over-questioning trivial asks · un-cited numbers / hidden data sources · acting on consequential intent without a review gate · mandatory cloud/account/embeddings before first value · over-dense simultaneous dashboards.

### §8.4 Build sequence (slices, each version-bumped + verified)
1. **Ambient conversation shell** — input-first anchored surface + routing pill + ambiguity-adaptive scaffold. Reuses IrisyChat transport.
2. **Morph layer** — conversation → side-panel artifact via the existing ViewerHost registry; output-type switch; artifact chips in-thread.
3. **Agent-workspace pane + tool stream** — live activity + take-over, wired to opencode `/event` + MCP tool calls.
4. **Edit + safety** — inline/point edit, pending-apply, checkpoint (vault git), accept/reject gate.
5. **Capability routing to open set** — MCP/CLI/Skill discovery + install + route, capability-agnostic.
6. **Ambient** — scheduled tasks, async jobs, brand-voice-as-markdown, AI-as-column.

Slices 1-2 realize the core "one morphing conversation"; 3-4 the transparency+trust moat; 5-6 the open-ecosystem + ambient-OS reach. The pre-v6 4-column shell (§7) and 5-chip nav (§ nav-l1) are SUPERSEDED for the home surface by §8.1; chips survive only as capability shortcuts inside the morph layer.

### §8.5 As-shipped implementation truth (NEW v8 — 2026-06-16, zeus drift reconciliation)

This subsection records what the shipped PWA actually renders (v0.1.276), so the ADR stops drifting from code. Authoritative over §7 + § nav-l1 for the home surface.

**Shell — `AmbientWorkbench` (3 zones, mounted across every route)** — `packages/ctrl-web/src/components/ambient/AmbientWorkbench.tsx`:

| Zone | Component | Behaviour |
|---|---|---|
| **L1 rail** | `Sidebar.tsx` (~52px icon rail) | Always mounted; glued to the morphing column's left. Acting from a routed page navigates home first, then signals `AmbientHome` via props. |
| **Morphing column** | `AmbientHome.tsx` | Stays MOUNTED even when a route owns the screen (`hidden={!isHome}`) so chat state + nonce effects survive a Settings/Notes visit. Holds the Irisy chat pane + output bar. |
| **Routed-page host** | `<Outlet>` inside `.routeHost` | Settings / Coding / Notes / Pool render here with a `.routeTopbar` carrying a `← Irisy` back bar + `☰` menu. This back-bar return path is INTENDED (resolves the v7 "open item"). |

**L1 chips (top→bottom)** — `Sidebar.tsx:79-163`, all unified-size inline-SVG (one 24-viewBox, stroke 1.7; bao 2026-06-16 "L1 icons must all be the SAME size"):

1. **Irisy** (sparkle) — conversation column focus
2. **Tools** (dynamic, one per loaded connector tool) — `loadConnectors()`
3. **Notes** (pencil) — opens Notes in the morphing column
4. **Coding** (code) — `navigate('/coding')`
5. **Feature Packs** (dynamic, one per installed pack with actions) — `loadInstalledPacks()`
6. *(spacer)*
7. **Discover** (plus-circle) — switches morphing column to `view='discover'`
8. **Settings** (gear) — `navigate('/settings')`
9. **Model badge** — opens `ProviderHub` picker

**Coding surface (v32, was v27/v30/v31)** — `CodingScene` is shared by Ambient and the `/coding` route (the latter is a URL-only deep link with no sidebar entry — same standing pattern as `/notes`/`/pool`; Irisy renders only in the Ambient-embedded path, which is what the sidebar actually opens). Its primary surface is a native chat UI (message list + composer, same visual language as AmbientHome's ToolStepView/thinking-trace pattern) driven by `coding_chat_stream`, which spawns the user's own `opencode acp` and relays its ACP events — no PTY, no xterm, no terminal emulation. Conversation is kept per-workspace (keyed by path) so returning to a workspace restores its transcript. It advertises the configured CTRL root AND every installed feature-pack scope carrying `opencode.json` (ADR-002 §1B.8 v74) via a workspace selector (v30); a pack directory without `opencode.json` is never advertised. Switching workspaces while a session is live shows a confirm bar (switching ends and restarts the ACP session, via `coding_reset_engine`, in the new cwd) rather than switching silently. A collapsed "Open externally instead" disclosure keeps v27/v30's external terminal/editor launch and launcher-hide behavior available as a secondary action. v31's embedded-PTY attempt (same session) is superseded — it reproduced a real, reproducible rendering failure (a black terminal area) confirmed on the actual machine, not carried forward.

This is neither §7.1's `[▾ Irisy Mcp-pool Coding Settings]` nor § nav-l1 v5's `[Irisy Mcp-pool Notes Coding Assistant]` — it is the §8.1 capability-agnostic set (open tools/packs + Discover). Those two earlier chip specs are provenance only.

**Coding composer attachments (v37)** — `CodingScene`'s single `+` opens one native macOS `NSOpenPanel` with file selection, directory selection, and multiple selection all enabled. The typed result separates regular files from directories at the native command boundary: files feed the unchanged ACP attachment-chip path and are read under ADR-002 §1.8.6's existing capability and size controls; directories are rendered as explicit paths in the prompt for OpenCode's own filesystem tools. No selected directory is recursively traversed, serialized, or represented as an ACP attachment. This supersedes the prior separate file-path and folder-path menu entries; desktop browser/mobile contexts receive the command's explicit platform error rather than a simulated second picker.

**Irisy pane geometry** — `AmbientHome.tsx:147,201`: right-anchored, `irisyWidth` default **480px**, divider-draggable clamp **`Math.max(300, Math.min(640, …))`**. SUPERSEDES §7.8's 380–430 constraint and the changelog-v7 320–820 figure (both stale).

**Brain note**: the home chat path routes through the in-process provider router (Pi exited the hot path, ADR-002 v20 §1.5) — NOT Pi, despite a stale "Pi default" comment in `lib/llm-transport.ts:262` (cosmetic, tracked as `vault/ctrl/adrs/DRIFT.md` D5). hermes is fully wired (install / `assistant_oneshot` / dashboard `:17890` / hermes-first branch in `irisy_chat.rs:151-195`) but its turn interception is intentionally **gated off** per bao 2026-06-12 decision A until hermes ships ACP streaming — an ADR-002 v20 intended interim, not a frontend concern.

### §8.6 Role switcher — above the chat box (NEW v22 — 2026-06-25)

> **v36 amendment (2026-07-27) — session tabs added ABOVE this switcher; the agent/model selector MOVES BELOW the composer.** Kiro-parity redesign (bao "Irisy的页面，清修改成跟kiro一样...session，model...都要", pairs ADR-005 irisy §8.7 v32): a new `SessionTabs.tsx` tab bar (multi-conversation tabs, matching Kiro's own top-of-page tab row) now sits between `ChatHeaderControls` and the role-switcher region this section describes — the two do not compete for the same row, `SessionTabs` owns its own row above. Separately, `AgentSelector` (the engine/model picker) relocates from directly above the composer to a new bottom toolbar row directly BELOW the composer, matching Kiro's bottom bar — pure repositioning, no change to the selector's own logic. Neither change touches the role-switcher locks below (persona/feature-pack/knowledge-base axis), which remain the model-not-yet-implemented design this section still describes.

bao 理念: **每个功能 = 角色 + 功能包,灵活配置不焊死**。配对 ADR-005 v6 的 persona 模型(单一品牌声音 + 可切换功能角色)。home 有**两条正交轴**:

- **L1 rail（左侧）** = 数据/模块导航(notes / tables / coding / …)— `Sidebar.tsx`,不变。
- **角色切换器（对话框上方）** = Irisy 当前**功能角色** = 一份灵活配置的 `(persona, 功能包[])`。显示当前角色 + 就地切换;**切角色时对话流持续**(不开新会话)。**尚未实装** —— 本节锁设计。

Locks:

1. **角色 = (persona, 功能包) 配置,非焊死单元。** persona 池(`lib/irisy-prompts.ts` + `personas/irisy/*`)⊥ 功能包池(`lib/feature-pack.ts` + 已装 MCP actions);每个 L1 声明式地配「绑哪个 persona + 挂哪些功能包」;换 persona / 加包 = 改配置不动代码。两者是扁平池 + 每 L1 配置(对齐 ADR-005 v6 §3 persona sources),可跨 L1 复用。
2. **L1 ≠ 角色。** L1 是模块(数据 + workspace),角色只是它的 persona 切面。有些 L1 不挂角色(discover / settings = 纯导航)。
3. **切换器位置 = 对话框上方**(`AmbientHome.tsx` 形变列头部,挨着 "Irisy" 标签 / 历史图标)。单一品牌(仍是 Irisy,ADR-005 单一品牌锁)—— 切角色 ≠ 多重人格。
4. **对话持续化**:persona / 功能包是**每轮可变的上下文**;hermes 会话历史**不随角色切换重置**。
5. **L1 ↔ 角色联动 = 是**(bao 2026-06-25):切 L1 时角色随之联动;输入框上方显示现行角色 + 可手动切换;切角色不改对话(= lock 4)。
6. **角色的第三维 = 知识库(数据)**:角色 = `(persona, 功能包[], 知识库)`。同 persona 按「功能包 + 对应知识库」派生多角色 —— 例:**个人知识库助理(默认角色)= KB persona + 通用 notes 包 + 个人 vault**;**股票角色 = 同 KB persona + 股票功能包 + 股票知识库**。
7. **初始角色集 + v1 范围**(bao 2026-06-25):默认 = 个人知识库助理;初始集 = 个人知识库助理 / 编程伴侣 / 工具创作;**v1 不做"新建角色"**,注册表留接口。

设计 SSOT = `vault/ctrl/irisy-roles.md`(§七 3 决策已落)。实装 = 后续切片(v1 未发)。

## Dependencies

`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@uiw/react-codemirror`, `@codemirror/{lang-json, lang-yaml, lang-html, lang-markdown, lang-css, legacy-modes, state, view}`, `mermaid`, `@tanstack/react-table`. All in lazy chunks per content-type. VMark is NOT a dependency.

## §9 Diagnostics surface (NEW v26, 2026-07-25)

The developer-facing diagnostics harness is one local PWA surface over ADR-010 § diagnostics. It selects `irisy | coding | notes` and renders the typed status model, non-mutating smoke checks, and a bounded correlated event timeline. Capture start/stop is explicit and capped at five minutes; it increases lifecycle-event granularity but never unlocks raw content. Export first renders the recursively redacted JSON preview, then requires an explicit user-selected local save action. There is no automatic disk persistence or network upload.

This is not a raw log console and not a runtime controller. It cannot send an Irisy prompt, spawn or write to a PTY, rebuild Notes, or create another watcher/index. First-party capture/export controls remain typed Tauri commands; agents receive only the authorized read-only Gate projection.

## Acceptance

- [x] `packages/ctrl-web/` is single React 18 + Vite 5 codebase. Verified.
- [x] `src-tauri/src/shell/` stays ≤ ~500 LOC. Verified.
- [x] Tauri `invoke()` desktop + WS+token mobile bridge. Verified.
- [x] L1 nav 2 chips (Irisy / Coding); Settings out of L1 nav. v0.1.105.
- [x] Workspace 2-state (COMPANION 430 / EXPANDED 1800) with L1 `▾` sole operator; right edge anchored. v0.1.117 (`feat(shell): workspace = independent Tauri child window glued left of main`, then refined).
- [x] Pool→Keyboard drag wired v0.1.106 (initial path). External zip / GitHub URL drop + trash uninstall + reorder in § Future work below.
- [x] Viewer registry with content-type → lazy viewer mapping (Tiptap / CodeMirror 6 / mermaid / Tanstack Table / etc.). Verified.
- [x] `/vault` 3-pane browser with FTS5 search + click preview + double-click tab. Verified.
- [x] SmartTable viewer reads frontmatter `schema:` + pipe table + edits round-trip via `vault_write`. Verified.
- [x] VMark is NOT a runtime dependency (`grep vmark package.json` = 0). Verified.

## Future work

- Keyboard drag-install: external `.zip` / `mcp.json` drop + GitHub URL drag from address bar + trash zone uninstall + grid reorder persistence
- Settings page L1 entry — `/settings` route renders inside workspace EXPANDED area; sub-pages `/settings/providers` (ADR-002 § provider) / `/settings/brain` (Pi status) / `/settings/appearance` / `/settings/editor` / `/settings/language` / `/settings/shortcuts` left rail with content panel right (§2 v2 amend)

## Provenance

- §1-§3 ← orig-002 (PWA pivot, 2026-05-13 + 2026-05-30 amendment Irisy-as-sole-entry + Keyboard drag-install + workspace 2-state)
- §4-§6 ← orig-020 (VMark stack adoption, 2026-05-25; orig file was `superseded by memory decision_vmark_not_substrate_use_open_stack` — that "supersede" was a framing fix, not a drop; the actual viewer + smart-table + vault browser decisions stand and are preserved here as v1)
