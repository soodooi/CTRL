# CTRL 键帽 Roadmap

**Owner**: Hephaestus（键帽生态负责人）
**Last updated**: 2026-05-16（由 zeus 抽自 ADR-001 §10）
**Authoritative**：本文档；ADR-001 §10 已 deprecated（保留作历史）

⚠️ **重要状态变更**：原 ADR-001 §10 写 v1.0 = 15 内置键帽。实际已砍至 **v1.0 = 8**，决策在 `.olym/steering/ctrl-strategy.md` 发生，但**未走 ADR 流程**。**待 ADR-004（v1.0 键帽 scope 砍量）补登决策依据**。本文档先记录现状。

---

## v1.0 = 8 键帽（实际）

### P0（5 个，launch 必交付）
1. **Clipboard 增强**（AI 改写粘贴）
2. **AI OCR**（GPT-4V 直读）
3. **AI 翻译**（Claude / Qwen 多语言）
4. **AI 文本处理**（NL 指令：改正式 / 摘要 / 转 markdown）
5. **Ctrl Chat**（产品入口键帽）

### v1.0 追加（3 个）
6. **AI Snippet / 文本扩展**（Espanso 路数 + AI 模板）
7. **代码片段 + AI 解释/改写**（CTRL 用户刚需）
8. **邮件 / 客户回复 AI 草稿**（中文 OPC 高频）

---

## v1.1 候选

- 窗口管理（snap / align / 全屏）
- AI PDF（总结 / 表格提取 / 翻译）
- 公式识别 LaTeX（GPT-4V）
- EVER 智识（智能识别选中文本类型 → 建议操作）
- 屏幕录制 + AI 字幕（Whisper）
- 会议纪要 AI（Granola 路数，ST-SS-native）
- 跨设备同步（剪贴板 / 历史 / preset，CRDT）—— 实际由 ADR-003 mesh 提供基座

---

## v1.2+ / 长尾

由社区创作者通过 manifest 提交，CTRL 不再亲手做内置。`ctrl-market` 上线后开始接 PR。

---

## 决策依据（待 ADR-004 补登）

砍量原因（推测，待 bao 确认）：
- 15 个全做完时间不可控
- 5 个 P0 足够验证产品形态
- 创作者经济激励长尾，没必要全做内置

**Hephaestus 启动后**：
1. 验证这 8 个的当前实现状态（哪些已开工、哪些没动）
2. 对照用户访谈和实际使用频率验证优先级
3. 给 zeus 提 ADR-004 起草建议（决策依据 + 量化指标）

---

## 历史

抽自 ADR-001 §10 的原 15 项清单：

| 原顺序 | 名称 | 现状 |
|--------|------|------|
| 1 | Clipboard 增强 | ✅ v1.0 P0 |
| 2 | AI OCR | ✅ v1.0 P0 |
| 3 | AI 翻译 | ✅ v1.0 P0 |
| 4 | AI 文本处理 | ✅ v1.0 P0 |
| 5 | Ctrl Chat | ✅ v1.0 P0 |
| 6 | 窗口管理 | ➡️ v1.1 |
| 7 | AI PDF | ➡️ v1.1 |
| 8 | 公式识别 LaTeX | ➡️ v1.1 |
| 9 | EVER 智识 | ➡️ v1.1 |
| 10 | 屏幕录制 + AI 字幕 | ➡️ v1.1 |
| 11 | AI Snippet / 文本扩展 | ✅ v1.0 |
| 12 | 代码片段 + AI 解释/改写 | ✅ v1.0 |
| 13 | 邮件 / 客户回复 AI 草稿 | ✅ v1.0 |
| 14 | 会议纪要 AI | ➡️ v1.1 |
| 15 | 跨设备同步 | ➡️ 由 ADR-003 mesh 基座提供，键帽形态待定 |
