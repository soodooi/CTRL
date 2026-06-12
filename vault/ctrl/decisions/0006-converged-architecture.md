# 0006 — 收敛架构:Irisy / 功能包 / 知识库 / 三引擎

> 状态:锁定方向 · bao 2026-06-12

## 背景
bao 戳破一个 gap:hermes/kairo/opencode 三引擎**硬编码在 kernel**,不是功能包,
跟功能包定位不一致;且 kairo 跟 vault 概念缠不清。先把整体想透,不再补补丁。

## 一图收敛
```
底座(kernel,永不是功能包): 功能包系统 · provider router(LLM) · Notes(本地 md) · keychain
   ↓ Irisy = 表象,用一个 brain 回复
brain 默认 = provider router(用户配的 Claude/Volc) ← 配了就秒回
brain 可选 = hermes 功能包(长效记忆)            ← 装了+选了才走
   ↓ 一切能力 = 功能包(可装/可卸/可选)
工具: Dev Box / CF Workers …  ·  brain: hermes  ·  notes: kairo  ·  coding: opencode
   ↓ 知识库 = 底座 + 功能包 + Irisy 的组合(不是单个功能包)
Notes(本地 md 存) + kairo(看) + Irisy recall(问·RAG) + supply(派生 AGENTS.md 喂 coding agent)
```

## 三句锁死
1. **Irisy 是表象**,用 brain 回复 —— 默认走 provider router(配的 Claude,秒回),
   hermes 只是可选 brain 功能包(没装就用 Claude)。
2. **三引擎 = 三类功能包**(hermes=brain / kairo=notes / opencode=coding),跟
   Dev Box 一个模型,可装可卸,**不再硬编码在 kernel**。
3. **知识库不是一个功能包**,是 **Notes 底座 + kairo(看) + Irisy recall(问) +
   supply(喂)** 的组合。

## 概念厘清(bao:kairo 跟 vault 分不清)
- **「vault」这词废弃**(bao 2026-06-09 "我没有 vault 这个概念,叫 Notes")。
- **Notes** = 本地 markdown 文件夹(数据本身,你拥有,vim 能开)。
- **kairo** = 看 Notes 的**一个可选查看器**(SilverBullet);CTRL **内置查看器**
  (NotesApp)默认够用,kairo 不是必须。数据 = Notes,工具看它,内置就行。

## 现在做 vs 以后(目前版本能力有限,bao)
| 现在 | 以后(能力上去) |
|---|---|
| Irisy 走 provider router(Claude 秒回)— [[889d104]] HERMES_FIRST=false | hermes 做成 brain 功能包 |
| Notes 默认内置 NotesApp,不依赖 kairo — [[b547bc3]] | kairo 做成可选 notes 功能包 |
| 功能包能装能用(Dev Box,Discover) | RAG recall / supply 派生 AGENTS.md / opencode 功能包化 |

## 待办
- [ ] 清 NotesApp 里残留的 "Vault" 字样 → "Notes"
- [ ] amend ADR-002 §1(现在还写 hermes 抢路 / kairo 嵌入)对齐本决策
- [ ] 三引擎功能包化(brain/notes/coding,用 manifest 现成的 target:brain)

关联 [[0003-ctrl-is-modular-intent-platform]] + [[0005-feature-pack]]。
