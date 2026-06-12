# 调研:竞品对一般用户的痛点 (2026-06-11)

调研 hermes / OpenClaw / WorkBuddy(腾讯) / CodeBuddy / Codex / 豆包+扣子,找对**一般用户(非技术 solo / OPC)**的痛点。7 个共性痛点,每个对位一个 CTRL 设计:

1. **provider/key 配置是最差 onboarding** — hermes 交互 TTY + Claude Pro/Max 不支持;openclaw 手编 JSON;豆包/coze BYOK 要第三方 relay。→ CTRL:默认 CF Workers AI(零 key)+ ProviderHub 友好配置。
2. **「本地/隐私」人人宣称、没人干净交付** — openclaw 默认 full host access;codex/codebuddy 云端跑;豆包**真实泄露过银行余额** + 无独立审计。→ CTRL:真 local=truth + keychain 身份 + 无账号。
3. **自托管/daemon/容器是分水岭** — openclaw(Node24+systemd)、coze studio(Docker+DevOps)。→ CTRL:Tauri 单装,无 daemon。
4. **功能过载(厂商自认)** — hermes 文档自己说「先跑通一个 chat 再加 gateway/cron/skills」。→ CTRL:one-shot atomic mcps。
5. **安全判断甩给用户** — openclaw 要新手懂 "untrusted input/sandbox";workbuddy 文件夹授权是隐形陷阱。→ CTRL:write-op review gate + drill-down 透明。
6. **coding 工具对非技术用户根本错配** — codebuddy/codex 产出代码(读不懂、验证不了)、artifact 是 repo/PR;solo 没 repo 可指。→ CTRL:drill-down(不必读代码)+ 业务任务(local MCP 接 CRM/ERP)。
7. **封闭生态 + 区域/账号/计费墙** — 豆包/coze 锁模型 + 区域墙 + metered credits;codebuddy 要 Tencent 账号 + WeChat 计费 + 中国/国际分裂;workbuddy 只接 WeCom/飞书,不接 Slack/Teams。→ CTRL:通用/开放(任意 BYOK)。

**关键发现**:`work-buddy.ai`(MIT、local-first、写操作 approval-gated)是**理念上最接近 CTRL 的竞品** —— 印证方向;但要 Python service + Claude Code 订阅(开发者设置),CTRL 的 Tauri 单装胜。

**结论**:这 6-7 个痛点共同画出一个空位 = **真本地、零配置门槛、不封闭、给非技术 solo 用业务任务(非 coding)的 AI workbench**。竞品要么是开发者工具,要么是封闭云花园,要么理念对但要开发者设置。

> 完整 sources 见 memory `project-ctrl-competitor-pain-points`(hermes/openclaw/workbuddy/codebuddy/codex/doubao-coze 三路调研报告)。
