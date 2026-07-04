---
title: CTRL 自主调试 harness — 分层方案 (governing, 逐条)
kind: spec
created_at: 2026-07-04
owner: bao
author: claude
status: L1-L3a partial SHIPPED + verified; L3b DOM verbs + L2 pending
purpose: bao「你要有个非常详细的调试方案，可以网上调研某个类似的调试方案来做，逐条做」+「你不能建立 Irisy 的调试端点吗」。一套让 AI agent 自主端到端验证 CTRL(含 Irisy 全链路)的调试 harness,不靠人在桌面点。
source: 全网调研(Tauri 2 E2E on macOS,一手来源见下)+ 实建实测(gate/engine/debug-endpoint 全跑通)。
related:
  - "[[reference-debug-by-driving-the-gate.md]]"
  - "[[architecture-byo-cli-driver.md]]"
---

# CTRL 自主调试 harness

> **调研定盘的硬事实(macOS)**:WKWebView **没有** WebDriver / CDP(苹果只给 Safari 的 `webinspectord` 手动检查,不可编程)。`tauri-driver` 直连 = Win/Linux only;Playwright `connectOverCDP` = Windows only。**macOS 上所有能用的方案都是「app 内注入自己的桥」** —— 所以正解是**扩展 CTRL 自己已有的服务**(kernel `:17873` gate + `:17872` WS 桥),而不是外挂 WebDriver。调研推荐 3b「extend CTRL's own bridge」正是此。

## 分层金字塔(便宜的层跑量,一层真全栈保信心)

| 层 | 驱动 | 覆盖 | 状态 |
|---|---|---|---|
| **L1 单元/契约** | `@tauri-apps/api/mocks` `mockIPC`(前端)+ `tauri::test`/`mock_builder`(Rust 命令) | React↔invoke 契约 + 命令逻辑/state(两半各自,不连) | ◑ Rust 单测已多(432);前端 mockIPC 未系统化 |
| **L2 前端 E2E(浏览器模式)** | Playwright → :5173,`page.route` stub invoke + LLM/gate 响应,`data-testid` 选择器 | 渲染/流程/**审批 modal 视觉**(mock 数据,不连真 kernel) | ◑ 已用 Playwright 验命令面渲染;mock-IPC 全链未做 |
| **L3 真全栈(macOS 关键)** | **扩展 CTRL 的服务**(调研 3b,最佳架构契合) | 真 UI → 真 Rust,自主 | 见下逐条 |

## L3 逐条(CTRL 自己的调试端点 —— 已建 + 待建)

**已建 + 实测通过**:
1. ✅ **gate 行为驱动**:HTTP MCP → `:17873`(token 在 `~/.ctrl/state/gate-token`)。验过:工具行为、vault_write 容忍 frontmatter、discover_skills 优雅降级、审查门对 hermes 触发/对 pwa 放行。见 [[reference-debug-by-driving-the-gate]]。
2. ✅ **引擎驱动**:hermes-acp stdio 探针(照 `acp_client.rs` spawn)。验过:terminal 本质 2 轮召回、tool_call/thought 事件、hermes 不发 permission。
3. ✅ **审查门 debug 端点**(commit 32816d4,`mcp_server.rs`,`cfg!(debug_assertions)` 或 `CTRL_DEBUG=1`,Bearer-gated):
   - `GET /debug/review/pending` → 待审列表
   - `POST /debug/review/resolve {id, approved}` → 批准/拒绝
   - **实测**:brain 写 → gate 暂停 → 外部 poll+resolve → approve 则写成 / deny 则「denied at the review gate」。**审查门 moat 全自主 E2E,零桌面点击。**

**待建(逐条)**:
4. ⏳ **`invoke_command` debug 动词**:`POST /debug/invoke {cmd, args}` → 直调任意 Tauri 命令(`irisy_reset_engine` / 驱动一整轮 Irisy 聊天)。这样能自主验**整个对话流**(思考→工具→审批→答案→写笔记自动跳的**逻辑**),不只审查门。**注意 Tauri 2 `eval()` 是 fire-and-forget**,要结果得经 IPC callback + oneshot/timeout 回传(tauri-pilot 的解法)。
5. ⏳ **DOM 驱动动词**(真点 UI):`dom_snapshot`(走 accessibility tree → 短 ref)/ `click`/`fill` by ref,经注入的 JS 桥。这才能验**渲染**(modal 真弹、菜单真出、自动跳的**画面**)。最大的一块。
6. ⏳ **L2 Playwright + mockIPC**:浏览器模式 stub invoke + LLM,验审批 modal / 命令面 / 自动跳的**视觉**(便宜、确定、跨平台;补 L3 DOM 之前的性价比选择)。
7. ⏳ **收进 `scripts/debug/`**:把 1/2/3 已验脚本 + 4/5 新动词整理成可复跑 harness。

## 备选(若不想自己维护 L3)
- `danielraffel/tauri-webdriver`(MIT/Apache,macOS WKWebView W3C WebDriver + **自带 MCP server 给 Claude Code 驱动**)—— 调研 3a,最快上手。但引外部依赖;CTRL 自己的桥(3b)是长期最契合。

## 一句话
**kernel/引擎/审查门 = 现在就能自主 E2E(已证)。剩下只有「真点 UI 的画面」层** —— 走 L2(mockIPC Playwright)兜视觉,或 L3 DOM 动词兜真全栈。不再有「桌面测不了」这个借口。

## Sources(一手)
Tauri WebDriver https://v2.tauri.app/develop/tests/webdriver/ · Mocking https://v2.tauri.app/develop/tests/mocking/ · `tauri::test` https://docs.rs/tauri/latest/tauri/test/ · macOS 追踪 issue #7068 https://github.com/tauri-apps/tauri/issues/7068 · WebdriverIO Tauri 平台支持 https://webdriver.io/docs/desktop-testing/tauri/platform-support/ · danielraffel/tauri-webdriver https://github.com/danielraffel/tauri-webdriver · Choochmeque/tauri-plugin-webdriver https://github.com/Choochmeque/tauri-plugin-webdriver · srsholmes/tauri-playwright https://github.com/srsholmes/tauri-playwright · tauri-plugin-mcp-bridge https://docs.rs/tauri-plugin-mcp-bridge/ · mpiton tauri-pilot https://dev.to/mpiton/i-built-a-cli-to-test-tauri-apps-because-nothing-else-worked-3915 · AI-agent E2E https://dev.to/dumebii/how-to-e2e-test-ai-agents-mocking-api-responses-with-playwright-in-nextjs-nic
