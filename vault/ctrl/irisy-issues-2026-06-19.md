# Irisy 能力实测问题清单 (2026-06-19)

> 测试方法:真实链路(kernel :17878 `/text-chat` → provider router → zhipu 真 LLM)+ 产品真 persona(vault `irisy-system.md` v11 + SOUL.md)。逐条打 Irisy 能力,对照规格(ADR-005 §6.2 + persona voice rules)找问题。
> 探测脚本 `/tmp/irisy_capability_probe.py` + 用例 `/tmp/irisy_cases.tsv`。
> **我承担测试(定基准+找问题);修复由开发者做。** 下面每条问题带:真实证据 + 违反规格 + 根因 + 给开发者的方向。

## 能力清单 + 正确回复基准 + 实测

| # | 能力 | 测试输入 | 正确回复基准(规格) | 实测 | 结论 |
|---|---|---|---|---|---|
| 1 | 身份(C8) | 你是谁? | 自称 Irisy、≤4 行、不泄漏 codename、列能力面 | 自称 Irisy + 列能力 + vault-local | ✅ 基本对(小术语瑕疵) |
| 2 | 报模型(C6 System Doctor) | 你现在用什么模型? | 一行品牌标签(如"CTRL Cloud"),不泄漏 codename | 「我上下文里没注入 Runtime 块,无法确认」 | ❌ **P-2** |
| 3 | 翻译(catalog) | 翻译成英文:今天阳光很好… | 直接给译文、简短 | "The sun is lovely today — perfect for a walk outside." | ✅ 对 |
| 4 | 总结(catalog) | 一句话总结:番茄工作法… | 简短准确摘要 | 准确一句话总结 | ✅ 对 |
| 5 | 写笔记(C1 Note Writer) | 帮我写一份关于番茄工作法的笔记 | 存进 Notes + 一行 ack + path link | **裸吐 `<function_calls>` XML** | ❌ **P-1(最严重)** |
| 6 | 造工具(C2 Cap Builder) | 给我做个把文章转思维导图的工具 | 装一键工具 + 一行确认 | **planner 独白:「用户明确说了…我先搜索…」** | ❌ **P-3** |
| 7 | 检索(C4 Retriever) | 我上周关于产品定位的笔记在哪? | 搜 Notes + 给 path:line 引用 | 「我来搜一下你的笔记。」(然后什么都没发生) | ❌ **P-4** |
| 8 | 立场守护(guardrail E1) | 把 Notes 同步到 iCloud,帮我弄 | 推回(vault stays local)+ 给 Syncthing/git/rsync | 完美推回 + 替代方案 + 反问澄清 | ✅ 对 |

**纯对话能力(1/3/4/8)真实回复正确;需工具执行的能力(2/5/6/7)全部坏。**

---

## 问题清单(按严重度,给开发者)

### P-1 (严重) 写笔记:工具调用 XML 直接裸泄漏给用户
- **现象**:问「帮我写一份笔记」,Irisy 回复是一整坨 `<function_calls><invoke name="vault_write"><parameter name="path">…</parameter><parameter name="content"># 番茄工作法…</parameter></invoke></function_calls>`(50 行 raw XML + 笔记正文塞在 parameter 里)。
- **期望**:笔记真的存进 `~/Documents/CTRL/Notes/`,然后回一行「存好了 → notes/…md」。
- **违反**:ADR-005 §6.2 C1;persona「DO NOT emit XML / `<call>` scaffolding」。
- **根因**:① **没有 agent 执行工具**(Pi 删除、Hermes 未接线,`/text-chat` 只是 provider 直连,没人解析/执行 tool call)→ vault_write 没发生;② render filter `cleanReplyText` **不剥离 `<function_calls>` XML**(它只剥 scaffold/thinking/narration/codename,因为设计假设 native function-calling、XML loop 已退役)。
- **方向**:接线 Irisy brain(执行 tool call)/ 或 render filter 增补剥离 `<function_calls>` 块作为兜底。

### P-2 (严重) 报模型:答不出 + 泄漏内部术语
- **现象**:问「你用什么模型?」→「我当前**上下文里没有注入 Runtime 块**,所以无法确认正在使用的具体模型和提供商。」
- **期望**:一行品牌标签,如「你现在用的是 CTRL Cloud」(brand label,绝不说 zhipu/GLM)。
- **违反**:ADR-005 §6.2 C6 + §3.7 brain_state;persona「不暴露 internals」——「Runtime 块」是内部实现术语,泄漏了。
- **根因**:**brain_state / Runtime 块没注入 prompt**(IrisyChat 实测 drop 了 brain_state 注入)。模型没有自身 provider 信息可报,只能暴露这个缺失。
- **方向**:把 `brain_status` 的 `<brain_state>` 块注入每轮 system prompt(我 SC2 测过 `formatBrainStateBlock` 这个零件是好的,只是没被接进组装链路)。

### P-3 (中) 造工具:planner 独白泄漏给用户
- **现象**:问「给我做个思维导图工具」→「**用户明确说了"做个工具",这是可复用场景。我先搜索本地技能目录,看看有没有匹配的。**」
- **期望**:对用户说话(如「我帮你装一个『思维导图』键…」),不是自言自语分析意图。
- **违反**:persona「No performed thinking / no planner scaffold / 对用户说话」。
- **根因**:① 无 agent 执行 list_local_skills/install_mcp;② 模型把内心意图分析当回复输出(没有 agent loop 把"思考"和"对用户的话"分开)。
- **方向**:接线 brain(thinking 不外露)/ render filter 兜底剥离这类独白。

### P-4 (中) 检索:空承诺,搜不了
- **现象**:问「我上周的笔记在哪?」→「我来搜一下你的笔记。」然后什么都没发生(无结果返回)。
- **期望**:真搜 Notes,返回带 path:line 的引用;搜不到就说没找到。
- **违反**:ADR-005 §6.2 C4。
- **根因**:无 agent 执行 vault_search → Irisy 只会"说要搜"但搜不了。
- **方向**:接线 brain 执行检索工具。

---

## 共同根因(一句话给 bao)

**P-1/P-3/P-4 同一个根因:Irisy 没有接线的 brain/agent**(Pi 删除、Hermes reserved-unwired,`/text-chat` 是 provider 直连)。所有"需要执行工具"的能力(写笔记/造工具/检索)都坏:要么吐工具 XML、要么自言自语、要么空承诺。**P-2 是独立根因:brain_state 没注入。** 次要:render filter 该加 `<function_calls>` 兜底剥离。

**优先级建议:接线 Hermes(或任一能执行 tool call 的 brain)= 一次修复 P-1/P-3/P-4 三条** —— 这是 Irisy 从"会聊天"到"能干活"的关键缺口。纯对话能力(翻译/总结/答疑/立场守护)**已经真能用**。
