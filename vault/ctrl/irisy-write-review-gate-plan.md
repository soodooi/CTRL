---
title: Irisy 写操作审查门 — 设计 spec (brainstorming 定稿, governing)
kind: spec
created_at: 2026-07-04
owner: bao
author: claude
status: approved (bao 2026-07-04) — 待 writing-plans → 实施
purpose: 把「写操作审查门(数据主权 moat)」落到正确架构。brainstorming skill 定稿:复用已有的 kernel `ReviewGate`(非重造),补 PWA 接线 + 扩审查范围覆盖 hermes + reconcile 掉误建的 ACP 层重复实现。
source: 探索现有代码(review_gate.rs / mcp_server.rs dispatch / visibility.rs)+ 8-facet 调研(HITL 最佳实践)+ bao 拍板 B。
related:
  - "[[terminal-frontend-research.md]]"
  - "[[irisy-terminal-frontend-plan.md]]"
amends:
  - "ADR-002 substrate §264 (review gate 范围) + ADR-006 §4 (autonomy ladder)"
---

# Irisy 写操作审查门 — 设计 spec

## 1. 背景 + 发现(ledger-proven)

「数据主权 + 写操作审查门」是 CTRL 护城河:没有人工过目,不发生自动写。调研(ADR-005 §8.6.2)后先在 ACP 层建了审批(拦 `session/request_permission`),但 **ledger 证明 hermes 不发 ACP permission —— 它直接调 `vault_write` 经 `:17873` gate 执行(outcome=ok)**,ACP 层拦不到。

探索现有代码发现:**CTRL 早有一个设计精良、红队评审过的 `kernel/review_gate.rs`**(`ReviewGate`),而且**已接进 dispatch**(`mcp_server.rs:4090`):
- gate 侧派生 `arg_summary`(**不用 caller 的 prose,防 C3 prompt 注入**)
- out-of-band resolve(**外部 brain 物理够不到自己的审批**)
- fail-closed 超时拒(120s)、`requires_review()` 全套写动词分类(含 §14 `produce`)、完整单测

**缺口两个**:① PWA 侧完全没接(无转发器/命令/modal,grep 零引用)→ 即便外部 brain 也是 hang→拒;② 门条件 `!is_first_party(caller)` **exempt 了 hermes**(注释:「pwa/irisy/hermes are CTRL's own」)—— 这就是 hermes 写还是 ok 的原因。

## 2. 决策(bao 2026-07-04)

**B —— 审查门覆盖 hermes 自己的所有高风险写。** hermes 是默认脑,但也是能被读到的笔记/网页/连接器数据 prompt-注入的 LLM;护城河必须覆盖它。接受审批成本换最强数据主权。

**amends** ADR-002 §264 / ADR-006 §4 原「hermes = first-party 可信、不审」的立场:改为「**自主脑(hermes + BYO)的高风险写都审;仅用户直接操作面(pwa/irisy)豁免**」。

## 3. 设计(三部分)

### Part 1 — 范围修正(kernel)
- `visibility.rs` 新增 `is_user_surface(caller) = matches!(caller, "pwa" | "irisy")`(用户直接操作面)。
- `mcp_server.rs:4090` 门条件 `!visibility::is_first_party(caller)` → `!visibility::is_user_surface(caller)`。
  - 结果:`hermes` / `byo-cli` / `external` / `codex` / `claude-code` 的高风险写 → 审;`pwa` / `irisy`(用户点的)→ 不审;读 → 不审(`requires_review` 不变)。
- `is_first_party` 其它用途(intent 投影 / net allowlist)**不动** —— 只改审查门这一处的判定谓词。

### Part 2 — 把 ReviewGate 接到 PWA(补缺口)
- **转发器**(supervisor,有 AppHandle):`review_gate.subscribe()` 广播 → 每个 `ReviewRequest` emit `review-request` Tauri 事件 + 启动时/reload 靠 `review_list_pending`。
- **命令**(commands):`review_resolve(id, approved) -> bool`(→ `runtime.review_gate.resolve`)+ `review_list_pending() -> Vec<ReviewRequest>`。resolve 走 Tauri intra-process,外部 brain 够不到 → 防自批不变量保持。
- **PWA**:全局**非阻塞审批卡**(复用 ③ 的卡组件,改绑 `ReviewRequest{id,caller,tool,arg_summary}`)。有待审就滑入;显示 **gate 侧派生的 tool + arg_summary**(防注入),Approve / Deny → `review_resolve(id, bool)`。挂在 app 壳层(非某个对话轮内),覆盖 hermes-in-chat + 外部 brain + 后台写。

### Part 3 — reconcile 掉 ACP 层重复实现(③)
- `acp_client.rs`:撤 `handle_permission` → 回 `select_allow_outcome` 自动放行(ACP 层不拦,真门在 dispatch);删 `PENDING_PERMISSIONS` / `resolve_permission` / `is_write_tool` / `PERMISSION_SEQ` / `AcpEvent::PermissionRequest` / `PermissionOptionView` / `handle_permission` 测试。
- **保留** `SessionUpdate` 类型迁移(adopt 官方 ACP crate,无关、是对的)。
- `irisy_chat.rs`:删 `PermissionCard`/`PermissionOptionWire`/`irisy_permission_respond` + `chat-permission-request` emit 分支;命令注册表撤 `irisy_permission_respond`。
- PWA:卡组件**复用**,transport 从 `chat-permission-request` 换 `review-request`;llm-transport 撤 permission 通道。

## 4. 数据流

```
hermes → 写工具 → :17873 dispatch_tool
  → needs_review = enforcing && !is_user_surface(hermes) && requires_review(tool)  [true]
  → review_gate.request(caller, tool, gate侧arg_summary) → oneshot rx  [dispatch 暂停]
       └─ broadcast → supervisor 转发器 → emit review-request → PWA 审批卡滑入
  ← 用户点 Approve/Deny → review_resolve(id, bool) → gate.resolve → oneshot 送值
  → dispatch 醒:approved 执行工具 / denied 返回 review-denied(工具不跑)
  (无人 120s → fail-closed 拒)
```

## 5. 验收标准

1. `is_user_surface` 单测:pwa/irisy=true;hermes/byo-cli/external/codex/claude-code=false。
2. dispatch 门:caller=hermes + 写工具 → `needs_review=true`(改前=false)。in-process 测试(gate `enforcing()` 在 test 下为 false,用直接调 `requires_review`+`is_user_surface` 组合验证谓词)。
3. `review_resolve` / `review_list_pending` 命令存在 + 注册。
4. PWA `tsc` 绿;审批卡渲染 `ReviewRequest` + 调 `review_resolve`。
5. ③ 的重复实现全撤,`SessionUpdate` 迁移保留,kernel + tsc 绿,原有测试(含 review_gate 5 测试)不破。
6. **真机(bao 机器)**:Irisy 对话里让它写笔记 → 审批卡滑入 → Approve 才写、Deny 不写(ledger 佐证)。桌面验证同 §8.6 诚实 gap。

## 6. 不做(YAGNI)
- 不做 approve 的 once/session/always 作用域持久化(ReviewGate 现无该概念;v1 每次审。后续可加)。
- 不做 edit-args(ACP request_permission 才有该语义;gate 层是 approve/deny 二选一)。
- 不改 `requires_review` 的分类集(已全 + 有测试)。
- 不动 `is_first_party` 的其它用途。
