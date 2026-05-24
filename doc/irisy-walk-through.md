# Irisy walk-through — 第一个用户走过的真实流程

> 2026-05-23 · hephaestus 落地版 · branch `keycap-dev`

## Irisy 一句话定义

> **Irisy = hermes-agent runtime + skill 知识库 + MCP 工具调用库** 三层综合体, 不是单独 LLM。
> 它是 CTRL 内你按 Ctrl 之后"问一切 / 干一切"的入口页面 — 懂全部 keycap, 懂本机 capability, 能调远端。

v1 实现把这三层映射到本机已有的:

| Layer | v1 实现 | 当前状态 |
|---|---|---|
| L1 runtime brain | CTRL kernel `llm_port` (Volc adapter) | ✅ chat 立即可用 |
| L2 skill 知识库 | `~/.hermes/skills/` | (空) future surface |
| L3 MCP 工具调用库 | kernel MCP server (ADR-013) + `~/.hermes/plugins/ctrl/` plugin | ✅ plugin deployed, 已 enable; 待 hermes brain wire 后转 surface 给外部 AI |

## 现状 (你本机已就绪)

- ✅ CTRL kernel + Tauri 2 + PWA stack (worktree `keycap-dev`)
- ✅ Volc adapter wired (`setup_llm_key volc <key>` 之前跑过)
- ✅ hermes-agent v0.14.0 装在 `/Users/mac/.local/bin/hermes` (via pipx)
- ✅ CTRL hermes plugin deployed at `~/.hermes/plugins/ctrl/` (8 文件, 进 irisy_init 后 enable)
- ⚠️ hermes brain providers: **零配置** (auth.json providers 空) — 不影响 chat (走 kernel Volc)

## 你跑的命令

```bash
cd /Users/mac/Documents/coding/CTRL/.worktrees/keycap
pnpm install              # 仅当 .pnpm-store stale 时
pnpm tauri dev            # boots Rust kernel + PWA hot reload
```

## 看见的流程

1. **CTRL.app 窗口出现** (Tauri shell + WebView)
2. **左 keyboard grid** 5 个 seed keycaps (CTRL Chat / 改写粘贴 / AI 翻译 / AI OCR / 文本处理)
3. **打开 Irisy** — 浏览器或 CTRL 顶部 nav 走到 `/irisy` (mode = `chat`, 不带 `?intent=create-keycap`)
4. **首次加载** → `irisy_init` Tauri command 跑 ~100ms:
   - 探 kernel LLM port → adapter `volc` ✓ ready
   - 探 hermes binary → 找到 `/Users/mac/.local/bin/hermes`, 读 `--version` → `Hermes Agent v0.14.0 (2026.5.16)`
   - 跑 `hermes plugins enable ctrl` → plugin enabled ✓
   - 读 `~/.hermes/auth.json` → providers 空 → `brain_configured: false`
   - 写 `~/.ctrl/state/kernel-handshake.json` → handshake ✓
5. **Status header 三行** (绿/灰圆点):
   - **Brain**: `volc` (绿)
   - **hermes**: `Hermes Agent v0.14.0 (2026.5.16) · plugin ✓ · no brain` (绿)
   - **MCP bridge**: `handshake written` (绿)
6. **Welcome 区**: "Hi, I'm Irisy." + 3 seed prompts:
   - What can you do here?
   - List my keycaps.
   - Help me make a clipboard keycap.
7. **点 seed 或自己输入** → chat 走 kernel `chat_stream` (Volc, 真 streaming via `chat.stream.delta`)
8. **回复气泡** 实时 delta 渲染 (kernel `llm_port` → Volc Qwen-3 / Llama-3.3)

## 设计上 v1 不走的路径

| Defer 的 | 原因 |
|---|---|
| ❌ PWA → hermes HTTP `/v1/runs` | `hermes gateway` 是 messaging mgr (Telegram/Discord/...), 不是 chat HTTP API |
| ❌ `hermes proxy start` | v0.14.0 broken (`ModuleNotFoundError: 'hermes_cli.proxy'`) |
| ❌ spawn `hermes chat -q "<prompt>"` subprocess | bao 本机 hermes 没配 brain provider, 立即 fail "no provider" |
| ❌ kernel MCP server :17873 listening | ADR-013 在 zeus 那条线; 现在 handshake file 写 placeholder URL, plugin tools 调用会得 connection refused (不影响 chat) |

## 将来升级到 "hermes 跑 chat"

1. `hermes auth add nous --type oauth` 或 `hermes model` 给 hermes 配 brain (OpenAI / Anthropic / Volc key)
2. `irisy_init` 再跑 → `brain_configured: true`
3. (后续 hephaestus) Status bar 多一个 toggle: kernel Volc / hermes subprocess
4. (后续 zeus) kernel MCP server 真 listening :17873 → hermes 通过 ctrl plugin 调 CTRL capability (vault.read / kv.get / llm.chat ...)

## 关键代码位置 (这次 commit 改了什么)

| 文件 | 类型 | 内容 |
|---|---|---|
| `src-tauri/src/commands/irisy.rs` | 新 | `irisy_init` Tauri command (3 层探测 + plugin enable + handshake) |
| `src-tauri/src/commands/mod.rs` | 编辑 | `pub mod irisy;` + invoke_handler 加 `irisy_init` |
| `packages/ctrl-web/src/components/irisy/IrisyChat.tsx` | 新 | chat surface, 用现有 `defaultTransport` (`ChatStreamTransport`) |
| `packages/ctrl-web/src/components/irisy/IrisyChat.module.css` | 新 | minimal styles |
| `packages/ctrl-web/src/routes/irisy.tsx` | 编辑 | mode 非 `create-keycap` fallback 替换为 `<IrisyChat />` |
| `doc/irisy-walk-through.md` | 新 | 本文 |

## 跑完后告诉 hephaestus

- chat 第一句的 latency (Volc 端点慢的话有感)
- status header 3 行内容是否符合预期
- Seed prompts 想不想换 (现在 3 句是 default)
- 任何 console 报错 / Rust panic
