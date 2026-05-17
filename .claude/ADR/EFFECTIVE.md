# CTRL 当前有效架构

> **不要读这个找历史**——这里只写"**现在真的是什么**"。
> 历史决策见各 ADR；本文档是 ADR 链的合成视图。
> 生成 / 更新人：zeus
> 最后更新：2026-05-16
> 后续将由 `build-effective.ts` 自动生成；当前为人工 v1.0

每条"当前定义"必须能追溯到具体 ADR §X。如果发现本文档与 ADR 矛盾，**以最新 Accepted ADR 为准**，回头修本文档。

---

## 0. 基本盘

| 项 | 当前值 | 来源 |
|----|------|------|
| 项目名 | CTRL | [ADR-001 §1](./001-system-architecture.md#1-decision) |
| 定位（核心叙事） | AI-native ambient OS 中枢 for OPC creators | [ADR-001 §1-2](./001-system-architecture.md#1-decision) |
| 决策人 | bao (单决策) | [ADR-001 frontmatter](./001-system-architecture.md) |
| 当前阶段 | H-2026-05-14-003 PWA polish | INDEX |
| 仓库 | https://github.com/soodooi/CTRL（main + 9 feat 分支） | git remote |

⚠️ **未决矛盾**：README-OPC-PLATFORM.md 把 CTRL 定位为"OPC 成品**托管平台**（不造工具）"，与 ADR-001 §2"工具集合 + 创作者底座"叙事并存。**待 ADR-006（OPC 平台定位决议）拍板**。

---

## 1. 四层架构（基石）

```
L3 Userland      WASM sandboxed actors（键帽 / 硬件 / LLM / OAuth）
L2 SDK           @ctrl/{kernel-sdk, stss, memory, mesh, desktop}（TS + Rust）
L1 Kernel        Rust microkernel，localhost daemon @ :17872 token-auth
L0 Native Shell  Tauri 2 ~500 LOC（Hotkey / Tray / MCP spawn / Keychain）
NEW UI Layer     packages/ctrl-web（单一 PWA，Tauri WebView 或浏览器双载体）
```

**来源**：[ADR-001 §3.1（原版）](./001-system-architecture.md#31-layer-diagram) → [ADR-002 §3](./002-pwa-pivot.md#3-new-4-layer-rendering-revises-adr-001-31)（现行，加 PWA 层 + L0 瘦身为 daemon 模式）

**保留不变**（被 ADR-002 / 003 明确 preserve）：
- 5 内核原语：Actor / Capability / Event / Channel / Effect
- Capability-based 安全模型
- Event-sourced persistence
- Rust kernel 内部设计

---

## 2. 5 内核原语

| # | 原语 | 角色 |
|---|------|------|
| 1 | **Actor** | 独立执行单元 + mailbox |
| 2 | **Capability** | 静态权限 token |
| 3 | **Event** | ST-SS `cell` + `op`，CBOR |
| 4 | **Channel** | 类型化管道，back-pressure aware |
| 5 | **Effect** | 一等公民副作用 |

**来源**：[ADR-001 §3.2](./001-system-architecture.md#32-five-primitives-l1-kernel-only-exposes-these)（locked，ADR-002/003 Preserves）

**No 6th concept**。

---

## 3. 5 键帽源（集成模型）

| 源 | 协议 | Day-1 count |
|----|------|-------------|
| MCP servers ⭐ | Anthropic MCP | 10,000+ |
| 大平台 OAuth | OAuth 2.0 + REST | 几十 |
| 本地 agents | 进程 spawn + IPC | 几千 |
| ST-SS 共享窗口 ⭐ | 自定义 ST-SS 协议 | 长尾 |
| 内置键帽 | First-party 代码 | **v1.0 = 8 个**（不是 ADR-001 §10 的 15 个） |

**来源**：[ADR-001 §4](./001-system-architecture.md#4-five-keycap-sources-the-integration-map)（locked）

⚠️ **v1.0 数量从 15 砍到 8**——决策已在 `.olym/steering/ctrl-strategy.md` 发生，但**未走 ADR 流程**。**待 ADR-004（v1.0 键帽 scope 砍量）补登**。当前清单见 [doc/keycap-roadmap.md](../../doc/keycap-roadmap.md)（Hephaestus 拥有）。

---

## 4. UI 层（PWA 一统）

| 项 | 选择 | 来源 |
|----|------|------|
| 主框架 | React 18 + Vite 5 | [ADR-002 §5](./002-pwa-pivot.md#5-pwa-stack-locks) |
| 路由 | TanStack Router | 同上 |
| Server state | TanStack Query | 同上 |
| Client state | Zustand | 同上 |
| 表单 | React Hook Form + Zod | 同上 |
| 样式 | CSS modules + design tokens（**禁 Tailwind 默认模板**） | 同上 |
| 动画 | Framer Motion（UI 过渡）+ CSS（键帽 hover） | 同上 |
| PWA 工具 | vite-plugin-pwa | 同上 |
| Bundle 预算 | **≤ 500 kB gzip**（关键路径 < 200 kB） | [ADR-002 §5 修订版](./002-pwa-pivot.md#5-pwa-stack-locks) by [ADR-003 §7](./003-multi-device-mesh.md#7-platform-coverage) |
| 载体 | Tauri WebView（桌面）/ 浏览器 PWA（移动） | [ADR-002 §3](./002-pwa-pivot.md#3-new-4-layer-rendering-revises-adr-001-31) |

---

## 5. 原生壳责任（仅此 4 项）

Tauri 2，~500 LOC Rust。PWA **做不了** 才放原生：

1. **全局 `Ctrl` 热键**（Win32 RegisterHotKey / macOS CGEventTap）
2. **系统托盘**（tauri-plugin-tray）
3. **MCP stdio 子进程 spawn**（tokio Command）
4. **OS 钥匙串**（tauri-plugin-stronghold for BYOK）

**来源**：[ADR-002 §4](./002-pwa-pivot.md#4-the-four-native-shell-responsibilities-pwa-impossible)（locked）

其余一切搬到 PWA。

---

## 6. LLM 策略（Pattern D + BYOK）

| 层 | 当前 |
|----|------|
| 默认（订阅含） | CF Workers AI quota（Qwen-3 / Llama-3.3）—— ADR-001 §5 原版 |
| 实际验证模型 | **Minimax 2.7 Highspeed**（已 rotate key，存 .env.local）—— 文档级决策，未走 ADR |
| 高级（BYOK） | Anthropic Claude / OpenAI GPT-4 |
| 隐私 | Ollama 本地 |
| Agent 框架 | **Hermes Agent**（NousResearch，pip install hermes-agent）—— Athena 验证通过 |
| Claude CLI 路径 | OpenAI-shape shim 包 `claude -p ... --output-format stream-json` 子进程；Hermes 通过 `custom_providers` 调用 |

**来源**：
- 原版 [ADR-001 §5](./001-system-architecture.md#5-llm-strategy--pattern-d--byok)
- Minimax 选型：`doc/ai-model-selection-analysis.md`、`doc/minimax-integration-plan.md`（**未走 ADR**）
- Hermes 选型：`doc/ctrl-agent-selection-summary.md`、`doc/hermes-agent-analysis.md`（**未走 ADR**）
- Claude CLI smoke：`experiments/claude-cli-smoke/`（zeus 验证）

⚠️ **3 处未走 ADR 的决策**：Minimax / Hermes / Claude CLI 集成路径。**待 ADR-005（LLM provider 终选）补登**。

---

## 7. 多设备 Mesh

```
Discovery → Transport → Encryption → Sync
ctrl-relay   WebRTC      vodozemac     Automerge v0.7.x
+ mDNS       + relay      (Olm 1:1)
```

| 层 | 选型 | 来源 |
|----|------|------|
| Discovery | ctrl-relay (CF Worker, HTTPS WSS) + mDNS 同 LAN 加速 | [ADR-003 §4](./003-multi-device-mesh.md#4-ctrl-relay-cf-worker-signaling--fallback) |
| Transport | WebRTC datachannel (webrtc-rs v0.17.x) + relay 回退 | [ADR-003 §3.1](./003-multi-device-mesh.md#31-layer-diagram) |
| Encryption | **vodozemac (Matrix.org Olm 1:1, NO Megolm)** | [ADR-003 §3.1](./003-multi-device-mesh.md#31-layer-diagram) |
| Sync | Automerge v0.7.x（Rust + WASM 同协议） | [ADR-003 §6](./003-multi-device-mesh.md#6-crdt-layer-automerge) |
| v1.0 文档 | mesh.devices / mesh.keycaps / mesh.preferences | [ADR-003 §6.1](./003-multi-device-mesh.md#61-document-inventory-v10) |
| v1.1 文档 | mesh.history / mesh.clipboard | 同上 |
| 移动平台 | 同样跑 vodozemac-wasm + automerge-wasm（不再是 ADR-002 §8 瘦客户端） | [ADR-003 §7](./003-multi-device-mesh.md#7-platform-coverage) |

⚠️ **加密库矛盾未解**：[ADR-003 §3.1](./003-multi-device-mesh.md#31-layer-diagram) 说 vodozemac，[ADR-003 §7](./003-multi-device-mesh.md#7-platform-coverage) 表格里 iOS PWA / Android Chrome PWA 列 libsignal-wasm。这两者不等价（vodozemac 是 Olm Rust 实现，libsignal 是 Signal 自家协议）。**待 zeus 在 ADR-007 二选一**。

---

## 8. 部署边界

```
Local (Tauri desktop)               CF Workers
├─ L1 Kernel (Rust daemon)          ├─ ctrl-auth (registration / session)
├─ Tool runtime (键帽 sandbox)       ├─ ctrl-billing (Stripe + LLM quota)
├─ Local AI memory (SQLite)          ├─ ctrl-market (manifest registry)
├─ Manifest cache (offline OK)       ├─ ctrl-push (Web Push VAPID)
└─ Hotkey / clipboard / keychain     └─ ctrl-relay (mesh signaling) ⭐ v1.0 mandatory
                                        └─ ctrl-sync (CRDT cross-device) v1.1
```

**来源**：[ADR-001 §7](./001-system-architecture.md#7-deployment-boundary) → [ADR-002 §9 加 ctrl-push](./002-pwa-pivot.md#9-ctrl-cloud-delta) → [ADR-003 §1 ctrl-relay 提升至 v1.0 mandatory](./003-multi-device-mesh.md#1-decision)

**Aliyun 备用 + Cloudflare 主**：见 `DEPLOYMENT_DECISION.md`（**未走 ADR**，待 ADR-008 补登）。

---

## 9. 仓库拓扑

```
soodooi/CTRL           ← 本仓库（单交付）
├── src-tauri/          L0 + L1 Rust
├── packages/           TS workspace（ctrl-web + ctrl-* + olym-core copy）
└── share/              manifest schema + starter 键帽

ctrl-cloud             ← 独立私仓（CF Workers backend）
hello-olym             ← olym-core SSOT
screi                  ← 归档（ST-SS cherry-pick 后）
```

**来源**：[ADR-001 §8](./001-system-architecture.md#8-repository-topology)（locked）

---

## 10. 二进制 / 性能预算

| 项 | 当前预算 | 来源 |
|----|--------|------|
| PWA bundle | ≤ 500 kB gzip（关键路径 < 200 kB） | [ADR-003 §7 修订](./003-multi-device-mesh.md#7-platform-coverage) |
| 桌面 installer（default） | ≤ 25 MB | [ADR-002 §16](./002-pwa-pivot.md#16-acceptance) |
| 桌面 installer（slim） | ≤ 18 MB（含 mesh） | [ADR-003 §14 修订](./003-multi-device-mesh.md#14-acceptance) |
| Kernel binary | ≤ 18 MB stripped+LTO | 同上 |
| Hotkey 冷启动 | ≤ 100 ms（首次 mesh setup +200 ms 可接受） | [ADR-003 §14 修订](./003-multi-device-mesh.md#14-acceptance) |
| Hotkey 温启动 | ≤ 30 ms | [ADR-002 §13](./002-pwa-pivot.md#13-success-criteria-validate-adr-002-acceptance) |
| MCP roundtrip | ≤ 200 ms | 同上 |

---

## 11. 当前阶段 / 工作流

**Phase 计划已搬出 ADR**（违反单决策原则）→ 见 `.olym/steering/ctrl-strategy.md`

**当前 active lane**：H-2026-05-14-003 PWA polish

**并行**：
- Win11 backend（zeus 已经历）
- Mesh foundation（已 merge 入 main）
- Mac migration（athena 在 Mac）

---

## 12. 未走 ADR 流程的现行决策（必须补登）

| 决策 | 在哪发生 | 拟补登 ADR |
|------|--------|-----------|
| v1.0 键帽从 15 砍到 8 | ctrl-strategy.md | ADR-004 |
| LLM provider 终选（Minimax / Claude CLI / Hermes） | doc/ 多个分析文档 | ADR-005 |
| OPC 平台 vs 工具集合定位 | README-OPC-PLATFORM.md | ADR-006 |
| 加密库 vodozemac vs libsignal-wasm 二选一 | ADR-003 内部矛盾 | ADR-007 |
| Cloudflare + Aliyun 部署策略 | DEPLOYMENT_DECISION.md | ADR-008 |
| Hermes Agent 框架最终采纳 | doc/ctrl-agent-selection-summary.md | ADR-009 |

---

## 13. 已 supersede / 不再生效

| 内容 | 原 ADR | 现状 |
|------|--------|------|
| 移动端瘦客户端模式 | [ADR-002 §8](./002-pwa-pivot.md#8-mobile-lane-pwa-only) | 已被 ADR-003 §1 替换为全 mesh 节点 |
| ctrl-relay 延期 P11+ | [ADR-002 §9](./002-pwa-pivot.md#9-ctrl-cloud-delta) | 已被 ADR-003 §1 提升 v1.0 mandatory |
| cloudflared tunnel 跨设备 | ADR-002 §8 | 已被 mesh 取代（[ADR-003 §8](./003-multi-device-mesh.md#8-migration-from-adr-002-8-cloudflared-tunnel)） |
| Hotkey 80 ms 冷启动 | ADR-002 §13 | 已被 ADR-003 §14 调整为 100 ms |
| Bundle 300 kB gzip | ADR-002 §5 | 已被 ADR-003 §7 调整为 500 kB |
| ADR-001 §10 15 内置键帽（v1） | ADR-001 §10 | 已被 ctrl-strategy.md 砍至 v1.0 = 8（待 ADR-004 正式登记） |
| ADR-001 §9 阶段规划 | ADR-001 §9 | 已被 ADR-002 §10 + ADR-003 §9 修订；现行版本在 ctrl-strategy.md |
| ADR-001 §6 #18 跨设备同步 P11+ | ADR-001 §6 | 已被 ADR-003 提升至 v1.1 |
| ADR-001 §11 CRDT 库选型 | ADR-001 §11 | 已被 ADR-003 §6 解决（Automerge v0.7.x） |

---

## 14. 故意延期 / 不在 v1 范围

- WASM 沙箱细节（wasmtime vs Wasmer vs Anthropic Sandbox Runtime）—— P3.9 RFC
- 定价（¥800 vs ¥1200 vs lifetime）—— P8
- 国际化时间表 —— P10 beta 后定
- 创作者分成具体百分比 —— P9 实现时定
- 硬件 OEM 合作 —— post-launch
- Pandagooo 品牌定位 —— 已确认架构内部用，非客户面

---

**找不到答案？** 先看 [INDEX.md](./INDEX.md) 列的 ADR；再看 `.olym/steering/ctrl-strategy.md`；再不行问 zeus。
