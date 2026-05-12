---
id: H-2026-05-12-002
title: ST-SS protocol cherry-pick + CTRL profile (research + dev)
severity: P1
status: open
reporter: bao
assigned_to: athena (parallel session in worktree)
lane: athena-stss
worktree: D:/code-space/ctrl-h002-stss
branch: feat/h-002-stss-cherrypick
touches:
  - packages/ctrl-stss/**
  - packages/ctrl-memory/**
related: [H-2026-05-11-001]
project_id: ctrl-v1
category: feature
created: 2026-05-12
updated: 2026-05-12
---

## 背景

H-001 bootstrap 把 P3 (ST-SS / memory cherry-pick) 当 Step 3 跳过了, 先做了 P2 Kernel.
现在 P2 done (kernel 11 模块 + FFI + Win W2 都通了), 回头收 P3 这一刀.

`packages/ctrl-stss/` 和 `packages/ctrl-memory/` 现状 = 空 skeleton (只有
package.json + `src/index.ts` 里一行 TODO + ctrl-stss/README.md 是 screi 残留文案).

## 这不是纯执行 handoff

是 **调研 + 开发** 双轨:
- 调研: screi 的源代码不是从天而降的, 看清楚它 v0.5 的实际结构再决定怎么 cherry-pick
- 开发: TS 层落地 + CTRL profile fields + README 重写

允许在工作中发现 spec §7 清单跟实际源码不完全对应, 那就**记录差异并按实际情况调整**, 不要硬抠 spec. spec 写于 2026-05-11, 源码也可能在那之后小动过.

## 目标 (loose)

1. `packages/ctrl-stss/` 跑起来 — wire format (Cell/Op) + encoding (CBOR) + local WebSocket transport + reducer (selective) 落地
2. `packages/ctrl-stss/` 加 CTRL profile 4 项: `stream_id` + `hardware_profile` + `eink_render_profile` + backpressure declaration
3. `packages/ctrl-memory/` 跑起来 — event store reader/writer (跟 Rust kernel 的 `EventStore` 不重复, TS 这边是 client-side 缓存 + 查询助手定位)
4. README.md 重写 (现在还是 @screi/protocol 文案)
5. `npm run typecheck --workspaces` + `npm test --workspaces` 全绿
6. Commit message 含 `[H-2026-05-12-002]` prefix
7. 完工前更新本 handoff: 写 "实际做了什么" + "跟 spec 差在哪" + "下一步建议"

## 边界 (硬约束)

- **TS only**. 不动 `src-tauri/src/**` 任何 Rust 文件
- **不改 `src-tauri/src/ctrl.udl`**. ST-SS wire ↔ kernel event bus 桥接是 P3.5 单独 handoff
- 不动 `packages/{olym-core, olym-desktop, ctrl-kernel-sdk}/` 现有内容 (可以新增依赖 import, 但不改它们)
- 不动 `win/CTRL/` (在并行 W3 lane)
- 全英文代码 + 注释, .md 文档允许中文
- 包名 `@ctrl/stss` + `@ctrl/memory`, **不是** `@screi/*`
- License 字段 `UNLICENSED`, **不是** Apache 2.0

## 参考

- `.olym/specs/stss-protocol/spec.md` — 完整 spec, §7 是 cherry-pick 清单 (作为起点, 允许实际有出入)
- `.claude/ADR/001-system-architecture.md` §3, §4 source #4
- 源仓: `D:/code-space/screi/packages/{protocol-ts, core, memory}/` — 完整可读
- screi 协议文档: `D:/code-space/screi/docs/protocol/v0.5/` (调研时读一下底)
- 跟 hello-olym/CTRL 主仓现有 TS 代码风格保持一致 (TypeScript strict, vitest, npm workspaces, ESM)

## 已知不确定点 (留给调研判断)

- `core/src/reducer.ts` 的 "selective" 边界在哪? 哪些 reducer 跟 v1-legacy 绑定, 哪些通用?
- screi v0.5 用 CBOR 还是 JSON? spec 写 CBOR 但实际源码看一眼
- `ctrl-memory` 跟 kernel 那边 SQLite EventStore 的关系? 不是 mirror, 是 client-side helper. 具体 API 形状自己拍
- CTRL profile fields 落在 envelope 顶层还是嵌套 meta? 自己决定, 但要 doc 化
- 测试到什么粒度? 至少: envelope 编解码 round-trip + WS transport open/close + reducer 基础 case

不确定的可以做决定但要在最终 handoff update 写清楚 "选了 A 不选 B, 理由 X".

## 验收 (松)

- [ ] `cd D:/code-space/ctrl-h002-stss && npm install && npm run typecheck` 通
- [ ] `npm test --workspaces` 通 (ctrl-stss + ctrl-memory 至少各 1 个 test 文件)
- [ ] `packages/ctrl-stss/src/` 至少有: envelope / op / cell / encoding / transport-ws / reducer / index
- [ ] `packages/ctrl-memory/src/` 至少有: log/reader 抽象 + 1 个 in-memory 实现
- [ ] README 重写 (引用 CTRL ADR-001 而非 screi 协议文档)
- [ ] 本 handoff 文件加 "Result" section 写 zeus 实际做了啥
- [ ] git log on branch: 至少 2 个 commits, 每个含 `[H-2026-05-12-002]`
- [ ] bao review

## 后续 handoff 链 (供参考, 不做)

- H-2026-05-1X-003 — P3.5 kernel ↔ ST-SS event bus 桥接 (Rust 改动, 可能扩 ctrl.udl)
- H-2026-05-1X-004 — P11 hardware SDK (`@ctrl/stss-hardware`)
- H-2026-05-1X-005 — P12 cross-device sync (Yjs CRDT)

## Result (athena, 2026-05-12)

### TL;DR

调研后**没有** verbatim 搬 screi 类型. 改成 **CTRL native data model + 选择性 lift screi engineering primitives**. 主因: 跟 bao 用 10 哲学对照后, "reuse screi 类型" 在 #2 / #3 / #4 / #7 上输 6 项, 全输 0 赢, 哲学性失分.

落地: 2 个包绿, 52 tests passing (37 stss + 15 memory + 14 olym-core unchanged), npm typecheck + npm test --workspaces 全绿.

### 实际做了什么

3 commits on `feat/h-002-stss-cherrypick`:

1. `feat(stss): [H-2026-05-12-002] P3.1 — CTRL-native protocol types`
   — `packages/ctrl-stss/src/protocol/` (8 files): `version` / `kind` / `error` / `cell` / `op` / `capability` / `envelope` / `framing` + index. 13 tests.
2. `feat(stss): [H-2026-05-12-002] P3.2 — CTRL profile + encode/transport/reducer`
   — `src/ctrl/` (5 files: stream-id / hardware / eink / backpressure / capabilities) + `src/encode/` (JsonEncoder) + `src/transport/` (Transport interface + WebSocketTransport + InMemoryTransport pair) + `src/reducer/` (DefaultReducer). README rewrite. 37 tests total.
3. `feat(memory): [H-2026-05-12-002] P3.3 — client-side AI memory log + reader`
   — `packages/ctrl-memory/src/` — types + log/ (AppendSink/LineSource interfaces, JSONL format, InMemoryLog) + reader/ (DefaultMemoryReader). README rewrite. 15 tests.

### spec §7 vs 实际源码 diff (重要)

spec §7 写 cherry-pick 这些文件:
- `protocol-ts/src/envelope.ts` — Cell/Op types
- `protocol-ts/src/cbor.ts` — encoding
- `core/src/reducer.ts` — namespaced state reducer
- `core/src/transport/ws.ts` — WebSocket transport

实际 screi v0.5 源码:
- **没有 `protocol-ts/src/cbor.ts`** — CBOR encoder 在 `core/src/encode/cbor.ts`, JSON encoder 在 `core/src/encode/json.ts`. spec 写错位置.
- **没有 `core/src/reducer.ts`** — reducer 在 `core/src/apply/{reducer,namespaced-reducer,types}.ts`.
- screi envelope 实际 **14 types** 不是 spec §2.1 隐含的 8 (多了 `cursor` / `layer-c.offer` / `layer-c.answer` / `prediction` / `feedback` / `input` 6 个远程观看类型).
- screi Cell **完全不是** spec §2.1 写的形状. spec §2.1: `{type:'cell', kind:CellKind, ts_ms, stream_id, payload}`. screi 实际: `{id, bbox, role:AXRole, content:string, parent?, style?, meta?, priority?, cognitive_priority?, attrs?}` — UI accessibility tree 模型, 不适合 CTRL 的 semantic event 域 (传感器读数 / LLM 响应 / 剪贴板).
- screi 8 op variants (insert/update/delete/move/append/transform/subtree-insert/subtree-delete) 后 4 个全是 UI scroll/layout bandwidth 优化, CTRL 永不用.
- spec §9 migration 其实**自己已经写了** "Renamed: kind → split into cell_kind / op_kind. Removed: agent.output, window.capture, webrtc.*" — bao 在 2026-05-11 写 spec 时直觉对了, 是 §7 cherry-pick 清单出错.

### 设计选择 + 理由 (六个 + 一个 meta 翻盘)

**M (meta 翻盘)**: 不 reuse screi 类型. CTRL native data model 按 spec §2.1.
- **为什么**: 见上面 10 哲学评估 — reuse 在 engine/spec 边界 (#2) / bespoke craft (#3) / polymorphic registry (#4) / small files (#7) / audit shape (#6) / P3.5 桥接复杂度 (#9) 全输.
- **代价**: 多写 ~600 LOC native types. 不能直接合并 screi v0.8+ — 但 screi 即将 archive (ADR-001 §1 §8), 是 non-loss.
- **得到**: envelope.ts 250 LOC (vs screi 915 LOC), engine/spec 干净分层, P3.5 kernel Event ↔ ST-SS Cell 1:1 mapping (无 AXRole 翻译层).

**B1 — Cell 模型**: CTRL native `{id, kind: CellKind, ts_ms, payload: unknown, attrs?}`. 没 bbox / role / content / style / parent. `CellKind = 'user_input' | 'clipboard_snapshot' | 'screen_snapshot' | 'hardware_reading' | 'llm_response' | 'tool_result' | 'context_snapshot' | (string & {})`.

**B2 — CTRL profile 落 capability bag, 不新发明 envelope type**. `HelloPayload.capabilities` 是开放 `Record<string, unknown>` (protocol 层), CTRL profile 是 `CtrlCapabilities` (ctrl 层) 加 index signature 实现结构化承载. 三个 profile fields: `hardware_profile` / `eink_render_profile` / `backpressure` + 三个常用 fields: `cell_kinds` / `op_kinds` / `needs_capability` (后者是 spec §3.1 的关键 — kernel capability broker 用来 verify 订阅者).
- **stream_id** = `Envelope.source` (一个字段两个名字会困惑, 选用了 screi 现成的 `source: string`, 加 helper `formatStreamId({publisher, instance})` 给结构).

**B3 — 编码默认 JSON, CBOR defer**. JSON v1 够本地 WS 用 + 零额外 deps. CBOR 需要 `cbor-x` (11KB npm), P11 硬件 5kbps 场景再加. `Encoder` interface 已留好接口.

**B4 — selective cherry-pick scope** (修正版):
- 搬: Transport interface + WebSocketTransport + InMemoryTransport + Encoder interface + JsonEncoder + length-prefix framing + ProtocolError 层级 pattern + DefaultReducer 接口形状 + Hello/Welcome handshake pattern.
- 写新: Cell / Op / Envelope (8 types, 不是 14) / CellKind / OpKind / CTRL profile 4 types / DefaultReducer impl (CTRL ops 语义).
- 不搬: AXRole / BBox / StyleHint / CellMeta / Layer A/B/C / WebRTC layer-c / prediction / feedback / input / cursor envelope / move/transform/subtree-* ops / NamespacedReducer / CBOR encoder / webtransport / auth / stss-composer.

**B5 — ctrl-memory = client-side helper, 不 mirror kernel**. kernel SQLite (P2.8 已 ship) 是事实源. TS 包提供 in-process append/read + 游标查询 + 时间穿越, 给 UI 层和创作者助手用. `AppendSink` / `LineSource` 接口让 P3.5 kernel bridge 作为新 impl 无缝接入.

**B6 — 测试粒度**: 52 tests, 覆盖 envelope round-trip / framing / 4 op ops 加 reducer / JSON encode-decode / in-memory transport pair / CTRL profile 在 capability bag 中的承载 / stream-id helpers / JSONL 格式 / memory iterate / 6 种 filter / seekToSeq / seekToTime / reset / caller-controlled apply.

**T2 翻盘**: 不存在了. CTRL native envelope.ts = 250 行, 自然 ≤300.

### P3.5 一个发现 (给下游 lane)

native data model 意外发现的好处 — **kernel Event ↔ ST-SS Cell mapping 是 1:1 的**:

- kernel `Event::Cell{kind, payload}` ↔ TS `Cell{id, kind, ts_ms, payload}`
- kernel `Event::Op{kind, target, payload}` ↔ TS `Op{kind, ts_ms, target?, payload?}`
- kernel `Capability` token ↔ TS `needs_capability: string[]` (entry in CtrlCapabilities)

如果搬了 screi 类型, P3.5 桥接代码就要写一层 `kernel.Event → ST-SS Cell{id: <synthesize>, bbox: [0,0,0,0], role: 'group', content: JSON.stringify(payload), meta: {source: 'native', source_kind: kind}, attrs: payload}`, 那才是真的污染. 现在 P3.5 lane 直接 cbindgen `kernel::Event` 到 `@ctrl/stss::{Cell, Op}` 就行.

### 后续 handoff 建议

1. **H-2026-05-1X-006 [docs]** — 修 spec.md. §2.1 Cell shape 跟代码同步; §7 cherry-pick 清单标记 "obsolete, see H-2026-05-12-002 Result"; §9 migration 表加 "v0.5 (screi) → v1 (CTRL native): Cell 重定义, Op vocab 减半, 7 envelope types 移除". 估 30 min, 顺手做.
2. **H-2026-05-1X-003 [feat][Rust]** — P3.5 kernel ↔ @ctrl/stss event bus 桥接. 期望: kernel `Event` enum 通过 `ctrl.udl` UniFFI 暴露成 TS 看得到的 `Cell` / `Op` shape; ctrl-memory `KernelBridgeLog` impl 走 Tauri command. 这是 zeus 或下一个 persona 接.
3. **H-2026-05-1X-004 [feat][TS]** — `@ctrl/stss-hardware` SDK 包. 给硬件 OEM 用的薄层 wrapper, 自动填 `hardware_profile`, 提供 `publish*` helpers.
4. **H-2026-05-1X-005 [feat][TS]** — `FileLog` impl (`@ctrl/memory` v1.5). JSONL on disk for dev replay. `format.ts` 已经准备好.
5. **H-2026-05-1X-007 [feat][TS]** — `KernelBridgeLog` impl. P3.5 完成后接.

### 验收自查

- [x] `npm install && npm run typecheck` 通
- [x] `npm test --workspaces --if-present` 通 (52 tests across stss + memory + olym-core)
- [x] `packages/ctrl-stss/src/` 至少有: envelope / op / cell / encode (json) / transport-ws / transport in-memory / reducer / index — 都有了, 实际比要求多
- [x] `packages/ctrl-memory/src/` 至少有 log/reader 抽象 + 1 个 in-memory 实现 — 有了
- [x] README 重写 (引用 CTRL ADR-001 + spec)
- [x] handoff Result section 填了 (本节)
- [x] git log on branch: 至少 2 个 commits, 每个含 `[H-2026-05-12-002]` — 3 个 commits + 这第 4 个 handoff commit
- [ ] bao review

### 文件结构最终

```
packages/ctrl-stss/src/
├── protocol/        (8 files, ~900 LOC)  — wire substrate
├── ctrl/            (6 files, ~260 LOC)  — CTRL profile dialect
├── encode/          (3 files, ~90 LOC)   — JsonEncoder
├── transport/       (4 files, ~260 LOC)  — Transport + WS + InMemory
├── reducer/         (3 files, ~140 LOC)  — DefaultReducer
└── index.ts         (re-export all)

packages/ctrl-memory/src/
├── types.ts         (filter + matchesFilter, ~60 LOC)
├── log/             (4 files, ~150 LOC)  — AppendSink/LineSource/JSONL/InMemoryLog
├── reader/          (3 files, ~120 LOC)  — MemoryReader + DefaultMemoryReader
└── index.ts
```

每文件 ≤300 行, 满足哲学 #7.

