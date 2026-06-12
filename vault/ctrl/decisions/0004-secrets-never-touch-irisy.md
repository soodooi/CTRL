# 0004 — Secret(token / key)永不经过 Irisy / LLM

> 状态:锁定(安全红线) · bao 2026-06-12

## 背景
bao 问「token 适合在对话框给 Irisy 吗?」—— 点出一条安全红线。设计「场景化
一键装」(配 CF token 这类)时必须先把它钉死。

## 决策
**任何 secret(API token / key / 密码)永不进入 Irisy / LLM 的对话上下文。**
- token 打进对话框 = 进 LLM 上下文 = 离开本机(发 provider)+ 留对话历史 +
  可能云同步 → 泄露。
- 违背 CTRL 铁律:secret 只进 macOS Keychain,CTRL 团队 server 不在 token
  流量里。

## 机制
```
你键入 token
   │  工作区原生 secret 框(●●●● 遮挡)
   ▼
本地 kernel ──直写──▶ macOS Keychain
   │  用时:kernel 读出 → 注入子进程环境(如 wrangler)
   ▼
Irisy / LLM 全程只见布尔「token 已配 ✓」,永远拿不到值
```

## 原则
- Irisy 负责**引导**(「去这拿 token →」),不碰**值**。
- 「AI 是 pipe,但 secret 不流经 pipe」。
- 「透明 by drill-down」的**唯一例外**:别的 raw 都能看,唯独 secret 对 AI
  不透明(保护用户)。

关联 [[quicker]](场景化一键装)+ ProviderHub(友好填 key 进 keychain)+
[[open-questions]] 场景化一键装一节。
