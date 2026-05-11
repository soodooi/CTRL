---
id: H-2026-05-11-001
title: CTRL Kernel bootstrap — workspaces + olym-core + ST-SS cherry-pick
severity: P0
status: open
reporter: bao
assigned_to: zeus
lane: zeus-bootstrap
touches:
  - package.json
  - packages/olym-core/**          # copy from hello-olym
  - packages/olym-desktop/**        # new scaffold
  - packages/ctrl-stss/**           # cherry-pick from screi
  - packages/ctrl-memory/**         # cherry-pick from screi
  - packages/ctrl-kernel-sdk/**     # new scaffold
  - src-tauri/src/kernel/**         # new L1 Kernel skeleton
related: []
project_id: ctrl-v1
category: feature
created: 2026-05-11
updated: 2026-05-11
---

## 现象

CTRL ADR-001 已锁 (AI-native Agent OS Kernel architecture). 5 个子 spec 写完 (kernel / stss / manifest / market / hardware). 当前 CTRL 仓只有 Tauri DDD skeleton + 法律 License, 没有 ADR 设计的 4 层架构 + 5 primitives + 5 keycap sources 任何代码.

本 handoff = **P1 + P2 + P3 合并启动** (执行级):
- P1: CTRL workspaces 初始化 + olym-core 副本
- P2: L1 Kernel skeleton (Rust 5 primitives)
- P3: ST-SS / memory cherry-pick from screi

## 证据

- `.claude/ADR/001-system-architecture.md` — full architecture lock
- `.olym/specs/kernel/spec.md` — L1 Kernel RFC
- `.olym/specs/stss-protocol/spec.md` — ST-SS CTRL profile
- `D:/code-space/hello-olym/packages/olym-core/` — source for copy
- `D:/code-space/screi/packages/{protocol-ts, core, memory}/` — source for cherry-pick

## 建议

### Step 1 — CTRL workspaces 初始化 (~30 min)

```bash
cd D:/code-space/CTRL
# package.json 加 workspaces
# - packages/*
mkdir -p packages/{olym-core,olym-desktop,ctrl-stss,ctrl-memory,ctrl-kernel-sdk}
```

`package.json` patch:
```json
{
  "workspaces": ["packages/*"]
}
```

### Step 2 — olym-core 副本 (~10 min)

```bash
cp -r D:/code-space/hello-olym/packages/olym-core/. packages/olym-core/
# 验证 package.json 已 private:true + license:UNLICENSED (从 hello-olym 已是这状态)
```

### Step 3 — ctrl-stss + ctrl-memory cherry-pick (~2 h)

参 `.olym/specs/stss-protocol/spec.md` §7 Cherry-pick clause.

Import (rename namespaces):
- `D:/code-space/screi/packages/protocol-ts/src/envelope.ts` → `packages/ctrl-stss/src/envelope.ts`
- `D:/code-space/screi/packages/protocol-ts/src/cbor.ts` → `packages/ctrl-stss/src/cbor.ts`
- `D:/code-space/screi/packages/core/src/reducer.ts` → `packages/ctrl-stss/src/reducer.ts` (selective)
- `D:/code-space/screi/packages/core/src/transport/ws.ts` → `packages/ctrl-stss/src/transport-ws.ts`
- `D:/code-space/screi/packages/memory/src/*` → `packages/ctrl-memory/src/*`

Refactor:
- 改包名 `@screi/protocol` → `@ctrl/stss`
- 改包名 `@screi/memory` → `@ctrl/memory`
- 删除 v1-legacy (apps/remote 相关 envelope)
- 加 CTRL profile fields per spec §3 (stream_id, hardware_profile, eink_render_profile)
- 加 backpressure policy declaration

### Step 4 — olym-desktop 骨架 (~30 min)

```
packages/olym-desktop/
├── package.json (name: @ctrl/desktop, deps: @ctrl/stss, @manidala/olym-core)
├── src/
│   ├── ports/
│   │   ├── llm.ts          (LLMPort interface)
│   │   ├── storage.ts      (StoragePort)
│   │   ├── tool.ts         (ToolPort)
│   │   ├── auth.ts         (AuthPort)
│   │   └── history.ts      (HistoryPort, bridges to @ctrl/memory)
│   ├── adapters/           (stub directories, fill in P4)
│   │   ├── llm/
│   │   ├── storage/
│   │   └── auth/
│   ├── cloud-sync/         (client for ctrl-cloud, stub)
│   └── index.ts
```

### Step 5 — ctrl-kernel-sdk 骨架 (~30 min)

L2 syscall surface in TypeScript:
```
packages/ctrl-kernel-sdk/
├── package.json (name: @ctrl/kernel-sdk)
├── src/
│   ├── actor.ts            (defineActor, spawn)
│   ├── capability.ts       (capability tokens)
│   ├── event.ts            (Event types, Cell, Op)
│   ├── channel.ts          (typed Channel API)
│   ├── effect.ts           (Effect builder API)
│   └── index.ts
```

Initial implementations stub (real wiring in P2 Rust kernel via Tauri invoke).

### Step 6 — L1 Kernel skeleton (Rust) (~5 days, biggest effort)

Per `.olym/specs/kernel/spec.md` §7:
```
src-tauri/src/kernel/
├── mod.rs
├── actor.rs           (Actor trait, scheduler skeleton)
├── capability.rs      (CapToken enum, Broker)
├── event.rs           (Event enum, bus)
├── channel.rs         (typed channels via tokio mpsc)
├── effect.rs          (Effect enum + async executor)
├── llm_port.rs        (adapter trait + workers-ai stub)
├── mcp_host.rs        (stub for P4)
└── persistence.rs     (SQLite event store)
```

P2 deliverable acceptance per `.olym/specs/kernel/spec.md` §9 validation criteria.

### Step 7 — npm install + 测试 (~10 min)

```bash
cd D:/code-space/CTRL
npm install
npm test --workspaces --if-present  # most workspaces have no tests yet, OK
```

## 验收清单

- [ ] CTRL `package.json` 有 workspaces: ["packages/*"]
- [ ] `packages/olym-core/` 存在, 跟 hello-olym 同源
- [ ] `packages/ctrl-stss/` 存在, screi 资产已迁 + CTRL profile fields 已加
- [ ] `packages/ctrl-memory/` 存在
- [ ] `packages/olym-desktop/` 骨架 + 5 ports interface 定义
- [ ] `packages/ctrl-kernel-sdk/` 骨架 + 5 primitives TS API
- [ ] `src-tauri/src/kernel/` 6 模块骨架 (actor / capability / event / channel / effect / persistence)
- [ ] `npm install` 通过, workspace link 解析
- [ ] 第一个测试: 用 ctrl-kernel-sdk 定义 hello-world actor manifest, 实例化, 跑通 LLM call (即使 stub)
- [ ] Commit message 含 `[H-2026-05-11-001]` prefix
- [ ] bao 确认 verify

## 讨论 / 备注

### 这是一个超大 handoff

合并了 P1 + P2 + P3 三个 phase. 预估总工作量 ~1 周.

可以拆成:
- H-2026-05-11-001-a: P1 (workspaces + olym-core 副本) + Step 1-2, ~1 h
- H-2026-05-11-001-b: P3 (ST-SS cherry-pick) + Step 3, ~2-3 h
- H-2026-05-11-001-c: P2 (L1 Kernel Rust) + Step 6, ~5 day
- H-2026-05-11-001-d: 骨架 + 整合 + 第一个 hello-world actor

建议 zeus 接到后**先拆**, 让 bao 在 a/b 完成后再决定 c 是否当下做.

### 风险

1. **Rust kernel 设计错** → P2 RFC review 必须先于 code, 不要 jump to implementation
2. **cherry-pick 漏文件** → screi 是 pnpm, CTRL 是 npm, 注意 lockfile + workspace 解析差异
3. **olym-core 跟 hello-olym 不同步** → 接 H-2026-05-10-002 通知 (mamamiya 仓的 olym 副本约定: hello-olym 是 SSOT, CTRL 是只读副本)

### 后续 handoff 链

完成本 handoff 后开:
- H-2026-05-1X-002: P4 MCP host integration
- H-2026-05-1X-003: P5 Tool manifest spec implementation
- H-2026-05-1X-004: P6 AI 创作助手
- H-2026-05-1X-005: P7 WASM sandbox + 5 P0 keycaps
- H-2026-05-1X-006: P8 ctrl-cloud 仓 + ctrl-auth + ctrl-billing
- H-2026-05-1X-007: P9 ctrl-market + creator revenue share

### bao verbal-go

bao 2026-05-11 钦定 "A, 写下来都写下来" — 全 ADR + 5 spec + steering + 本 handoff 落地完成, 进入实施阶段.
