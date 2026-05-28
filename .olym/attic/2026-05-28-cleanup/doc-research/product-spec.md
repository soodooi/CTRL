# CTRL — 产品 Spec（活文档）

> 整合 PRD 之外的迭代决策。本文件是开发期的 source of truth；与 `.claude/PRPs/prds/ctrl-platform.prd.md` 互补 —— PRD 是面向投资人 / 外部的定位锚点，本文件是面向工程的执行细节，会持续迭代。

**最后更新**：2026-05-04
**状态**：v0.1 范围已锁定，进入 Phase 1 Spike + Slice 1 实现

---

## 1. 一句话定位

按 `Ctrl` 唤出 → 进入「工具合集」面板 → 选工具 / 输 intent → 工具执行（含 AI 步骤 / 工作流 / 外部调用）。

**本质**：**模块化的 AI-native 桌面工具合集 + 全网生态聚合入口**。每个工具是独立模块，可装可卸；面向 OPC（一人公司主理人）。是 Quicker 的 AI 升级版 + Raycast 的中文圈版 + Cherry Studio 的桌面入口版。

**核心战略**：**工具不值钱，生态才值钱**。CTRL 长期价值在「谁是入口」+「谁定标准」+「谁拿数据」，不在「谁有 8001 个工具」。

**关键定位**：**CTRL 是 OPC 端 AI 产品的分发渠道（distribution platform）**。今天 AI 产品挤着上飞书做 bot / 多维表格扩展 = 在用飞书当分发渠道；但**飞书太厚重（要企业账号 → 装应用 → 配 token → 才能用），OPC 不需要这种重量**。CTRL 是 OPC 的轻量分发渠道：**别人的 AI 产品做成 CTRL tool，一键装、一键引导**。CTRL 不是「飞书的下游」，而是 **OPC 段的「飞书替代」**。

---

## 2. 用户分层

| 段 | 画像 | 核心痛点 |
|---|---|---|
| **A. AI-native 用户** | 每天用 ChatGPT / Claude / Cursor / Granola | 上下文喂入烦、多工具切换、prompt 工程疲劳 |
| **B. Quicker 用户 / 难民** | Win 高级用户，习惯按 Ctrl 跑动作 | 无 Mac、无 AI、动作不够智能、动作市场单点风险 |
| **C. 重叠区（核心）** | 用 AI + 想要桌面快捷入口的中文 OPC | 两者全部 |

**非用户**：大公司员工 / 纯娱乐 / 手机原生用户 / 不写代码不做内容不接客户的人。

---

## 3. 对标产品地图

### 形态对标

| 维度 | 一线对标 | 启示 |
|---|---|---|
| 唤出 + 面板 | Raycast / Alfred / LaunchBar | Raycast 视觉规范是起点 |
| 场景化动作 | **Quicker** | 5 亿装机量；唯一直接对标 |
| AI 输入框 | Cursor Composer / ChatGPT Desktop | Cursor 上下文注入最顺 |
| 桌面 AI 助手（最像） | **Highlight AI**（YC）/ Granola / MacGPT / Pieces | Highlight 双 Cmd 唤出形态最近 |
| 多模型聚合 | Cherry Studio / ChatHub / OpenRouter | Cherry 中文圈最熟 |
| 本地 LLM | LM Studio / Ollama / MLX | LM Studio 体验天花板 |
| 步骤化自动化 | Apple Shortcuts / n8n / Keyboard Maestro | n8n 节点设计可学 |
| 创作者市场 | Raycast Store / Quicker / Apple Shortcuts Gallery | Raycast 精品策展 |
| 专家蒸馏（L2） | Delphi.ai / Personal.ai | 直接集成 API |
| 真人接管（L3） | Topmate / Cal.com / 知识星球 | Cal.com 拼装 |
| **中文 AI 出口** | **Coze / 飞书 / 元器** | 字节生态必接 |

### 模块化生态对标

| 产品 | 模块叫什么 | 量级 | 启示 |
|---|---|---|---|
| VS Code | Extension | 50000+ | 标杆 |
| **Raycast** | Extension（TS） | 1500+ | 形态最像 CTRL，**精品策展** |
| Obsidian | Plugin | 1200+ | 「插件定义产品」 |
| **Cherry Studio** | 工具 + MCP | ~20 内置 | 中文 AI 工具合集对标 |
| LobeChat | Tool / Plugin | 100+ | OSS 中文圈 |
| Coze | 插件 / 节点 | 6000+ | 云端 workflow（互补） |
| **Quicker** | 动作（**无工具层**） | 8000+ | 只有 Action 没有 Tool ← CTRL 升级点 |

### 没人做过的组合（CTRL 下注）

> **桌面唤出 + 场景化工具 + 多 LLM + 中文圈分发（Coze/飞书）+ 创作者市场 + 真人兜底**
>
> 任意单点都有强者；六项乘积无人做过。

具体对手缺口：
- Highlight AI：① + 部分 ③，缺 ②④⑤⑥
- Raycast Pro：① + 部分 ② + 部分 ③，缺 ④⑤⑥
- Quicker：①②④（强）但缺 ③⑤⑥，无 Mac
- Cursor：③ 强但只在编辑器
- Delphi：⑤ + L2 但无 ①②④
- Cherry Studio：② + ③ 但无 ①④⑥

---

## 4. 需求清单

| # | 类别 | 需求 | v0.1 | v0.2 | v1+ |
|---|---|---|---|---|---|
| R1 | 唤出 | 单 Ctrl / 双 Ctrl / 中键三选一可配置 | ✓ | | |
| R2 | 唤出 | 输入框 + 工具面板二合一 | ✓ | | |
| R3 | 唤出 | 数字键 1–9 直选 | ✓ | | |
| R4 | 上下文 | 选中 / App / URL / 剪贴板 / 鼠标位置自动捕获 | ✓ | | |
| R5 | 上下文 | 选中类型识别 → 推荐工具 | | ✓ | |
| R6 | 上下文 | 截图 + OCR | | | ✓ |
| R7 | 引擎 | 步骤化执行（变量 / 流式 / 条件） | ✓ | | |
| R8 | 引擎 | 多模型 LLM 步骤 | ✓ | | |
| R9 | 引擎 | 脚本沙箱（JS / Python / Deno） | | ✓ | |
| R10 | 引擎 | HTTP 步骤 | ✓ | | |
| R11 | Memory | 用户偏好注入 | | ✓ | |
| R12 | Memory | 历史上下文（最近 N 次） | | ✓ | |
| R13 | Memory | 偏好学习（常用前置） | | ✓ | |
| R14 | 隐私 | 自带 API key | ✓ | | |
| R15 | 隐私 | 本地模型支持（Ollama / MLX） | | | ✓ |
| R16 | 创作者 | 可视化工具编辑器 | | ✓（粗版） | |
| R17 | 创作者 | 工具市场 / 分享 | | | ✓ |
| R18 | 创作者 | 收入仪表盘 | | | ✓ |
| R19 | 跨端 | macOS 首发 | ✓ | | |
| R20 | 跨端 | Win 跟随 | | | ✓ |
| R21 | 集成 | Shell / AppleScript 步骤 | ✓ | | |
| R22 | 集成 | Coze workflow 调用模板 | ✓ | | |
| R23 | 集成 | 飞书 webhook 模板 | ✓ | | |
| R24 | 集成 | URL Scheme 反向触发 | | ✓ | |
| R25 | 集成 | CLI（`ctrl run ...`） | | ✓ | |
| R26 | 集成 | 飞书 Bot SDK 接入 | | | ✓ |
| R27 | 集成 | MCP 协议接入 | | ✓ | |
| R28 | 聚合 | Quicker Action Importer（XML → CTRL manifest） | ✓ | | |
| R29 | 生态 | Partner Tool SDK：第三方 AI 产品做成 CTRL tool 的接入流程 | ✓ | | |
| R29b | 生态 | 一键引导：OAuth helper / token wizard / 截图教程 | ✓ | | |
| R30 | 聚合 | Coze workflow runner 内置工具 | ✓ | | |
| R31 | 生态 | 创作者身份 OAuth（GitHub / WeChat） | ✓ | | |
| R32 | 生态 | Tool manifest 开放 spec + OSS 参考实现 | ✓ | | |
| R33 | 生态 | 数据飞轮埋点（PostHog / 自建） | ✓ | | |
| R34 | 生态 | 多渠道分发（URL 安装 / GitHub repo / in-app 市场） | | ✓ | |

---

## 5. 工作流集成（4 层）

| 层 | 形态 | 例子 | 优先级 |
|---|---|---|---|
| **L1：CTRL 内部步骤化** | 工具内的 step engine（取选中 → AI → 写回） | 内核 | v0.1 |
| **L2：动作里调外部** | HTTP step / Shell step / AppleScript step | 一个工具调 Coze workflow / 飞书 webhook / `gh issue create` | **v0.1** |
| **L3：CTRL 被外部调** | URL Scheme + CLI + 入站 webhook | Apple Shortcuts / n8n / cron 触发 CTRL | v0.2 |
| **L4：双向事件总线** | 工具产出推 webhook / 外部事件触发工具 | n8n 当无人值守层，CTRL 当人触发层 | v1+ |

**和现有产品的关系**：
- **云端节点流**（n8n / Zapier / Make / Coze / Dify）：互补，CTRL 经 L2/L3 调它们
- **桌面自动化**（Apple Shortcuts / Keyboard Maestro / BTT）：重叠，CTRL 是 AI-native 升级版
- **编辑器内**（Cursor / Raycast）：正交，CTRL 是跨 App 入口

**CTRL 卡位**：人触发 + 桌面级 + 秒级 + AI 步骤 + 跨 App。

---

## 6. 中文圈定位：CTRL vs 字节生态

**字节生态分两块**：
- **飞书**（企业协作 + 企业级 AI 分发渠道）—— **CTRL 在 OPC 段做替代**，不接（详见 §7.6）
- **Coze**（云端 workflow 后端）—— **CTRL 把它当后端**，调用方向是 CTRL → Coze

| 对手 / 伙伴 | 定位 | 关系 | 实现方向 |
|---|---|---|---|
| **飞书** | 企业级 AI 分发渠道 | **对标** —— CTRL 是 OPC 段的飞书 | 不集成；做更轻、一键引导（§7.6） |
| **Coze workflow** | 云端 workflow 后端 | **借用** —— 复杂逻辑放 Coze，CTRL 调 | 内置 Coze Runner 工具（§7.5） |
| **Volcano Engine** | 字节 LLM API | **可选用** | 多模型 step 之一 |
| **Dify** | OSS workflow 平台 | **互补** —— 用户已用就接 | HTTP step 即可 |

**关键洞察**：
- Dify 已经"native 接飞书"——这是企业 SaaS 思路
- CTRL 反过来——**不接飞书，而是替代飞书在 OPC 段的分发角色**
- Raycast / Cursor 西方产品既不接也不替代飞书 ← CTRL 抢中文圈的最大窗口

---

## 7. 模块化模型（核心架构概念）

### 二级抽象

```
工具 Tool（顶级模块，可安装/禁用/卸载）
  ├─ 动作 Action（工具暴露的可调用项）
  ├─ 设置 Settings（每工具自己的配置）
  └─ UI（可选，工具可注册自己的面板）

例：
  翻译工具
    动作：翻译选中 / 翻译剪贴板 / 翻译并替换
    设置：默认语言、模型选择
  Coze Runner 工具
    动作：运行 workflow X / Y / Z
    设置：Coze API key、workflow id 列表
  飞书发布工具
    动作：发到群 / 写多维表格 / 创建文档
    设置：bot token、默认目标
```

**为什么不是 Quicker 那样平铺 Action**：Tool 一等公民让安装、依赖、配置、版本都在工具粒度发生，Quicker 把这些摊在 Action 上是结构性 debt（用户「装一个工具要装它的 5 个动作 + 改 5 处配置」）。

### 模块形态分阶段

| 阶段 | 形态 | 谁能开发 | 时间 |
|---|---|---|---|
| **v0.1** | **声明式工具**（JSON manifest + 步骤序列） | **创作者无需写代码** | 4-6 周 |
| **v0.2** | TS 脚本工具（Deno 沙箱） | 开发者写函数 | +3 周 |
| **v0.3** | 完整 Tool SDK（自定义 UI + 后台任务） | 完整插件开发者 | +4 周 |
| **v1+** | MCP 协议接入 | 跨 AI 客户端共享工具 | +2 周 |

**声明式优先** ← 抢 Quicker 中文 power user 的核心：让不写代码的 OPC 也能做工具。

### v0.1 内置工具（5-8 个）

- **Translator**（翻译）
- **Markdown 工具集**（quote / link / table）
- **AI 改写**（知乎风格 / 邮件风格 / 学术风格）
- **AI 总结**
- **AI 标题生成**（SEO）
- **Coze Runner**（HTTP 模板，绑用户的 workflow id）
- **飞书发布器**（webhook 模板）
- **浏览器搜索 / Google / 知乎搜索**

---

## 7.5 聚合策略（聚合 > 自建）

> **核心立场**：CTRL 不和 Quicker / 飞书 / Coze 抢工具数量——而是把它们的能力**聚合到桌面入口**。聚合入口本身就是护城河。

### 三大主聚合源（v0.1 必含）

| 来源 | 量级 | 形态 | CTRL 接法 | 主要挑战 |
|---|---|---|---|---|
| **Quicker 动作市场** | 8000+ 公开动作 | XML/JSON 配置 + C# 脚本步骤 | (1) **Quicker Importer 工具**：XML → CTRL manifest，仅可视化步骤可自动转，C# 步骤需人工补 / 转 LLM step；(2) 创始团队精选 Top 100 手动迁；(3) 长期推 Quicker 作者来 CTRL 重发布拿创作者收入 | 法律/IP（动作版权归原作者）；C# 脚本不可自动转 |
| **Coze workflow** | 6000+ 节点 + 用户自建 workflow | REST API | 内置「Coze Runner」工具，绑用户 workflow id，把 Coze 复杂逻辑当 CTRL 的一个 step | 字节锁定 |

> **注意：飞书不是聚合源**。详见 §7.6「CTRL vs 飞书」—— 我们是 OPC 段的飞书替代，不是它的下游。

### 次要聚合源（按需加）

| 来源 | 形态 | 优先级 |
|---|---|---|
| Apple Shortcuts | URL Scheme + `shortcuts run` CLI | v0.2 |
| n8n / Zapier / Make / Dify | webhook URL（HTTP step 即可，无需特殊工具） | v0.1（HTTP step 自带） |
| GitHub / Linear / Notion / Slack / Stripe | OpenAPI（HTTP step + 模板） | v0.2（每个一个 wrapper 工具） |
| Raycast Extension | 反向：CTRL 工具能否在 Raycast 调？协议不通，需 MCP 桥 | v1+ |
| MCP servers（Anthropic 协议） | MCP client → 跨 AI 客户端共用工具 | v0.3 |

### Quicker Importer 关键决策

- **法律 / IP**：动作版权归原作者；CTRL 仅做格式转换工具，不在自己市场上重发布——除非作者来 CTRL 注册账号并主动迁
- **品牌路径**：创始团队公开导入自用的 30-50 个 Quicker 动作 → builder-in-public 内容 → 引来 Quicker 作者 / 用户围观
- **协作路径**：尝试联系 Quicker 作者 Cao Yue（已知 GitHub），探讨官方 API 或 Mac 端授权合作

---

## 7.6 CTRL vs 飞书：我们是替代，不是下游

> **一句话**：飞书是企业级 AI 产品分发渠道；CTRL 是 OPC 级 AI 产品分发渠道。**两者并列，不是上下游**。

### 为什么 OPC 不需要飞书的重量

| 维度 | 飞书 | CTRL |
|---|---|---|
| 注册 | 必须企业账号 + 实名 + 域名验证 | **一键安装，邮箱即用** |
| 装一个 AI 产品 | 管理员审批 → 应用市场搜 → 安装到工作台 → 配权限 → 配 token | **一键装 tool → 引导式 OAuth → 立即可用** |
| 触发 AI | 进飞书 → 找应用 → 点开 → 输入 → 等结果 | **按 Ctrl → 选工具 → 立即出结果** |
| 多账户 | 一个人在不同公司有多个飞书账号要切 | **CTRL 是个人的，跨工作环境一致** |
| 数据归属 | 企业管理员可见 | **本地优先，用户独占** |

### CTRL 的「轻」体现在哪

- **零账户门槛**：装上即用；账号是 v0.2 才上的可选项
- **OAuth 一键引导**：每个第三方 AI 产品的 token / API key 配置走标准 wizard，含截图 / 视频
- **配置即用**：不需要工作台 / 应用市场 / 权限矩阵；tool 装上就在面板里
- **离线友好**：不联网也能跑无 LLM 步骤的工具
- **退出友好**：卸载干净，不留垃圾

### 第三方 AI 产品为什么应该上 CTRL 而不是飞书

| 痛点 | 上飞书 | 上 CTRL |
|---|---|---|
| 触达个人 OPC 用户 | 难（飞书 OPC 渗透低） | 直接 |
| 用户安装步骤 | 5+ 步 | 1 步 |
| 鉴权复杂度 | 自建应用 / 商店应用两套 | 标准 OAuth wizard |
| 计费 / 抽成 | 飞书 0%，但分发慢 | CTRL 待定（PRD 建议 L2 15%） |
| 用户数据归属 | 飞书的企业租户 | 用户本地 |
| 快速上线 | 需走应用商店审核 | manifest 上 GitHub 即可 |

### 我们的 partner program（v0.1 雏形 / v0.2 正式）

第三方 AI 产品来 CTRL 上架的标准路径：

1. **接入**：按 CTRL 开放 spec 写一份 tool manifest（YAML/JSON），声明 actions / settings / scopes
2. **OAuth wizard**：CTRL 提供一组 helper 让第三方 AI 把自己的 OAuth 流程嵌进 tool 配置
3. **分发**：manifest URL → CTRL「装这个」按钮（一键安装 + 自动配置）
4. **更新**：自动拉 manifest 新版本
5. **遥测**（用户授权后）：调用次数 / 成功率回到第三方仪表盘
6. **变现**：v1+ 接 Stripe / 微信支付，订阅与 take rate

> **这一节是 CTRL 真正的护城河图纸**。每多一个第三方 AI 产品按 CTRL 标准接进来，标准就更稳；标准越稳，新进来的就更愿意按 CTRL 标准接。**飞书已经在企业端建了护城河，但它在 OPC 端是真空。**

---

## 7.7 核心薄、聚合厚 —— 6 种接入方式

> **架构原则**：CTRL 内核只做 5 件事：唤出 / 上下文捕获 / 工具注册表 / 工具 host / UI 面板。**所有具体能力都是 tool**。tool 通过下面 6 种方式之一拿到 CTRL Host 提供的能力。

| # | 接入方式 | 形态 | 典型用例 | 创作者门槛 | 优先级 |
|---|---|---|---|---|---|
| 1 | **声明式 manifest** | JSON/YAML 定义步骤序列（LLM / HTTP / shell / template） | 翻译、AI 改写、Markdown 工具集 | **零代码** | **v0.1** |
| 2 | **HTTP endpoint** | manifest 指 URL；CTRL 按标准 schema 调；第三方任意托管 | SaaS AI 产品（"我的服务在 api.foo.com，CTRL 这样调"） | 写 endpoint | **v0.1** |
| 3 | **CLI / 子进程** | 调本地 binary：`my-tool action --input "$SEL"` | 本地脚本、命令行工具、shell helper | 写脚本 | **v0.1**（Shell step 复用） |
| 4 | **OS 原生** | AppleScript / `shortcuts run` / PowerShell | macOS Shortcut 桥、复杂系统操作 | OS 脚本知识 | v0.2 |
| 5 | **MCP server** | CTRL = MCP client，tool = MCP server（stdio / SSE） | 任何已有 MCP server 的服务（GitHub MCP / Filesystem MCP / DB MCP） | MCP SDK | v0.3 |
| 6 | **WebView embed** | tool 注册 URL，CTRL 嵌入式 webview + IPC | 视觉编辑器、画布工具、第三方 AI 复用现有 web UI | 已有 web app 即可 | v0.2 |
| 7 | **完整 SDK**（Rust/TS dynamic） | 完整插件，可注册自己的面板 / 后台任务 / 自定义 step | 高级开发者 | SDK 学习 | v0.3 |

**关键洞察**：
- **90% 工具用 (1)+(2)+(3) 就够**，可以零脚本运行
- **(5) MCP 是「免费拿到全 MCP 生态」的捷径** —— CTRL 一接，所有 MCP 能力立刻可用
- **(6) WebView 是第三方 AI SaaS「无缝搬家上 CTRL」的关键** —— 他们不用重写 UI

**Day 1 必含**：(1)(2)(3)。这三种覆盖 Quicker 主用例 + 所有 SaaS AI 接入。

---

## 7.8 后台管理（Backend，借鉴 Quicker）

### Quicker 后台关键功能（学习对象）

- 账号 + 云同步
- 动作市场（搜索 / 安装 / 版本 / 订阅作者）
- 安装量统计、收藏、评分
- 作者主页、动作集合
- 自动更新
- 权限提示

### CTRL 后台分阶段

| 模块 | v0.1 | v0.2 | v1+ |
|---|---|---|---|
| **Auth** | GitHub OAuth | + WeChat OAuth | + 手机号 |
| **Tool registry** | manifest 元数据（id / 作者 / 版本 / 分类 / 权限） | + 截图 / 视频 | + 多语言 |
| **分发** | Manifest URL + 一键安装 | + GitHub repo 同步 + in-app 市场 | + 私有市场 / 团队市场 |
| **版本** | semver + 自动更新 | + 回滚 / Beta channel | + A/B |
| **统计** | 安装量 / 调用次数（用户授权后回传） | + 成功率 / 错误率 | + 留存 |
| **评分** | ❌（跳） | 5 星 + 文字 | + 防刷 |
| **Moderation** | 自动 LLM 扫描 + 黑名单 | + 用户举报 | + 人工审核高敏 |
| **创作者主页** | 作者全部 tools + 统计 | + 收入仪表盘 | + 订阅 / 打赏 |
| **变现** | ❌（跳） | Stripe + 微信支付 | + 抽成 / Pro 订阅 |

### 实现路径

- **Day 1**：**不需要服务端** —— manifest URL = CDN 文件（GitHub raw / Cloudflare Pages），客户端拉取即装。**零运维成本**
- **Week 4+**：最小后端（Bun + Hono + Postgres + R2），处理认证 + 统计 + 搜索
- **v1+**：完整后台 + 创作者收入

### 与 Quicker 后台的核心差异

| 维度 | Quicker | CTRL |
|---|---|---|
| 模块粒度 | 平铺动作 | Tool 含多 Action（结构性升级） |
| 同步策略 | 服务端中央同步 | manifest URL 去中心化 + 客户端拉 |
| 第三方 AI 接入 | 无原生 | OAuth / 自带 key 是一等公民 |
| 创作者收入 | 无 | Day 1 不开但 schema 已留位 |

---

## 7.9 前端展示契约

### Tool 展示字段（manifest 规定）

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | 全局唯一，倒序域名风格（`com.author.tool-name`） |
| `name` | ✓ | 中英文显示名 |
| `version` | ✓ | semver |
| `author` | ✓ | `{ name, github, url, avatar? }` |
| `description.short` | ✓ | ≤ 80 字 |
| `description.long` | | Markdown |
| `icon` | ✓ | URL 或 inline base64 |
| `category` | ✓ | 单一主分类（见 §7.10） |
| `tags` | | 自由 tag 数组 |
| `screenshots` | | URL 数组（v0.2） |
| `permissions` | ✓ | network / clipboard / files / shell / camera / microphone |
| `settings` | | 配置项 schema（含一键引导 wizard 脚本） |
| `actions` | ✓ | Action 数组（见下） |

### Action 展示字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✓ | tool 内唯一 |
| `name` | ✓ | 显示名 |
| `description` | | 一句话 |
| `icon` | | 默认继承 tool icon，可覆盖 |
| `hotkey` | | 面板内 1-9 / 系统级全局热键 |
| `scenes` | | `AnyApp / App(bundleId) / TextEditor / BrowserUrl(regex)` |
| `input` | ✓ | `none / selection / clipboard / freetext / file` |
| `output` | ✓ | `none / clipboard / replace-selection / modal / browser / notify` |
| `params` | | 可参数化（"翻译到 [语言]"，下拉框选） |
| `preview` | | 是否支持 live preview（v0.2） |

### 面板行为契约

- **默认视图**：当前场景 ∪ 用户置顶 ∪ 最近使用
- **搜索**：按 tool / action 名 / tag / category 模糊匹配
- **分类切换**：一行 chip：全部 / 当前场景 / AI / 写作 / 翻译 / ...（用户可自定义首屏 chip 顺序）
- **数字键 1–9**：当前可见列表快捷选择
- **运行后**：流式区域 + 二级操作（复制 / 重跑 / 调参 / 转 Cursor / 查看日志）
- **设置入口**：每个 tool 卡片右上角齿轮 → tool 设置面板（按 manifest `settings` schema 自动渲染）

---

## 7.10 工具分类法

### 研究 Quicker 旧分类（其市场页常见 tag）
- 文本处理 / 翻译 / 网络与浏览器 / 系统操作 / 开发者工具 / 多媒体 / 办公 / 通讯 / 创意 / 设计 / 实用 / 游戏 / 实验性

### CTRL 分类（融合 Quicker 旧分 + AI native 新分）

| 顶级分类 | 例 |
|---|---|
| **AI 写作** | 改写 / 续写 / 风格转换 / 标题 / SEO |
| **AI 翻译 / 多语** | 翻译 / 同声 / 术语对照 |
| **AI 总结 / 提取** | 摘要 / 要点 / 引用 / 关键词 |
| **AI 编程** | 解释代码 / 修 bug / 写测试 / 生成 SQL |
| **AI 图像 / 多模态** | OCR / 抠图 / 描述生成 / 图片→ Markdown |
| **AI 助理 / 对话** | 个人 GPT / 角色扮演 / 即问即答 |
| **文本工具** | 大小写 / 编码 / 正则 / 字数 |
| **Markdown / 文档** | 引用 / 表格 / 链接 / 转 PDF |
| **网络 / 浏览器** | 搜索 / 摘录 / 截图 / 收藏 |
| **系统 / 文件** | 重命名 / 解压 / 哈希 / 路径 |
| **开发者** | Git / API / curl / JSON 处理 |
| **办公** | 表格清洗 / 邮件草稿 / 日历 |
| **集成（destination）** | 推 Notion / Linear / Slack / Lark / GitHub issue |
| **工作流后端** | Coze / n8n / Zapier / Dify runner |
| **OS 自动化** | Apple Shortcuts / 脚本 / AppleScript |
| **创意 / 设计** | 配色 / Lorem / 占位图 |
| **个人** | 备忘 / 日记 / 习惯打卡 |
| **实验** | beta / preview |

### 分类规则

- 一个 tool 主分类只能 1 个；可有多个 tags
- **AI 类目排在最上**（CTRL 是 AI native 产品）
- **「集成（destination）」独立成类** —— 这类是 CTRL 输出到外部（推 Notion / 推 Lark），不要混入其他类目
- **「工作流后端」独立成类** —— Coze Runner / n8n Runner 这类 wrapper 单独分类，避免和原生工具混

---

## 8. 架构（Hexagonal + Modules）

### 当前已建（src-tauri/src/）

```
domain/        纯领域：detector / events
application/   端口（5 个）+ 用例（3 个）
adapters/      OS / Tauri / Clock 适配器
```

### 下一步要加

```
src-tauri/src/
  modules/                   ← 新增顶级
    mod.rs                   tool registry
    builtin/
      translator/
        manifest.json
        actions.rs
      markdown_tools/
      coze_runner/
      feishu_poster/
      ...

share/
  modules/                   ← 用户安装的声明式工具
    community-xxx/
    my-private-tool/
```

**新增端口**：
- **`ToolRegistryPort`**：工具注册 / 列举 / 启用 / 禁用 / 安装 / 卸载
- **`ToolHostPort`**：给工具提供能力的聚合接口（取选中 / LLM / 剪贴板 / HTTP / 设置存取）

工具 → host → port → adapter，是 Hexagonal 的「能力即端口」模式 + 模块化。**不打破当前 hex 架构，是它的自然延伸。**

---

## 9. 累积决策（v0.1 锁定）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| **D1** | 唤出形态 | **混合**：默认工具面板，再按一次进 AI 输入框 | AI-native + Quicker 都满足 |
| **D2** | v0.1 是否带 LLM | **带 + 自带 key 引导** | 没 AI 就是减配 Quicker，AI-native 看不上 |
| **D3** | 文档归宿 | **`doc/` 单一入口**（已合并 docs/） | 一处真相 |
| **D4** | v0.1 是否含 HTTP/Shell step | **含** | 半天工作量，差异化立刻拉开 |
| **D5** | workflow 引擎边界 | **轻量内置（≤5 步）+ 复杂调 Coze** | 借生态杠杆，避免重复造 |
| **D6** | 模块粒度 | **Tool 一等公民 + Action 二级 + 声明式起步** | 对 Quicker 的结构性升级 |
| **D7** | CTRL 与飞书关系 | **CTRL 是 OPC 段的飞书替代**（不接飞书） | 飞书太厚重不适合 OPC；分发渠道角色应由 CTRL 占据 |
| **D8** | 第三方 AI 产品接入 | **Partner Tool SDK + 一键引导**（v0.1 雏形） | 「别人接我们」是护城河，必须 Day 1 就有标准 |

---

## 10. 路线图

| 阶段 | 目标 | 时间 | 关键内容 |
|---|---|---|---|
| **Phase 1 Spike**（进行中） | 验证单 Ctrl 唤出 + 选中捕获 | 5-6 天 | detector + CGEventTap + Cmd+C PoC + 实测 35 case → `doc/SPIKE_RESULTS_MAC.md` |
| **v0.1 Slice 1** | Quicker 内核 + 工具加载器 | 3-4 天 | ForegroundApp / ToolRegistry / 5 内置工具（无 LLM） |
| **v0.1 Slice 2** | AI 步骤 + 中文圈集成 | 3-4 天 | LLM step + Coze/飞书模板 + 3 个 AI 工具 |
| **v0.1 联调 + 内测** | 招 30 OPC | 2 周 | 打磨 + 埋点 + 种子用户访谈 |
| **v0.2** | 智能化 + 入站触发 | 4 周 | 选中识别 / Memory / TS 脚本 / URL Scheme / CLI |
| **v0.3** | 完整 Tool SDK | 4 周 | 自定义 UI / 后台任务 / 工具市场 alpha |
| **v1+** | 创作者市场 / 飞书插件 / MCP / Win 端 | 长期 | PRD Phase 5+ |

---

## 11. NOT Building（明确剔除）

- 通用 launcher（Spotlight 替代）
- 团队协作 / 共享工作区
- 移动端 / Web 端
- 强监管行业 AI（医疗诊断 / 律师执业意见）
- 自研 LLM
- 自研支付 / 预约（拼 Stripe + 微信支付 + Cal.com）
- Day 1 多语言（中文优先，英文 V2）
- UI 自动化（鼠键模拟 / 录制）—— 可能永远不做
- Quicker 那种把所有动作平铺到市场（CTRL 必须先归到 Tool）

---

## 12. 待解决（Open Questions）

- [ ] **Tool manifest schema** 定稿（参考 Raycast / VSCode extension manifest）
- [ ] **AI 路由器**（intent → 推荐 tool）：embedding / 关键词 / LLM？
- [ ] **工具沙箱**（v0.2 起）：Deno isolate vs 子进程 vs WASM
- [ ] **工具签名 / 信任**：避免恶意代码
- [ ] **Memory 存储**：本地 SQLite vs 云
- [ ] **Coze API 鉴权**：用户自带 token vs 平台代理
- [ ] **飞书集成合规**：个人开发者商户路径
- [ ] **30 位种子 OPC 招募清单**（V2EX / 即刻 / X 中文 / 屠龙 / 纵横四海）
- [ ] **Phase 1 Spike 35 case 实测填完后做 A/B/C 决策**

---

## 13. 关联文档

- **PRD**：`.claude/PRPs/prds/ctrl-platform.prd.md`（投资视角）
- **Mac plan**：`.claude/PRPs/plans/phase-1-spike-single-ctrl-mac.plan.md`
- **Win plan**：`.claude/PRPs/plans/phase-1-spike-single-ctrl.plan.md`
- **Spike 实测**：`doc/SPIKE_RESULTS_MAC.md`

---

## 变更日志

- **2026-05-04**：初版整合 —— 定位、用户分层、对标矩阵、需求 R1–R27、工作流 4 层、中文圈分发、模块化二级模型、架构延伸、6 项决策、路线图、NOT Building、待解决问题。
- **2026-05-04（晚）**：重大定位修正 ——
  - 增加「**工具不值钱，生态才值钱**」战略前提
  - 增加「**CTRL = OPC 段 AI 产品分发渠道**」核心定位（§1）
  - 新增 §7.5 聚合策略（Quicker / Coze 为聚合源）
  - 新增 §7.6「CTRL vs 飞书」—— **飞书从聚合源转为对标对象**：CTRL 是替代飞书在 OPC 段的分发角色，不是接进飞书
  - 新增 R28-R34 聚合 / 生态相关需求（含 R29 Partner Tool SDK + R29b 一键引导）
  - 新增 D7（与飞书关系）+ D8（Partner SDK + 一键引导）决策
- **2026-05-04（再补）**：把「核心薄、聚合厚」原则落到工程契约 ——
  - 新增 §7.7 接入方式（6 种：manifest / HTTP / CLI / OS / MCP / WebView / 完整 SDK）
  - 新增 §7.8 后台管理（借鉴 Quicker，分阶段；Day 1 不需要服务端）
  - 新增 §7.9 前端展示契约（Tool / Action 字段 + 面板行为）
  - 新增 §7.10 工具分类法（融合 Quicker 旧分 + AI native 新分，18 个顶级分类）


---

## 14. 新增决策（2026-05-16）

### 14.1 AI模型选型决策
**决策**：使用 **Minimax 2.7 Highspeed** 作为核心AI模型

**理由**：
1. **国内市场优先**：专注中文OPC用户，Minimax中文优化更好
2. **访问稳定**：国内API访问稳定，无网络障碍
3. **成本可控**：相比国际模型成本更低
4. **响应速度快**：Highspeed版本适合实时交互

**实施计划**：
1. **AI创作助手**：使用Minimax生成工具manifest
2. **意图理解**：用户输入分类和路由
3. **内容生成**：工具描述、帮助文本等
4. **备用方案**：DeepSeek V3、Qwen 2.5作为备选

### 14.2 市场切入策略
**决策**：**国内市场优先，分阶段验证**

**阶段1：深度垂直（0-12个月）**
- 目标：服务10,000名中文OPC用户
- 策略：V2EX、即刻、知乎等社区深度渗透
- 重点：Founder as Founding Creator亲自示范
- 收入：订阅为主，验证付费意愿

**阶段2：生态扩展（12-24个月）**
- 目标：50,000名用户，建立创作者生态
- 策略：与飞书、Coze等平台深度整合
- 重点：创作者工具和市场建设
- 收入：订阅+平台抽成

**阶段3：国际化准备（24-36个月）**
- 目标：技术架构支持国际化
- 策略：英文文档，国际支付准备
- 重点：观察海外市场，小规模测试
- 收入：多元化收入来源

### 14.3 技术架构更新
**新增模块**：
1. **@ctrl/llm**：LLM客户端封装（Minimax优先）
2. **@ctrl/creator**：AI创作助手工具
3. **@ctrl/market**：工具市场前端
4. **@ctrl/payment**：支付集成（微信支付优先）

**技术调整**：
1. **前端**：完善PWA界面，优化移动端体验
2. **后端**：增强Minimax API集成和监控
3. **安全**：加强API Key管理和数据安全
4. **性能**：优化热键响应和工具启动时间

### 14.4 业务模块优先级
**P0（立即开始）**：
1. 完善前端PWA界面（3-5天）
2. 实现5个内置工具（5-7天）
3. 集成Minimax 2.7 API（3-5天）
4. 建立种子用户社区（持续）

**P1（2-4周）**：
1. 实现工具市场基础
2. 集成飞书OAuth
3. 实现创作者发布工具
4. 建立创作者激励计划

**P2（8-12周）**：
1. 实现订阅系统
2. 实现平台抽成
3. 数据分析和优化
4. 国际化基础准备

### 14.5 成功指标更新
**技术指标**：
- 热键响应时间 < 200ms
- AI路由准确率 > 90%
- 工具启动时间 < 2秒
- 系统稳定性 > 99.9%

**业务指标（阶段1）**：
- 30天内获取1000名种子用户
- 7日留存率 > 35%
- 创作者-用户重合率 > 40%
- 月收入增长 > 20%

**财务指标**：
- 月运营成本 < ¥2000
- 用户获取成本 < ¥10
- 用户生命周期价值 > ¥300
- 投资回报周期 < 12个月

### 14.6 风险控制更新
**新增风险**：
1. **Minimax API稳定性**：准备DeepSeek备用方案
2. **国内合规要求**：严格遵守内容审核和数据安全
3. **支付集成复杂度**：微信支付优先，简化流程
4. **社区建设难度**：创始人亲自参与，建立信任

**缓解措施**：
1. **技术风险**：多模型支持，自动故障转移
2. **市场风险**：小规模验证，社区驱动增长
3. **执行风险**：分阶段实施，控制范围
4. **资金风险**：控制成本，验证后再投入

### 14.7 资源需求��新
**人员需求**：
- 全栈开发（1人）：核心功能开发
- 前端开发（1人）：界面和交互优化
- 后端开发（1人）：API和集成开发
- 产品/社区（1人）：用户需求和社区建设

**技术资源**：
- Minimax API：¥500/月（预估）
- 服务器费用：¥200/月（Cloudflare Workers + D1）
- 域名和证书：¥200/年
- 营销费用：¥1000/月（社区活动）

**资金需求**：
- 月运营成本：¥2000
- 季度预算：¥6000
- 年度预算：¥24000
- 应急资金：¥5000

### 14.8 变更日志更新
- **2026-05-16**：新增AI模型选型（Minimax 2.7 Highspeed）
- **2026-05-16**：更新市场切入策略（国内市场优先）
- **2026-05-16**：更新业务模块优先级和行动计划
- **2026-05-16**：更新成功指标和风险控制
- **2026-05-16**：更新资源需求和财务规划

## 15. CTRL作为OPC成品承载平台的新定位

### 15.1 核心定位调整
**从**：自己做AI工具的平台
**变为**：**OPC成品的轻量化承载平台**

**关键洞察**：
1. **不是自己做工具**：而是承载别人做好的工具
2. **不是接入飞书**：而是成为飞书的轻量化替代品
3. **不是要用户写代码**：全部由AI agent完成集成
4. **不是要电脑24小时开机**：按需启动，用完即走

### 15.2 用户价值主张
1. **前端**：统一的桌面入口界面
2. **本地知识管理**：个人知识库和记忆
3. **Copilot agent**：AI助手帮助使用工具
4. **分享功能**：随时可以访问和分享工具
5. **轻量化**：相比飞书等企业级产品更轻更快

### 15.3 技术架构调整
**新增能力**：
1. **轻量化工具集成层**：CLI/HTTP/MCP包装器
2. **AI agent自动集成**：自然语言描述→自动集成
3. **分享功能架构**：工具分享和协作
4. **本地服务管理**：按需启动，资源优化

**移除复杂度**：
1. **不要求电脑24小时开机**：工具按需启动
2. **不要求用户写代码**：AI agent全自动
3. **不要求复杂配置**：一键安装和配置
4. **不要求企业账号**：个人即可使用

### 15.4 具体实施路径
**阶段1：轻量化集成验证（2-4周）**
1. 选择3-5个轻量级OPC成品（如八字算命、文本处理等）
2. 实现CLI/HTTP/MCP包装器
3. 验证一键安装和配置
4. 测试按需启动和资源管理

**阶段2：AI agent自动集成（4-8周）**
1. 实现AI agent（Minimax 2.7）
2. 实现自然语言到manifest生成
3. 实现自动配置和测试
4. 实现错误修复和优化

**阶段3：分享和协作（8-12周）**
1. 实现工具分享功能
2. 实现协作和评论
3. 实现版本管理和更新
4. 实现社区和推荐

### 15.5 成功标准
**技术标准**：
- 工具集成时间 < 5分钟（AI agent自动）
- 工具启动时间 < 2秒
- 内存占用 < 100MB/工具
- 系统兼容性 > 95%

**业务标准**：
- 用户满意度 > 4.5/5
- 工具使用频率 > 3次/天
- 创作者参与度 > 30%
- 分享转化率 > 20%

### 15.6 风险控制
**新增风险**：
1. **OPC成品质量参差不齐**：严格审核和评分
2. **AI agent集成准确率**：多轮验证和人工审核
3. **分享功能滥用**：信任和信誉系统
4. **本地资源竞争**：智能调度和优化

**缓解措施**：
1. **质量控制**：创作者认证和工具审核
2. **AI优化**：持续训练和反馈优化
3. **社区治理**：用户举报和信誉系统
4. **资源管理**：智能调度和资源限制

---

## 15. 立即行动项

### 本周（第1周）
1. **周一**：完善前端PWA界面，优化用户体验
2. **周二**：实现第一个内置工具（文本翻译）
3. **周三**：注册Minimax账号，测试API连接
4. **周四**：在V2EX发布项目介绍，招募种子用户
5. **周五**：收集反馈，调整开发计划

### 关键检查点
1. **第1周末**：完成5个内置工具原型
2. **第2周末**：Minimax集成完成，AI助手可用
3. **第4周末**：30名种子用户，验证核心假设
4. **第8周末**：工具市场上线，创作者生态启动

### 成功标准
- ✅ 用户能通过Ctrl唤出使用工具
- ✅ AI创作助手能生成有效manifest
- ✅ 种子用户愿意持续使用
- ✅ 创作者愿意发布工具
- ✅ 商业模式初步验证

---

*文档更新完成，准备进入实施阶段。*
*下一步：开始完善前端PWA界面，实现第一个内置工具。*