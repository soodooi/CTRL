# ADR Process

CTRL 的 ADR（Architecture Decision Records）治理规则。**这不是建议，是契约**。

---

## 1. 单决策原则（最重要）

**One decision per ADR**。如果一个 ADR 讨论 2+ 个独立决策，必须拆。

**反例**：ADR-001 把"4 层架构 + 5 原语 + 18 基础设施 + 15 键帽 + 阶段规划 + 风险"全塞一个文档，导致每次部分 pivot 都得局部 supersede 单 section，留下烂账。

**正例**：每个独立决策一个 ADR：
- ADR-N: PWA 选 React 18 + Vite（仅此一项）
- ADR-N+1: PWA bundle 预算 500 KB gzip（仅此一项）
- ADR-N+2: ...

如果决策天然耦合（"选 Tauri 2 + 关闭 Tauri Mobile 路径"），可以放一起；判断标准：**它们能否独立 supersede**。

---

## 2. 内容边界

ADR 写什么：
- ✅ **决策本身**（一句话能讲完）
- ✅ **为什么**（context: 当时的事实 / 约束 / 压力源 + 量化）
- ✅ **后果**（positive / negative / trade-offs）
- ✅ **替代方案 + 拒绝理由**（至少 2 个）

ADR **不**写什么（违反 = PR 阻断）：
- ❌ **实现细节** → `.olym/specs/<domain>/spec.md`
- ❌ **阶段计划** → `.olym/steering/ctrl-strategy.md`
- ❌ **迁移步骤** → `.olym/handoffs/H-*.md`
- ❌ **键帽清单 / 产品 roadmap** → `doc/keycap-roadmap.md`（Hephaestus 拥有）
- ❌ **代码示例 / 文件路径 / Cargo 依赖** → spec

**判断标准**：如果该内容 6 个月后会改但决策不变，那它就是 spec 不是 ADR。

---

## 3. 生命周期

```
Proposed → Accepted → Superseded
                    ↘ Rejected
```

| 状态 | 含义 | 允许写代码？ |
|------|------|------------|
| **Proposed** | 提议，等 bao Accept | ❌ |
| **Accepted** | 已生效，可写代码 | ✅ |
| **Superseded** | 被新 ADR 替代 | ❌ 不能据此写新代码，可读历史 |
| **Rejected** | bao 拒绝 | ❌ 永远保留，防后人重复评估 |

**Accepted 后正文不改**。要改就发新 ADR。例外：在 acceptance 当下确认的小幅修订（typo / 措辞），bao 在 Accept 时 inline 修订 OK，但要在 `## Acceptance` 段记录。

---

## 4. Supersede 规则

支持两种 supersede：

### 全量 supersede（首选）
新 ADR 完全替代旧 ADR。旧 ADR `status: Superseded` + `superseded_by: [ADR-N]`，新 ADR `supersedes: [ADR-旧]`。旧 ADR 顶部加 banner。

### 局部 supersede（应避免，但允许）
新 ADR 替代旧 ADR 的某些 section。旧 ADR 局部 section 加内联标记 `🚫 SUPERSEDED by ADR-N §X`，原文保留。

**新规则**：**如果一个 ADR 被局部 supersede 超过 3 次，强制重写为 V2**（renumbered ADR-N-v2），原版 status 改 Superseded。否则烂账。

---

## 5. 双向链接

| 字段 | 必填？ | 含义 |
|------|-------|------|
| `supersedes` | 当替代时必填 | 列出被替代 ADR / section |
| `superseded_by` | 自动维护 | 被新 ADR 替代时 build-index 自动写入 |
| `implemented_by` | Accepted 时必填 | 该决策对应的 spec 文件 |
| `tags` | 必填 | 用于 EFFECTIVE.md 分类 |

**断链检测**：CI 会校验 supersedes ↔ superseded_by 双向一致，以及 implemented_by 文件存在。

---

## 6. 跨文档关系

```
.olym/steering/ctrl-strategy.md   ← 战略意图（含阶段计划）
            ↓
.claude/ADR/                       ← 架构决策（含决策依据）
            ↓
.olym/specs/<domain>/spec.md       ← 实现契约（含接口、协议）
            ↓
.olym/handoffs/H-*.md              ← 落地步骤（含 sub-PR 拆分）
            ↓
code                                ← 实现
```

**规则**：
- 修改 ADR-声明事实的决策（如砍量、换技术、改定位），**必须走 ADR amendment**，禁止直接改 strategy。违反 = PR 阻断。
- spec 顶部必须声明 `parent_adr: ADR-N`。
- handoff 顶部必须声明 `parent_adr: ADR-N` + `parent_spec: <path>`。

---

## 7. 编号

- 单调递增 `001`, `002`, `003` ...
- 不复用编号
- ADR-N 拆分 / 重写为 V2 → 新编号 ADR-M，旧 N 保留为 Superseded

---

## 8. 角色

详见 [ROLES.md](./ROLES.md)。简略：

| 角色 | 可提哪类 ADR |
|------|-------------|
| **bao**（用户） | 任意；唯一 Accepter |
| **zeus**（架构 + 底座 + LLM 适配） | tags: foundation / shell / llm / commercial |
| **athena**（Copilot 系统） | tags: agent / copilot |
| **hephaestus**（键帽生态） | tags: keycap / manifest / market |

---

## 9. 反 bloat 检查清单（写 ADR 前自查）

- [ ] 标题是否能用 12 字以内说清？
- [ ] 决策段是否一句话？
- [ ] 是否能让 6 个月后的我一眼看懂？
- [ ] 是否每段都和"决策 + why + 后果 + 替代"有关？
- [ ] 是否含代码 / 文件路径 / 依赖版本？→ 移走
- [ ] 是否含阶段计划 / 时间表？→ 移走
- [ ] 是否讨论 2+ 决策？→ 拆
- [ ] 行数 > 200？→ 太长，砍

---

## 10. 工具

- `build-index.ts` —— 扫 frontmatter 生成 [INDEX.md](./INDEX.md)
- `build-effective.ts` —— 合成当前有效架构视图 [EFFECTIVE.md](./EFFECTIVE.md)
- `lint.sh` —— 校验双向链、frontmatter 完整性、文件大小（v2 加）
- Log4brains（未来）—— 静态站点发布到 GitHub Pages
