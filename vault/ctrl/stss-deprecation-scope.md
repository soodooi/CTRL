# ST-SS 弃用范围地图(SC6 scoping)

> 系统设计先行:动手前先把 ST-SS 全量 surface 摸清,画统管全局的弃用图。
> 4 路并行勘查 + 亲自核实关键依赖(2026-06-23)。GOAL SC6 = 「ST-SS 全量停用:`stss_bridge` / `commands/stss` / `ctrl-stss` 移除或停用;本机 `kernel→PWA` 流用最简 WS 顶上;前端流不回归(视觉验证)」。

## 核心发现:ST-SS 是两个风险截然不同的东西,别当一件事做

| | 半 A:TS 协议抽象(死重) | 半 B:kernel→PWA 活线(载 3 个出货功能) |
|---|---|---|
| 是什么 | `@ctrl/stss` TS 包(Cell/Op/Envelope/reducer/capability 协议机器)+ 唯一消费者 `@ctrl/memory` | kernel `:17872` WS bridge + `subprocess_stss_adapter` + `commands/stss` + 前端 `useCellStream`/`useSubprocessChannel` hooks |
| PWA 用它吗 | **不用** —— ctrl-web 零 import `@ctrl/stss`,直接 `cbor-x` 解码 + 内联类型(`useCellStream.ts:11`) | **用** —— 3 个出货功能的实时流都走这条线 |
| 谁依赖 | `@ctrl/stss` ← 仅 `@ctrl/memory`;`@ctrl/memory` ← **无人**(孤儿,亲核实) | 3 commands + adapter + supervisor + 2 前端 hooks |
| 删了会断什么 | **零产品影响**(只掉协议参考测试) | **3 个功能视觉回归**(见下) |
| 风险 | **几乎零** | **高**(必守「前端流不回归」) |
| 动作 | **直接删**(整包 + 孤儿消费者) | **不是删,是简化/降级**(留活线、换掉抽象、保 payload 契约) |

**结论**:GOAL 说「`ctrl-stss` 移除」= 半 A,零风险纯清理;「本机流用最简 WS 顶上」= 半 B,而**当前 `:17872` 本就是一个 token-WS** —— 所谓「ST-SS」在活线上其实就是「WS 载 CBOR Cell/Op」,真正死的是 TS 那套语义流抽象(reducer/capability envelope 没人用)。所以半 B 多半是**去抽象 + 改名 + 保 payload**,不是重建流。

---

## 半 A 全量清单(死重,直接删)

| 物 | file:line | 现状 | 动作 |
|---|---|---|---|
| `packages/ctrl-stss/` | 整包(`package.json` `@ctrl/stss` v0.1.0 private/UNLICENSED;~14 src + 8 test,≈84 测试) | PWA 不 import;Rust kernel 有自己的 `event.rs` mirror,**不**依赖此 TS 包 | **删整包** |
| `packages/ctrl-memory/` | 整包(`@ctrl/memory`,16 测试;唯一 import `@ctrl/stss` 的包) | 无人 import(`grep @ctrl/memory packages/ctrl-web/src` = 空) | **删整包**(孤儿) |
| topology 文档 `share/stss-spike` 条目 | `.claude/rules/stack-and-topology.md` | `share/stss-spike` **已不存在**(spike 早提升进 `stss_bridge.rs`),文档 stale | 删条目 |
| topology「ctrl-stss 69 tests / 99 workspace」 | 同上 | 测试数 stale(实际 84/16/139) | 改数或删 |

> 删半 A 工作区测试 239 → 139(只剩 ctrl-web 产品测试)。**无所谓** —— 掉的是协议参考测试,不是产品验证。

---

## 半 B 全量清单(活线,简化/降级,守不回归)

### Rust kernel 侧
| file | 角色 | file:line |
|---|---|---|
| `kernel/stss_bridge.rs` | `:17872` token-WS bridge;`StssBridge::{new,serve,publish_cell,publish_op,subscribe_events}`;广播 channel + CBOR 帧 + token 校验 | `serve` ~95;`DEFAULT_LISTEN_ADDR=127.0.0.1:17872` :36 |
| `kernel/subprocess_stss_adapter.rs` | 把 SubprocessActor outbox 翻译成 v0.7 wire(`SubprocessStdout`→`TerminalOutput` 等);7 测试 | `forward_subprocess_outbox` ~66;`translate_op` ~164 |
| `commands/stss.rs` | 4 Tauri command:`subscribe`(返回带 token 的 bridge_url)/`publish`/`list_streams`/`get_bridge_token` | 25-97 |
| `commands/mod.rs` | `generate_handler!` 注册 4 个 stss command | 182-186 |
| `shell/kernel_supervisor.rs` | boot 时 `bridge.serve(STSS_LISTEN_ADDR, on_op)`(on_op 现 no-op 日志) | 205-217 |
| `commands/code_space.rs` | `cs_spawn` 调 `forward_subprocess_outbox` 把 PTY 输出接上 bridge | import ~21;调用 ~179 |
| `commands/kernel.rs` | LLM 流式 + MCP 结果:`bridge.publish_cell/op` 共 7 处 | 670/727/749/758/926/945/982 |
| `commands/skills.rs` | skill 进度 `publish_cell(LlmResponse)` | ~339 |
| `commands/system.rs` | `KernelStatus.stss_bridge_addr` 诊断字段 | 51/118 |
| `kernel/event.rs` | `Event{Cell|Op}` + `CellKind`/`OpKind` 词汇(**非 ST-SS 专属**,scheduler/persistence 也用) | — **保留** |

### 前端侧(ctrl-web,13 文件;**回归风险**)
| file | 角色 |
|---|---|
| `hooks/useCellStream.ts` | WS client,`subscribe()`→连 `:17872`→`cbor-x` decode→React state(`llm_response` 流) |
| `hooks/useSubprocessChannel.ts` | 高频 WS client,`terminal_output` 绕过 React 直推 xterm;双向(cs_stdin/resize/signal 回流) |
| `lib/bridge.ts` | WS 传输层(Tauri vs browser 探测,默认 `:17872`) |
| `lib/kernel.ts` | `subscribe/publish/listStreams` 封装 + `StreamHandle` 形 |
| `components/workspace/McpOutputPane.tsx` · `McpRunView.tsx` | 订 `mcp-<id>` 流,过滤 `llm_response`,live `<pre>`(Irisy 回复逐字出) |
| `routes/code-space.tsx` · `components/coding/CodingTerminal.tsx` | xterm 实时终端 + 右栏结构化 cell |
| `routes/workspace.tsx` | `LegacyMcpStreamView` 调试路由 |
| `lib/workspace-shape.ts` · `irisy-mcp-zod.ts` · `routes/pool.tsx` | `stss-stream`/`stss:` 作 source/kind 枚举(非渲染,改名即可) |

### ST-SS 上实际流的 3 个出货功能(= 回归红线)
1. **LLM 逐字流** —— Irisy/MCP 回复在 `McpOutputPane`(主页右栏)/`McpRunView`/`LegacyMcpStreamView` 的 `<pre>` 逐字出。流 `mcp-<id>`,`llm_response` cell `{delta}`。
2. **终端实时输出** —— Code Space `/code-space/$envId` + `CodingTerminal` 的 xterm。`terminal_output` cell(base64 PTY 字节),高频,绕 React 直推。
3. **结构化元数据** —— 右栏 `env_status`/`agent_thinking`/`agent_action`/`terminal_exit`。

### 最简 WS 替换契约(前端必须仍收到的 payload 形,换传输不换契约)
```
{ type:'cell'|'op', kind:string, ts_ms:number, stream_id?:string, payload:... }
关键 kind:
  llm_response    { delta: string }
  terminal_output { data_b64, actor, pid, len }
  terminal_exit   { actor, pid, code, signal? }
  env_status      { state:'spawning'|'running'|'exited'|'error', detail? }
  agent_thinking / agent_action { text | action_kind ... }
```
编码 CBOR/JSON 皆可(前端 `decode()` 与传输无关);**必须保 per-stream token auth**(code-space WS 无 token 会断)。

---

## 弃用计划(分两半,先零风险后守红线)

**Phase 1 — 删半 A(死重,零产品风险)**
- 删 `packages/ctrl-stss/` + `packages/ctrl-memory/`;改 topology 文档(stss-spike 条目 + 测试数)。
- 验证:`npm test` workspace 仍绿(掉的只是协议参考测试);tsc 全绿;ctrl-web 不受影响。
- 这一步就**坐实了 GOAL SC6 的「`ctrl-stss` 移除」**,零回归。

**Phase 2 — 半 B 去抽象 + 改名(守前端流不回归)**
- `subprocess_stss_adapter.rs` 内联进 `code_space.rs`(只 Code Space 用),删此文件。
- `stss_bridge.rs` 降级改名为「plain kernel event WS」(去 ST-SS 品牌/语义流叙事,**保 `:17872` + token + CBOR Event 帧 + 3 publish 入口**);`commands/stss.rs` 的 `publish`/`list_streams`/`get_bridge_token`(无前端调用)stub 或删,`subscribe` **保留**(2 hook 靠它拿 bridge_url)。
- 前端 `stss`/`stss-stream`/`stss:` 枚举改名为中性(`event-stream` 等)。
- 验证(**视觉铁证**):`/code-space` spawn bash 看 xterm 实时输出不丢帧 + 主页跑 MCP 看 `McpOutputPane` 逐字流不漏字 + 右栏结构化 cell。`/table-lab` 连不上 kernel(需 token),真机验证入口受限 —— 这步**需重建 Tauri app 跑真机**。

**Phase 3(可选,后续)— 传输升级 Tauri Channels**
- ADR-010 v5 ③⑥ 目标 = Tauri Channels(原生二进制)。但当前 `:17872` token-WS 已满足「最简 WS」字面要求,Channels 迁移是**性能/标准对齐增量**,非 SC6 必需。Channels 桌面腿 browser dev 测不了(需真机),独立小目标更合适。

---

## 要 bao 拍的决策(唯一卡点)

**半 B 做到哪一档?**
- **档 1(推荐,最小):** 删半 A + 半 B 去抽象/改名,**保 `:17872` token-WS 当「最简 WS」**,payload 契约不变,3 功能视觉验证。→ 诚实坐实 SC6,风险可控,符合「收敛不推倒」。
- **档 2(更进):** 再把桌面腿从 raw WS 迁到 Tauri Channels(原生二进制,ADR-010 v5 目标)。更大,需真机 e2e,browser dev 测不了 → 建议拆独立小目标(Phase 3),不混进 SC6。

> 我的建议:**SC6 = 档 1**(Phase 1 + Phase 2)。Phase 1 这一步可立即开工零风险;Phase 2 守红线需真机视觉验证。Channels(档 2/Phase 3)单立。

## 诚实缺口 / 待核
- 测试数(84/16/139)= agent 报,合并前 `npm test` 复核。
- Phase 2 真机视觉验证需重建 app(`/table-lab` headless 连不上 kernel,GOAL 早记此入口限制)。
- `commands/stss.rs::publish`/`get_bridge_token`/`list_streams` 零前端调用(agent 报)→ 删前 grep 复核 mobile/tunnel 路径无暗调。
