# CTRL — Product Brief

## Product

CTRL 是中文 OPC（一人公司）的桌面 AI 工具合集 + 全网生态聚合入口。按 `Ctrl` 唤出 → 进入工具面板 → 选键帽 / 输入 → 工具执行（含 AI 步骤 / 工作流 / 外部调用）。本质是「**模块化的 AI-native 桌面工具合集**」+「**OPC 段 AI 产品的分发渠道**」（飞书在 OPC 段太厚重，CTRL 是更轻的分发面）。

**Register**: product (app UI, not marketing site)

## Users

- **中文 OPC**：独立开发者、内容创作者、自由设计师、自由咨询，25-45 岁
- **PC 是主战场**（每天 6+ 小时桌面操作）
- **付费意愿**：年付费 ¥500-3000，已为 ChatGPT Plus / Cursor / Notion / Claude API 付费
- **设备**：macOS 13+ 主力，Win 跟随
- **场景**：在多个 App 间切换工作（写作 / 写代码 / 接客户 / 营销），需要一个秒级桌面入口聚合 AI + 工作流能力
- **痛点**：现有 AI 工具碎片化（ChatGPT / Cursor / Granola 各一个），重复造轮子，跨域问题（法律/财税/设计）只能高价咨询或赌运气问 AI

**反向画像（不服务）**：大公司员工 / 纯娱乐用户 / 手机原生用户 / 不写代码不做内容不接客户的人。

## Brand voice

**工业精确 + 务实低调 + 不卖弄 AI**。

- 像 Linear / Cursor / OP-1：工程师品味的克制
- 不像 ChatGPT 那样把"AI"挂嘴边；AI 只是 step engine 里的一种 step
- 中文 + 英文双语友好，但中文优先
- 文案：信息密度高，没有 fluff，没有"让你的工作流飞起来"这种营销词
- 句号不用 em dash（按"用逗号、冒号、分号、句号、括号"的规矩）

## Anti-references

明确不要长成这样：

| 别撞上 | 原因 |
|---|---|
| **紫色渐变 SaaS / web3 落地页** | AI slop 的最大公约数，没有任何品牌识别度 |
| **Material Design** | 太 Google，不符合 macOS 中文桌面气质 |
| **Anthropic 橙** | 已被占用 |
| **ChatGPT 灰** | 太单调，被关联到"通用 AI 框" |
| **iCloud / SwiftUI 默认蓝** | 没差异化，看起来像系统自带 App |
| **Notion 黑白** | 中性到无个性 |
| **iOS 26 Liquid Glass 默认配色** | 撞 Apple 系统语言 |
| **Hero metric SaaS 模板** | 大数字 + 标签 + 渐变副数字 = SaaS cliché |
| **emoji 当 icon 套娃**（Notion/Slack 路数） | 训练语料里"不够专业用 emoji 凑"的反例。CTRL 的 emoji 是工具 hero icon，不是装饰 |

## Strategic principles

1. **工具不值钱，生态才值钱** — 不抄 Quicker 8000 个长尾动作；做 Top 10 + AI 杠杆 + 开放 manifest 生态
2. **CTRL = OPC 段的飞书替代** — 别人的 AI 产品做成 CTRL tool，一键装、一键引导（飞书太厚重不适合 OPC）
3. **模块化（Tool 一等公民 + Action 二级）** — 每个工具是独立模块，可装可卸；声明式优先（JSON manifest），脚本沙箱二级
4. **AI-first** — 每个 Quicker 老工具加 AI 后能力放大 5-20 倍；CTRL 的核心差异化是 LLM-native
5. **聚合 > 自建** — Quicker 的 8000 动作 / Coze 的 6000 节点都是后端，CTRL 是入口
6. **Founder as founding creator** — 创始团队是首批创作者 + dogfooder + builder-in-public

## Visual metaphor (locked)

**键帽（Keycap）派 · 工业精确**。产品名 = `Ctrl` 键，键帽是天然视觉母题。每个工具是一个物理键帽（5 层阴影 + 渐变面 + spring hover + press 下沉）。参考 OP-1 / Braun / Linear / Frank Chimero。

## Layout primitives

- **键帽池（Pool）** — 全部可用工具的库（左 sidebar，列表式，搜索）
- **键盘（Keyboard）** — 主工作面，键帽网格
- **工作区（Workspace）** — 默认隐藏，复杂键帽（如 AI 长输出）展开时出现

## Phase

v0.1 — Phase 1 Spike + Slice 1 + 部分 Slice 2 已完成（详见 `doc/product-spec.md` §10 路线图）。当前焦点：UI / VI 收敛到生产级。

## Related docs

- 完整 product spec: `doc/product-spec.md`
- 设计 token: `doc/design/tokens.json`
- 高保真原型: `doc/design/keycap-prototype.html`
- Quicker 研究: `doc/quicker-research.md`
- PRD（投资视角）: `.claude/PRPs/prds/ctrl-platform.prd.md`
