# openSUSE 调研 — 多窗口 / 开发环境配置 / 文件管理

> 调研角度由 bao 指定(2026-06-12):看 openSUSE 的多窗口写作、开发环境配置、
> 文件管理,对 CTRL「工作区」有没有借鉴。
>
> **诚实前提**:openSUSE 是 **Linux 发行版 / 桌面 OS**,这三块能力其实来自它
> 搭载的 **KDE Plasma(窗口)+ YaST(配置)+ Dolphin(文件)**;openSUSE 自己
> 独有的是 YaST + patterns + OBS。CTRL 是 ambient **app 层**,所以借**思路**,
> 不借**形态**(不做窗口管理器 / 桌面 OS)。

---

## 1. 多窗口(KDE Plasma 窗口管理)

- **Quick Tiling**:拖窗口到屏幕边 / 角,自动平铺到 8 个位置(四象限 + 左右
  半屏);键盘快捷键可把窗口瞬移到另一个虚拟桌面。
- **Virtual Desktops + Activities**:多虚拟桌面 +「活动」(按任务分组的桌面集)。
- **PlasmaZones**:FancyZones 式自定义区域布局,per-monitor / per-desktop
  (需 Plasma 6 + Wayland)。
- 局限:快速平铺只锁 50% / 25%;这套是给 power user 的,操作偏复杂。

## 2. 开发环境配置(YaST + Patterns)★ 最有借鉴

- **Patterns(模式)**:把「一组相关包」打包成一个可一键装的单元。
  `devel_basis` = 一键装齐基础开发工具链(等价 Debian 的 build-essential);
  `C/C++ Development` pattern 同理。
- **一键装所有 -devel**:YaST 能声明式地「给系统所有包装上编译所需的 -devel
  包」,一键完成。
- 思路本质:**声明式 + 成组 + 一键** —— 用户说「我要能做 X」,系统算出要装
  哪些,用户不用逐个挑。

## 3. 文件管理(Dolphin)

- **Split View(F3)**:左右两栏不同目录,拖拽互传。
- **Tabs(Ctrl+T)** + **Places 面板**(书签 / 设备 / 最近,可拖拽重排)。
- **KIO**:把 Google Drive / S3 / SFTP / WebDAV **透明挂成本地目录**一样操作。★
- **F4 内嵌终端**:在当前文件位置直接开终端。

---

## 对 CTRL 的借鉴(核心)

### ① 工作区布局 ← 平铺 / 虚拟桌面
- 工作区不该是单一固定布局,而是**可平铺的分区**:Irisy + 工作区(+ 多面板)
  按需平铺、中缝可拖。
- 「Activities = 按任务分组的桌面集」→ CTRL 可有**按任务的工作区集**(写作
  一组、coding 一组)。
- ⚠️ 警惕:KDE 这套复杂度是给 power user 的。CTRL 要用户友好,**借分区 / 任务
  集的思路,不借操作复杂度**;窗口平铺是 OS 职责,CTRL 不重造窗口管理器。

### ② 模块 / Provider 配置 ← Patterns ★ 这次最实的收获
- openSUSE 的 **pattern = 一组包一键装**,正是 CTRL **模块化平台**该有的:
  **一个场景 = 一组模块,一键装齐**(Discover 按场景组织,不让用户逐个挑工具)。
- 「声明式我要能编译 → 系统算出装什么」= CTRL 的**意图驱动**:用户说意图,
  Irisy 算出要哪些模块 + 配置。
- 直接印证 [[modular-intent-platform]] + ProviderHub 友好配置方向。

### ③ vault / 文件工作区 ← Dolphin
- **Split View / Tabs / Places** = 成熟的本地文件工作区范式。文档工作区可借:
  **分栏对照**(写作时左文档右参考)、**Places**(收藏 vault 位置 / 项目)、
  **Tabs**(多文档)。
- **KIO 透明远程挂载**(最契合 CTRL 哲学):Dolphin 把网盘 / 远程挂成本地目录。
  这正是 CTRL connector 哲学 —— 飞书 / Notion / Slack 作 sync provider,
  **在 vault 里像本地文件一样**,不打开第三方 app。**KIO 是 CTRL connector
  的成熟先例**,值得照它的「protocol handler」架构想。
- **F4 内嵌终端** → CTRL 工作区 **inline 工具**(在文档旁直接调 Irisy 能力,
  不切走)。

---

## 边界(不借的)
- openSUSE 是 OS / 桌面层,CTRL 是 ambient app 层。窗口平铺、虚拟桌面是 OS
  职责 —— CTRL 的「多窗口」= ① Quicker 式快捷取用面 + ② Irisy 工作区面板,
  **不是**平铺整个桌面。
- 借的是**思路**(成组一键配置、透明远程挂载、分栏对照),不是**形态**
  (不做 Linux 桌面)。

## Sources
- [Quick Tiling in KDE Plasma on openSUSE](https://cubiclenate.com/2020/01/02/quick-tiling-in-kde-plasma-on-opensuse/)
- [PlasmaZones — FancyZones-style tiling](https://github.com/fuddlesworth/PlasmaZones)
- [openSUSE for developers (Wiki)](https://en.opensuse.org/openSUSE:OpenSUSE_for_developers)
- [devel_basis / build-essential on openSUSE](https://www.pragmaticlinux.com/2022/01/how-to-install-build-essential-on-opensuse/)
- [A comprehensive guide to Dolphin (Opensource.com)](https://opensource.com/life/15/8/comprehensive-guide-dolphin-file-manager)
- [Dolphin/File Management (KDE UserBase)](https://userbase.kde.org/Dolphin/File_Management)
