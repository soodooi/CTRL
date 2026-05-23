# CTRL first-user setup — bao walkthrough

> Per `feedback_document_setup_flows` 🔒: zeus 写 doc, bao 跟着跑. 不让 bao 现场记 command.
>
> 这份是 first-user 全流程: 装 hermes → 装 CTRL plugin → 启 CTRL.app → 验证 hermes 看见 CTRL tools → 跑通端到端.

---

## 0. Prereqs (检查一次, 30 秒)

```bash
python3 --version      # 需要 3.11+
which brew             # macOS 装 homebrew (你应已有)
```

如果 Python < 3.11: `brew install python@3.13` (现 stable).

---

## 1. 装 pipx (一次性 setup)

`pipx` 是 Python CLI 工具 sandbox 安装器 — 每个 CLI 独立 venv, 不污染 system Python.

```bash
brew install pipx
pipx ensurepath          # 把 ~/.local/bin 加 PATH
# 重开 terminal (或 `source ~/.zshrc`) 让 PATH 生效
```

验证: `which pipx` 应输出 `/opt/homebrew/bin/pipx`.

---

## 2. 装 hermes-agent (3 分钟)

```bash
pipx install hermes-agent
```

完成后, **任意 terminal** 都可跑:

```bash
hermes --version         # 应输出 'Hermes Agent v0.14.0 (...)'
hermes status            # 系统状态概览
```

---

## 3. 装 ctrl-hermes-plugin (本仓库 local editable)

ctrl-hermes-plugin 还没发 PyPI (v0.1 dev). bao 用 local editable install:

```bash
pipx inject hermes-agent /Users/mac/Documents/coding/CTRL/packages/ctrl-hermes-plugin
```

`inject` 把 plugin 装进 hermes 的 venv, 同 process 可见. 验证 plugin 装好:

```bash
hermes plugins list      # 列表应包含 'ctrl' (kind=tool)
hermes tools list | grep ctrl_   # 应看到 ctrl_kernel_status / ctrl_vault_read / ...
```

如果 `ctrl` 不出现: 检查 `~/.hermes/plugins/` 看是否有 ctrl 目录, 或重 `pipx inject`.

---

## 4. 启 CTRL.app (kernel boot)

```bash
cd /Users/mac/Documents/coding/CTRL
npm install              # 一次性 (如果还没装)
npm run tauri dev        # 启 Tauri shell + kernel
```

启动后 logs 应有:

```
kernel::mcp_server listening on http://127.0.0.1:17873/mcp
kernel handshake written for ctrl-hermes-plugin  path=~/.ctrl/state/kernel-handshake.json
```

验证 handshake file:

```bash
cat ~/.ctrl/state/kernel-handshake.json
# 应输出 { "url": "http://127.0.0.1:17873/mcp", "token": "...uuid...", "schema_version": 1 }
```

如果文件不在: kernel 没起 / 端口 17873 被占用. 看 Tauri terminal 输出找 bind 错误.

---

## 5. 配 hermes model (一次性, 用 BYOK)

hermes 要 LLM provider 才能 `chat`. bao 已有 Anthropic API key (在 keychain), 配 hermes 用 Anthropic:

```bash
hermes login anthropic   # 走 OAuth or paste API key
hermes model             # 选 default model, 比如 anthropic/claude-sonnet-4
```

验证:

```bash
hermes chat -q "say hello" -Q   # -Q = quiet 模式, 只输出最终响应
# 应输出 hello world 之类
```

---

## 6. 端到端验证 — hermes 用 CTRL tools

```bash
hermes chat -q "list files in my vault" -Q
```

hermes 内部应:
1. 看到 user query, 选 tool `ctrl_vault_list`
2. plugin handler 读 `~/.ctrl/state/kernel-handshake.json`
3. POST `http://127.0.0.1:17873/mcp` with Bearer token, method=`tools/call`, name=`vault_list`
4. kernel `vault::list` 跑 → 返列表
5. hermes 把结果格式化回 bao

预期输出: 你 vault 里 markdown 文件名 (如果 vault 空, 输出 "(no files)" 之类).

写一条:

```bash
hermes chat -q "write a note: today's progress = CTRL plugin path live" -Q
```

预期: hermes 调 `ctrl_vault_write({ path: 'today.md', body: ... })` → `~/.ctrl/vault/today.md` 出现.

---

## 7. PWA 验证 (mobile 暂不支持远程)

CTRL.app 桌面 PWA 走 Tauri WebView (intra-process invoke), 桌面看 `kernel.status` LED 应绿.

**手机端**: kernel 现 bind `127.0.0.1` loopback, 手机 (即使同 WiFi) **访问不到**. 远程 mobile 需要:
- 短期: kernel LAN bind (`0.0.0.0:17873`) + token + 手机走 LAN IP — 需要 bao 决定是否要现在 ship (跨 ADR-003 scope)
- 长期: mesh + ctrl-relay (ADR-003 + ADR-017, v1.1+)

---

## 8. 常见故障

| 症状 | 原因 | 解 |
|---|---|---|
| `hermes: command not found` | pipx PATH 没生效 | 重开 terminal 或 `source ~/.zshrc` |
| `ctrl` plugin 没出现 | inject 装错 venv | 检查 `pipx environment` + `pipx list` |
| `KernelCallError: FileNotFoundError` | CTRL.app 没起 | 启 CTRL.app, kernel 写 handshake |
| `HTTP 401` | token rotated | plugin auto-retry, 一般自愈 |
| 端口 17873 占用 | 上一次 kernel 没退干净 | `lsof -i :17873` 找进程 kill |
| hermes 装失败 (Python conflict) | brew Python 跟 system Python 冲突 | 用 `pipx install --python /opt/homebrew/bin/python3.13 hermes-agent` 显式 Python |

---

## 9. 完事后清场 (如果想 reset 全流程)

```bash
pipx uninstall hermes-agent          # 清 hermes + plugin
rm -rf ~/.hermes ~/.ctrl/hermes-venv  # 旧 venv 残留
rm ~/.ctrl/state/kernel-handshake.json  # kernel 下次启再写
```

vault `~/.ctrl/vault/` 是 bao 的数据, 不动 (Obsidian 哲学, ADR-015).

---

## Status (zeus 更新这里)

- 2026-05-23: doc 写完. bao 跟着走 1-6 应可端到端跑通; 步 7 mobile 等 LAN/mesh decision.
