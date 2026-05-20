# CTRL System State (live)

> 团队同步用单页。任何窗口（Zeus / Athena / Hephaestus / bao）查"现在系统跑了啥"先看这页。
> 不是 ADR，不是 spec——是**当前事实快照**，可随时被覆盖。
> 维护：Zeus（who changes infra），所有人可读可补。
> 最后更新：2026-05-17

---

## 1. 进程 / 服务（本地 Mac）

| 服务 | 端口 | 跑在 | 状态 |
|-----|-----|-----|------|
| Vite dev (Irisy PWA) | 5173 | localhost | ✅ active（Athena 在用） |
| claude-cli-shim | 8787 | localhost | ✅ active（Irisy 依赖），代码在 `packages/ctrl-claude-shim/` |
| 本地 Hermes daemon | — | — | ❌ 未装（之前卸过） |

启动 shim：
```bash
cd packages/ctrl-claude-shim
node --experimental-strip-types src/server.ts
# 或 npm start
```

---

## 2. AWS Lightsail Tokyo Server

- 公网 IPv4: **52.196.27.37**
- 公网 IPv6: 2406:da14:18a0:8000:642b:479f:37db:5c38
- DNS: **hermes.ctrlapplab.com** → 上面 IP（CF DNS only, gray cloud）
- TLS: Let's Encrypt 自动续期（Caddy）

SSH（key 在 Mac 本地 `~/.ssh/lightsail-tokyo.pem`）：
```bash
ssh -i ~/.ssh/lightsail-tokyo.pem ubuntu@52.196.27.37
```

### Server 现跑的服务

| 服务 | 端口 | 用户 | 进程 | 状态 |
|-----|-----|------|-----|------|
| Postgres 17 + pgvector 0.8.2 | 5432 (localhost) | `postgres` | systemd | ✅ active |
| ctrl-mcp (Hono + Drizzle) | 9000 | `ubuntu` | nohup tsx | ✅ active（spike 期间手起的，无 systemd unit）|
| Mem0 wrapper (FastAPI) | 9100 (localhost) | `hermes` | nohup python | ✅ active（懒加载，需 embedder 配置才能真用） |
| Caddy（反代 → 9119） | 80, 443 | `caddy` | systemd | ✅ active |
| Hermes daemon | 9119 | `hermes` | systemd `hermes.service` | ❌ inactive（多种 daemon 模式都有 bug，Athena 待选可用模式） |
| fail2ban / unattended-upgrades / ufw | — | — | systemd | ✅ active |

### Server 文件位置

```
/opt/hermes/venv/             Hermes Python venv（hermes user）
/opt/mem0/venv/               Mem0 Python venv（hermes user）
/opt/mem0/src/server.py       Mem0 FastAPI wrapper（spike 写的）
/opt/mem0/src/embed.py        fastembed 嵌入脚本（spike 用）
/opt/ctrl-mcp/                ctrl-mcp Node 项目（spike 写的，需迁回仓库）
/etc/systemd/system/hermes.service
/etc/caddy/Caddyfile
/var/lib/hermes/.hermes/.env  Hermes 配置 .env（API key 放这）
/var/lib/hermes/.hermes/      Hermes home（profile / sessions / SQLite）
```

### DB credentials (dev only)

```
host=127.0.0.1
db=ctrl
user=ctrl_app
password=CHANGEME_dev_only
```

### Spike 留下的现成数据

`decisions` 表里 64 行已嵌入 + HNSW 索引；3 个测试 tenant（alice / bob / carol）。

---

## 3. ADR / Decision 现状（按角色）

| ID | 谁拥有 | 状态 |
|---|------|------|
| 001 System Architecture | zeus | Accepted (partial supersede) |
| 002 PWA Pivot | zeus | Accepted (partial supersede) |
| 003 Multi-device Mesh | zeus | Accepted (spike pending) |
| 007 vodozemac | zeus | Proposed |
| **010 键帽 = MCP** | **hephaestus 决策 + zeus 落档** | TODO |
| **005 LLM provider catalog** | **zeus** | TODO |
| **008 部署架构（AWS Tokyo + CF）** | **zeus** | TODO（实施已完成，文档未写） |
| **015 云端记忆栈 + 多租户** | **athena**（属 Hermes 范畴） | TODO |
| **011 多角色 Copilot persona** | **athena** | TODO |

---

## 4. 角色 + 范畴（locked）

| 角色 | 拥有 |
|------|------|
| **bao** | 唯一 Accepter，商业决策，产品方向 |
| **Zeus** | 底座（kernel + Tauri shell + ADR governance）+ LLM 适配（shim、provider catalog）+ 工具（MCP、adapter）+ 原材料（AI providers）+ 前端基建（PWA stack）+ server 裸基础设施 |
| **Athena** | Copilot 产品 + Irisy persona + Hermes 系统使用 + **云端记忆栈架构** + 多 persona 设计 |
| **Hephaestus** | **当前暂停** 自造键帽；做键帽集成调研（Zeus 协作） |

未来 persona（Athena 计划，未启用）：Janus (v1.1 集成专家) / Talos / Mnemosyne

---

## 5. v1 关键事实

- Irisy v1 = PWA → Tauri → Zeus shim → claude（**没有 Hermes**）
- 键帽协议 = **MCP（B 方案）**，对外 MCP server 对内 actor，16 starter 包成 builtin MCP server（待 ADR-010）
- Memory stack（Postgres + pgvector + Mem0 + olym MCP）= 已 spike 验证（2GB Lightsail 充足）

---

## 6. 等待中的决策

| 待决策 | 由谁定 |
|------|------|
| Janus 是独立 persona（A）还是合并进 Irisy（B） | Athena × bao |
| 16 starter keycap 具体清单 | Hephaestus + bao |
| Hermes 系统 v1.1 用还是另选 | Athena 在 v1.1 评估时定 |

---

## 7. 修改本页规则

1. 改前看一眼最后更新时间（避免覆盖别人的实时事实）
2. 简短追加；旧事实写"~~已废~~"而不是直接删
3. 自己 commit 别 force（这页是低冲突文档）
