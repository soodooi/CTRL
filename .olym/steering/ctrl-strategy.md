# CTRL Strategy — 单页 navigator

Single-page navigator for product strategy + 15 keycap list + 不做清单 + boundaries.

> Read this in 5 minutes before any new session.

---

## Positioning (lock)

CTRL = **AI-native ambient OS 中枢** (野心), v1 落地为**桌面 AI 工具入口 + 创作者底座**.

- **Brand**: CTRL — 中文 OPC 桌面 AI 工具合集
- **Mental model**: `Ctrl` 唤起 → workspace ephemeral → 1 键帽 = 1 AI 工具
- **Users**: 25-45 岁 中文 OPC (一人公司), 独立开发者 / 创作者 / 设计师, macOS 13+ 主力
- **Pricing**: 单一订阅 (CF Workers AI quota + 15 内置键帽), BYOK 高级解锁
- **Visual**: Keycap 派工业精确, Linear / Cursor / OP-1 / Braun 气质

**3 件押注**:
1. 1 键帽 = 1 AI 工具 (极简 + agentic)
2. Ctrl 唤起 → ephemeral workspace
3. 创作者即消费者 (manifest + AI 助手)

---

## Top 15 keycaps (v1 scope)

### 5 P0 (launch v1.0)
1. **Clipboard AI 改写粘贴** — 选中→粘贴时改写为指定语气
2. **AI OCR** — GPT-4V 直读, 零 OCR vendor
3. **AI 翻译** — Claude / Qwen, 文本+截图+文档
4. **AI 文本处理** — NL 指令 ("改正式"/"摘要"/"转 markdown")
5. **Ctrl Chat** — 产品入口键帽, 通用 AI 对话

### 5 P1 (v1.1)
6. **窗口管理** — snap / align / 全屏, macOS Rectangle 替代
7. **AI PDF** — 总结 / 表格提取 / 翻译
8. **公式识别 LaTeX** — GPT-4V 直接出
9. **EVER 智识** — 智能识别选中文本类型 → 建议操作
10. **屏幕录制 + AI 字幕** — Whisper 转录

### 5 差异化 (v1.0-v1.2)
11. **AI Snippet** — Espanso 路数 + AI 模板
12. **代码片段 + AI 解释/改写** — CTRL 用户刚需
13. **邮件 AI 草稿** — 中文 OPC 接客户高频
14. **会议纪要 AI** — Granola 路数, ST-SS native
15. **跨设备同步** — 剪贴板 / 历史 / preset

**v1.0 = 8 keycaps** (5 P0 + AI Snippet + 代码片段 + 邮件草稿)
**v1.1 = +5 P1**
**v1.2 = +会议纪要 + 跨设备同步**

---

## 5 keycap sources (integration map)

| Source | Protocol | Day-1 count |
|---|---|---|
| **MCP servers** ⭐ | Anthropic MCP | 10,000+ |
| Big-platform OAuth | OAuth 2.0 + REST | Feishu / Coze / Notion / Linear / Slack / GitHub |
| Local agents | Process + IPC | OpenClaw / ClawX / Python scripts |
| **ST-SS 分享** ⭐ | Self ST-SS protocol | Long-tail desktop apps + hardware |
| Built-in | First-party code | 15 (v1) |

**Strategic principle**:
- Protocol-level (MCP/OAuth/OpenAPI) integration captures 90%
- 5-8 high-ROI private adapters (Feishu/Coze/Dify/n8n)
- Long-tail solved via ST-SS SDK + AI manifest generator

---

## LLM strategy (Pattern D)

```
Default (CF Workers AI quota in subscription)
    ↓
BYOK (user fills Anthropic / OpenAI key for advanced)
    ↓
Local Ollama (privacy geek)
```

- **Runtime LLM**: Qwen / Llama (cheap, China-accessible) via CF Workers AI
- **Creation LLM**: Claude / GPT-4 (BYOK, high quality)
- **Failover chain**: Workers AI → Anthropic → Ollama
- We sell **tools + platform**, not models

---

## Architecture (lock, see ADR-001)

```
L3 Userland (WASM sandboxed actors)
    ↑↓ typed message passing
L2 SDK (@ctrl/{kernel-sdk, stss, memory, desktop})
    ↑↓ syscall-like API  
L1 Kernel (Rust microkernel: Actor / Capability / Event / Channel / Effect)
    ↑↓ native OS calls
L0 Tauri (Hotkey / Window / Tray / FS / Keychain)
```

5 primitives only. AI-native Agent OS pattern (AIOS-inspired + IronClaw capability + LiveStore event sourcing).

---

## 不做清单 (Never)

| Don't | Why |
|---|---|
| Workflow editor | Coze / n8n 已经做了 |
| 自己造硬件 | Solo + 资本错配 + 18 月周期 |
| 100+ 长尾平台 adapter | ST-SS 给创作者自己接 |
| Quicker 8000 长尾 | 不可能赢, 也不该赢 |
| ChatGPT GPTs 接入 | OpenAI 不开放 host API |
| 跟 mamamiya 共享用户数据 | 独立 D1, 完全隔离 |
| 自营内容 (CTRL 团队当主力创作者) | 跟创作者抢饭 |
| 本地 wrangler dev | CLAUDE.md 全局禁止 |
| 多 tenant (CTRL 单产品) | pandagooo 多 tenant 是另一条线 |

---

## Boundaries with existing platforms

| 它 | CTRL 跟它的关系 |
|---|---|
| Coze / Dify / n8n | OAuth 拉 bot 到 CTRL workspace, **不做 workflow 编辑器** |
| 飞书 Aily / 多维表 | webhook + OAuth 双向, **不做协作文档** |
| OpenClaw / ClawX | 装机 + IPC 启动, **不做 agent framework** |
| MCP 生态 | client + 一键装, **不做 MCP host platform** (Anthropic 在做) |
| Raycast | 差异化 = AI native + 中文 + ST-SS + 创作者经济 |
| ChatGPT | 不直接接入 (OpenAI 不开放) |

---

## Repository topology

```
D:/code-space/CTRL/         ← THIS REPO (single deliverable)
D:/code-space/ctrl-cloud/   ← NEW REPO (CF Workers backend)
D:/code-space/hello-olym/   ← olym-core SSOT (mamamiya 也用)
D:/code-space/screi/        ← ARCHIVE after P3 cherry-pick
```

---

## Phase plan (no time, sequence only)

| Phase | Content | Status |
|---|---|---|
| **P0** | Legal cleanup (screi 撤 Apache, CTRL +LICENSE) | ✅ 2026-05-11 |
| P1 | CTRL workspaces + copy olym-core | next |
| P2 | L1 Kernel skeleton (Rust, 5 primitives) ⭐ RFC first | depends P1 |
| P3 | L2 SDK (@ctrl/stss + @ctrl/memory cherry-pick from screi) | depends P2 |
| P4 | MCP host integration | depends P2 |
| P5 | Tool manifest spec implementation | parallel P3-P4 |
| P6 | AI 创作助手 (manifest generator) | depends P5 |
| P7 | WASM sandbox + 5 P0 built-in keycaps | depends P2 |
| P8 | ctrl-cloud + ctrl-auth + ctrl-billing | parallel P7 |
| P9 | ctrl-market + creator revenue share | depends P8 |
| P10 | Closed beta (内测) | depends P7-P9 |
| P11+ | Hardware SDK + E-ink demo | post-launch |

---

## Success criteria (validate ADR-001)

CTRL v1.0 must achieve:
- ✅ Day-1 install enables 100+ MCP servers (zero creator content)
- ✅ 30-min flow: install → connect Feishu OAuth → trigger first keycap
- ✅ Any independent dev publishes first ST-SS keycap in 1 day
- ✅ AI manifest generation: NL request → installed keycap < 5 min
- ✅ Sandbox provably prevents malicious 3rd-party keycap from accessing user data

---

## Key external resources (research baseline)

- AIOS paper (Rutgers COLM 2025): https://arxiv.org/abs/2403.16971
- Anthropic Sandbox Runtime: https://github.com/anthropic-experimental/sandbox-runtime
- MCP Official Registry: https://registry.modelcontextprotocol.io/
- IronClaw seL4-inspired capability sandbox
- Quicker (top 30 actions research): https://getquicker.net/Share/Recommended
- Raycast (Mac launcher baseline): https://www.raycast.com/
- screi ST-SS protocol v0.5: `D:/code-space/screi/docs/protocol/v0.5/`

---

## Specs index

- `.claude/ADR/001-system-architecture.md` — master ADR (decisions locked)
- `.olym/specs/kernel/spec.md` — L1 Rust microkernel RFC
- `.olym/specs/stss-protocol/spec.md` — ST-SS CTRL profile + hardware + E-ink
- `.olym/specs/tool-manifest/spec.md` — manifest schema, 5 source types
- `.olym/specs/creator-economy/spec.md` — market + 分润 + 审核
- `.olym/specs/hardware-strategy/spec.md` — ambient OS roadmap, post-launch

---

## When you need to decide something not covered here

1. Read ADR-001 first
2. Check relevant spec (specs/ above)
3. If still unclear: 新 ADR (`.claude/ADR/00X-*.md`) + update this strategy doc
4. Do NOT make conflicting decisions across documents — strategy doc is canonical lookup
