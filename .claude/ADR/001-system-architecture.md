# ADR-001: CTRL System Architecture — AI-native Agent OS Kernel

- **Status**: Accepted
- **Date**: 2026-05-11
- **Decision makers**: bao (solo operator)
- **Supersedes**: prior Tauri DDD framing in `src-tauri/` (kept as L0 native shell)
- **References**: AIOS (Rutgers COLM 2025), Anthropic Sandbox Runtime, IronClaw seL4-inspired sandbox, MCP OASIS security, LiveStore/TanStack DB, Yjs CRDT

---

## 1. Decision

CTRL adopts an **AI-native Agent OS Kernel architecture** with 4 layers and 5 core abstractions. The desktop application is repositioned from "AI tool launcher" to **ambient AI operating system 中枢** — a microkernel-style runtime that hosts sandboxed actor-based 键帽 (keycaps), connects to 10,000+ external tool sources via 5 protocols, and powers a creator economy through declarative manifests.

**Deliverable scope**: one private repository (`soodooi/CTRL`), self-contained, consuming `olym-core` as workspace copy from `hello-olym` SSOT. `screi` repository to be archived after ST-SS cherry-pick. `ctrl-cloud` repository (new, private) hosts the CF Workers backend (auth / billing / market).

**Strategic frame**: CTRL is **not a Raycast competitor**. CTRL is **Microsoft of ambient AI era** — a protocol hub for desktop + hardware + agents + creators, anchored in Chinese OPC (一人公司) market for v1 with global expansion path via MCP ecosystem.

---

## 2. Product positioning

| Layer | Statement |
|---|---|
| Brand | CTRL — 中文 OPC 桌面 AI 工具合集 + 创作者底座 |
| Mental model | `Ctrl` 键唤起 → workspace ephemeral → 1 键帽 = 1 AI 工具 |
| Users | 中文 OPC (独立开发者 / 创作者 / 设计师 / 自由咨询), 25-45 岁, macOS 13+ 主力 |
| Pricing | 单一订阅 (含 CF Workers AI quota + 15 内置键帽), BYOK 高级解锁 Claude / GPT-4 |
| Differentiation | AI-native (非 retrofit) + Keycap 视觉派 + 创作者经济 + ST-SS 硬件 ready |

**核心三件押注 (新形态曲线)**:

1. **1 键帽 = 1 AI 工具** (极简化 + agentic, 对齐行业趋势)
2. **Ctrl 唤起 → workspace** (ephemeral, 对齐 cmd-K 新形态)
3. **创作者即消费者** (manifest + AI 助手, 空白机会)

---

## 3. Architecture — 4 layers, 5 primitives

### 3.1 Layer diagram

```
┌─────────────────────────────────────────────────────────┐
│ L3 Userland (sandboxed, WASM)                          │
│  键帽 actors / 硬件 source actors / LLM call actors /   │
│  OAuth flow actors / Tool runtime actors                │
└─────────────────────┬───────────────────────────────────┘
                      │ typed message passing
                      ↓
┌─────────────────────────────────────────────────────────┐
│ L2 SDK / Adapters (TS + Rust dual)                     │
│  @ctrl/kernel-sdk · @ctrl/stss · @ctrl/memory ·         │
│  @ctrl/desktop                                          │
└─────────────────────┬───────────────────────────────────┘
                      │ syscall-like API
                      ↓
┌─────────────────────────────────────────────────────────┐
│ L1 CTRL Kernel (Rust microkernel)                      │
│  Actor Scheduler · Capability Broker · Event Bus ·      │
│  LLM Port · MCP Host · Persistence (event-sourced)      │
└─────────────────────┬───────────────────────────────────┘
                      │ native OS calls
                      ↓
┌─────────────────────────────────────────────────────────┐
│ L0 Tauri Native Shell                                  │
│  Hotkey · Window · Tray · Notification · FS · Keychain │
└─────────────────────────────────────────────────────────┘
```

### 3.2 Five primitives (L1 Kernel only exposes these)

| # | Primitive | Role |
|---|---|---|
| 1 | **Actor** | Independent execution unit with mailbox. 键帽 / 硬件 / LLM call / OAuth flow are all actors. |
| 2 | **Capability** | Static token bundle declaring what an actor can do (`LlmCall(model)`, `FsRead(path)`, `ClipboardWrite`). No ambient authority. |
| 3 | **Event** | ST-SS `cell` + `op` is the only message format. CBOR-encoded payload. |
| 4 | **Channel** | Typed pipe between actors. Back-pressure aware. |
| 5 | **Effect** | First-class side effect (`LlmCall`, `McpInvoke`, `EmitEvent`, `SpawnActor`). Returned from actor handlers, not invoked directly. |

**No 6th concept.** All keycap logic expressible in these 5 primitives. Creator manifest declarative.

### 3.3 Why this architecture

| Choice | Reason |
|---|---|
| Microkernel (L1) | L3 sandbox, hot-swap actors, no recompile to extend |
| Actor model | Natural fit for streams (ST-SS, LLM streaming, hardware sensor) |
| Capability-based security | Static-provable sandbox, ctrl-market审核压力大降 |
| Event-sourced persistence | AI memory replay, time travel, cross-device sync via CRDT |
| Prototype-based OOP (not class hierarchy) | AI generates manifest = instantiate prototype, no class explosion |
| RTOS-inspired scheduling | Hardware actors (camera/audio) preempt UI, deadline-aware LLM calls |

### 3.4 RTOS principles borrowed (soft real-time)

| Principle | CTRL implementation |
|---|---|
| Priority preemption | Hardware source actors > UI actors |
| Deadline awareness | Every LLM call carries `deadline_ms`, kernel fails over (CF AI → Claude → Ollama) |
| Static resource budget | Actor declares memory/CPU budget in manifest, kernel rejects over-allocation |

Not hard real-time. Tauri runtime is enough.

### 3.5 What we are NOT

- ❌ Workflow editor (Coze/n8n do this)
- ❌ Hardware vendor (we are the brain, not the device)
- ❌ Long-tail adapter farm (ST-SS lets creators self-adapt)
- ❌ Quicker 8000 长尾 clone
- ❌ ChatGPT GPT clone (OpenAI doesn't open the API for embedded host)
- ❌ Mamamiya tenant (CTRL has independent users/D1/billing)

---

## 4. Five 键帽 sources (the integration map)

| Source | Protocol | Day-1 count | Owner |
|---|---|---|---|
| **MCP servers** ⭐ | Anthropic MCP (LinuxFoundation/AAIF standard) | 10,000+ | Anthropic ecosystem |
| **Big-platform OAuth** | OAuth 2.0 + REST | tens of vendors | Feishu / Coze / Notion / Linear / Slack |
| **Local agents** | Process spawn + IPC | thousands | OpenClaw / ClawX / custom Python agent |
| **ST-SS 分享窗口** ⭐ | Self-defined ST-SS protocol | unlimited long-tail | Independent desktop devs |
| **Built-in keycaps** | First-party code | 15 (v1) | CTRL team |

**Strategic principle**: protocol-level integration captures 90% of value (MCP + OAuth + OpenAPI). Adapter farm captures the next 5-8% high-ROI platforms (Feishu/Coze). Long tail solved via ST-SS SDK + AI manifest generator.

---

## 5. LLM strategy — Pattern D + BYOK

```
Default subscription (CF Workers AI quota)
   ├── Runtime LLM calls: Qwen-3 / Llama-3.3 (cheap, fast, China-accessible)
   └── 80% users never need more
        ↓
BYOK advanced tier
   ├── User fills their own Anthropic / OpenAI API key
   ├── Used at creation time (Claude generates better manifests)
   └── 20% creators / power users
        ↓
Local Ollama / private models
   └── Privacy-sensitive geek tier
```

**Commercial logic**: CTRL sells tools + platform, not models. LLM is wholesale-procured from CF Workers AI.

**Deployment**: LLM calls go through `ctrl-billing` worker which enforces quota and proxies to CF Workers AI. No standalone `ctrl-llm` worker (overhead removed).

---

## 6. Eighteen底座 infrastructure items

### Protocol layer (5)
1. MCP client + server discovery
2. ST-SS receiver/sender (custom protocol)
3. OAuth flow + token vault (Tauri Keychain)
4. Process IPC (for local agents)
5. Webhook receiver (for Coze/Feishu Aily callbacks)

### Data flow layer (3)
6. Unified event bus (kernel-internal)
7. AI memory (event-sourced, `@ctrl/memory`)
8. Step engine (chain MCP + ST-SS + LLM as actor flows)

### Creator layer (4)
9. Manifest schema (LLM-friendly Zod + `.describe()`)
10. AI 创作助手 (NL → manifest, slot-filling chat)
11. Sandbox dry-run (WASM execution environment)
12. Manifest version management (git-style)

### Market layer (3)
13. `ctrl-market` registry + review pipeline
14. Revenue share engine (install count + invocation count → creator wallet)
15. Quality scoring (user ratings + auto schema validation)

### Commercial layer (3)
16. `ctrl-auth` (independent of mamamiya, own D1)
17. `ctrl-billing` (Stripe + CF Workers AI quota + LLM proxy)
18. BYOK key vault (encrypted-at-rest in Tauri Keychain)

---

## 7. Deployment boundary

### Local-only (Tauri desktop, no server)
- LLM direct call (BYOK or local Ollama)
- Tool runtime (keycap execution)
- Local AI memory (SQLite event store)
- Manifest cache (offline operable)
- Hotkey / window / clipboard

### CF Workers (server-side)
- `ctrl-auth` — registration, login, session, magic-link
- `ctrl-billing` — Stripe subscription state, CF Workers AI proxy with quota, LLM fail-over
- `ctrl-market` — manifest registry, review, install stats, revenue share
- Optional `ctrl-sync` (Phase 2+) — AI memory cross-device sync via CRDT

**Constraint**: per `CLAUDE.md` discipline, local `wrangler dev` is forbidden. Use `*.workers.dev` staging for testing.

---

## 8. Repository topology

```
D:/code-space/CTRL/                     ← THIS REPO (single deliverable)
├── src-tauri/                          L0 Tauri shell + L1 Kernel impl
│   └── src/
│       ├── kernel/                     ← L1 Kernel (Rust microkernel)
│       │   ├── actor.rs                Actor trait + scheduler
│       │   ├── capability.rs           Capability token + broker
│       │   ├── event.rs                Event bus + ST-SS encoding
│       │   ├── channel.rs              Typed channels
│       │   ├── effect.rs               First-class effects
│       │   ├── llm_port.rs             LLM adapter routing
│       │   ├── mcp_host.rs             MCP server discovery + invoke
│       │   └── persistence.rs          SQLite event store + CRDT
│       └── shell/                      ← L0 Tauri integration
├── src/                                React UI (Pool + Workspace)
└── packages/                           ← workspace
    ├── olym-core/                      copy from hello-olym
    ├── olym-desktop/                   桌面 olym 派生
    ├── ctrl-stss/                      cherry-pick from screi
    ├── ctrl-memory/                    cherry-pick from screi
    └── ctrl-kernel-sdk/                L2 syscall surface (TS)

D:/code-space/ctrl-cloud/               ← NEW REPO (CF Workers backend)
├── workers/{ctrl-auth, ctrl-billing, ctrl-market}
├── database/{ctrl-users, ctrl-market, ctrl-billing}  ← independent D1
└── packages/olym-runtime/              copy from hello-olym

D:/code-space/hello-olym/               olym-core SSOT (also serves mamamiya)
D:/code-space/screi/                    ARCHIVE after ST-SS cherry-pick
```

---

## 9. Phase plan

| Phase | Content | Status |
|---|---|---|
| **P0** | Legal cleanup (screi Apache→Reserved, CTRL +LICENSE) | ✅ done 2026-05-11 |
| P1 | CTRL workspaces + copy olym-core | next |
| P2 | L1 Kernel skeleton (5 primitives in Rust) ⭐ RFC first | depends P1 |
| P3 | L2 SDK (@ctrl/kernel-sdk + @ctrl/stss + @ctrl/memory) | depends P2 |
| P4 | MCP host integration (Anthropic SDK in kernel) | depends P2 |
| P5 | Tool manifest spec (actor + capability + flow schema) | parallel P3-P4 |
| P6 | AI 创作助手 (manifest generator, slot-filling chat) | depends P5 |
| P7 | WASM sandbox + 5 P0 built-in keycaps | depends P2 |
| P8 | `ctrl-cloud` repo + ctrl-auth + ctrl-billing | parallel P7 |
| P9 | ctrl-market + creator revenue share | depends P8 |
| P10 | Closed beta (内测) | depends P7-P9 |
| P11+ | Hardware actor SDK + 1-2 hardware demos (E-ink coding peripheral, AI 眼镜) | post-launch |

**Time framing**: ignored per bao directive — focus on sequence and unblocking, not deadlines.

---

## 10. Top 15 built-in keycaps (v1 scope)

### 5 P0 (launch v1.0)
1. Clipboard 增强 (AI 改写粘贴)
2. AI OCR (GPT-4V 直读, no OCR vendor)
3. AI 翻译 (Claude / Qwen 多语言)
4. AI 文本处理 (NL 指令: 改正式 / 摘要 / 转 markdown)
5. Ctrl Chat (产品入口键帽)

### 5 P1 (v1.1)
6. 窗口管理 (snap / align / 全屏)
7. AI PDF (总结 / 表格提取 / 翻译)
8. 公式识别 LaTeX (GPT-4V)
9. EVER 智识 (智能识别选中文本类型 → 建议操作)
10. 屏幕录制 + AI 字幕 (Whisper)

### 5 差异化 (v1.0-v1.2)
11. AI Snippet / 文本扩展 (Espanso 路数 + AI 模板)
12. 代码片段 + AI 解释/改写 (CTRL 用户刚需)
13. 邮件 / 客户回复 AI 草稿 (中文 OPC 高频)
14. 会议纪要 AI (Granola 路数, ST-SS-native)
15. 跨设备同步 (剪贴板 / 历史 / preset, CRDT)

---

## 11. Open questions (deferred decisions)

| Question | Defer until |
|---|---|
| Actor runtime: tokio + 自造 vs actix vs Bevy ECS | P2 RFC |
| WASM sandbox: wasmtime vs Wasmer vs Anthropic Sandbox Runtime port | P2 RFC |
| Persistence: SQLite + custom event store vs LiveStore vs TanStack DB | P3 design |
| CRDT library: Yjs (TS) vs Automerge (Rust) | P11 cross-device sync |
| Pricing: ¥800/yr vs ¥1200/yr vs lifetime | P8 ctrl-billing implementation |
| Internationalization: English-only post-launch vs 中文 first? | P10 beta |

---

## 12. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Kernel design wrong, expensive rewrite | 🔴 | P2 RFC reviewed before code |
| WASM sandbox + Tauri integration unfamiliar | 🟡 | Anthropic Sandbox Runtime open source reference |
| Actor model Rust ecosystem choice | 🟡 | Bias tokio + 自造, avoid heavy framework |
| Solo learning curve (actor + capability + WASM) | 🟡 | 1-2 weeks ramp, AI pair-programming |
| Creator users can not understand manifest | 🟢 | AI 创作助手 abstracts, users speak NL only |
| ctrl-cloud delivery slips, blocks ctrl-market | 🟡 | ctrl-auth + ctrl-billing first, market deferrable to v1.1 |
| Hardware vendor relationships | 🟢 | Post-launch concern, ST-SS protocol hardware-ready Day 1 |

---

## 13. Non-decisions (intentionally deferred)

- Pandagooo brand vs architecture: confirmed architecture-only, not customer-facing brand
- Multi-tenant arch for ctrl-cloud: not needed, CTRL is single-product
- Specific revenue-share percentage: defer to P9 implementation
- Hardware OEM partnerships: post-launch
- Internationalization timeline: post-v1.0 beta feedback

---

## 14. Success criteria for ADR-001 validity check

CTRL v1.0 should achieve:
- ✅ Day-1 install enables 100+ MCP servers (zero creator content needed)
- ✅ 30-minute first-time user flow: install CTRL → connect Feishu OAuth → trigger first 键帽
- ✅ Any independent dev publishes first ST-SS keycap to ctrl-market in 1 day
- ✅ Creator manifest generation via AI assistant takes < 5 minutes for typical NL request
- ✅ Sandbox provably prevents malicious 3rd-party keycap from accessing user data outside declared capability

If any of these fail measurably, the architecture has design defect — return to ADR review.

---

## 15. References

- [AIOS: LLM Agent Operating System (Rutgers, COLM 2025)](https://arxiv.org/abs/2403.16971)
- [Anthropic Sandbox Runtime (open source)](https://github.com/anthropic-experimental/sandbox-runtime)
- [Anthropic Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing)
- [IronClaw / NanoClaw — seL4-inspired capability sandbox](https://ibl.ai/blog/openclaw-ironclaw-nanoclaw-securing-autonomous-ai-agents)
- [MCP Security — OASIS standard](https://github.com/cosai-oasis/ws4-secure-design-agentic-systems/blob/main/model-context-protocol-security.md)
- [Anthropic Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Agent Operating Systems Blueprint (TechRxiv 2026)](https://www.techrxiv.org/doi/full/10.36227/techrxiv.175736224.43024590/v1)
- [LangGraph graph-native orchestration](https://www.poniaktimes.com/ai-agent-frameworks-2026/)
- [Awesome Local-First — LiveStore / TanStack DB / Yjs](https://github.com/alexanderop/awesome-local-first)

---

## 16. Related specs (children of this ADR)

- `.olym/specs/kernel/spec.md` — L1 Kernel 5 primitives detail + Rust API surface
- `.olym/specs/stss-protocol/spec.md` — ST-SS protocol with hardware profile
- `.olym/specs/tool-manifest/spec.md` — Manifest schema for 5 source types
- `.olym/specs/creator-economy/spec.md` — Market + 分润 + 审核
- `.olym/specs/hardware-strategy/spec.md` — Ambient AI OS v2/v3 + 电纸书 coding 杀手用例
- `.olym/steering/ctrl-strategy.md` — Top 15 keycaps + 不做清单 + boundaries
