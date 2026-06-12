# 0003 — CTRL = 模块化、意图驱动的平台(不是一堆内置 face)

- 状态:Accepted
- 日期:2026-06-11
- 关联:[0001](0001-ctrl-is-the-project-brain-not-a-coding-tool.md)(项目大脑);纠正了把 Coding/Notes 做成固定 face 的错

## Context
bao:「coding 其实应该是可以安装的…我希望 ctrl 可以在各个场景、用户意图层面,能灵活集成模块,用户可操作。」

之前把 Coding / Notes / 一个 bundled CRM 做成了固定内置(sidebar 固定 face + 内置 iris-crm),违背了 CTRL 本来的模块化(mcp = 1 键 = 1 工具)+「用户搜索/安装/配置」。

## Decision
**CTRL = 模块化、意图驱动、用户拥有的本地 AI 工作台。每个能力(coding / CRM / notes / 任何)都是可安装模块,不内置。** 一个 primitive(mcp manifest = 模块)+ 一个意图循环 + 一个 store。

- **一个 primitive**:模块 = mcp manifest(metadata + 能力 + 配置 schema)。形态同 Claude Skill / MCP tool。一切是模块,**包括 coding**。
- **意图浮现,无菜单膨胀**:用户说意图 → Irisy 匹配**已装模块的 manifest 描述** → 只加载相关 1-3 个(progressive disclosure)。库可无限大,UI 极小。**scale 活在 registry,不在 UI。**
- **用户可操作**(app-store 级,不是配置文件):一键装(.mcpb 式 bundle)、guided 表单配置 → keychain、按**场景**组织的 store、AI 从一句话生成 manifest。

## Consequences
- **这是减法**:砍掉固定 tab → 一个 primitive + 意图循环 + store。比「一堆 feature」严格更简单(治「庞大乱」)。
- **coding = 获客 beachhead**:coding 模块(wrap opencode / Claude Code / Codex,BYOK)→ 开发者 KOL 来用 → 他们就是建模块的人,成模块供给(Raycast 2 万开发者 / 2000+ 扩展 flywheel)→ 口碑带平台 → 带非技术买家。Cursor 0→$2B ARR 全靠开发者口碑。**只有 coding 是「模块」不是「tab」才成立。**
- **edge**:local + 用户拥有 + 任意模型/agent = 空象限(Raycast 云 Pro / Claude Desktop 锁模型 / Zapier 云跑且拿你数据,各缺一条)。
- **商业**:Raycast 模板 —— free 核心 + Pro 订阅;module store 是 moat + 获客,不是收入(monetize substrate,对齐 share-and-be-shared)。

## 反乱护栏
1. 只一个 primitive(模块);每个「内置 X」的冲动 → X 是模块。
2. 无菜单膨胀 —— 模块按意图浮现,不让用户翻菜单。
3. curation(reviewed 目录)= 信任 moat,不是 openness-for-its-own-sake。
4. 场景组织,不是 logo 组织。

## 落地(全是移除表面积)
1. Coding / Notes 从 sidebar 固定 face → 可安装模块
2. 模块按意图浮现(Irisy 匹配 manifest 描述)
3. Discover = 模块 store(场景组织、一键装、key → keychain)

## Sources
见 [research/modular-intent-platform.md](../research/modular-intent-platform.md);memory `project-ctrl-modular-intent-platform`(完整调研 + Raycast / Cursor / Anthropic Skills+MCP / Zapier sources)。
