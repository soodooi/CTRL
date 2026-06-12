# Quicker 调研 — 快捷取用 / 场景面板 / 动作市场

> CTRL 最早的灵感来源(立项时参考)。对应 CTRL 形态的**场景 ①:快捷取用**
> (Ctrl 唤醒 → 快捷键一次性呈现功能)。这次系统补一篇,界定 CTRL **抄什么 /
> 不抄什么**。

## 是什么
Quicker = Windows「指尖工具箱」/ 超级启动器。不只是开软件,更是启动各种「动作」。
8000+ 动作、500 万+ 安装。

## 核心机制
- **唤醒**:鼠标中键(默认)/ 快速点 Ctrl / 侧键 / 热键 → 弹出面板。
- **面板 = 全局面板 + 场景面板**:全局面板常显;**场景面板随当前活动软件变化**。
- **场景(上下文应用)**:按当前软件**进程名**自动判断(notepad.exe → notepad
  场景)。每个场景独立管理 4 个触发:**动作页 / 轮盘菜单 / 鼠标手势 / 左键辅助**。
  预置:全局(应用无关)、通用(可复用基础动作页)、任务栏 / 桌面。
- **动作 = 原子功能**,9 种基本类型:启动软件 / 开文件 / 开文件夹 / 运行命令 /
  开 URL / 模拟按键 / 发文本 / 执行脚本 / 切换面板。
- **组合动作**:模块拼搭 + 变量传值(像积木);子程序 = 可复用片段。
- **动作市场**:复制一个链接即可安装;分享你造的动作,别人的也帮你。
- **识别选中**:能识别用户选中的文件 / 文本再操作。

## 对 CTRL 的借鉴(抄什么)
1. **唤醒面板、一次性呈现动作** → CTRL **场景 ① 快捷取用**(Ctrl 唤醒,截屏 /
   OCR / everything 快捷键一次性呈现,点一下 = 原子动作)。这是 CTRL 的根。
2. **场景面板随上下文动态变** → CTRL 形态 ②**工作区按能力 / 上下文动态匹配**
   (刚校准的:工作区不是固定 dashboard,跟当前动作长出来)。
   - **但更 AI native**:Quicker 按「进程名」切;CTRL 按**意图 + 内容类型**切
     (Irisy 理解你要干嘛,而非只看你开了哪个 exe)。
3. **动作 = 原子** → CTRL **one-shot mcp**(一个 mcp = 一个原子动作,设计哲学 #4)。
4. **动作市场 / 分享** → CTRL **Discover + share-and-be-shared**(复制链接 /
   bundle 一键装的范式可借)。

## 边界(CTRL 明确不抄)
- ✗ **可视化组合动作编辑器**(模块拖拽 + 变量):这是 **workflow editor**,在 CTRL
  的「不做清单」(Coze / n8n 已做)。CTRL 改用 **AI 从自然语言生成 manifest**,
  用户不拖步骤。
- ✗ **8000 长尾动作堆砌**:不做清单写明「Quicker 8000 长尾 clone 不可能赢」。
  CTRL 要 **curation + 意图浮现 1-3 个**,不是动作墙。
- Quicker 是 Windows-only + 社区脚本;CTRL 跨平台 + AI 生成 + 本地 vault +
  **secret 进 keychain**。

## ★ 杀手用例(bao 2026-06-12 提的真实需求)
**配置开发环境 + 配 CF token 这类,手动做占用用户大量时间。**
这正是「**场景化一键装**」(openSUSE Patterns + Quicker 动作 的合流)的落地靶子:
- 选一个场景(如「CF Workers 开发」)→ CTRL **一键**:装工具链(node / wrangler)
  + **引导填 CF token**(进 keychain,不硬编码)+ 注入环境变量。
- 把「**装工具 + 配 secret + 设环境**」打成一个 pattern,一键完成 + 友好引导,
  替代用户手动一步步弄。
- 关联 [[opensuse]](Patterns 成组一键)+ ProviderHub 友好配置 + coding 模块
  (KOL 获客 beachhead)。详见 [[open-questions]] 的「场景化一键装」一节。

## Sources
- [Quicker 官网](https://getquicker.net/)
- [面板窗口](https://getquicker.net/kc/manual/doc/panel-window)
- [场景与动作管理](https://getquicker.net/KC/Manual/Doc/profiles)
- [安装分享的动作](https://getquicker.net/kc/manual/doc/install-action)
- [Quicker — 一种全新的 Windows 效率神器(少数派)](https://sspai.com/post/47776)
