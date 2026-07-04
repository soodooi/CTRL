# Irisy 写操作审查门 — 实施计划

> **For agentic workers:** 走 executing-plans / 手动逐步。checkbox 跟踪。
> spec: `vault/ctrl/irisy-write-review-gate-plan.md`(approved)。

**Goal:** 让写操作审查门(数据主权 moat)覆盖 hermes,并撤掉误建的 ACP 层重复实现。

**Architecture:** CTRL 的 `ReviewGate` 已端到端全建好(kernel dispatch → supervisor `review:pending` → `ReviewGateHost` modal 已挂载 → `review_resolve`)。**唯一功能缺口** = dispatch 条件 `!is_first_party(caller)` 放行了 hermes。改成 `!is_user_surface(caller)` 即让 hermes 入审。外加撤 ③ 的 ACP 层重复。

**Tech Stack:** Rust kernel(visibility/mcp_server/acp_client)、React PWA(既有 ReviewGateHost 不动)。

**⚠️ 关键教训**:动手前没 grep 既有 gate/review 基础设施,导致 ③ 整套重复造轮(kernel ReviewGate + supervisor 转发器 + ReviewGateHost 全早已存在)。→ 记忆 `feedback-grep-existing-infra-before-building`。

---

## Task 1 — 范围修正:hermes 入审(唯一功能变更)

**Files:**
- Modify: `src-tauri/src/kernel/visibility.rs`(加 `is_user_surface`)
- Modify: `src-tauri/src/kernel/mcp_server.rs:4090`(换谓词)
- Test: `src-tauri/src/kernel/visibility.rs`(#[cfg(test)])

- [ ] **Step 1: 写失败测试**(visibility.rs tests mod)
```rust
#[test]
fn user_surface_excludes_brains() {
    assert!(is_user_surface("pwa"));
    assert!(is_user_surface("irisy"));
    // Brains (autonomous, prompt-injectable) are NOT user surfaces → reviewed.
    for b in ["hermes", "byo-cli", "external", "codex", "claude-code"] {
        assert!(!is_user_surface(b), "{b} is a brain, must be reviewed");
    }
}
```
- [ ] **Step 2: 跑,确认 fail**（`is_user_surface` 未定义）
Run: `cargo test --lib user_surface_excludes_brains 2>&1 | tail -3` → FAIL (cannot find function)
- [ ] **Step 3: 实现 `is_user_surface`**（放在 `is_first_party` 旁）
```rust
/// User-driven surfaces — the human acting directly through the app. Their gate
/// calls are the user's own intent, so they are NOT subject to the write-review
/// gate. Everything else that calls the gate is an autonomous BRAIN (hermes +
/// BYO CLIs), whose high-blast writes ARE reviewed (ADR-002 §264 / ADR-006 §4,
/// amended 2026-07-04: the moat covers hermes too — an injectable LLM).
pub fn is_user_surface(caller: &str) -> bool {
    matches!(caller, "pwa" | "irisy")
}
```
- [ ] **Step 4: 跑,确认 pass**
Run: `cargo test --lib user_surface_excludes_brains 2>&1 | tail -3` → PASS
- [ ] **Step 5: 换 dispatch 谓词** — `mcp_server.rs:4090` 附近
```rust
        let needs_review = !denied
            && review_gate::ReviewGate::enforcing()
            && !visibility::is_user_surface(gate_req.caller())
            && review_gate::requires_review(&tool_name);
```
（把 `is_first_party` 改为 `is_user_surface`；注释顺手更新为「Scope to autonomous brains (hermes + BYO); user surfaces pwa/irisy exempt」）
- [ ] **Step 6: build + 全 review/visibility 测试**
Run: `cargo build && cargo test --lib visibility 2>&1 | grep "test result"` → ok
- [ ] **Step 7: commit**
```bash
git add src-tauri/src/kernel/visibility.rs src-tauri/src/kernel/mcp_server.rs
git commit -m "feat(gate): review gate covers hermes writes (is_user_surface)"
```

## Task 2 — reconcile:撤 ③ 的 ACP 层重复

**Files:**
- Modify: `src-tauri/src/shell/acp_client.rs`（撤 handle_permission → select_allow_outcome;删注册表/变体/helpers/2 测试;**留 SessionUpdate 迁移**）
- Modify: `src-tauri/src/commands/irisy_chat.rs`（删 PermissionCard/Wire/命令/emit 分支）
- Modify: `src-tauri/src/commands/mod.rs`（撤 irisy_permission_respond 注册）
- Modify: `packages/ctrl-web/src/lib/llm-transport.ts`（删 permission 通道 + 类型 + respondToPermission）
- Modify: `packages/ctrl-web/src/components/ambient/AmbientHome.tsx`（删 PermissionView/字段/handler/渲染/import）
- Modify: `packages/ctrl-web/src/components/ambient/AmbientHome.module.css`（删 perm* 样式）

- [ ] **Step 1: acp_client.rs** — 读循环 permission 分支 `handle_permission(&v, &mut *on_event).await` → 回 `select_allow_outcome(&v)`;删 `AcpEvent::PermissionRequest` 变体 + `PermissionOptionView` + `PENDING_PERMISSIONS`/`PERMISSION_SEQ`/`pending_permissions`/`resolve_permission`/`is_write_tool`/`selected_outcome`/`handle_permission`/`PERMISSION_TIMEOUT` + 测试 `write_tools_prompt_reads_flow`/`resolve_permission_unknown_id_is_false`;撤相关 imports（HashMap/atomic/StdMutex/oneshot 若无他用）。**保留** `acp_v1` import + `parse_session_update` + block_text/tool_content_text/status_str + 其 2 测试。
- [ ] **Step 2: irisy_chat.rs** — 删 `PermissionOptionWire`/`PermissionCard`/`irisy_permission_respond` + prompt 闭包里 `AcpEvent::PermissionRequest` 分支。
- [ ] **Step 3: mod.rs** — 删 `irisy_permission_respond` 注册行。
- [ ] **Step 4: llm-transport.ts** — 删 `PermissionCardData`/`PermissionOptionData`/`respondToPermission`/`permission?` 字段/QueueItem permission 分支/`unlistenPermission` 监听/consumer permission yield。
- [ ] **Step 5: AmbientHome.tsx** — 删 `PermissionView`/`Msg.permissions`/`decidePermission`/流循环 permission 分支/渲染块/`respondToPermission` import。
- [ ] **Step 6: CSS** — 删 `.permCard`/`.permHead`/`.permIcon`/`.permInput`/`.permBtns`/`.permBtn`/`.permDecided`。
- [ ] **Step 7: build + tsc + 测试**
Run: `cd src-tauri && cargo build && cargo test --lib acp_client 2>&1 | grep "test result"`（应 5 passed:2 session-update + 3 allow_outcome）
Run: `cd packages/ctrl-web && npx tsc --noEmit 2>&1 | grep "error TS" || echo clean`
- [ ] **Step 8: commit**
```bash
git commit -am "refactor(irisy): remove duplicate ACP-layer approval; ReviewGate is the gate"
```

## Task 3 — ADR amend + version

- [ ] **Step 1:** ADR-002 §264（review gate 范围）加 changelog 行:范围从「first-party 全豁免」→「仅 user surface(pwa/irisy)豁免;hermes + BYO 脑高风险写入审」,bao 2026-07-04 拍 B。bump version。
- [ ] **Step 2: commit** `docs(adr): review gate covers hermes (bump)`

## 验收（对齐 spec §5）
- Task1 谓词单测绿;Task2 后 kernel+tsc 绿、acp_client 5 测试、review_gate 5 测试不破;③ 重复全撤、SessionUpdate 迁移留。
- **真机(bao)**:对话让 Irisy 写笔记 → `ReviewGateHost` modal 弹 → Approve 才写、Deny 不写(ledger 佐证)。
