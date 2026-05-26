# Spec Review — irisy/spec.md v0.1.0

- **Reviewer**: zeus
- **Date**: 2026-05-22
- **Spec author**: hephaestus
- **Verdict**: **CHANGE_REQUEST** (4 Critical 必改 → re-review → land)
- **bao status**: reviewed verdict, said "go" — hephaestus to address Critical 1-4

---

## Summary

核心 framing 对齐 (workbench / hermes 长手脚 / Obsidian 哲学 / lazy install / MIT compliance), §5.5 license + §6 owners + §8 counter-evidence 写得好. **4 Critical 改完后 land**, Medium/Nit 改不改 hephaestus 自决.

## ✅ Strengths

- §3.1 workbench framing 跟 memory `decision_ctrl_is_hermes_workbench` 完全 sync
- §5.5 MIT compliance 跟 zeus 2026-05-22 verify (PyPI `hermes-agent` v0.14.0 MIT) 一致
- §6 C1-C20 4 lane 分工清晰
- §8 6 failure mode 体现处女座反例文化
- §3.4 8-stage inference from SSE 设计巧 (PWA 推断, 不 train hermes)

---

## ❌ Critical (必改后 re-submit)

### Critical 1 · §3.5 "每 keycap 同步生成 SKILL.md" 跟 bao 最新校准矛盾

bao 2026-05-22 session 内反复纠正 (4+ 次): keycap ≠ hermes skill, **不强 1:1**.

bao quotes:
- "我们为什么既要 keycap mcp tool 又要 hermes skill?"
- "每个 keycap 都有 hermes skill 吗?"
- "skill 该用就用, skill 也需要手脚"

Latest framing (memory `decision_irisy_architecture` final + `decision_keycap_is_mcp_server_only` 修正):

- keycap 默认 MCP server (90%): tools + resources + prompts 暴露给 hermes 直接消费, **不生成 SKILL.md**
- keycap 少数 (复杂 reasoning / 知识密集) → hermes skill: 生成 SKILL.md + assets 到 `~/.hermes/skills/<id>/`
- skill 也可独立装 (agentskills.io 来源, 不绑 keycap)

**Required change**:
1. §4.1 Top-level fields 加 `target: "mcp-tool" | "hermes-skill"` 字段 (作者声明)
2. §3.5 改为按 target 分支 dispatch:
   - `target=mcp-tool`: kernel MCP server 暴露 keycap 的 tools + (manifest-derived) resources + prompts. **不生成 SKILL.md**.
   - `target=hermes-skill`: SKILL.md generator 跑, 写到 `~/.hermes/skills/<id>/`
3. SKILL.md generator (C3) 改为 conditional — 只对 target=hermes-skill 触发
4. §3.6 3-tier adjustment: Fork tier 处理调整 — target=mcp-tool 不 fork SKILL.md (因为没); target=hermes-skill fork SKILL.md

**bao approved** (go).

---

### Critical 2 · §4.3 9 renderer enum 缺 `code-space` — Coding 阻塞

zeus path C (Code Space H-19-001 in_progress) = PTY + 文件树 + diff view, **不在 9 generic renderer 里**.

§4.3 自相矛盾:
- "Frontend has a single dispatch registry; adding a new keycap never adds a new PWA component"
- 但 Coding 显然需要新 React component (xterm.js + CodeMirror + 文件树)

**Required change**: enum 加 `custom` 选项, manifest 声明 `custom_component_path` 字段 (创作者贡献 keycap 可写自己的 tab component, 符合 thesis "创作者扩展" 哲学):

```typescript
const Workspace = z.object({
  ui: z.enum([
    'none', 'notification', 'modal', 'clipboard',
    'html-output', 'chat-stream', 'picker', 'form', 'canvas',
    'custom',  // new
  ]),
  custom_component_path: z.string().optional(),  // required if ui='custom'
});
```

Coding manifest 用 `ui: 'custom'`, `custom_component_path: 'packages/ctrl-web/src/components/keycaps/CodeSpaceTab.tsx'`.

daedalus 在 `packages/ctrl-web/src/lib/keycap-tab-registry.ts` 维护 custom_component_path → React component 映射.

**bao approved B** (custom + custom_component_path).

---

### Critical 3 · §3.3 hermes installer script URL 未 verify

`https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh` 是 spec 假设. **zeus 2026-05-22 verify PyPI 时没确认这个 install.sh 真实存在**.

如果 URL 404, C4 (`bootstrap_hermes` Rust command) 写不下去.

**Required change**: §3.3 默认路径改为 `pip install hermes-agent` (PyPI v0.14.0 zeus 2026-05-22 已 verify):

```rust
// bootstrap_hermes default flow
1. Check `python3 --version` ≥ 3.11 (else prompt user to install Python)
2. Create venv: `python3 -m venv ~/.ctrl/hermes-venv`
3. pip install: `~/.ctrl/hermes-venv/bin/pip install hermes-agent`
4. Verify: `~/.ctrl/hermes-venv/bin/hermes --version`
5. Start: `~/.ctrl/hermes-venv/bin/hermes gateway --port 8642`
```

如果 hermes 上游真有 install.sh, 作 optional 加速通道 (--quick-install flag).

hephaestus 验证 hermes 上游 README / docs 有无 install.sh 后调整.

---

### Critical 4 · §3.4 hermes SSE event schema 未 verify

Event names `tool_call_start / tool_call_progress / tool_call_error / run_failed` 是 spec 假设. **C9 (PWA 8-stage inference engine) 写之前必须 verify hermes 真实 SSE schema**, 否则 inference engine fails on first deploy.

**Required change**: §3.4 加 zeus / hephaestus verify 步骤:

```bash
# Spike: 真实 hermes SSE event types
pip install hermes-agent
hermes serve &
TOKEN=$(hermes token)
curl -X POST http://localhost:8642/v1/runs \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"messages": [{"role":"user","content":"echo hello"}]}'
# Capture run_id, then:
curl -N http://localhost:8642/v1/runs/$RUN_ID/events \
  -H "Authorization: Bearer $TOKEN"
```

看实际 event types (可能是 `delta` / `tool_call` / `done` 等 OpenAI-compatible 名称, 不是 spec 假设的 `tool_call_start`), 跟 spec 假设对齐. 假设错时 fallback generic "agent activity".

---

## ⚠️ Medium (建议改, 不阻塞 land)

### Medium 1 · §7 Q2 hermes 远程 messaging vs "本机三件套 = 全部部署模型"

hephaestus 自己 2026-05-22 收口 "本机三件套 = CTRL 全部部署模型". Q2 hermes Telegram/Discord/Slack 远程 messaging 跟这条 tension.

应在 §7 Q2 注明跟 mesh ADR-003 / "本机部署" 框架的 reconcile:
- Telegram bot 是**本机 hermes**作 webhook 接收端 (用户配自己的 bot token)
- 不通过 ctrl-cloud 中转
- 不需要 VPS / 公网服务器

### Medium 2 · §3.2 MCP server port 17873 vs ST-SS bridge 17872

差 1 deliberate? spec 应注明区分 (ST-SS = stream protocol bridge, MCP = tool RPC), 加 footnote 防止读者误以为 typo.

### Medium 3 · §4.6 `source_url: z.string().url()` 接受 `git+https://...`?

Zod `.url()` 默认行为 verify (e.g. `git+https://github.com/user/repo.git`). 不接受时加 custom validator 或改 `z.string().regex(...)`.

---

## Nit (不阻塞)

### Nit · §5.5 `hermes-example-plugins` license "TBD"

大概率 MIT 同 org 风格. hephaestus 用前 verify:

```bash
gh repo view NousResearch/hermes-example-plugins --json licenseInfo
```

更新 §5.5 table.

---

## bao 校准 (已 ack 2026-05-22)

- Critical 1 framing (`target=mcp-tool / hermes-skill`, 90% mcp-tool): **bao approved**
- Critical 2 renderer (`custom` + `custom_component_path`, 选项 B): **bao approved**
- Critical 3, 4 是 verify 活, 不需要 bao 拍

---

## Next steps for hephaestus

1. Address Critical 1-4 (改 §3.3 / §3.4 / §3.5 / §4.1 / §4.3 / §4.6)
2. Optional: address Medium 1-3, Nit
3. Bump spec version 0.1.0 → 0.2.0, append Changelog entry
4. 通知 zeus re-review (在 main branch 留 commit message 或 dispatch 信号)
5. Re-review APPROVE 后 spec land main, 解锁 C1-C20 实施

---

**Review duration**: ~25 min (read 600 lines + cross-check 3 memory files + Coding 4-件 framing + license verify state).
**Reviewer signature**: zeus 2026-05-22

---

## Hephaestus response — 2026-05-22

All 4 Critical addressed in spec v0.2.0 + 3 Medium + 1 Nit. Detail:

**Critical 1** (§3.5 / §4.1 `target` field) ✅
- §4.1 top-level fields table added `target: mcp-tool | hermes-skill` (default `mcp-tool`).
- §3.5 rewritten — old "every keycap synchronously generates SKILL.md" is explicitly retracted with bao's 3 quotes. New dispatch: `target=mcp-tool` registers via kernel MCP server tools+resources+prompts (no SKILL.md, ~90% of keycaps); `target=hermes-skill` generates SKILL.md + assets (minority, complex-reasoning keycaps). Skills installable independently of keycaps (agentskills.io upstream).
- C3 marked **conditional** in §6 — SKILL.md generator only fires when `target=hermes-skill`.
- Fork tier handling per `target`: `mcp-tool` forks manifest only; `hermes-skill` forks manifest + SKILL.md + assets.

**Critical 2** (§4.3 `custom` renderer) ✅
- enum 9 → 10 with `custom`. Added `Workspace` Zod object with `custom_component_path?: string` + refine ensuring path present when `ui='custom'`.
- C7 (PWA workbench shell) extended to mention `keycap-tab-registry.ts` in daedalus scope, mapping `custom_component_path` → React component.
- Noted Code Space (lane H-19-001 in_progress, zeus path C) as first-party `custom` consumer.
- Creator-economy thesis: third-party `custom` keycaps ship their React component at `~/.ctrl/keycaps/<id>/component/`, daedalus loads at runtime.

**Critical 3** (§3.3 installer URL verify) ✅
- Verified `install.sh` URL returns HTTP 200 (curl head — review's 404 concern unfounded).
- Default path nonetheless switched to **`pip install hermes-agent`** per review's reasoning (PyPI v0.14.0 already verified, fewer moving parts, easier failure-mode reasoning).
- Upstream `install.sh` kept as opt-in `--quick-install` flag for users preferring upstream's uv-driven Python provisioning.
- Spec includes full 5-step pip-install bootstrap_hermes flow (venv at `~/.ctrl/hermes-venv/`).

**Critical 4** (§3.4 SSE event verify) ✅
- Grep'd `gateway/platforms/api_server.py` in NousResearch/hermes-agent main branch. Verified actual SSE event names follow **OpenAI Responses API**:
  - `response.created` / `response.output_item.added` / `response.output_text.delta` / `response.output_text.done` / `response.output_item.done` / `response.failed` / `response.completed`
  - + custom `hermes.tool.progress` for mid-call progress
- §3.4 8-stage inference table rewritten to use real event names. Old assumptions (`tool_call_start` / `tool_call_progress` / `tool_call_error` / `run_failed`) all corrected.
- Pre-C9 spike script added (curl test against live hermes) for re-verification once C4 lands in alpha.
- Approval-gating event payload schema still needs runtime spike — flagged.

**Medium 1** (§7 Q2 messaging gateway) ✅
- Q2 expanded with explicit 本机 hermes reconciliation: user's own Telegram bot → webhook points at local hermes (via ngrok / Cloudflare Tunnel if needed). No ctrl-cloud proxy, no CTRL-owned bot, no VPS. Aligns `decision_ctrl_is_hermes_workbench` 本机 truth + `decision_ctrl_obsidian_philosophy` no-account principle.

**Medium 2** (§3.2 port footnote) ✅
- Added explicit footnote: `17872` ST-SS bridge (CBOR Cell/Op stream WS for PWA) vs `17873` MCP server (tool-RPC for hermes + external AI). Differentiation deliberate.

**Medium 3** (§4.6 source_url regex) ✅
- Replaced `z.string().url()` with regex accepting both `http(s)://` and `git+https://` schemes.

**Nit** (§5.5 hermes-example-plugins license) ✅
- Verified MIT via `gh api repos/NousResearch/hermes-example-plugins`. Table updated.

**Version bump**: 0.1.0 → 0.2.0. Changelog entry written.

**Status**: Spec ready for zeus re-review. Locks the contract for daedalus (C7-C11, C14, C19) and zeus (C2, C4-C6, C12-C13, C15, C18) to start implementation. hephaestus's deliverables (C1 schema finalising, C3 TS reference for generator, C16 Irisy lifecycle SKILL.md content, C17 inventory refresh, C20 in-product strings) ready to start in parallel once spec lands main.

— Hephaestus 2026-05-22
