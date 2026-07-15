---
title: 0005 — 知识库架构定稿（全网调研后锁定）
tags: [strategy, knowledge-base, architecture, locked]
updated: 2026-06-13
---

# 0005 — 知识库架构定稿

> bao 2026-06-13：先确定知识库架构。全网调研三路（folder/tag/link 理论 + 产品实测 + 本地优先信任哲学），抄最好的作业，不猜测。
> 锚点：[[0004-kb-architecture]]（地基 + 四能力闭环）· [[0002-north-star-anti-trae]]（傻瓜测试）

## 核心问题（bao 提出）

不管用户文件存哪，能不能靠 tag/元数据/索引形成一个知识库架构？还是一定要把文件移到一个文件夹？

## 调研结论：抄最好的作业 = DEVONthink Index + macOS Smart Folder

全网实测，**只有两家做到「文件留原地、不搬、靠索引/查询组织成知识库」**，机制不同，CTRL 两者合一抄：

| 抄谁 | 抄什么 | 来源 |
|---|---|---|
| **DEVONthink Index 模式** | 库只存文件的**引用（路径 + 元数据）**，真文件留磁盘原地，不导入不复制；Finder 和产品里都能管 | discourse.devontechnologies.com（Index vs Import） |
| **macOS Smart Folder** | 组织 = **保存的查询（saved query = 虚拟文件夹）**，文件零移动，一份内容可出现在多个视图 | support.apple.com（Smart Folder）+ en.wikipedia.org（virtual folder） |

理论佐证（folder vs tag vs link）：
- folder 单维度，越用越乱（一个文件只能放一个文件夹）。
- 纯自由 tag 规模化会爆炸 / 不一致 / 单点故障（忘打一个标签整个系统失效）。
- 2024-26 趋势转向 **objects + properties + 双链**（Tana/Anytype/Capacities），谁都不再拿 folder 当主轴。
- 「位置无关」组织是成熟 OS 级技术（virtual folder / saved search），但**虚拟文件夹不能承载写入** → 新建内容仍需一个真实落点。

## 锁定的组织模型

1. **数据模型 = in-place 索引（抄 DEVONthink Index）**：SQLite 索引只存文件的**引用**（路径 + 稳定 ID + frontmatter + tags + FTS5），**文件留磁盘原地，不搬不导入**。索引是可丢弃的派生 —— 本地是 truth，索引是 mirror（对齐当前 Kiro Design Philosophy，见 `.kiro/steering/development-philosophy.md`）。
2. **修掉 DEVONthink 的断链缺陷**：不拿绝对路径当唯一身份（DEVONthink 在 Finder 移动文件就断链）。给每个文件一个**稳定 ID**（frontmatter `id:` 或内容/inode 指纹），路径只是「当前位置」字段；文件移动用 FS watcher + 指纹**自动重关联**。
3. **组织/呈现 = saved query 当虚拟文件夹（抄 Smart Folder）**：一条 query = 一行 SQLite WHERE（tag / 路径 glob / frontmatter 字段 / FTS5 全文），存成 vault 里一个普通 `.md`（frontmatter 描述查询）——可 git diff、vim 编辑（过 vim test）。打开时实时跑出结果。组织从「搬文件/建文件夹树」升级为「零移动、多重归属」。
4. **folder 只当物理落点**（浅层），**不当主组织轴**；禁止用深层嵌套文件夹表达分类。
5. **properties（frontmatter key-value）> 自由 tag**：多维组织靠 properties + query，不靠用户手建 tag 体系。tag 若用：扁平、少量、功能性（Forte 原则），不嵌套。
6. **双链（wikilink）= 可选关联增益**，不作找回的唯一路径（避免 link 派单点故障）。
7. **不强迫搬文件到一个 vault**：用户文件可留原地被索引（只读纳管）；**新建内容默认落到一个「家」目录**（可改）—— 因为虚拟文件夹不能承载写入。

## 落地分期

- **v1（现状可用）**：单一默认 vault（`~/Documents/CTRL`，已有 FTS5 + 语义 + backlink/tag scanner）。大多数用户是新人、无现成库（bao：不是所有人都有 Obsidian 库），单 vault 够用。
- **v1.x（差异化卖点）**：**索引多个外部文件夹**（文件留原地，抄 DEVONthink Index）+ 稳定 ID + FS watcher + saved query 虚拟文件夹。这才完整实现「不管存哪都能组织成知识库」。

## 信任哲学（架构的一部分，bao 钦定：宣扬「不碰你的数据、本地存储、让你放心」）

CTRL 的客观事实命中所有最可信模式（本地 md / 不进口数据 / AI 是 pipe / BYOK / mesh E2EE）。把技术事实翻成普通人秒懂的承诺，用「技术后果 + 可验证」而非「相信我」。

5 条做法 + slogan（均有出处）：
1. **无导出 = 最强信任**：「没有导出按钮，因为你的文件从没离开过你。」/「卸载 CTRL，你的笔记还在 —— 它们一直都是普通 markdown。」（对标 Ink & Switch "You own your data, in spite of the cloud"）
2. **AI 训练焦虑的正面回答 + 可见开关**：每次 AI 处理处明文 + 开关：「This text was processed by [your provider]. CTRL never stores it, never trains on it.」（行业共识：口头不训练不够，要合同 + 产品里都看得见 —— Kalisa）
3. **零知识用「技术后果」表达**：「Your keys live in your Keychain. We don't have them — we can't read your sync, and neither can anyone else.」（对标 Anytype "No one at Anytype can decrypt your data"）
4. **逐条隐私声明（像 Obsidian 那样列）**：「No CTRL account. No telemetry. No CTRL server in your data path. Your identity is a key in your own Keychain — we don't even know you exist.」
5. **商业模式讲在明面**：「We sell tools, not your data.」（对标 Obsidian「靠订阅/license，不靠数据」）

反面教材（为什么用户不放心）：Evernote 2016（员工可读笔记、默认开无法退出，一天撤回）、Otter.ai 2025 集体诉讼（录非用户对话训练模型）、Zoom/LinkedIn/X 默认 opt-in 训练。**共同教训：用户最恨「默认开 + 藏 ToS 里 + 事后才发现」。**

## 待 bao 决策（不猜测）

- 是否开源 / 第三方审计 kernel + 加密部分？这是 Standard Notes 级信任锚点，但 repo 现为 private —— 战略 trade-off，未决。

## 现状对照

- ✅ 已有：单 vault + FTS5 全文 + 语义嵌入 + backlink/tag scanner + frontmatter + wikilink。
- ✗ 待做（v1.x）：索引外部文件夹（in-place）、稳定 ID、FS watcher、saved query 虚拟文件夹、AI 处理处的「不存储/不训练」明文+开关、隐私页逐条声明。
