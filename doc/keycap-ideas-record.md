# CTRL Keycap意向记录

## 记录说明
本文件用于记录所有想做成CTRL keycap（工具）的意向和想法。这些记录将作为后续工具开发和集成的参考。

## 记录格式
每个意向记录包含以下信息：
- **意向名称**：工具的名称
- **描述**：工具的功能描述
- **类型**：工具类型（CLI/HTTP/MCP/WebView/Declarative）
- **优先级**：P0/P1/P2（P0最高）
- **状态**：想法/调研中/开发中/已完成
- **记录日期**：记录时间
- **相关链接**：相关资源或参考

## Keycap意向列表

### 1. 八字算命工具
- **描述**：基于cantian-ai/bazi-mcp的八字算命工具，飞书正在承接的OPC产出
- **类型**：MCP
- **优先级**：P0（验证用例）
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：GitHub: cantian-ai/bazi-mcp
- **备注**：作为第一个验证的OPC成品，测试轻量化集成能力

### 2. 文本翻译工具
- **描述**：选中文本翻译，支持多语言
- **类型**：HTTP（调用翻译API）
- **优先级**：P0（基础工具）
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：基础工具，验证HTTP集成方式

### 3. AI改写工具
- **描述**：文本风格转换，如知乎风格、邮件风格、学术风格
- **类型**：HTTP（调用LLM API）
- **优先级**：P0（基础工具）
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：验证AI能力集成

### 4. Markdown工具集
- **描述**：Markdown格式化工具，如引用、表格、链接等
- **类型**：Declarative（声明式）
- **优先级**：P0（基础工具）
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：验证声明式工具集成

### 5. 剪贴板增强工具
- **描述**：AI增强的剪贴板管理，智能粘贴
- **类型**：CLI + HTTP混合
- **优先级**：P1
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：需要系统剪贴板访问权限

### 6. 搜索聚合工具
- **描述**：多平台搜索聚合，如Google、知乎、GitHub等
- **类型**：HTTP
- **优先级**：P1
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：需要多个API集成

### 7. 飞书集成工具
- **描述**：飞书消息发送、文档创建、多维表格操作
- **类型**：HTTP（飞书API）
- **优先级**：P1
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：飞书开放平台
- **备注**：验证中文生态集成

### 8. Coze Runner工具
- **描述**：运行Coze workflow，作为复杂逻辑的后端
- **类型**：HTTP（Coze API）
- **优先级**：P1
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：Coze平台
- **备注**：验证云端workflow集成

### 9. 本地知识库RAG工具
- **描述**：个人本地知识库检索和问答
- **类型**：CLI + HTTP混合
- **优先级**：P2
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：需要本地向量数据库

### 10. 网页抓取工具
- **描述**：轻量级网页内容抓取和提取
- **类型**：CLI（Python脚本）
- **优先级**：P2
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：scrapling项目参考
- **备注**：验证CLI工具集成

### 11. AI对话工具
- **描述**：轻量级AI对话助手，支持多模型
- **类型**：HTTP（LLM API）
- **优先级**：P2
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：验证多模型支持

### 12. 文件处理工具
- **描述**：文件重命名、格式转换、批量处理
- **类型**：CLI
- **优先级**：P2
- **状态**：想法
- **记录日期**：2026-05-16
- **相关链接**：无
- **备注**：验证文件系统操作

### 13. OpenTeams集成工具
- **描述**：集成OpenTeams开源AI智能体协作平台，支持多智能体协作
- **类型**：HTTP + CLI混合
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：GitHub: openteams-lab/openteams
- **备注**：OpenTeams是一个开源AI智能体协作平台，支持160+内置AI成员，8个团队预设，1000+技能库，完全本地执行

### 14. GBrain知识库工具
- **描述**：集成Garry Tan的GBrain知识库系统，为AI智能体提供持久化记忆
- **类型**：CLI + MCP混合
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：GitHub: garrytan/gbrain
- **备注**：GBrain是Y Combinator CEO Garry Tan开发的AI智能体知识库系统，支持17,888页知识，4,383人，723公司，21个定时任务

### 15. PokoClaw轻量工具
- **描述**：轻量级OpenClaw替代方案，支持容器化安全运行
- **类型**：CLI（Docker容器）
- **优先级**：P2
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：GitHub: sipeed/picoclaw（可能相关）
- **备注**：寻找轻量级OpenClaw替代方案，支持WhatsApp、Telegram、Slack等消息平台集成

### 16. Excalicord工具
- **描述**：Discord服务器克隆或相关工具（需要进一步调研）
- **类型**：CLI/HTTP（待确定）
- **优先级**：P2
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：GitHub: ExordiumX/ExoCord-Discord-Server-Cloner
- **备注**：可能是Discord相关工具，需要进一步调研具体功能

### 17. Follow Builders工具
- **描述**：AI建设者内容摘要工具，监控顶级AI建设者的X和YouTube内容
- **类型**：HTTP + CLI混合
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：GitHub: zarazhangrui/follow-builders
- **备注**：监控25个AI建设者的X内容，6个AI播客，2个官方博客，提供每日/每周摘要，支持Telegram、Discord、WhatsApp等

### 18. Supadata API工具
- **描述**：社交媒体元数据提取工具，支持YouTube、TikTok、Instagram、X、Facebook
- **类型**：HTTP
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：https://docs.supadata.ai/get-metadata
- **备注**：统一API获取社交媒体元数据，包括视频、图片、轮播、帖子等，支持多平台统一格式

### 19. X/Twitter API工具
- **描述**：X/Twitter官方API集成工具，支持推文管理、搜索、用户查找等
- **类型**：HTTP
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：https://docs.x.com/x-api/getting-started/about-x-api
- **备注**：X官方API v2，支持帖子管理、搜索、用户查找、时间线、书签等功能，需要API密钥

### 20. Frontend Slides工具
- **描述**：使用Claude前端技能创建精美的HTML幻灯片，支持PPT转换和多种视觉风格
- **类型**：CLI + HTTP混合
- **优先级**：P0（高质量工具）
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: zarazhangrui/frontend-slides
- **备注**：零依赖单HTML文件，12种视觉风格，支持PPT转换，反AI平庸设计，生产质量代码

### 21. OpenAI Realtime API v2工具
- **描述**：OpenAI实时语音API v2集成，支持GPT-5级别推理的语音模型
- **类型**：HTTP（WebSocket + WebRTC）
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：https://developers.openai.com/api/docs/models/gpt-realtime-2
- **备注**：GPT-Realtime-2语音模型，支持70+输入语言到13种输出语言的实时翻译，远程MCP服务器，图像输入，SIP电话呼叫

### 22. 飞书CLI工具
- **描述**：飞书官方CLI工具，支持200+命令，24个AI Agent技能，覆盖17个业务领域
- **类型**：CLI
- **优先级**：P0（中文生态关键）
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: larksuite/cli
- **备注**：官方飞书CLI，支持消息、文档、表格、日历、邮件、任务、会议等，AI原生设计，MIT许可证

### 23. Tab Out浏览器标签管理工具
- **描述**：AI驱动的浏览器标签管理器，将打开的浏览器标签分组为任务，便于轻松关闭
- **类型**：浏览器扩展 + CLI混合
- **优先级**：P1
- **状态**：调研中
- **记录日期**：2026-05-16
- **相关链接**：GitHub: zarazhangrui/tab-out
- **备注**：为打开太多标签从不关闭的人设计，本地运行无服务器，隐私友好，遵循"build something small"理念

---

## 2026-05-16 批次调研记录（Hephaestus）

> bao 给出 6 个候选项目 + "轻量笔记软件" 主题，逐一 gh 实证。**适配 / 不适配都记录**，作为反查避免重复调研。

### 24. HyperFrames
- **描述**：HTML → 视频生成框架，HeyGen 出品，专为 agent 设计；中文版 hyperframes-fix 已做国内适配（流畅中文 TTS / 中文短视频样式 / 一键横竖版）
- **类型**：CLI / HTTP API
- **优先级**：P1
- **状态**：调研完成，待 license 评估
- **记录日期**：2026-05-16
- **相关链接**：GitHub: heygen-com/hyperframes (18,749★) / liangdabiao/hyperframes-fix (89★) / nexu-io/open-design (42,693★, hyperframes 集成方)
- **评估**：✅ **强候选**。OPC 短视频是中文内容生态主流。**待查**：HeyGen 是付费 SaaS，开源核心是否允许商业 keycap 集成；中文版 fix 的 license 也要看

### 25. nexu-io/open-design
- **描述**：Anthropic Claude Design 的开源替代，集成 HyperFrames + 19 skills + 71 brand-grade design systems；支持网页/桌面/移动原型 + slides/图/视频；可在 Claude Code / Codex / Cursor / Gemini / OpenCode / Qwen / Copilot / Hermes / Kimi CLI 上跑
- **类型**：本地 agent（依附 coding CLI）
- **优先级**：P2（参考价值大于直接集成）
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: nexu-io/open-design (42,693★)
- **评估**：✅ **样本价值高**。如要做"AI 设计 keycap"或"AI 创作助手"必看其 19 skills + 71 design systems 怎么组织；本身作为 keycap 太重，更适合作为产品方向参考

### 26. cc-telegram-bridge
- **描述**：Claude Code & Codex CLI 通过 Telegram 远控；session resume / 多 bot 隔离 / Agent Bus delegation / fan-out / 语音输入 / streaming
- **类型**：CLI bridge + 第三方 IM channel
- **优先级**：—
- **状态**：✗ **不适配** —— 已砍
- **记录日期**：2026-05-16
- **相关链接**：GitHub: cloveric/cc-telegram-bridge (169★) / RichardAtCT/claude-code-telegram (2,599★, 同类更高 star)
- **评估**：❌ 跟 bao 2026-05-16 决策"远程入口只用 PWA，不用飞书 / Telegram / Discord 等 IM channel"冲突。如未来 reaffirm 多 channel 路线再启用

### 27. midaz
- **描述**：云原生账本平台，Go 写，多币种多资产复式记账，n:n 交易支持，金融基础设施
- **类型**：HTTP API
- **优先级**：—
- **状态**：✗ **不适配** —— 用户群不重合
- **记录日期**：2026-05-16
- **相关链接**：GitHub: LerianStudio/midaz (386★)
- **评估**：❌ 金融账本平台，OPC 创作者用户群不重合。除非未来做"自由职业开票 / 小微商户对账" niche，否则不进入 v1/v1.1

### 28. moxt
- **描述**：高性能量化交易库，Mojo + C++ 写，简化量化交易
- **类型**：CLI / 本地 lib
- **优先级**：—
- **状态**：✗ **不适配** —— 用户群严重不重合
- **记录日期**：2026-05-16
- **相关链接**：GitHub: f0cii/moxt (58★)
- **评估**：❌ 量化交易者 ≠ OPC 创作者，技术栈 Mojo 也未进入主流。不做

### 29. royfhs
- **描述**：bao 提到的项目，但 gh 搜 `royfhs` / `roy fhs` 均无有效命中
- **类型**：未知
- **优先级**：—
- **状态**：⚠️ **未找到**
- **记录日期**：2026-05-16
- **相关链接**：—
- **评估**：可能拼写有误（候选拼法：`roy-fhs` / `roy_fhs` / 私人 repo / 非 GitHub 项目）；等 bao 给正确名字再查

### 30. confldence
- **描述**：bao 提到的项目，疑似拼错；`confldence` 仅命中 1 个无 star 项目；`confidence` 是 Angular / Spotify 等泛用项目，都不像 keycap 候选
- **类型**：未知
- **优先级**：—
- **状态**：⚠️ **未找到 / 待澄清**
- **记录日期**：2026-05-16
- **相关链接**：—
- **评估**：是 Confluence (Atlassian) 集成吗？还是别的项目？等 bao 澄清

---

## 2026-05-16 批次调研：轻量化笔记软件（Hephaestus）

> 调研主题：找 "轻量化笔记" 类 keycap 候选。分 4 个流派记录。**核心洞察：CTRL 的 keycap UX（按 Ctrl → 弹输入框 → 写两句 → 送后端）跟"快速 capture 笔记 app" UX 同构 —— 这是 CTRL 的天然品类**。

### 31. Memos (memospot 桌面版)
- **描述**：Memos 是中文圈 flomo 自托管替代；memospot 是 Memos 桌面版，Rust 写，privacy-first 轻量
- **类型**：HTTP API（Memos REST）
- **优先级**：**P0**（与已有 flomo 集成形成"云 + 本地"双线）
- **状态**：调研完成，强推荐做
- **记录日期**：2026-05-16
- **相关链接**：GitHub: memospot/memospot (293★) / usememos/memos (上游)
- **评估**：✅ **最强笔记候选**。理由：(1) 中文圈用户基数大；(2) privacy-first + Rust 跟 CTRL 价值观/技术栈对齐；(3) 仓库已有 `packages/ctrl-flomo-integration`，Memos = 自托管平行版，叙事完整

### 32. Note Mark
- **描述**：闪电快 web-based markdown notes app
- **类型**：HTTP / WebView
- **优先级**：P2
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: enchant97/note-mark (662★)
- **评估**：🟡 中度。web-based 跟 PWA 优先一致，但定位偏轻量 wiki，跟 flomo/Memos 的"快速 capture"略不同

### 33. printnotes
- **描述**：Google Keep + Obsidian 风格的跨平台笔记，Flutter 写
- **类型**：本地 app + 数据导出
- **优先级**：P2
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: RoBoT095/printnotes (138★)
- **评估**：🟡 形态偏完整笔记 app，作为 CTRL keycap 太重，参考价值大于集成价值

### 34. dumbnote
- **描述**：极简快速 capture HTML app，"面对突发会议或电话快速记下" 设计
- **类型**：HTML / 单页
- **优先级**：P2
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: baibao577/dumbnote-page (74★)
- **评估**：🟡 UX 参考价值（极简 capture），但功能太薄不适合直接做 keycap

### 35. quick-input (Notion menubar)
- **描述**：macOS menubar app，快速 capture 到 Notion，Markdown 支持
- **类型**：macOS menubar + Notion API
- **优先级**：P1（如果做 Notion 集成）
- **状态**：参考实现
- **记录日期**：2026-05-16
- **相关链接**：GitHub: xupeng/quick-input (2★)
- **评估**：🟡 star 低但 UX 同构 CTRL—— "hotkey → 弹输入 → 送后端"。如果做 Notion sink keycap，可借鉴

### 36. Obsidian Web Clipper
- **描述**：Obsidian 浏览器扩展，从浏览器快速 capture 到 Obsidian vault
- **类型**：浏览器扩展（非 CTRL keycap，但 Obsidian sink keycap 参考）
- **优先级**：P1（如果做 Obsidian 集成）
- **状态**：参考实现
- **记录日期**：2026-05-16
- **相关链接**：GitHub: mvavassori/obsidian-web-clipper (104★)
- **评估**：🟡 不是 keycap 候选本身，但是 Obsidian sink keycap 集成路径的参考样本

### 笔记主题的抽象洞察（给 Zeus 的建议候选）

调研到的笔记后端形态高度同构（**hotkey → 短文本 / markdown / 选区 → POST 到后端**）。建议抽象一个 **"notes sink" 通用 keycap 模板**，参数化：
- 后端 endpoint（API URL）
- 认证方式（API key / OAuth / 本地 token）
- 文本变换（前缀 / 后缀 / tag / 时间戳）
- 输入源（剪贴板 / 选区 / 弹框）

一个模板，N 个 sink（flomo / Memos / Notion / Obsidian / Logseq / 飞书云文档 / ...）。给 Zeus 提案后，可由用户在 Irisy 引导下零代码生成 sink keycap。

---

## 2026-05-16 批次调研：系统级桌面小工具（Hephaestus）

> bao 主题：Synergy 类（鼠标键盘共享）/ IDM 类（下载）/ BetterDisplay 类（虚拟显示器 + 显示调节）。**这一批是"OS 增强工具"，跟前两批"内容创作 / 笔记 / coding"形成另一条赛道**。

### 37. Synergy / Input Leap（鼠标键盘跨设备共享）
- **描述**：用一台机的鼠标键盘控制附近多台机，无缝跨设备工作。Synergy 是商业原始项目，**开源继承者是 Input Leap（Barrier 的延续）**
- **类型**：本地 daemon + keycap 控制面板
- **优先级**：P1（**注意：与 CTRL mesh ADR-003 有重叠，需 Zeus 决定边界**）
- **状态**：调研完成，待与 ADR-003 协调
- **记录日期**：2026-05-16
- **相关链接**：GitHub: input-leap/input-leap (7,922★, GPL) / symless/synergy (235★, 商业本体) / DEAKSoftware/Synergy-Binaries (1,366★)
- **评估**：✅ 强候选但**架构敏感**。CTRL 自家 mesh 已规划"跨设备"，Input Leap 是"跨设备输入"，**可能应该作为 mesh 的一个 use case 直接集成进底座，而不是 keycap**。或者 keycap 仅作为"调起 Input Leap 连接/切换主控"的轻控制面板，daemon 复用现成 Input Leap

### 38. Motrix（IDM 开源替代，下载管理）
- **描述**：全功能下载管理器，Electron + Aria2 底层，跨平台。**中文圈最大的 IDM 开源替代**
- **类型**：HTTP API keycap（调 Motrix RPC / Aria2 JSON-RPC）
- **优先级**：P2（OPC 创作者不一定高频下载，但通用工具）
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: agalwood/Motrix (51,711★) / amir1376/ab-download-manager (15,496★) / persepolisdm/persepolis (7,317★)
- **评估**：✅ 中候选。用户场景：选中链接 → Ctrl 唤起 → keycap "Motrix 下载" → 自动 enqueue + 进度通知到 Irisy。技术上可以直接走 Aria2 JSON-RPC，不绑定 Motrix UI

### 39. BetterDisplay（macOS 显示器解锁 + 虚拟显示器）
- **描述**：macOS 显示器全功能解锁：HiDPI 缩放 / XDR/HDR 额外亮度 / **虚拟屏（dummy display）** / DDC 控制 / 额外 dimming / PIP / streaming / EDID override
- **类型**：CLI 包装（**官方提供 betterdisplaycli**，是 keycap 集成的理想接口）
- **优先级**：P1（macOS 用户）
- **状态**：调研完成
- **记录日期**：2026-05-16
- **相关链接**：GitHub: waydabber/BetterDisplay (**31,746★**, 本体免费有 Pro 增值) / waydabber/betterdisplaycli (79★, 官方 CLI) / huberdf/FreeDisplay (27★, 开源 macOS 替代) / zpix1/windisplay (57★, Windows 版)
- **评估**：✅ **强候选**。用户场景：Ctrl 唤起 → "切 HiDPI / 调亮度 / 加虚拟屏 / 切外接屏配置" → 通过 betterdisplaycli 执行。注意：BetterDisplay 本体 Pro 版收费，但 CLI 免费。跨平台需补 windisplay + Linux 替代

### 40. 临时存储分享文件
- **描述**：用户选中文件 → Ctrl 唤起 → 上传到临时存储后端 → 自动复制下载链接到剪贴板 + Irisy 通知。**OPC 发文件给客户/朋友的真痛点，不想用百度网盘**
- **类型**：CLI / HTTP（curl 一行就能 cover transfer.sh）
- **优先级**：**P0**（高频 + 实现极简）
- **状态**：调研完成
- **记录日期**：2026-05-17
- **相关链接**：GitHub: dutchcoders/transfer.sh (15,839★, Go, 事实标准) / somenonymous/OshiUpload (196★, Perl) / BBaoVanC/bobashare (25★, Rust) / 闭源对照: wormhole.app / file.io / 0x0.st / send.firefox.com
- **评估**：✅ **强候选**。形态最简单：CLI keycap 内嵌 `curl --upload-file X https://transfer.sh/`。建议默认支持多个后端（用户选 transfer.sh / 自托管 / 0x0.st）。**抽象**：跟 #38 Motrix 一样属于 "daemon controller / HTTP RPC" 模板类

### 41. GitHub 加速下载（"京东服务器"类）
- **描述**：bao 原话"通过京东服务器帮助下载 github repo 文件"。中文 OPC 真痛点：GitHub 在国内 clone 慢 / release 下载 403 / 头像加载失败
- **类型**：URL 重写 + git clone wrapper（CLI keycap）
- **优先级**：**P0**（中文 OPC 刚需）
- **状态**：调研完成，**bao 的"京东服务器"具体方案待澄清**
- **记录日期**：2026-05-17
- **相关链接**：GitHub: docmirror/dev-sidecar (**22,244★**, 中文圈最大综合加速) / sky22333/hubproxy (2,551★, Docker + GitHub) / creazyboyone/FastGithub (1,030★) / WJQSERVER-STUDIO/ghproxy (692★, Go) / asjdf/ghproxy (37★, Cloudflare Worker)
- **评估**：✅ **强候选**。生态成熟。**京东特指 ？** gh 上没有显式 "JD GitHub mirror" 项目，可能 bao 指的是某个具体的 JD 云镜像服务（如 kkgithub.com / gh-proxy.com 等闭源/私服）。建议形态：keycap 让用户配多个镜像源 → URL 重写 → git clone / curl 透明加速；**待 bao 给具体京东 URL / 来源**

### 42. Intent（实时 IM 工具）
- **描述**：bao 提到"研究 Intent 这个实时 IM 工具"
- **类型**：未知
- **优先级**：—
- **状态**：⚠️ **未找到对应项目，待澄清**（bao 后续 "忘了 过了"）
- **记录日期**：2026-05-17
- **相关链接**：—
- **评估**：⚠️ gh 搜 "intent" 高 star 候选都不是 IM；待 bao 给 URL

### 43. garden-skills（视频 / 设计类 Skills 集合）
- **描述**：ConardLi 的开源 Skills 集合，含 web design / knowledge retrieval / image generation 等多个 skill；中文圈大 V 出品，视频 + 设计方向
- **类型**：Claude Skill 集合（每个 skill 是 markdown + assets）
- **优先级**：P1
- **状态**：调研完成
- **记录日期**：2026-05-17
- **相关链接**：GitHub: ConardLi/garden-skills (**5,119★**, CSS) / 研究笔记: wangjs-jacky/garden-skills-study
- **评估**：✅ **强候选** — 跟 #20 Frontend Slides 同类（Claude Skill 形态）。集成路径：复制 skill 到 Irisy `~/.claude/skills/`（per `decision_drop_hermes_for_irisy_v1`，Irisy v1 = claude，直接装即可用），或包 launcher keycap（点 → 触发 Irisy `/skill-name`）。Pattern 归属：**新 Pattern H "Claude Skill Launcher"**（ADR-010 v1.1 修订，跟 #20 同类）

### 44. cc switch（一键接入 coding CLI）
- **描述**：跨平台桌面 All-in-One assistant，让用户一键切换并管理多个 coding CLI（Claude Code / Codex / OpenCode / OpenClaw / Gemini CLI / Hermes Agent / Qwen Code）+ 切换 API 中转 / 模型 / 配置
- **类型**：Pattern B (CLI wrapper) 或 Pattern G (builtin) — 取决于实现路径
- **优先级**：**P0**（Athena Code Space 12-slot grid 直接受益 — 用户从 Irisy Code tab 调用 cc-switch 切换 source；跟 Irisy coding companion 路线对齐）
- **状态**：调研完成，强推荐做 keycap
- **记录日期**：2026-05-17
- **相关链接**：GitHub: **farion1231/cc-switch** (**73,902★**, Rust) / SaladDay/cc-switch-cli (2,769★, Rust) / Laliet/cc-switch-web (327★, TS) / Golden-Promise/vscode-cc-switch (127★ 教程) / 官网 ccswitch.io
- **评估**：✅ **超强候选**。理由：(1) 73.9k★ 验证刚需；(2) Rust 跟 CTRL 技术栈对齐；(3) 直接服务 Athena 的 Code Space tab —— 用户从 Irisy 一键切换 Claude/Codex/Cursor/Gemini；(4) 跟 Pattern C daemon controller 衔接（cc-switch 本身 manage 多个 CLI 子进程）。建议 v1 集成路径：wrap cc-switch CLI（包成 keycap，tools = `cli.list` / `cli.switch(provider)` / `cli.add_config(...)`） + UI 走 HTMLOutputPanel 或 Settings 范式

### 45. OpenHuman + OpenHuman Skills（TinyHumans）
- **描述**：TinyHumans (tinyhumans.ai) 出品的 Personal AI agent —— Product Hunt 标语 "An AI agent even your dad can use. Yes, without terminal."。定位非技术用户的本地 AI super intelligence。配套 `openhuman-skills` 是 **Skills registry**，是 CTRL keycap 注册机制的直接同类参考
- **类型**：本地 agent（Pattern 类比 #44 cc-switch）+ Skills registry 参考（影响 manifest schema v0.2）
- **优先级**：P1（参考价值 > 直接集成 — 不重复造 agent，但 skills registry 设计必须吸收）
- **状态**：调研完成
- **记录日期**：2026-05-18
- **相关链接**：
  - GitHub: tinyhumansai/openhuman (**15,676★**, Rust)
  - GitHub: tinyhumansai/openhuman-skills (3★, TypeScript) — **Skills registry powering the OpenHuman codebase**
  - 官网: https://tinyhumans.ai
  - 配套 NeoCortex（memory infrastructure for production AI）
- **评估**：✅ **强参考**。两个 insight：
  1. **OpenHuman 定位 = "for your dad" 非技术用户** — 跟 CTRL 中文 OPC 创作者用户画像高度重合（"按 Ctrl 唤起，不要 terminal"）。值得对标 UX
  2. **openhuman-skills registry** = CTRL keycap registry 的早期同类。本仓库虽然只 3 star 但代码量小、新鲜（TypeScript，2026 出品），**直接抄读其 skill schema + 注册机制可加速 manifest v0.2 promote**。要不要让 Hephaestus 优先深读这个 registry 的 schema 设计？

---

### 系统级小工具主题的抽象洞察（给 Zeus 的建议候选）

这一批跟前两批（内容 / 笔记 / coding）形态本质不同：

| 主题 | 抽象形态 |
|---|---|
| 内容创作（HyperFrames / open-design） | LLM/API 调用，输入 → 加工 → 输出 |
| 笔记（Memos / flomo / Notion） | hotkey → 短文 → POST 到后端 |
| **系统级小工具（Synergy / Motrix / BetterDisplay）** | **keycap 是控制面板，背后调起或控制已有本地 daemon / CLI** |

第三类的抽象建议：

1. **"CLI wrapper" keycap 模板** —— 大量小工具（BetterDisplay CLI / Motrix RPC / Input Leap CLI / yt-dlp / ffmpeg / ...）的集成本质是"参数化执行外部 CLI 然后解析输出"。建议抽象一个 CLI wrapper 模板，参数化命令、参数 schema、输出解析、进度回调
2. **"daemon controller" keycap 模板** —— 控制本地长驻 daemon（Aria2 / Input Leap / lark-cli daemon / ...）的统一接口模式
3. **跟 mesh 边界澄清** —— Input Leap 这种"跨设备控制类"工具是否应该被 mesh 收编，还是作为独立 keycap？建议 Zeus 出一条"什么进 mesh / 什么走 keycap" 的判定规则

---

## 意向收集渠道

### 1. 用户反馈
- V2EX社区
- 即刻社区
- 知乎专栏
- GitHub Issues

### 2. 竞品分析
- Quicker动作市场
- Raycast Extension
- 飞书应用市场
- Coze workflow

### 3. 技术探索
- GitHub开源项目
- MCP服务器生态
- 命令行工具
- Web服务API

## 优先级评估标准

### P0（立即开始）
- 验证核心假设的工具
- 基础用户体验工具
- 技术验证关键工具
- 时间：1-2周内完成

### P1（近期规划）
- 重要但非紧急的工具
- 生态建设关键工具
- 用户需求明确的工具
- 时间：1个月内完成

### P2（长期规划）
- 复杂或资源需求高的工具
- 探索性工具
- 锦上添花的工具
- 时间：1-3个月内完成

## 记录更新流程

1. **收集意向**：从各种渠道收集工具意向
2. **初步评估**：评估技术可行性和用户价值
3. **记录归档**：按格式记录到本文件
4. **优先级排序**：根据评估标准确定优先级
5. **开发规划**：纳入开发计划
6. **状态更新**：定期更新工具状态

## 与flomo的集成建议

由于flomo是一个笔记工具，建议以下集成方式：

### 1. flomo Webhook集成
- 通过flomo的inbox webhook接收笔记
- 自动解析笔记内容，提取工具意向
- 自动创建意向记录

### 2. flomo API集成
- 使用flomo API读取特定标签的笔记
- 自动同步到本记录文件
- 双向同步更新

### 3. 手动同步流程
1. 在flomo中记录工具意向（使用特定标签如#ctrl-keycap）
2. 定期手动整理到本文件
3. 更新状态和优先级

## 下一步行动

### 立即行动
1. **验证P0工具**：从八字算命工具开始验证
2. **建立收集流程**：建立从flomo到本文件的同步流程
3. **社区征集**：在V2EX等社区征集工具意向

### 近期计划
1. **自动化收集**：实现flomo webhook自动收集
2. **优先级评估**：建立更科学的评估体系
3. **开发路线图**：基于意向制定详细开发计划

---

## 设计理念：Build Something Small

### 理念来源
源自zarazhangrui (Zara Zhang)的"Build Something Small"理念，强调从小处着手，解决具体问题，而不是一开始就追求构建庞大的系统。

### 核心理念
1. **解决具体问题**：每个工具专注于一个明确的痛点
2. **保持简单**：最小可行产品，零依赖或最少依赖
3. **快速迭代**：小步快跑，持续改进
4. **实用主义**：功能优先于形式，用户体验优先于技术复杂度

### 在CTRL中的应用
- **轻量化承载平台**：不是自己做大工具，而是承载小工具
- **按需使用**：工具按需启动，用完即走
- **用户友好**：用户零代码集成，快速获得价值

---

*本文件将持续更新，记录所有keycap意向和进展*
*最后更新：2026-05-18 by Hephaestus（追加 #43 garden-skills / #44 cc-switch / #45 OpenHuman + openhuman-skills；分类管理调研走 06；"AI 场景落地师"岗位待 bao 拍板登记位置）*

---

## Pattern Index（2026-05-17 ADR-010 分桶）

> ADR-010 把所有 keycap 归 7 个 pattern（A–G）。下表把 42 条意向逐一打 pattern 标签，便于按 pattern 批量集成。**reference impl 标 ★**。

| # | 名称 | Pattern | 备注 / 与 Pattern 关系 |
|---|---|---|---|
| 1 | 八字算命 (bazi-mcp) | **D ★** | 已是原生 MCP server，零包装 |
| 2 | 文本翻译 | **A** | HTTP API tool (HttpCapability + 可选 KeyringRead) |
| 3 | AI 改写 | **A** | HTTP API tool (LLM 调用) |
| 4 | Markdown 工具集 | **G** | 已是声明式 step，纳入 builtin MCP server |
| 5 | 剪贴板增强 | A + G | 部分声明式 + 部分 HTTP（AI 增强） |
| 6 | 搜索聚合 | **A** | 多 HTTP API fan-in 到 one tool |
| 7 | 飞书集成 | **E ★** | OAuth (Feishu/Lark provider) |
| 8 | Coze Runner | **E** | OAuth (Coze provider) |
| 9 | 本地知识库 RAG | B + A | CLI (向量库) + HTTP (查询) |
| 10 | 网页抓取 (scrapling) | **B** | Python CLI wrapper |
| 11 | AI 对话 | **A** | LLM HTTP API，但与 Irisy 重叠，考虑砍 |
| 12 | 文件处理 | **B** | CLI wrapper (mv/cp/find/sed 等) |
| 13 | OpenTeams | **C** | Daemon controller（OpenTeams 是长驻 agent cluster） |
| 14 | GBrain | **D** | 提供 MCP 客户端，已 MCP 化 |
| 15 | PokoClaw | — | ✗ 不适配（pokoclaw 已是 AI assistant，跟 Irisy 角色冲突） |
| 16 | Excalicord | — | ✗ 不适配（功能不明） |
| 17 | Follow Builders | A + 自己是 agent | 内容聚合 → HTTP delivery；agent 部分由用户跑，CTRL 只做触发 |
| 18 | Supadata API | **A** | HTTP API (1 endpoint) |
| 19 | X/Twitter API | **E** | OAuth 2.0 / Bearer Token |
| 20 | Frontend Slides | A + 本地生成 | 参考价值大于直接集成 |
| 21 | OpenAI Realtime API | **A** | WebSocket + WebRTC（A 特殊态：long-lived connection） |
| 22 | 飞书 CLI (larksuite/cli) | **B** | CLI wrapper，包 200+ 命令 |
| 23 | Tab Out | **F** | 浏览器扩展 publish 当前 tab 信息 → ST-SS |
| 24 | HyperFrames | A or B | 取决于 license（HTTP API 或本地 CLI） |
| 25 | nexu-io/open-design | — | 参考样本，不直接做 keycap |
| 26 | cc-telegram-bridge | — | ✗ 不适配（PWA only 决策冲突） |
| 27 | midaz | — | ✗ 不适配（OPC 不重合） |
| 28 | moxt | — | ✗ 不适配（量化交易不重合） |
| 29 | royfhs | — | ⚠️ 未找到，待 bao 澄清 |
| 30 | confldence | — | ⚠️ 未找到，待 bao 澄清 |
| 31 | Memos | **A ★** | HTTP API (Memos REST)，flomo 自托管对照 |
| 32 | Note Mark | **A** | HTTP / WebView |
| 33 | printnotes | — | ✗ 太重，作为完整 app 不适合 keycap |
| 34 | dumbnote | — | UX 参考，不集成 |
| 35 | quick-input (Notion menubar) | **A** | Notion API sink，UX 同构 |
| 36 | Obsidian Web Clipper | **A** | Obsidian sink |
| 37 | Input Leap | ⚠️ 跨边界 | "跨设备输入" 应进 mesh 还是 keycap？待 Zeus ADR 边界规则 |
| 38 | Motrix / Aria2 | **C ★** | Aria2 daemon + JSON-RPC controller |
| 39 | BetterDisplay | **B ★** | CLI wrapper (`betterdisplaycli`) |
| 40 | 临时文件分享 (transfer.sh) | **A** | HTTP POST (curl 单行 cover) |
| 41 | GitHub 加速 | **B** | git clone wrapper + URL 重写 |
| 42 | Intent | — | ⚠️ 未找到 |
| — | share/modules/builtin/markdown-quote | **G ★** | 16 个 starter 之一，做 builtin MCP server reference |
| — | VSCode coding context publisher | **F ★** | Pattern F reference，待 ADR-010 §5.6 ST-SS↔MCP bridge spec |

### 分桶统计

| Pattern | 数量 | reference impl |
|---|---|---|
| **A** Notes / Share / HTTP API sink | 15 | ★ Memos (#31) |
| **B** CLI wrapper | 7 | ★ BetterDisplay (#39) |
| **C** Daemon controller | 2 | ★ Motrix / Aria2 (#38) |
| **D** 第三方 MCP server | 2 | ★ bazi-mcp (#1) |
| **E** OAuth 大平台 | 3 | ★ 飞书 (#7) |
| **F** 第三方 ST-SS publisher | 1 | ★ VSCode publisher（待 spec） |
| **G** 声明式 step (builtin) | 1 + 16 starter | ★ markdown-quote |
| ✗ 不适配 / 参考 / 未找到 | 11 | — |
| ⚠️ 跨边界 | 1 (Input Leap #37) | 待 Zeus 决 |

### 关键观察

- **Pattern A 是最大桶（15 条）** —— Notes/HTTP API sink 是 CTRL 最大量 keycap 形态。建议 ADR-010 §`OAuthCapability` 落地后立刻批量生成 A 类 keycap（一个 HTTP 模板 N 个后端）
- **Pattern D 数量少（2 条）但生态势能最大** —— 一旦 `MCPServerActor` 落地，外部 Anthropic MCP 10K+ servers 全部立刻可用，分桶数会爆炸
- **Pattern F 只有 1 条** —— 不是真的 1 条，是"第三方 ST-SS publisher" 这个生态还没起来；ADR-010 §8 把桥接协议 defer 到 stss-protocol/mcp-bridge.md，会成为后续 Pattern F 大规模爆发的开关
- **11 条不适配** —— 占 26%，调研淘汰率合理（处女座原则：不适配也记录，避免重复调研）