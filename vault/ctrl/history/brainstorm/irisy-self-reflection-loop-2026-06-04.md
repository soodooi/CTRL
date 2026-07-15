# Irisy 自我复盘闭环 — 设计调研

**Date**: 2026-06-04
**Trigger**: bao 2026-06-04 — "Irisy 现在有很多问题，最简单的使用都有问题... 应该有自我复盘，自己提升的过程呀，要闭环；你先调研一下，看看怎么设计？"
**Status**: 调研 + 设计草案, ADR 改动 pending bao 锁
**Anchors**: ADR-005 §1 lifecycle / §3 prompt v5 / §4 soul-md-compat · ADR-002 §3 brain / §3.7 brain_status · `irisy-capabilities-2026-06-04.md` · `user-intents-2026-06-04.md` (I 反 5 项)
**Predecessors**: `decision_pi_is_sole_brain_hermes_is_keycap` · `feedback_pi_is_core_use_upstream_surfaces` · `feedback_verify_runtime_not_design`

---

## TL;DR

bao 钦定 **in-session per-turn 复盘**。

**直接每 turn 跑完整 reflection (LLM 调用) 不可行** —— 每轮加 ~500ms 延迟 + token 翻倍 + Reflexion / Self-Refine 论文已警告"over-reflection 会让 agent 性能下降"。

**推荐: 两层闭环 (技术分层, 不是时间分期)**：

1. **Detect (每 turn, 0 LLM cost)** — 客户端纯规则识别失败信号 (用户改写 / 负反馈词 / Pi 自打脸 / tool fail), 命中写 `.irisy-memory/episodes/<date>.md`
2. **Reflect + Improve (按需 trigger, 1 LLM 调用)** — 累积 N 负 episode / 用户主动问 / app idle 时 Pi 跑 reflection prompt, 物化到 SOUL.md `x-ctrl:lessons` + `.irisy-memory/reflections/<date>.md` + `.irisy-memory/playbook.md` (注入下一轮 system prompt)

**约束 Pi 上游 `./hooks` 子路径 export 但 dist 目录空** —— 必须在 IrisyChat / kernel `commands::irisy` 这层加, 不能 delegate 给 Pi upstream (跟 `feedback_pi_is_core_use_upstream_surfaces` 不矛盾, 是 upstream 暂没 surface 可用)。

---

## 1 CTRL 现状 (runtime verified, 2026-06-04)

| 文件 / 位置 | 现状 | 缺口 |
|---|---|---|
| `packages/ctrl-web/src/components/irisy/IrisyChat.tsx` | 已组装 system prompt: brain state + core memory + SOUL.md long-term + memory index + history | 0 reflection / 0 detect / 0 improvement wire |
| `packages/ctrl-web/src/lib/irisy-memory.ts` | 有 `ensureMemoryBootstrap()` / `loadCoreMemory()` / `recordMemory()` API | 无 episode / reflection / playbook 概念 |
| `~/.ctrl/vault/.irisy-memory/` | 仅 `user_profile.yml` 一份 (ADR-005 §4 SOUL.md seed 已落 `.soul-md-version`) | 无 `episodes/` / `reflections/` / `playbook.md` |
| `src-tauri/src/commands/irisy.rs` | `irisy_init` + 基础 chat ops | 无 turn-end hook / 无 episode 落盘 |
| Pi 0.73.1 `dist/core/hooks/` | package.json 声明 `./hooks` export | **目录是空的, upstream hooks 未实装** |
| `user-intents-2026-06-04.md` I 反 (Reflect) | 5 项, 全 ❌ / 🟡 | 全是**用户主动问**, **没有 Irisy 主动反思** |
| 用户当前对话 Pi 版本 | log 显示 0.73.1 已下载但未 restart, runtime 用的可能是老版 | 用户不知 |

**关键技术约束**: Pi upstream 没有 `on('turn-end')` 这种 hook, CTRL 想在每 turn 注入反思动作, 只能在 IrisyChat 拦截 `transport.stream(history)` 的完成态自己加。

---

## 2 业界方案对照

挑 8 个跟"agent self-reflection / self-improvement loop"最相关的代表作。

### 2.1 学术经典

| 方案 | 年 | 核心机制 | 落 CTRL 启发 |
|---|---|---|---|
| **Reflexion** (Shinn et al., NeurIPS 2023) | 2023 | trajectory 跑完 → verbal self-reflect → 存"episodic memory" → 下次 trial 读 | episode 概念直接对接, 但 CTRL 是 chat 不是 trial-based, 要改造 |
| **Self-Refine** (Madaan et al., NeurIPS 2023) | 2023 | 单轮 Generate → Feedback → Refine 循环 | 适合"重要回答前自检 1 次", 不适合每轮 |
| **Constitutional AI** (Anthropic, 2022) | 2022 | self-critique against 原则 → revise | CTRL 可借 "原则集" 概念 (prompt v5 + playbook.md) |
| **Generative Agents** (Park et al., Stanford Smallville 2023) | 2023 | observation stream → 定期 reflection (抽象 abstract thoughts) → memory stream → 行为 retrieve | **最贴 CTRL**: 定期 reflection + 抽象思考 + 长记忆 retrieve, 不是每轮 |
| **Voyager** (Wang et al., NeurIPS 2023) | 2023 | skill library + self-verification + curriculum, 失败 skill 不入库 | "好的复盘进库, 坏的过滤" 思路 |
| **DSPy** (Stanford Khattab) | 2023+ | teleprompter 自动 tune prompt + few-shot, programmatic optimization | 不适合 in-session, 但 nightly batch 可借 |
| **Tree of Thoughts** (Yao et al., 2023) | 2023 | 多路径探索 + self-evaluate 选最优 | 推理任务用, chat 不适合 |
| **ReAct** (Yao et al., 2022) | 2022 | reasoning + action 交错, 失败 verbal reasoning 修正 | Pi 已内建 (coding agent loop), 不重叠 |

### 2.2 production framework

| 方案 | 核心 | 落 CTRL 启发 |
|---|---|---|
| **Letta** (ex-MemGPT, Packer) | 4 段 memory (system / core / recall / archival), agent **自己 edit core memory block** via tool call | "agent 自己改自己的长记忆"思路, CTRL SOUL.md 可对应 core, episodes 对应 recall |
| **Mem0** | 自动 extract user facts → consolidate (dedup + merge) → inject 上下文 | extract + consolidate 两段, CTRL 可借 consolidate (避免 episode 越积越多变噪声) |
| **OpenAI ChatGPT memory** (2024) | 抽取 user prefs → "Memories" list 注入 system prompt, 用户可读可删 | 物化形态: 用户可见 + 可改 (CTRL vim test 守住 → markdown file 已对齐) |
| **Anthropic Projects + Files** | 手动上传知识, 无自动 reflection | CTRL 反过来, 自动 + 用户可改 |
| **LangGraph reflection** | Anthropic-style critique loop 当 graph node, generator → reviewer → revise | 适合"重要答前一次性 refine", 不适合 chat 每轮 |
| **MetaGPT / AutoGen / CAMEL** | multi-agent, critic agent 给反馈 | CTRL 单 brain, 不引入多 agent (跟 `decision_one_persona_irisy` 冲突) |
| **Cognition Devin** (闭源, 推断) | long-horizon, verification + self-correction | 黑盒, 仅作概念参考 |

### 2.3 user-facing chat 场景的关键 finding

跨学术 + 工业, 4 条共识:

1. **per-turn reflection 在工业产品里几乎没人做** —— ChatGPT memory / Letta / Mem0 都是**异步 / 触发式**, 不是每轮卡你 500ms 等 critique LLM
2. **per-trial reflection (Reflexion) 适合 episodic task (code / math / game)** —— chat 没有清晰 trial boundary, 要自定义 "episode" 颗粒度
3. **detect ≠ reflect** —— 失败信号识别可纯规则 (cheap), 但抽象提炼必须 LLM (expensive). 业界都是分层
4. **物化形式决定能否闭环** —— 物化进黑盒 vector store → 用户看不见 → 漂移没人察觉; 物化进 markdown → vim test 守住 → 用户可改可删 (OpenAI 也是这个方向)

---

## 3 关键设计 trade-off

### 3.1 触发节奏 (bao 已选 per-turn, 但需细分)

| 选项 | 优 | 劣 | CTRL 适配 |
|---|---|---|---|
| **每 turn full reflect** | 时效最高 | +500ms 延迟 +1 LLM 调用 / 轮, over-reflection 论文警告性能下降 | ❌ 不推荐 |
| **每 turn detect, 累积 N 后 reflect** | 时效高 + 成本可控 | 实装两套 | ✅ 推荐 (本 doc 主案) |
| **每 turn detect, idle / session-end reflect** | 成本最低 | 闭环慢 | 🟡 fallback |
| **nightly batch** | 0 实时影响 | 慢 24h, bao 已否决 | ❌ |

### 3.2 物化形态

| 选项 | 优 | 劣 |
|---|---|---|
| **Vector store (embedding)** | retrieve 灵活 | 黑盒, 用户看不见, 漂移没人察觉, 跟 vim test 冲突 |
| **markdown file (SOUL.md body + .irisy-memory/*.md)** | vim test 守住, 用户可读可改, OpenClaw / Claude Code 兼容 (ADR-005 §4) | retrieve 是 full-load 而非 semantic search |
| **SQLite vault-index FTS5** | 已实装, 快搜 | 不适合"长记忆 → 注入 prompt" 场景 |

**推荐**: 主用 markdown, retrieve 走 full-load (episode 数 cap 在 50, 老的 consolidate 进 playbook), vault-index FTS5 仅用于"用户问'我上周说过 X 吗'"。

### 3.3 reflection 谁来写

| 选项 | 含义 | 适配 |
|---|---|---|
| **Pi 自决, 隐式** | reflection 不通知用户 | ❌ 违反 transparency (vim test) |
| **Pi 自决, 显式** | reflection 写 markdown 用户看得见, 但 Pi 不打断 | ✅ 推荐 |
| **Pi 提议, 用户确认** | reflection 抛 dialog 让用户 Y/N | ❌ 太烦, 跟 "Companion ≠ in-your-face" 冲突 |

**例外**: SOUL.md **frontmatter** 改动必须 ask user (ADR-005 §4.3 已锁); body / lessons / episodes 直接写不打断。

### 3.4 LLM driven vs rule-based detect

| 选项 | 优 | 劣 |
|---|---|---|
| **LLM 判失败** | 准确 | 每 turn +1 调用, 跟"不能每 turn LLM"自相矛盾 |
| **规则 detect** | 0 成本 + 即时 | 误判 (用户"再说一次" 也可能是想换个话题) |
| **混合: 规则 detect, 累积后 LLM 确认** | 性价比最高 | 实装两套 |

**推荐**: 纯规则 detect, LLM 仅在 reflect 阶段介入。

---

## 4 推荐设计 — Detect / Reflect / Improve 三步闭环

### 4.1 数据形态

```
~/.ctrl/vault/
└── irisy/
    ├── SOUL.md                              # ADR-005 §4 已锁, frontmatter + body
    │   └── x-ctrl:
    │       └── lessons: [...]              # 高级提炼 (reflection 写)
    └── .irisy-memory/
        ├── MEMORY.md                        # 已实装 (index)
        ├── user_profile.yml                 # 已实装
        ├── episodes/                        # ← 新增
        │   └── 2026-06-04.md                # append-only, 每条 = (timestamp, signal_type, raw_turn 摘录)
        ├── reflections/                     # ← 新增
        │   └── 2026-06-04.md                # reflect 阶段输出, 一份 = (周期, 翻车 turn 列表, 根因, 改进点)
        └── playbook.md                      # ← 新增, 累积 do/don't 列表 → 注入 system prompt
```

### 4.2 Detect 层 — 每 turn 0 LLM 成本

**位置**: `packages/ctrl-web/src/components/irisy/IrisyChat.tsx`, 在 `transport.stream(history)` 流完后立即调。

```typescript
// packages/ctrl-web/src/lib/irisy-reflection.ts (新)

interface FailureSignal {
  type: 'user_rephrase' | 'negative_feedback' | 'banned_preamble' |
        'tool_call_fail' | 'long_silence';
  severity: 'low' | 'high';
  evidence: string;  // 触发的原文片段
}

export function detectFailureSignals(
  prevUserMsg: string | null,
  latestUserMsg: string,
  latestAssistantMsg: string,
  toolCalls: ToolCall[],
): FailureSignal[] {
  const signals: FailureSignal[] = [];

  // 1. user_rephrase: 用户改写上一问 (Levenshtein < 0.4 + 含改写词)
  const REPHRASE_HINTS = ['不是这个', '我说的是', '重新', '不对', '我意思'];
  if (prevUserMsg && similarity(prevUserMsg, latestUserMsg) > 0.6 &&
      REPHRASE_HINTS.some(h => latestUserMsg.includes(h))) {
    signals.push({ type: 'user_rephrase', severity: 'high', evidence: latestUserMsg.slice(0, 80) });
  }

  // 2. negative_feedback: 用户负词
  const NEG = ['错了', '不对', '不是', 'nope', '重来', 'wrong', '说错了'];
  if (NEG.some(w => latestUserMsg.toLowerCase().includes(w))) {
    signals.push({ type: 'negative_feedback', severity: 'high', evidence: latestUserMsg.slice(0, 80) });
  }

  // 3. banned_preamble: Pi 自打脸 (prompt v5 已禁但可能漏)
  const BANNED = ['Sure!', 'Of course!', '我来分析', '让我帮你', '当然可以'];
  if (BANNED.some(b => latestAssistantMsg.startsWith(b))) {
    signals.push({ type: 'banned_preamble', severity: 'low', evidence: latestAssistantMsg.slice(0, 60) });
  }

  // 4. tool_call_fail
  for (const t of toolCalls) {
    if (t.success === false) signals.push({
      type: 'tool_call_fail', severity: 'high',
      evidence: `${t.name}: ${t.error?.slice(0, 80)}`
    });
  }

  return signals;
}

export async function recordEpisode(turn: TurnRecord, signals: FailureSignal[]) {
  if (signals.length === 0) return;  // 不写正常 turn (cap 噪声)
  const date = new Date().toISOString().slice(0, 10);
  const path = `.irisy-memory/episodes/${date}.md`;
  const entry = formatEpisodeEntry(turn, signals);  // markdown frontmatter + body
  await appendVaultFile(path, entry);
}
```

**特征**:
- 0 LLM cost (纯客户端规则)
- 0 延迟 (与 chat stream 完成同步)
- 噪声可控 (只写命中信号的 turn, 不写正常 turn)
- 用户可改 `playbook.md` 调规则 (cap manifest 之外, 软规则 in markdown)

### 4.3 Reflect 层 — 按需 trigger, 1 LLM 调用

**触发条件 (OR)**:
- 累积 ≥ N (推荐 N=5) 个 negative episode 未消化
- 用户主动: "复盘一下" / "你最近怎么样" / "应该改什么" (走 `user-intents I 反` I1-I5)
- App idle ≥ 30 分钟 且有未消化 episode (跟 ADR-005 §1 stage 7 概念对齐, 但作用在 Irisy 自身)
- 用户长会话 ≥ 50 turn (避免会话太长不消化)

**Reflection prompt** (落 `vault/.irisy-prompts/irisy-reflect.md`, 跟 system prompt 同管):

```
# Self-Reflection — 回看最近 N 个翻车 turn

你刚跑了一段对话, 命中以下负面信号 (episode 列表):
{episodes}

请按以下结构输出 markdown 报告:

## 翻车 turn 列表
- turn #X: [signal type] — 原话: "..." — Pi 回了: "..."

## 根因假设 (按概率排序)
1. ...
2. ...

## 我应该避免的行为 (do-not list)
- ...

## 我应该坚持的方式 (do list)
- ...

## SOUL.md `x-ctrl:lessons` 应该加的高级提炼 (≤3 条, 跨 session 持久)
- ...
```

**物化**:
- 报告全文 → `.irisy-memory/reflections/<date>-<HHmm>.md`
- "do-not list" + "do list" → append `playbook.md` (注入 system prompt, 见 §4.4)
- "高级提炼" → SOUL.md `x-ctrl:lessons` (frontmatter mutation, 按 ADR-005 §4.3 应 ask user, 但 `x-ctrl:` namespace 是 CTRL-only, 可放宽规则: 自动写 + UI 红点提示用户去看, 不打断)

**reflect 完毕后** clear 已消化的 episodes (移到 `.irisy-memory/episodes/_archived/`), 避免重复 reflect。

### 4.4 Improve 层 — 注入下一轮 prompt

`IrisyChat.tsx` 现 prompt 组装顺序 (现状):
```
1. brain state block (ADR-005 §3 prompt v5)
2. core memory (irisy-memory MEMORY.md)
3. long-term memory (SOUL.md)
4. memory index
+ history
```

加 1 段 (新):
```
5. playbook (.irisy-memory/playbook.md) — Irisy 跨 reflection 累积的 do/don't 规则
```

`playbook.md` 形态 (人类可读, 用户可改):
```markdown
# Irisy Playbook — auto-curated from reflections

> 这份文件由 Irisy 复盘后自动维护. 你可以手动改 / 删 / 标"keep" 不让她改.

## Do
- 用户问技术问题时, 第一句就给结论, 不要 "我来分析" 之类开场 (2026-06-04 reflection)
- 用户用中文时回中文, 用英文时回英文 (2026-06-03 reflection)

## Don't
- 不要把 tool call 过程文字化给用户看 (ADR-002 §7 锁, 但仍漏过 2 次)
- 不要在不确定时编代码, 先 grep 再答 (2026-06-04 reflection)

## Keep (用户标的 → 不让 Irisy 自动删)
- 用户偏好 yaml 配置过 SAP 系统对接方式
```

注入 prompt 时:
- 只取 `## Do` + `## Don't` 段, `## Keep` 给用户看不进 prompt (避免膨胀)
- 总字符上限 1500, 超了 LLM 提炼合并 (consolidate, 借 Mem0 思路)

### 4.5 闭环验证 — 怎么知道复盘有效

**关键问题**: 这套机制本身怎么避免"reflection 写了一堆但 Pi 还是错"？

3 个客观信号:
- **negative episode rate / 100 turn** 应该单调下降 (telemetry)
- **同一 do-not 规则的复发率** 应该 → 0 (规则签名 hash 匹配)
- **用户主动 "I 反" 类 intent 频率** 应该下降 (用户不需要主动问 = Irisy 自己在改)

UI 层 (可选): Settings → Irisy → "复盘报告" tab, 展示这 3 个 metric 时间序列 + 最近 reflection 列表。

---

## 5 落地路径 (不分阶段, 一次成型)

按 bao `feedback_no_planning_no_phasing` —— 不写 v1/v1.1, 不写 Phase 1/2/3. 直接列文件清单:

新文件:
- `packages/ctrl-web/src/lib/irisy-reflection.ts` (detect + episode 模块)
- `packages/ctrl-web/src/lib/irisy-playbook.ts` (playbook 读写 + consolidate)
- `vault_seed/irisy-reflect-prompt.md` (reflection prompt 模板, seed 进 vault)
- `vault_seed/irisy-playbook.md` (seed empty playbook)
- `src-tauri/src/commands/irisy_reflect.rs` (新 Tauri command: trigger_reflection)

改动:
- `packages/ctrl-web/src/components/irisy/IrisyChat.tsx`:
  - stream 完成后调 `detectFailureSignals()` + `recordEpisode()`
  - prompt 组装加 §5 playbook 段
  - 用户输入触发"复盘"intent 时调 trigger_reflection
- `packages/ctrl-web/src/lib/irisy-memory.ts`:
  - 加 `appendEpisode()` / `loadPlaybook()` / `loadRecentReflections()` API
- `src-tauri/src/kernel/vault.rs::seed_vault_feature_layer`:
  - seed `playbook.md` / reflection prompt template
- ADR-005 amendment: bump v2 → v3, 加 §5 self-reflection-loop section, changelog 记录

**Pi upstream 跟踪**: 把 issue 提到 pi-coding-agent GitHub: 请落实 `./hooks` export (`on('turn-end')` / `on('tool-call')`); 一旦 upstream 落了, CTRL 这层从 IrisyChat 拦截改为 Pi hook callback (memory `feedback_pi_is_core_use_upstream_surfaces` 要求, 当 upstream 提供 surface 就切换). 短期 IrisyChat 自实装是 fallback, 不是终态。

---

## 6 Open questions (bao 决策点)

1. **SOUL.md `x-ctrl:lessons` 自动写 vs ask user**:
   - ADR-005 §4.3 锁了 "frontmatter 改前问用户"
   - 但 `x-ctrl:` namespace 是 CTRL-only, body / 普通段也都 Pi 写
   - 提议: `x-ctrl:lessons` 视为 CTRL 内部数据, 自动写 + UI 红点提示 (不打断), 跟 episodes/reflections 同管
   - **bao 拍**

2. **negative signal 规则集严宽**:
   - 现规则 4 类 (rephrase / 负词 / banned_preamble / tool_fail)
   - 严: 漏检多 (Pi 还在错, 没 episode)
   - 宽: 误判多 (用户"再说一次"也可能是想换话题, 不是不满)
   - 提议: 默认中等 + 用户可在 `playbook.md` `## Detect tuning` 段调
   - **bao 拍**

3. **reflection trigger 阈值 N**:
   - N=3 太频, N=10 太稀
   - 提议 N=5, 但用户主动 / idle 30min / 长会话 50 turn 都可强 trigger
   - **bao 拍**

4. **playbook 注入 prompt 上限**:
   - 现 1500 字符, 满了 LLM consolidate
   - 提议给 bao "建议字符数 + 是否分级 (高优先级先注)" 决策
   - **bao 拍**

5. **复盘 UI 要不要做**:
   - Settings → Irisy → 复盘报告 tab (展示 metric + 历史 reflection)
   - 或: 只落文件, 不做 UI (用户 vim 看, 跟 vault 哲学一致)
   - 提议: 不做单独 tab, 在 Settings → Irisy 现有面板加 1 个 "最近一次复盘" link + 直接打开 vault 文件
   - **bao 拍**

6. **Pi 上游 hooks 落实前用 IrisyChat 拦截是否 OK**:
   - 跟 `feedback_pi_is_core_use_upstream_surfaces` 不完全一致 (该 feedback 是反对手糊 RPC, 不是反对暂用 IrisyChat 拦截)
   - 提议: OK, 一旦 Pi 落 `./hooks` 立刻切, 中间无 lock-in (detect 函数本身可复用)
   - **bao 拍** (或不 ack 默认 OK)

---

## 7 参考

### 7.1 学术

- Reflexion: Language Agents with Verbal Reinforcement Learning, Shinn et al., NeurIPS 2023, <https://arxiv.org/abs/2303.11366>
- Self-Refine: Iterative Refinement with Self-Feedback, Madaan et al., NeurIPS 2023, <https://arxiv.org/abs/2303.17651>
- Constitutional AI, Anthropic, 2022, <https://arxiv.org/abs/2212.08073>
- Generative Agents: Interactive Simulacra of Human Behavior, Park et al., 2023, <https://arxiv.org/abs/2304.03442>
- Voyager: An Open-Ended Embodied Agent with LLMs, Wang et al., NeurIPS 2023, <https://arxiv.org/abs/2305.16291>
- DSPy: Compiling Declarative Language Model Calls, Khattab et al., 2023+, <https://github.com/stanfordnlp/dspy>
- Tree of Thoughts, Yao et al., 2023, <https://arxiv.org/abs/2305.10601>
- ReAct, Yao et al., 2022, <https://arxiv.org/abs/2210.03629>

### 7.2 production

- Letta (ex-MemGPT): <https://github.com/letta-ai/letta>, <https://research.memgpt.ai>
- Mem0: <https://github.com/mem0ai/mem0>
- LangGraph reflection: <https://langchain-ai.github.io/langgraph/tutorials/reflection/reflection>
- OpenAI ChatGPT memory: <https://openai.com/index/memory-and-new-controls-for-chatgpt/>

### 7.3 CTRL 关联

- `vault/ctrl/adrs/005-irisy.md` §1 (lifecycle) / §3 (prompt v5) / §4 (SOUL.md)
- `vault/ctrl/adrs/002-substrate.md` §3 (brain) / §3.7 (brain_status)
- `vault/ctrl/history/brainstorm/irisy-capabilities-2026-06-04.md` (能力清单, 本 doc 是 A 类 brain-ops 的延伸)
- `vault/ctrl/history/brainstorm/user-intents-2026-06-04.md` (I 反 5 项, 本 doc 提供主动反思与之互补)
- `vault/ctrl/history/brainstorm/vault-irisy-product-design-2026-06-03.md` (vault 整体设计)
- memory: `decision_pi_is_sole_brain_hermes_is_keycap` / `feedback_pi_is_core_use_upstream_surfaces` / `feedback_verify_runtime_not_design`
