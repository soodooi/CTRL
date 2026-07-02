---
title: 飞书全端点面 × CTRL 建设规划图 (governing)
kind: plan
created_at: 2026-07-02
owner: bao
author: claude (真调研: 飞书官方 2,500+ 端点核实 + Bitable 37 端点精确 + lark-openapi-mcp preset 覆盖)
purpose: bao「认真分析飞书所有端点，尽量将所有端点都建立。有问题随时讨论」
serves: CTRL = 本地 AI-native 飞书 (feedback-ctrl-is-feishu-not-integrate-feishu) 的端点级落地规划
related:
  - "[[feishu-mcp-research]]"
  - "[[capability-pack-map]]"
  - "[[smart-table-grist-parity-plan]]"
  - 002-substrate.md   # §14 describe/query/produce
  - 006-cross-cutting.md # §5 定位 + IM-reach
---

# 飞书全端点面 × CTRL 建设规划图

> **系统设计先行**：动手建端点前先把「飞书有什么 / CTRL 建哪些 / 哪些结构上不该建」想清楚。不逐个 debug 式凑。
> 真相：飞书开放平台 **2,500+ 服务端 API 端点**，横跨 ~20 产品域。全建 = Quicker-8000 反模式 (CLAUDE.md「What CTRL is NOT」禁)。**正确解 = 按「CTRL 是不是这个产品」分桶，只建 CTRL 原生 IS 的那几个产品的全端点。**

## 分桶原则（唯一判据）

对每个飞书产品问一句：**CTRL 是不是它 / 能不能本地单用户成为它？**
- **A 桶 = CTRL 原生 IS（数据/生产力产品）** → **建它的全部端点**（§14 describe/query/produce over 本地 plain-text，经 :17873 gate）。这才是「实现飞书这块」。
- **B 桶 = 触达（reach）** → **不重造，经 hermes 网关集成**（你没法本地成为「别人在的 IM」）。
- **C 桶 = 结构上不是 CTRL（企业云/多租户）** → **不建**（本地单用户 + 无账号 + 无组织，做不了也不该做；违定位）。

## 全产品 × 分桶 × 端点量 × CTRL 现状

| 飞书产品 | 端点量(估) | 桶 | CTRL 对应 | 现状 |
|---|---|---|---|---|
| **多维表格 Base/Bitable** | ~37（精确） | **A** | **Smart-table**（§14 RecordSource） | 🟡 ~20%（核心 CRUD 通） |
| **电子表格 Sheets** | ~40 | **A** | Smart-table / 表格 | ⬜ 未建 |
| **云文档 Docx/Docs** | ~50 | **A** | **Notes / vault**（plain-text） | 🟡 读/写 vault 有，块级 API 未 §14 化 |
| **知识库 Wiki** | ~20 | **A** | vault 文件夹 + backlink | 🟡 vault 覆盖 |
| **云盘 Drive** | ~40 | **A** | vault 文件 | 🟡 vault 覆盖 |
| **任务 Task** | ~20 | **A** | **LifeOS Task**（§14 task source 已建!） | ✅ describe/query/create/update |
| **日历 Calendar** | ~30 | **A** | LifeOS Calendar | ⬜ 计划中 |
| **消息 IM/Messenger** | ~150 | **B** | hermes 网关触达 | ⬜ 网关接线待 |
| **邮件 Mail** | ~40 | **B** | hermes 网关 / IMAP connector | ⬜ |
| **通讯录 Contacts（组织架构）** | ~80 | **C** | — | ⛔ 非目标（组织/多租户） |
| **审批 Approval（多人流程）** | ~40 | **C** | — | ⛔ 非目标（多人工作流=云） |
| **视频会议 VC/Meeting** | ~60 | **C** | — | ⛔ 非目标（音视频基建） |
| **考勤 Attendance** | ~40 | **C** | — | ⛔ 非目标（企业 HR） |
| **人事 CoreHR/HR** | ~300+ | **C** | — | ⛔ 非目标（企业 HR，最大块） |
| **管理后台 Admin/权限/角色** | ~100+ | **C** | — | ⛔ 非目标（无账号/无组织） |
| **其它**（打卡/OKR/招聘/直播/AnyCross/…） | ~1000+ | **C** | — | ⛔ 非目标 |

**估算**（联网核实总量 + 分产品估）：
- **A 桶（CTRL 建全端点）≈ 6 产品 / ~240 端点** = 全飞书的 **~10%**，但是**生产力/数据核心**。
- **B 桶（集成非重造）≈ 2 产品 / ~190 端点**。
- **C 桶（不建，结构上不是 CTRL）≈ 12+ 产品 / ~2000+ 端点** = 全飞书的 **~80%**，是**企业超级 app 的组织/HR/云基建**。

## 结论（认真分析后的诚实判断）

**「把飞书所有 2,500 端点都建立」不该字面执行** —— 其中 ~80% 是 CTRL 结构上做不了、也不该做的企业云功能（HR/考勤/审批/组织通讯录/会议/管理后台）。本地单用户 + 无账号 + plain-text 的 CTRL 去建这些 = 既不可能（没有多租户/组织实体）也违定位（「不做长尾 clone」「不做 SaaS multi-tenant」）。

**该建的 = A 桶 6 产品的全端点**（Bitable/Sheets/Docs/Wiki/Drive/Task/Calendar），全部 §14 化 over 本地 plain-text，Irisy 可调、经 gate。这 ~240 端点建齐 = **CTRL 真成为「本地 AI-native 飞书生产力核心」**。B 桶走网关集成。C 桶明确 out。

## Build 计划（A 桶，系统化，逐产品 dev-loop）

1. **Base/Bitable 补全**（当前，~20%→100%）：update_field · table delete · **batch record ops** · **建关系列(Reference/Lookup/Rollup)经 gate** · view list/update/delete · record get/batch。
2. **Task 补全**（已有 §14 source，补 batch/reminder/member 对齐飞书 Task）。
3. **Calendar**（§14 化：event describe/query/produce + freebusy）。
4. **Docs/Sheets/Drive/Wiki**（vault §14 化补齐：块级 produce / sheet cell 操作 / 文件 CRUD）。

每片：§14 produce 过 gate + review + markdown/plain-text round-trip + 测试。

## 待 bao 拍的边界问题（系统设计的关键决策）

1. **C 桶确认 out?** HR/考勤/审批/组织通讯录/会议/管理后台 —— 我判**结构上不是 CTRL、不建**。你同意这条边界，还是有哪个你想要（要的话怎么本地化？多人审批/组织架构在单用户本地无实体）？
2. **B 桶（IM/Mail）** = 走 hermes 网关**触达**（不重造），对吗？
3. **A 桶优先序** = 先补全 Bitable 到 100%，还是横向先把 6 产品各起个骨架？我建议**先纵向补全 Bitable**（已 20%，最近价值），再横向。
