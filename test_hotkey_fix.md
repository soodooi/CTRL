# 热键修复测试说明

## 修改内容

1. **移除了冷却期** (`FIRE_COOLDOWN_MS`)
   - 之前：250ms 冷却期防止重复触发
   - 现在：无冷却期，依赖更好的注入事件过滤

2. **添加了热键状态重置**
   - 在窗口显示时调用 `HotkeyController::reset_state()`
   - 清除 `ctrl_pending`、`other_seen`、`ctrl_down_at` 状态
   - 防止窗口显示时的假事件干扰

3. **保持注入事件过滤**
   - 仍然过滤 `LLKHF_INJECTED` 事件
   - 防止 Windows 11 焦点切换时的假 Ctrl 事件

## 预期效果

### 问题修复：
1. **用户关不掉窗口** → 应该能正常关闭
2. **需要点击外部后 Ctrl 才生效** → 应该立即生效

### 可能的新问题：
1. **窗口闪烁**（如果注入事件过滤不够好）
2. **重复触发**（如果用户快速按 Ctrl）

## 测试步骤

1. 启动应用后，按 **Ctrl** 打开窗口
2. 再次按 **Ctrl** 应该立即关闭窗口
3. 重复测试多次，确保稳定性
4. 测试快速按 Ctrl（打开→关闭→打开）

## 如果仍有问题

### 备选方案：
1. **更精确的注入事件检测**
   ```rust
   // 除了 LLKHF_INJECTED，检查其他标志
   if flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED) != 0
   ```

2. **时间窗口过滤**
   ```rust
   // 如果两个 Ctrl 事件间隔太短（<50ms），可能是假事件
   ```

3. **窗口焦点状态感知**
   ```rust
   // 当窗口有焦点时，使用不同的热键检测逻辑
   ```

## 调试信息

检查日志中的关键词：
- `"hotkey: lone-Ctrl tap detected"`
- `"WindowController::toggle — uncloak (show)"`
- `"WindowController::toggle — cloak (hide)"`
- `"Hotkey state reset (window shown)"`