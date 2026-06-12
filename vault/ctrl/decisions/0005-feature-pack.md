# 0005 — 「功能包」是用户面正式术语 + 形式方案

> 状态:锁定术语 + 形式草案 · bao 2026-06-12

## 术语决策
**「功能包」= 用户面正式叫法。**
- 用户看到 / 说的:「装个功能包」「卸了这个功能包」。
- 技术端底层(代码、manifest):仍是 mcp manifest / bundle —— 用户不接触。
- 对用户不再说黑话「mcp」「keycap」(2026-06-07 keycap→mcp 是**技术端**改名;
  对**用户**统一「功能包」)。后面所有 UI 文案用「功能包」。

## 形式:复用现有 manifest,只加一个轴
CTRL 的 `McpManifest`(`packages/ctrl-mcp-sdk/manifest-schema.ts`)**已覆盖
功能包 ~80%**:

| 功能包要啥 | 现有 manifest 字段 | 状态 |
|---|---|---|
| 引导填 secret → keychain | `config_schema.fields[].kind:'secret'` | ✅ |
| 装资源 / vault 文件 | `cap_asset.files` / `cap_asset.vault.seed` | ✅ |
| 场景动作(deploy/logs…) | `actions[]`(steps) | ✅ |
| 调外部 CLI(wrangler) | `source: cli-wrapper` | ✅ |
| 平台限制 | `platforms` | ✅ |
| keychain 读写权限 | `capabilities.keyring` | ✅ |
| **装工具链(node/wrangler)** | —— | ❌ 缺,新增 `provision` 轴 |

**新增的唯一一轴 `provision`**(装工具链 + 注环境):
```jsonc
"provision": {
  "tools": [
    { "id": "node",     "check": "node --version",
      "install": { "macos":   {"via":"brew",   "pkg":"node"},
                   "windows": {"via":"winget", "pkg":"OpenJS.NodeJS"} } },
    { "id": "wrangler", "check": "wrangler --version",
      "install": { "any": {"via":"npm", "pkg":"wrangler", "global":true} } }
  ],
  "env": { "CLOUDFLARE_API_TOKEN": "{{secret:cf_api_token}}" }  // 值从 keychain 取
}
```

## 装工具:解析顺序(bao 2026-06-12 定:内置下载器为主)
每个 `provision.tools[]` 按顺序解析:
1. **check** 先跑(`wrangler --version`)→ 已装就跳过。
2. 没装 → **CTRL 内置下载器**:从 CTRL 维护的工具源拉预编译二进制到
   `~/.ctrl/tools/<id>/`,加进功能包 env 的 PATH。(跟现有 `~/.ctrl/pi/`、
   `~/.ctrl/agents/kairo/` lazy-install 一脉相承;隔离、不污染系统、卸载即清)
3. 内置下载器没这个工具 / 失败 → **fallback 系统包管理器**(brew / winget / npm,
   读 manifest 的 `install.<os>.via`)。
4. 都不行 → 友好报错 + 引导用户手动。

**需要的底座(一次性建)**:一个 **工具 registry**(工具 id → 各平台预编译
二进制 URL + 校验和),内置下载器按 id 查。这是底座基础设施,不是功能包内容。

## 文件 + 分发
- **文件**:功能包 = 一个 v2 mcp manifest(markdown + JSON frontmatter,可 git
  diff、AI 可生成)。
- **打包**:`.ctrlpack`(= manifest + assets 的 zip bundle),Discover 一键装
  (对齐 Anthropic `.mcpb`)。
- **安装流程**:install → `provision` 装工具(check → install)→ `config_schema`
  引导填 secret 进 keychain → 注 `env` → `actions` 就绪进工作区 → **卸载即清**。

## 示例:「CF Workers 开发」功能包(端到端)
- `config_schema`: `cf_api_token`(secret)。
- `provision.tools`: node, wrangler;`provision.env`: CLOUDFLARE_API_TOKEN ← keychain。
- `actions`: deploy / logs / preview(cli-wrapper → wrangler)。
- `platforms`: macos, windows。

## 决策已齐(bao 2026-06-12 全拍完)
- **装工具**:内置下载器为主,系统包管理器 fallback(见上节)。
- **打包格式**:复用 Anthropic **`.mcpb`**(生态对齐、工具现成,不造轮子)。
- **第一个官方功能包**:**「CF Workers 开发」**(dogfood,ctrl-cloud 自用)。

## 下一步落地(待 bao 定节奏)
1. **进 ADR**:把功能包模型 amend 进 ADR-002 substrate § composition(provision
   轴 + 「功能包」术语 + `.mcpb` + 内置下载器)—— 架构锁点,防漂移。
2. **底座**(一次性):manifest 加 `provision` Zod 轴 → 工具 registry → 内置
   下载器(`~/.ctrl/tools/`)→ provision runner(check→install→注 env)→ `.mcpb`
   安装路径。
3. **第一个功能包**:CF Workers 开发 manifest(node/wrangler + cf_api_token +
   deploy/logs/preview)。
4. **UI**:Discover 找到 + 一键装 + 安装流程(provision 进度 + secret 引导填)。

关联 [[0003-ctrl-is-modular-intent-platform]] + [[0004-secrets-never-touch-irisy]]
+ [[quicker]] + [[opensuse]]。
