# CTRL 战略头脑风暴

**日期**：2026-05-05
**状态**：原始头脑风暴，待整理
**目的**：把一次开放式战略对话里的所有思考、洞察、待决策问题落地为可整理的文档

---

## 0. 元说明

这个文档不是 PRD、不是 spec、不是产品需求文档——它是一次**思考过程的快照**。
- 已锁定的判断会标 `[已锁定]`
- 还在纠结的会标 `[待决策]`
- 推论性的会标 `[推论]`
- 可能错的会标 `[需验证]`

---

## 1. 核心命题（已锁定）

### 1.1 价值层
- **AI 时代释放了海量个体创造能力，需要一个承接器** `[已锁定]`
- **创造者 = 消费者**——同一个人既造也用，没有 KOL/粉丝那种割裂 `[已锁定]`
- **prompt = tool**——AI 时代工具的最小原子是一段 prompt，而不是一段代码 `[已锁定]`

### 1.2 商业层
- **价值优先，商业次之**——有价值自然能赚钱，不强行设计变现 `[已锁定]`
- 短期不做账号系统、不做 marketplace 抽成、不做创作者经济
- 长期类比：RSS（协议）→ Substack（服务），HTTP（协议）→ Cloudflare（服务）

### 1.3 哲学层
- **本地优先（local-first）**——数据在用户硬盘，CTRL 是 runtime，不是托管商 `[已锁定]`
- 类比：Obsidian、Markdown、Email 协议、RSS

---

## 2. CTRL 是什么——定位演进

依次淘汰的过往说法（每一个都有局限）：
1. ~~"AI 时代的 launcher"~~ → 太窄，忽略了创造和学习
2. ~~"Prompt App Store"~~ → 太交易，忽略了学习
3. ~~"蒸馏自己的平台"~~ → 太极客，忽略了 99% 不会用 AI 的人
4. ~~"本地优先的 AI vault"~~ → 太架构，没有人味
5. ~~"AI 时代的工具锻造车间 + 收纳柜"~~ → 缺承接所有外部生态的视角

**最新定位（最对的版本）：**

> **CTRL 是 AI 服务的"浏览器"——一个底座 + 一个显示屏，所有 agent / 工具 / Skill / persona / 蒸馏的人格 都通过统一协议接入，用户按一个键就能调，不需要装 N 个 app、注册 N 个账号。**

类比：

|  | 干啥的 | 协议 | 内容来自哪 |
|---|---|---|---|
| 浏览器 | 跑网页 | HTTP + HTML | 任何人写的网站 |
| **CTRL** | **跑 AI 服务** | **底座合约 + Frame** | **任何人写的键帽** |

**核心要点：浏览器不"做"网站，它跑别人做的网站。CTRL 不"做"AI 服务，它跑别人做的 AI 服务。**

---

## 3. 三层产品结构

```
┌─────────────────────────────────────────────────────────┐
│  表层（消费侧）                                          │
│    键盘——按一个键，干一件事                              │
├─────────────────────────────────────────────────────────┤
│  中层（产品三块面板）                                    │
│    ① 键盘（高频/Pin/肌肉记忆）                           │
│    ② 仓库（搜索/意图/长尾发现）                          │
│    ③ 工作区（显示屏/渲染键帽输出）                       │
│    ④ 终端（创造侧——和 AI 聊出新键帽）                   │
├─────────────────────────────────────────────────────────┤
│  底层（架构）                                            │
│    底座协议——任何能力都通过同一接口接入                  │
│    Vault——本地文件型键帽存储                            │
└─────────────────────────────────────────────────────────┘
```

---

## 4. 关键架构洞察（按时间顺序）

### 4.1 终端 = 创造工具 `[已锁定]`
- 键帽不是预先做好的，而是**用户在终端里和 AI 对话锻造出来的**
- 现有 ChatWorkspace 改造一下就是 1.0 终端
- 终端的核心智能：从对话里**自动结构化**成 keycap manifest（schema、标签、chord、输入绑定）

### 4.2 蒸馏自己的连续光谱 `[已锁定]`

| 蒸馏度 | 实现 | 例子 | 创作成本 |
|---|---|---|---|
| **L0 风格 prompt** | 一段 system prompt | "@小红书种草风" 键 | 10 分钟 |
| **L1 few-shot 模板** | system prompt + 5-10 个真实样本 | "用我妈口气劝学" 键 | 半小时 |
| **L2 RAG** | prompt + 接入笔记/微博/朋友圈 | "我的写作风格" 键 | 一两小时 |
| **L3 fine-tune / LoRA** | 在基模上微调 | "数字版张三医生" 键 | 几天 + 算力 |

CTRL 支持整条光谱。终端是这条光谱的施工现场。

### 4.3 本地优先 + Obsidian 融入 `[已锁定]`

```
~/CTRL/                          # 用户自己 own 的 vault
  keycaps/
    @王小波式.json
    @我妈式劝学.json
    周报版我.json
  personas/
    王小波式/
      prompt.md
      examples/
        001.md
    周报版我/
      prompt.md
      sources.json              # 指向 ~/Obsidian/work/weekly/
  models/
    周报版我.lora                # 本地 LoRA（可选）
  history/
    runs.jsonl                   # 本地调用历史
  .index/
    vault.lancedb/               # 本地向量库
    embed.cache/
  config.json
```

**关键性质：**
- 全是纯文本 / JSON / Markdown，任何编辑器能开
- 整个目录扔进 git 就是版本控制
- iCloud / Dropbox 同步 = 跨设备
- 一个键帽 = 一个 `.json` 文件 = 微信发给朋友 = 安装

### 4.4 本地向量化 `[已锁定]`

| 组件 | 推荐 | 理由 |
|---|---|---|
| Embedding 模型 | bge-small-zh-v1.5 / multilingual-e5-small | 中文友好、80MB、M 芯每秒几千 chunk |
| Vector store | SQLite + sqlite-vec / LanceDB | 文件型、零 daemon、跟 vault 一起 sync |
| 索引策略 | FileWatcher → 增量重 embed | 不全跑、零卡顿 |
| Runtime | Mac MLX/CoreML，Win ONNX | 本地、零 API 成本 |

向量库**也用来搜键帽**——以后键帽多了，"种草" 自动找到 `@小红书种草风`。

### 4.5 API 作为副作用 `[已锁定]`

键帽不只是 transformer，可以是 agent——读你的世界 + 对你的世界做事。

| 档 | 模式 | 适用 |
|---|---|---|
| **直发**（绿色 API）| 键帽生成 → 直接 POST | Telegram / Mastodon / GitHub / WordPress |
| **OAuth 直发**（黄色）| 用户授权 → CTRL 帮调 | Twitter / 微博 |
| **草稿+深链**（橙红色）| CTRL 生成内容 → URL scheme 唤起官方 app → 用户在 app 点发 | **小红书 / 知乎 / 抖音 / 微信** |

第三档是**中文最大流量平台的合规路径**——不违 ToS，但抢走前面所有繁琐。

### 4.6 MCP + Skill 接入 `[已锁定]`

CTRL 不孤立——它接 AI 工具圈大动脉。

```
            生产侧（开发者 / 专家）              消费侧（普通用户）
            
            写 MCP server   ──┐                          ┌─→ 按键就能用 GitHub
            写 Skill        ──┼─→ CTRL 粘合成键帽 ─→  ─┼─→ 按键就能问律师
            蒸馏自己        ──┘                          └─→ 按键就能改朋友圈
```

MCP / Skill / Prompt 都是键帽下面的"capability 来源"——键帽只是粘合层。

### 4.7 底座 + 显示屏（最关键的统一抽象）`[已锁定]`

> **键帽需要安装的底座（universal socket）+ 工作区是个显示屏（passive renderer）**

```typescript
interface Keycap {
  manifest: {
    name, icon, tags, version, author,
    capabilities: ['llm', 'image-gen', 'mcp:github', 'skill:writer', ...],
    inputs: [{ kind: 'clipboard'|'selection'|'file'|'form', schema? }],
    runtime: 
      | { kind: 'local-process', cmd }      // CTRL 起进程
      | { kind: 'http',          endpoint } // HTTP 流式
      | { kind: 'websocket',     url }      // 长连接（长任务）
      | { kind: 'mcp',           server },
    auth?: 
      | { kind: 'none' }
      | { kind: 'api-key',  envVar }
      | { kind: 'oauth2',   provider, scopes }
      | { kind: 'cookie',   domain }
      | { kind: 'custom',   flow },
    publisher: { name, verified, signature, homepage },
  }
  
  invoke(inputs, signal: AbortSignal): AsyncIterator<Frame>
}

type Frame =
  | { kind: 'text',    content, streaming? }
  | { kind: 'image',   url }
  | { kind: 'form',    schema }              // 反向请求结构化 input
  | { kind: 'choices', options }             // 多变体并列
  | { kind: 'widget',  component, data }     // 自定义 UI
  | { kind: 'action',  label, handler }
  | { kind: 'file',    content, format }
  | { kind: 'status',  progress?, label }
```

**关键性质：**
- 键帽**只实现 `invoke()`**——不懂任何 UI
- workspace **只渲染 Frame**——不懂任何键帽细节
- 中间通过事件流解耦——可以本地、跨进程、跨网络
- 协议是**纯文本声明**——不写代码也能定义键帽

**这一抽象解掉了多少之前的难题：**

| 之前的难题 | 底座/显示屏怎么解 |
|---|---|
| 不同类型键帽架构怎么统一？ | 都实现同一个 `invoke()`，差异在内部 |
| Logo 这种 compound keycap 怎么做 UI？ | 流式发 Frame：form → status → choices → widget → file，workspace 自动渲染 |
| MCP server 启动管理？ | manifest.capabilities 声明，runtime 按需起 |
| Skill 集成？ | Skill 是一种 capability |
| 第三方扩展？ | 写一个实现 Keycap interface 的文件，丢进 vault |
| 键帽 fork / 修改？ | manifest + 实现是普通文件 |
| 学习层怎么内嵌？ | workspace 渲染时附"看 prompt"按钮 |
| 登录用户账号难？ | **每个键帽自己声明 auth 类型，CTRL 只做凭证管家** |
| Manus 这类外部 agent 怎么装？ | runtime: 'http' + auth: 'api-key' + publisher 验证 |
| 长任务（几小时）怎么管理？ | Frame 流双向 + AbortSignal + 后台执行 |
| 信任问题（"原装 Manus"）？ | publisher 数字签名 + 验证标记 |

---

## 5. 八条主管线 + 第九条

| # | 管线 | 主要用户 | 典型键帽 | 创作者来源 | 杀手镜头 |
|---|---|---|---|---|---|
| 1 | 工具线 | 所有人 | 翻译/总结/改写/证件照/OCR | CTRL 团队预制 + 社区 | 第一次按 Ctrl 就能用，零配置 |
| 2 | 蒸馏人格线 | 所有人 | @律师小张 / @会计李四 / @王小波式 / @我妈式 | 专业人士 / KOL / 普通用户 | "我居然能 5 块钱'问'一个律师" |
| 3 | AI 产品聚合线 | AI 重度用户 | 跨模型问答 / 生图 / TTS | CTRL + 开发者 | 一个键 fan-out 到 4 个模型 |
| 4 | Vibe Coding 线 | 半技术用户 | 生成组件/调 bug/写 SQL/部署 | 程序员 KOL | "不会写代码也能造出能跑的应用" |
| 5 | 内容创作线 | 主播/KOL/博主 | 标题党 / 直播话术 / 选品文案 | 内容圈 KOL + MCN | "每天少花 2 小时想标题" |
| 6 | 行业 B2B 线 | 中小企业主 | ERP 操作 / 客户邮件 / 行业模板 | SaaS 厂商 + 行业大佬 | 老板娘也能让工厂数字化 |
| 7 | 学习 / 教育线 | 学生 / 终身学习者 | 学英语 / 解题 / 编程导师 / 健身教练 | 教育 KOL + 老师 | 跟一个"王老师"人格学奥数 |
| 8 | 生活 / 社交 / 心理线 | 大众 | 怎么回这条消息 / 哄娃 / 心理树洞 | 心理咨询师 / 情感 KOL / 普通用户 | "憋了一晚的回复，5 秒搞定" |
| **9** | **个人/小微商家视觉创作线** | 个体户 / 副业者 / 小工作室 | logo / 名片 / 海报 / 包装 / VI 套装 | 设计圈 KOL + 设计师 | "10 分钟 logo + 名片 + 海报 + 包装贴纸全套" |

**二维分布：**
- 横轴：横向（人人）↔ 纵向（特定身份）
- 纵轴：大众 ↔ 专业/技术性

中间地带（蒸馏人格线、内容创作线、学习线、商家视觉线）= CTRL 的核心战场。

---

## 6. 对现有产品的定位（参考系）

|  | 重量 | 数据所有权 | 入门门槛 | AI 原生度 | 用户规模 | 谁在用 |
|---|---|---|---|---|---|---|
| 飞书 | 重 200MB+ | 字节 cloud | 低 | 中（堆叠）| 200M+ | 公司/团队 |
| Notion | 重 cloud-only | Notion cloud | 中 | 中（堆叠）| ~50M+ | 知识管理控 |
| Obsidian | **轻** | **你** | 高 | 弱（bolt-on）| **~1-2M** | 极客 / PKM 党 |
| Quicker | 中 | 你 + 云同步 | 中 | 弱 | 数十万 | Win 高级用户 |
| Raycast | 轻 | 部分云 | 低 | 中 | 数百万 | 开发者 |
| GPTs Store | cloud | OpenAI cloud | 低 | 高 | OpenAI 用户 | ChatGPT 用户 |
| Coze | 中 | 字节 cloud | 中 | 高 | ?M | 开发者 / 业务 |
| character.ai | cloud | 他们 cloud | 低 | 高（persona） | 数千万 | 娱乐用户 |
| Manus | cloud | 他们 cloud | 中 | 高（agent） | 早期 | 早期 adopter |
| **CTRL** | **轻 + 本地** | **你** | **低** | **高（key=prompt）** | ? | **想要本地控制权的普通 AI 用户** |

CTRL 占的格子（**本地 + 轻 + 普通人友好 + AI 原生**）目前没人占。

### 关键参考的具体价值

- **Obsidian**：local-first 架构哲学；用户少这件事是反向利好（种子用户最高质量、影响力最大）
- **Quicker**：证明了"hotkey + 浮动 panel + 用户创作 + 社区分享"这个交互范式在中国可以跑通
- **MCP 生态**：海量开发者已经在写 MCP server，CTRL 接上等于继承整个生态
- **Skill 协议**：Anthropic 推的"打包专业知识"概念，天然 fit "蒸馏人格"
- **飞书反例**：太重、cloud-locked、堆叠功能——CTRL 反着来
- **GPTs Store 反例**：cloud-locked、平台抽成、创作者数据被锁——CTRL 反着来

---

## 7. CTRL 不做什么（红线 - Day 1 划清楚）

**永远不做：**
- 表格 / 在线文档 / 富文本编辑
- 日历 / 任务管理 / 项目管理
- 团队协作 / 在线评论 / 共享 workspace
- 视频通话 / 即时通讯
- 移动端 first（桌面打磨好之前不做 mobile）
- 内置 AI workstation（那是飞书的工作）
- 完整 PKM（那是 Obsidian 的工作）

**敢拒绝什么，决定产品成不成。**
**只要做"全功能 AI workstation"的诱惑出现一次，CTRL 就废了。**

### Day 1 硬约束（性能）

| 项 | CTRL 必须做到 |
|---|---|
| 启动 | < 200ms 从 Ctrl 按下到 UI ready |
| 内存 | < 80MB |
| 登录 | 永不必须 |
| 入口 | 就 3 块：键盘 / 仓库 / 终端 + 工作区显示 |
| 离线 | 除 LLM 调用外全离线 |
| 安装包 | < 30MB |

---

## 8. 冷启动路径

| 阶段 | 时长 | 目标用户 | 获客手段 | 关键 demo |
|---|---|---|---|---|
| **0 → 1** | 3 个月 | Obsidian / Logseq / 思源用户 | 他们的论坛 / Discord / 小红书 PKM tag | "把 vault 接进 CTRL，5 分钟造出 '我的写作风格' 键" |
| **1 → 10** | 1 年 | AI-curious 知识工作者（用 ChatGPT 但烦飞书）| KOL 拍 "@王小波式" 视频，小红书自来水 | "5 分钟蒸馏一个 KOL" 系列 |
| **10 → 100** | 破圈 | 大众 | 算命 / 证件照 / 朋友圈代写 / logo 爆款键帽 | TikTok / 抖音病毒视频 |

**为什么 0→1 选 Obsidian 用户：**
- 已接受 local-first，零教育成本
- 已有 vault，CTRL 直接接现成数据立刻 wow
- 博客主 / PKM 大 V 多——传播力是普通用户 100 倍
- 量虽 1-2M，但是最高质量种子

---

## 9. Phase 1 重排（核心交付）

### 之前的错误：Phase 1 = "做 5-8 个 demo 键帽"
### 正确的 Phase 1 = "**做底座协议 + 显示屏**，键帽是验证协议的样本"

| 优先级 | Phase 1 必交付 |
|---|---|
| **P0** | 底座合约 v1（manifest 格式 + invoke 接口规范）—— Rust trait + TS interface + 文档 |
| **P0** | workspace 显示屏（能渲染中等版 Frame：text + form + image + status）—— React 实现 |
| **P0** | Vault 文件加载机制 —— 扫 ~/CTRL/keycaps/ + FileWatcher 热重载 |
| **P0** | 配置 vault 路径（默认 `~/CTRL/`，可指向 Obsidian vault） |
| **P1** | 3-5 个参考实现键帽（每种 Frame 至少一个用到，作为协议正确性验证） |
| **P1** | 终端（一个特殊键帽，invoke() 是"和 AI 聊出新键帽 manifest"） |
| **P1** | 凭证管家（系统 keychain 集成，键帽通过 ctx 拿凭证） |
| **P2** | 本地向量索引（bge-small + sqlite-vec） |
| **P2** | MCP client runtime |
| **P2** | 图像生成支持（云 API 优先） |
| **P2** | Publisher 签名验证 |

**工时估算：3-4 周**（之前算过 2-3 周，加了远程 runtime + 长任务 + 认证 + 签名后增到 3-4）

### Phase 1 demo 键帽组合（候选）

7-8 个，覆盖最大异质性：

| # | 管线 | 键帽 | 验证什么 |
|---|---|---|---|
| 1 | 工具线 | 翻译 | 纯 prompt + text Frame |
| 2 | 工具线 | 改朋友圈风 | 剪贴板输入 |
| 3 | 蒸馏人格线 | `@王小波式` | system prompt + few-shot |
| 4 | 蒸馏人格线 | `@我的写作风格` | RAG（接 Obsidian） |
| 5 | AI 聚合线 | 跨模型 fan-out | choices Frame + 多模型路由 |
| 6 | Vibe Coding 线 | 生成 React 组件并保存 | MCP filesystem capability |
| 7 | 生活线 | 怎么回这条消息 | 简单 prompt + 选区输入 |
| 8 | 商家视觉线 | `给我做个 logo` | image + form + status + choices + file（compound）|
| 9 | 外部 agent 线 | 调用 Manus 类外部 agent | runtime: 'http' + 长任务 + 认证 |

### Phase 1 是否包含 #8（logo）和 #9（外部 agent） `[待决策]`

**包含的好处：**
- #8 视觉冲击拉满，演示视频传播力强 10 倍
- #9 直接 prove "CTRL 是 AI 服务浏览器"——比任何讲解都硬
- 各踩一条新管线（视觉、外部 agent）

**包含的代价：**
- #8 多 3-5 天（图像 API + form + 多变体 UI）
- #9 多 5-7 天（远程 runtime + 长任务 + 认证 + 签名）
- 总 Phase 1 多 1-2 周

**待决策：是排进 Phase 1 还是 Phase 1.5？**

---

## 10. 还没想透的问题（待决策）

### 10.1 承接器形态 `[待决策]` ★ 最关键

四种结构性不同：

| 形态 | 谁创造 → 谁消费 | 类比 | 商业模式（如果硬选）|
|---|---|---|---|
| 1. 个人 vault | 我 → 我 | Obsidian | 工具付费 |
| 2. 中央 App Store | 创作者 → 大众 | GPTs Store | 平台抽成 |
| 3. 创作者私域 | KOL → 自己粉丝 | Patreon | 创作者订阅 |
| 4. 协议层 | 任何人 → 任何人，文件流通 | RSS / Email / npm | 协议免费，配套服务 |

**当前倾向**：4 是底层，3 是可选商业化层。文件格式开放（4），marketplace 是上层操作的服务（3）——像 email + Gmail。

**但还没真正拍板**——因为商业被推迟了，优先级降低。

### 10.2 vault 独立 vs 寄生 Obsidian `[待决策]`

- **独立 vault**（`~/CTRL/`）：纯粹、不污染、面向所有人
- **寄生在 Obsidian vault 里**：Obsidian 用户上手 0 门槛，但绑定 Obsidian 用户群

**当前倾向**：独立 vault，但能**指向**Obsidian vault 路径作为可选 RAG 数据源。

### 10.3 终端是否进 Phase 1 `[已倾向但未拍板]`

强烈倾向**进**——理由：
- 没终端 = 没键帽供给 = spike 死在"没东西可用"
- 现有 ChatWorkspace 改造成本低
- 早期种子用户能自产键帽 = 价值假设验证最便宜

### 10.4 跨管线复合键帽（composability） `[待决策]`

例子：
- 内容创作 × 蒸馏人格 = `@李佳琦式直播话术`
- 工具线 × Vibe Coding = `给我画个组件`
- Logo × VI × 商家视觉 = `开店全套视觉一键生成`

**Phase 1 要不要 demo 一个 composability？**
- 优势：CTRL 最特别的能力（其他平台都做不到）
- 代价：实现复杂度 +1（需要"键帽可以引用键帽"机制）

### 10.5 底座 v1 复杂度 `[已倾向中等版]`

| 版本 | Frame 类型 | Cover 哪些 | 工时 |
|---|---|---|---|
| 极简 | 仅 text | 80% 数量但 50% 价值 | 1 周 |
| **中等** | text + form + image + status | 加 form 和图像 | 2-3 周 |
| 完整 | 全 8 种 Frame | 全部场景 | 4-6 周 |

**当前选**：中等。其他向后兼容补。

### 10.6 第一个外部 agent demo 选哪家 `[待决策]`

候选：
- Manus（API 不一定开放，但概念最对）
- OpenAI assistants API（最稳定）
- Claude Computer Use（最前沿）
- 国产代表（豆包/智谱/百川——中文场景最有共鸣）

---

## 11. 关键洞察集锦（一句话版）

按浮现顺序：

1. "prompt = tool" → 整个平台原子被重定义
2. "证件照" → 揭示长尾仓库层（顶层日用 + 底层长尾）
3. "算命" → 揭示对话式 persona 类键帽（与一次性 transformer 并存）
4. "登录用户账号难" → 大厂故意没 OAuth，是结构性问题
5. "终端是创造工具" → 创造侧浮出，跟消费侧并列
6. "蒸馏自己" → AI 时代专业能力第一次脱离时间被分发
7. "Obsidian 本地存储要融入" → 本地优先是哲学不是 feature
8. "向量化 + API 作为终端" → 键帽从 transformer 变成 agent
9. "飞书太重、Obsidian 用户少" → 中间空位 = CTRL 该坐的格子
10. "AI 时代创造需要承接器" → 核心命题最简版
11. "创造者 = 消费者" → 角色塌缩
12. "为不会用 AI 的人做" → 99% 用户是关键
13. "也是知识和学习平台" → 第三个面（创造/消费/学习）
14. "商业少考虑点，有价值自然能赚钱" → 价值优先
15. "管线整理：工具/蒸馏/AI/Vibe/主播/B2B" → 8 条管线
16. "MCP / Skill 也应该可以调" → 接入开发者生态
17. "做 logo 也是好方向" → 第 9 条管线 + compound keycap 样板
18. "找一个通用接口、键帽底座、工作区是显示屏" → **核心架构抽象**
19. "Manus 装进来就好了，原装的" → 远程 + 长任务 + 认证 + 签名

---

## 12. 一行版定位演进（最终态）

> **CTRL 是 AI 服务的浏览器——一个本地的、轻的、人人都能用的键盘式入口；任何 AI 能力（prompt、persona、agent、Skill、MCP server、工作流）都能装在键盘上的一个键里，按一下就用，不需要装 N 个 app、不需要登 N 个账号、不需要会写代码。**

补充说明：
- "**浏览器**" 类比关键——CTRL 不是内容生产者，是内容运行时
- "**本地的、轻的**" = 区别飞书 / Notion / GPTs Store
- "**人人都能用**" = 区别 Obsidian / Cursor / Coze
- "**键盘式入口**" = 区别于 ChatGPT 等聊天框形态
- "**任何 AI 能力**" = 底座的 generative capacity

---

## 13. 下一步（建议）

1. 把这个文档跟 `doc/product-spec.md` / `doc/quicker-research.md` 一起整理
2. 拍板 §10 里几个 `[待决策]` 的问题（优先 10.1、10.4、10.6）
3. 把 §9 Phase 1 重排成具体的可执行任务列表（含工时）
4. 起草底座合约 v1 的正式文档（manifest schema + invoke 接口 + Frame 类型枚举）
5. 起草 vault 目录结构 + 文件格式正式规范
6. 选定 Phase 1 的 7-9 个 demo 键帽，每个写一句"它存在的意义"

---

## 14. 底座生态研究（2026-05-05 续记）

> 起因：用户问"开放性研究——哪些可以作为底座接入进来？底座需要提供什么条件？"
> 拆成两维：**软件底座**（什么 runtime 能产生 keycap）+ **硬件底座**（keycap 能投射到什么物理形态上让用户摸得到/带得走）。
> 共享一份"底座契约"——这是 CTRL 之所以是 runtime 而非 app 的核心。

### 14.1 软件底座类型谱系（8 类候选）

| # | 类型 | 候选举例 | 接入难度 | 用户感知 |
|---|---|---|---|---|
| 1 | **本地进程类** | CLI 工具（ffmpeg/yt-dlp/pandoc）、Ollama/LMStudio 本地模型、AppleScript/URL Scheme 调起的 native app（Things/Bear/Obsidian） | 低-中 | 离线可用，最 Mac 原生 |
| 2 | **HTTP/REST API 类** | OpenAI/Anthropic/Gemini/DeepSeek/Kimi、Notion/Linear/Slack/GitHub、Stripe/微信、个人自建的 dify/n8n workflow | 低 | 数量最多，云依赖 |
| 3 | **MCP 服务器类** | 官方/社区 MCP（filesystem/github/playwright/context7）、Smithery/Glama 市场、用户自建 MCP | 中 | 协议级标准，最可移植 |
| 4 | **WebSocket / 流式** | 实时数据（股票/币圈/IoT）、Liveblocks/Yjs 协作、流式 LLM | 中-高 | 适合 Frame 流 |
| 5 | **Webview / 浏览器扩展** | 嵌入 Notion 页/Figma/Excalidraw、Chrome extension 通道、社交媒体发布 API | 中 | 视觉重，最贴近"原产品" |
| 6 | **Agent 框架类** | Manus、Computer Use、browser-use、LangGraph、CrewAI、用户私有蒸馏 agent（律师/会计/写手） | 高 | 单帽 = 一个有人格的 agent |
| 7 | **数据仓库类** | Obsidian vault、Apple Notes、SQLite/DuckDB、Notion DB/Airtable、向量库（Chroma/LanceDB） | 中 | 它们既是底座也是被检索物 |
| 8 | **硬件 / 系统外壳** | 摄像头/麦/屏、蓝牙设备、HomeKit/Matter、iOS Shortcuts 反向输入、Apple Intelligence Foundation Models、剪贴板/通知 | 中-高 | 把"现实"接进来 |

### 14.2 硬件底座 6 层 tier

| Tier | 类型 | 候选 | 一帽形态 | 适配难度 |
|---|---|---|---|---|
| **T1 · 主流移动** | iPhone / iPad / Android | App / 小组件 / Live Activity / 锁屏挂件 | 触摸瓷片，4-12 帽 | 中 |
| **T2 · 国内生态** | 鸿蒙 Next（原子化服务）、微信小程序、支付宝小程序 | 卡片即应用 | 卡片，单/多帽 | 中-高（鸿蒙）/低（小程序） |
| **T3 · 周边可穿戴** | Apple Watch / WearOS / 三星 Galaxy Watch | Complication / Tile | 1-3 帽极限精简 | 中 |
| **T4 · 物理孪生 ⭐** | Stream Deck / Loupedeck / TourBox / 自制 QMK 键盘 / 树莓派副屏 | **真实按键 = keycap 1:1** | 6/15/32 个物理键 | 低-中 |
| **T5 · AI 原生硬件** | Rabbit R1 / Plaud Note / Ray-Ban Meta / Apple Vision Pro / 国产 AI 眼镜 | 语音帽 / 空间帽 | 0-3 帽，无屏或空间屏 | 高（API 不稳） |
| **T6 · B 端 / 车机 / 工业** | CarPlay / Android Auto / 鸿蒙座舱 / 收银机 / 工厂触屏 / 餐饮点单屏 | 行业模板 | 大帽，少而准 | 高（认证+审核） |

### 14.3 共享契约：8 项硬条件（任何底座要被 CTRL 收编都得提供）

1. **身份**：唯一 ID + manifest（名称/图标/版本/能力声明）
2. **调用协议**：input/output schema，是否支持 streaming
3. **认证**：声明凭证类型（none / API key / OAuth / system 钥匙串），由 CTRL 统一保管
4. **生命周期**：启动 / 停止 / 健康检查 / 资源限制 / 沙盒边界
5. **状态机**：ready / busy / cooling-down / error / quota-exhausted
6. **事件流**：进度、日志、Frame 上报（接回 §4 八条 lane）
7. **权限边界**：用户授权的资源域（哪些文件/哪些 quota），可撤回
8. **可序列化**：整个底座的"接入声明"能被打包、签名、分发——这是导出新 app 的前提

**契约分层**：
- **Tier-A 标准底座**：完全实现 1-8，可被打包导出（MCP / 自家 SDK 写的）
- **Tier-B 包装底座**：只实现 1-5（HTTP/REST 类），导出时只能内嵌"调用记录"而非可重放运行
- **Tier-C 影子底座**：只满足 1-3（本地 CLI、URL scheme），CTRL 给它套一层 manifest，仅在 Mac 内可用

### 14.4 硬件底座 7 字段（每层 tier 出 app 时 manifest 必须填）

1. **输入**：触屏 / 语音 / 物理键 / 笔 / 凝视 / 手势——决定 keycap 触发方式
2. **屏幕预算**：尺寸 + 单帽最小可读区——决定一屏几帽
3. **算力**：本地能不能跑 LLM？iPhone 16 + 起 Apple Foundation Models 可，watch 不可，Rabbit 看模式
4. **联网假设**：离线能跑哪些帽（决定 Tier-A/B/C 底座的可移植性）
5. **后台权限**：能否常驻 / 收推送 / 监听位置——决定 Frame 流是否成立
6. **安装机制**：App Store / sideload / 原子化 / 小程序 / OTA 固件烧录——决定分发成本
7. **凭证 / 计费通道**：iCloud Keychain / Google / 华为账号 / 商店内购 / 直连——决定能否打通用户

### 14.5 移动工作区 → 新 app → 客户终端（导出链路）

```
键帽群组（一组 keycaps + 状态 + 配方）
   │
   ▼
工作区 manifest（引用了哪些底座/权限/UI 形式）
   │
   ▼ export
轻量 app pack（.ctrl-app，类似 PWA manifest + 资源）
   │
   ▼ 运行容器
客户终端（mobile host / web host / 嵌入到对方系统）
```

**移动 host 必须具备**：
- 能解析 manifest 和重放 Tier-A 底座
- 对 Tier-B 底座：内置一个 HTTP 客户端 + 凭证迁移协议
- 对 Tier-C 底座：直接拒绝或回 fallback 到 CTRL 主机
- UI 接口：把 keycap 群组按 manifest 的"形态约束"重排（手机竖屏 = 上下分屏，不再是键盘）

### 14.6 判断（不全做，选 hero target）

- **最对路：T4 物理孪生（Stream Deck / 自制键盘）** `[推论]`
  CTRL 概念离硬件最近的形态。买 Stream Deck → CTRL 把工作区"烧"成一组按键映射 → 物理按下 = keycap 触发。**几乎不需要新发明，市场已经验证**。
  风险：Elgato 是 Corsair 子公司、生态闭，但有第三方 SDK 和开源替代（QMK + 小屏）。

- **最现实：T1 iPhone via App Intents + Shortcuts + Action Button** `[推论]`
  不做完整 native app，把 keycap 群组导出成 App Intents 包 + Shortcuts → 长按 Action Button / Siri / Spotlight 触发。**研发投入最小，覆盖人群最大**。
  iPhone 16 Pro 的 Camera Control + Action Button + Apple Foundation Models = iPhone 端最像 CTRL 的硬件组合。

- **最有想象力但最不稳：T5 AI 原生硬件** `[需验证]`
  Rabbit/Humane 全在找"应用形态空缺"——CTRL 的 manifest+配方可能是它们缺的内容生态。但这些设备命悬一线，下注要小。
  Vision Pro 的"空间 keycap"是 wildcard，2026 末轻量眼镜出来前不算主战场。

- **最深但最重：T6 B 端 / 车机 / 工业** `[已锁定 = Phase 4]`
  对应 §5 老板线和 ERP 对接。**收银机/工厂屏 = 客户终端最具体的形态**——老板买 CTRL 配置一次，每个店员设备拿到的是同一个 manifest 衍生的瘦客户端。
  风险：行业认证、销售周期长，不适合 Phase 1。

- **几乎跳过：T3 Watch** `[已锁定 = 不做]`
  一帽体验差，做了用户也不买账。

### 14.7 Phase 重排建议（接 §9）

- **Phase 1（Mac 收敛阶段）**：硬件底座挂零，软件底座先收敛 Tier-A（MCP）+ Tier-C（本地 CLI / URL scheme）两类，Tier-B 拿 1-2 个云 LLM 做样本
- **Phase 2（轻外延）**：T1 iPhone Shortcuts / App Intents 包导出 + T4 Stream Deck 映射器（这两个研发量都 < 1 周）
- **Phase 3（差异化）**：二选一——T2 鸿蒙原子化服务（赌国内市场）或 T5 一款 AI 硬件适配（赌差异化）
- **Phase 4（B 端）**：T6 工业终端，由真客户拉动，不主动投入

### 14.8 待决策（追加进 §10）

- **14.8.1 客户终端是装我们的 host，还是吐出独立 IPA/APK？** 前者轻、后者重但商业价值高
- **14.8.2 凭证如何迁移？** 全在客户端、CTRL 当中介代理调用、还是按底座类型分流
- **14.8.3 .ctrl-app 包格式** —— 是否复用 PWA manifest，还是定义私有 schema
- **14.8.4 物理孪生的优先硬件** —— Stream Deck（生态成熟但闭）vs 开源 QMK + 小屏（自由但要自己卖）

---

## 附录 A：术语表

- **键帽（keycap）**：CTRL 的最小可调用单元。一个键帽 = 一个文件 = 一个能力
- **底座（socket）**：键帽接入 CTRL 的统一接口规范
- **显示屏（display）**：workspace 作为通用 Frame 渲染器的角色
- **Frame**：键帽吐给 workspace 的最小渲染单元（text/image/form/...）
- **Vault**：本地存储所有键帽 + 数据 + 配置的目录
- **终端（terminal）**：和 AI 对话锻造新键帽的特殊键帽
- **蒸馏（distill）**：把"我"或"专家"或"风格"压缩成 prompt / few-shot / RAG / LoRA
- **管线（pipeline / lane）**：CTRL 承接的特定用户段 × 用例分组
- **Publisher**：键帽的发布方（个人或机构），可数字签名以建立信任
- **软件底座（software socket）**：能产生 keycap 的 runtime（MCP/HTTP/CLI/agent 框架等 8 类，见 §14.1）
- **硬件底座（hardware socket）**：keycap 投射的物理终端（移动/可穿戴/物理孪生/AI 硬件/B 端，6 tier，见 §14.2）
- **底座契约（socket contract）**：8 项硬条件（身份/调用/认证/生命周期/状态机/事件流/权限/可序列化），软硬共享，见 §14.3
- **.ctrl-app**：工作区导出的轻量 app pack，含 manifest + 资源，可被移动 host 重放

## 附录 B：被否定/搁置的想法（避免来回纠结）

- ❌ 内置 OAuth 解 ChatGPT 登录 → 大厂故意不给，结构性死局
- ❌ 一上来做账号系统 → 商业延后，先验证价值
- ❌ 一上来做 marketplace → 协议优先，商业是上层
- ❌ 模仿飞书做 AI workstation → 太重，做不过
- ❌ 模仿 Obsidian 做完整 PKM → 太重，做不过
- ❌ Phase 1 闷头做 8 个 features → 应该做 1 个协议 + 5 个验证样本
- ❌ "BYOK 优先" 作为商业策略 → 实际是 "first-run 必须零配置" 的 UX 要求
- ❌ 自己写所有键帽 → 不可能也不应该；CTRL 是 runtime，不是内容
