---
version: alpha.2
name: open-emby-design
description: A playful-but-precise creative-tool studio anchored on a clean white canvas and Emby Blue (#2727e6), the single brand voltage that carries every primary CTA, the generate action, and the active tool state — learned from SuperHi's edtech language where learning software must feel like a toy but work like an instrument. Type runs a grotesque pair (Neue Haas Grotesk Display/Text, open substitute Inter) at confident sizes, with IBM Plex Mono carrying every technical readout — stitch counts, millimeter dimensions, color hex — because embroidery data should look like what it is: machine code made beautiful. A rotating "thread palette" of saturated accents (yellow #ffda00, green #16ab59, orange #ff7715, pink #ffbac4, warm-blue #91d8ec) codes stitch types and status, echoing the physical thread rack of a real embroidery studio. Corners are generous (8px inputs, 16px cards, 24px panels, full pills) and elevation is capped at one shadow tier — depth comes from color-blocking and sticker-like floating badges, not from shadows.

colors:
  # ---- brand ----
  primary: "#2727e6"            # Emby Blue (SuperHi blue-50) — every primary CTA, generate, active tool
  primary-hover: "#4747ed"      # blue-45
  primary-active: "#1616be"     # blue-55, press state
  primary-deep: "#121297"       # blue-60, text-on-tint links
  primary-disabled: "#dedefb"   # blue-20
  primary-tint: "#dedefb"       # blue-20, selected-row wash
  # ---- ink & text ----
  ink: "#111118"                # grey-90, never pure black
  body: "#58585d"               # grey-80
  muted: "#757579"              # grey-70
  muted-soft: "#979797"         # grey-60
  on-primary: "#ffffff"
  # ---- surfaces & hairlines ----
  canvas: "#ffffff"
  surface-soft: "#f6f6f6"       # grey-10, panels / hover fills
  surface-strong: "#ebebeb"     # grey-20, icon-button fill
  hairline-soft: "#ebebeb"      # grey-20
  hairline: "#d9d9d9"           # grey-30, default 1px border
  border-strong: "#b7b7b9"      # grey-50, focused/strong outline
  # ---- thread palette (multi-accent, stitch-type coding) ----
  thread-yellow: "#ffda00"      # yellow-50 — selection highlight, marquee, "NEW" moments
  thread-yellow-soft: "#fff099" # yellow-30 — hover highlight wash
  thread-green: "#16ab59"       # green-50 — tatami fill stitch, success states
  thread-green-deep: "#00833e"  # green-60
  thread-orange: "#ff7715"      # orange-50 — satin stitch, warnings, agent "thinking"
  thread-pink: "#ffbac4"        # pink-50 — run/outline stitch, soft accents
  thread-warm-blue: "#91d8ec"   # warm-blue-50 — appliqué/special stitch, info
  thread-red: "#ff4141"         # red-50 — errors only (never decoration)
  error-deep: "#e10000"         # red-60
  error-tint: "#fee7e7"         # red-10
  # ---- scrim ----
  scrim: "#111118"              # rendered at 45% opacity for modals

typography:
  # 家族说明：display/text = 'Neue Haas Grotesk' 开源替代 Inter; mono = IBM Plex Mono (OFL 可直接内置); accent = Adieu Light 替代 Space Grotesk
  display-hero:
    fontFamily: "'Space Grotesk', 'Inter', -apple-system, 'Microsoft YaHei', sans-serif"
    fontSize: 44px
    fontWeight: 500
    lineHeight: 1.05
    letterSpacing: -0.88px
  display-xl:
    fontFamily: "'Inter', -apple-system, 'Microsoft YaHei', sans-serif"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: -0.32px
  display-lg:
    fontFamily: "'Inter', sans-serif"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: -0.26px
  display-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  title-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 16px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  title-sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 15px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0
  body-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0
  body-sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: 0
  caption:
    fontFamily: "'Inter', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: 0
  # 等宽 = 技术读数专用：针数 / 尺寸mm / 色号 / 坐标 / 百分比
  mono-data:
    fontFamily: "'IBM Plex Mono', 'Cascadia Mono', monospace"
    fontSize: 14px
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: 0
  mono-label:
    fontFamily: "'IBM Plex Mono', monospace"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.33
    letterSpacing: 0.24px
    textTransform: uppercase
  stitch-tag:
    fontFamily: "'IBM Plex Mono', monospace"
    fontSize: 10px
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: 0.4px
    textTransform: uppercase
  button-md:
    fontFamily: "'Inter', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0
  button-sm:
    fontFamily: "'Inter', sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: 0
  nav-link:
    fontFamily: "'Inter', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: 0

rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  full: 9999px

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  base: 16px
  md: 24px
  lg: 32px
  xl: 48px
  xxl: 64px
  section: 96px

components:
  # ---- 按钮 ----
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    padding: 12px 24px
    height: 44px
  button-primary-active:
    backgroundColor: "{colors.primary-active}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-primary-disabled:
    backgroundColor: "{colors.primary-disabled}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
    rounded: "{rounded.sm}"
    border: 1px solid "{colors.ink}"
    padding: 11px 23px
    height: 44px
  button-tertiary-text:
    backgroundColor: transparent
    textColor: "{colors.ink}"
    typography: "{typography.button-md}"
  button-generate-pill:        # 「生成刺绣」主动作 = 全站最热时刻
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-md}"
    rounded: "{rounded.full}"
    padding: 12px 28px
    height: 48px
  icon-button-circle:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: 36px
  icon-button-tool-active:     # 编辑器工具选中态 = 黄底黑字贴纸
    backgroundColor: "{colors.thread-yellow}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    height: 36px
  # ---- 应用壳 ----
  topbar:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.nav-link}"
    height: 64px
    borderBottom: 1px solid "{colors.hairline}"
  sidebar-nav-item:
    backgroundColor: transparent
    textColor: "{colors.muted}"
    typography: "{typography.nav-link}"
    rounded: "{rounded.sm}"
    padding: 10px 12px
  sidebar-nav-item-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary-deep}"
    rounded: "{rounded.sm}"
  panel:                       # 检查器 / 侧栏面板
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    border: 1px solid "{colors.hairline}"
    padding: 24px
  # ---- 上传与图稿 ----
  upload-dropzone:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    typography: "{typography.body-md}"
    rounded: "{rounded.lg}"
    border: 2px dashed "{colors.border-strong}"
    padding: 48px
  upload-dropzone-hover:       # 拖入时黄底高亮 = SuperHi 高光笔动作
    backgroundColor: "{colors.thread-yellow-soft}"
    border: 2px dashed "{colors.ink}"
    textColor: "{colors.ink}"
  artwork-card:                # 图稿卡片（首页/历史）
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.md}"
  artwork-card-image:
    rounded: "{rounded.md}"
  # ---- 编辑器 ----
  canvas-viewport:             # 针迹仿真视口 = 唯一允许深色底的区域
    backgroundColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  editor-toolbar:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    border: 1px solid "{colors.hairline}"
    padding: 6px
  inspector-row:               # 属性行：label + mono 读数
    typography: "{typography.caption}"
    textColor: "{colors.muted}"
    padding: 8px 0
  inspector-value:
    typography: "{typography.mono-data}"
    textColor: "{colors.ink}"
  thread-chip:                 # 绣线色片 = 线轴贴纸
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-label}"
    rounded: "{rounded.full}"
    border: 1px solid "{colors.hairline}"
    padding: 6px 14px
  stitch-tag-satin:
    backgroundColor: "{colors.thread-orange}"
    textColor: "{colors.ink}"
    typography: "{typography.stitch-tag}"
    rounded: "{rounded.full}"
    padding: 3px 8px
  stitch-tag-tatami:
    backgroundColor: "{colors.thread-green}"
    textColor: "{colors.on-primary}"
    typography: "{typography.stitch-tag}"
    rounded: "{rounded.full}"
    padding: 3px 8px
  stitch-tag-run:
    backgroundColor: "{colors.thread-pink}"
    textColor: "{colors.ink}"
    typography: "{typography.stitch-tag}"
    rounded: "{rounded.full}"
    padding: 3px 8px
  stitch-tag-special:
    backgroundColor: "{colors.thread-warm-blue}"
    textColor: "{colors.ink}"
    typography: "{typography.stitch-tag}"
    rounded: "{rounded.full}"
    padding: 3px 8px
  selection-outline:           # 画布选区 = 2px 黄实线 + 角点手柄
    border: 2px solid "{colors.thread-yellow}"
  # ---- Agent 面板 ----
  agent-message:
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  agent-message-thinking:      # Agent 思考中 = 橙点脉冲
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.md}"
  user-message:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 16px
  plan-card:                   # Agent 产出的制版方案卡
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    border: 1px solid "{colors.hairline}"
    padding: 24px
  # ---- 表单 ----
  text-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-md}"
    rounded: "{rounded.sm}"
    border: 1px solid "{colors.hairline}"
    padding: 12px
    height: 44px
  text-input-focus:
    border: 2px solid "{colors.ink}"
  text-input-error:
    border: 2px solid "{colors.thread-red}"
    backgroundColor: "{colors.error-tint}"
  slider:
    trackColor: "{colors.surface-strong}"
    fillColor: "{colors.primary}"
    thumbColor: "{colors.canvas}"
    thumbBorder: 2px solid "{colors.ink}"
    height: 24px
  stepper:                     # 色数/密度步进器
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-data}"
    rounded: "{rounded.full}"
    height: 36px
  consent-toggle-on:           # 数据飞轮授权 = 绿底白字（贡献=正向）
    backgroundColor: "{colors.thread-green}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.full}"
  # ---- 反馈与徽章 ----
  badge-new:                   # SuperHi 贴纸式 NEW
    backgroundColor: "{colors.thread-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.stitch-tag}"
    rounded: "{rounded.full}"
    padding: 3px 8px
  status-dot-ok:
    backgroundColor: "{colors.thread-green}"
    rounded: "{rounded.full}"
    size: 8px
  status-dot-err:
    backgroundColor: "{colors.thread-red}"
    rounded: "{rounded.full}"
    size: 8px
  toast:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: 12px 20px
  modal-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: 32px
  progress-bar:                # 生成/导出进度 = 黄填充
    trackColor: "{colors.surface-strong}"
    fillColor: "{colors.thread-yellow}"
    rounded: "{rounded.full}"
    height: 8px
  data-table-row-hover:
    backgroundColor: "{colors.primary-tint}"
  plugin-card:                 # 社区插件卡 = 白卡 + 贴纸徽章
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    border: 1px solid "{colors.hairline}"
    padding: 20px
  empty-state:                 # 空态 = 大字 grotesque + 黄色点缀
    typography: "{typography.display-md}"
    textColor: "{colors.muted}"
  export-card:                 # 导出卡（DST/PES/JEF 选择）
    backgroundColor: "{colors.surface-soft}"
    textColor: "{colors.ink}"
    typography: "{typography.title-sm}"
    rounded: "{rounded.md}"
    padding: 20px
  marquee-strip:               # 欢迎页 ticker（SuperHi 标志性跑马灯）
    backgroundColor: "{colors.thread-yellow}"
    textColor: "{colors.ink}"
    typography: "{typography.mono-label}"
    padding: 8px 0
---

## Overview

open_emby 的设计语言学自 **SuperHi** —— 一个把"学写代码"做成玩具店的在线学校。它的核心命题与刺绣软件完全同构：**专业工具不必长得像企业软件**。刺绣是手艺活，用户是创作者而不是操作员，所以界面应该像一间明亮的工作室：白画布、一卷彩色绣线、几块贴纸。

基面是**纯白 canvas**（#ffffff），文字用近黑的 **ink**（#111118，SuperHi grey-90 —— 永不使用纯黑）。唯一的品牌电压是 **Emby Blue**（#2727e6，SuperHi blue-50）：每个主 CTA、「生成刺绣」按钮、编辑器工具选中态、进度中的链接，全部由这一股电流承载。全站 90% 是白 + ink，蓝色只出现在一两个关键时刻 —— 这和 SuperHi 用蓝的方式完全一致。

与 SuperHi 不同的是我们给了多色系一个**功能性职责**：饱和的"绣线色板"（黄 #ffda00 / 绿 #16ab59 / 橙 #ff7715 / 粉 #ffbac4 / 天蓝 #91d8ec）不做装饰，而是**针法编码系统** —— tatami 填针是绿、缎面针是橙、轮廓/直线针是粉、特殊针法是天蓝；黄色保留给"选中/高亮/NEW"这一唯一语义（SuperHi 的高光笔动作）。红色 #ff4141 只用于错误，永不装饰。用户的眼睛扫过针迹列表就能读出工艺结构，就像扫一眼线轴架。

字体是双轨制：**grotesque 家族**（Neue Haas Grotesk，开源替代 Inter）承载所有界面文字；**IBM Plex Mono** 承载一切技术读数 —— 针数、毫米尺寸、色号 hex、坐标、百分比。刺绣文件本质是给机器看的代码，让数据长成代码的样子，正好呼应 SuperHi 作为编程学校的 mono 基因。第三个字体位置留给 **Adieu Light**（替代 Space Grotesk）用于欢迎页大标题这类"海报时刻"，带一点手写怪趣。

**Key Characteristics:**
- 单一品牌电压：Emby Blue (#2727e6) 只承载主 CTA / 生成动作 / 激活态，使用克制。
- 多色系功能化：绣线色板 = 针法编码（tatami 绿 / satin 橙 / run 粉 / special 天蓝），黄色专属"选中与高亮"。
- 双轨字体：Inter 管界面，IBM Plex Mono 管一切机器数据（针数/mm/hex），Space Grotesk 管海报时刻。
- 贴纸徽章系统：NEW、针法 tag、绣线 chip 全部是 pill 贴纸 —— 直接呼应 SuperHi 的 sticker 语言。
- 大圆角无硬角：输入 8px、卡片 16px、面板 24px、按钮 pill；唯一允许的"硬"是画布网格本身。
- 单层阴影：全系统只有一个 shadow tier（卡片 hover 浮起 + 浮层），深度靠色块分割而不是投影叠加。
- 深色斑点唯一化：针迹仿真视口（canvas-viewport）是界面里唯一深色区域 —— 针迹线在深底上发光线，像灯箱上看稿。

## Colors

### Brand
- **Emby Blue**（`{colors.primary}` — #2727e6）：SuperHi 的签名蓝。主 CTA 背景（生成、导出、确认方案）、侧边栏激活态文字、slider 填充、focus 链接。
- **Blue Hover / Active / Deep**（#4747ed / #1616be / #121297）：hover 变亮、按下变深、深号用于 tint 底上的文字链接。
- **Blue Tint**（`{colors.primary-tint}` — #dedefb）：选中行洗色、用户消息气泡、表格 hover —— 蓝的"影子"用法。

### Thread Palette（功能色，非装饰）
| 色 | 值 | 唯一职责 |
|---|---|---|
| Thread Yellow | #ffda00 | 选中态 / 高亮 hover / NEW 徽章 / 进度条填充 / 跑马灯底 |
| Thread Green | #16ab59 | tatami 针法 tag、成功状态、数据飞轮授权开关 on |
| Thread Orange | #ff7715 | satin 针法 tag、警告、Agent 思考中脉冲点 |
| Thread Pink | #ffbac4 | run/outline 针法 tag、柔和点缀 |
| Thread Warm Blue | #91d8ec | 特殊针法（贴布/珠片）tag、info 提示 |
| Thread Red | #ff4141 | 仅错误（表单校验、失败状态），永不装饰 |

### Surface & Hairline
- **Canvas** #ffffff：所有页面的地板。本系统**没有暗色模式**（绣线色在深色上无法准确评估，这是工艺要求而非审美选择）。
- **Surface Soft** #f6f6f6：面板 hover、dropzone 静置、agent 消息泡。
- **Surface Strong** #ebebeb：圆形 icon 按钮底、slider 轨道、progress 轨道。
- **Hairline** #d9d9d9 / **Hairline Soft** #ebebeb：1px 分割线两档；**Border Strong** #b7b7b9 用于 dropzone 虚线与禁用描边。

### Text
- **Ink** #111118：标题、正文、激活导航 —— 主力文字色。
- **Body** #58585d：长文段落（插件描述、Agent 解释）。
- **Muted** #757579：次要标签、属性行 label、空态辅助。
- **Muted Soft** #979797：禁用文字，极少使用。

### Scrim
- **Scrim**（`{colors.scrim}` — #111118 @ 45%）：全局模态遮罩。用 ink 而非纯黑，保持色温一致。

## Typography

### Font Family
三家族制，全部有开源落地方案：
1. **Inter**（替代 Neue Haas Grotesk Text/Display）— 界面全部文字。Inter 与 Haas 的比例几乎 1:1 迁移。
2. **IBM Plex Mono**（OFL，可直接内置 woff2）— 技术读数专用：针数、mm 尺寸、色号、文件格式标签、mono-label 大写微标。
3. **Space Grotesk**（替代 Adieu Light）— 仅限 display-hero 海报时刻（欢迎页、空态大字）。

中文回退：`'Microsoft YaHei', 'PingFang SC'` 追加在每个 family 栈尾。

### Hierarchy

| Token | Size | Weight | 用途 |
|---|---|---|---|
| `{typography.display-hero}` | 44px | 500 | 欢迎页海报标题（Space Grotesk） |
| `{typography.display-xl}` | 32px | 600 | 页面级标题 |
| `{typography.display-lg}` | 26px | 600 | 卡片组/区块标题 |
| `{typography.display-md}` | 20px | 600 | 面板标题、空态大字 |
| `{typography.title-md}` | 16px | 600 | 卡片标题、列表主行 |
| `{typography.title-sm}` | 15px | 500 | 次级标题 |
| `{typography.body-md}` | 15px | 400 | 正文 |
| `{typography.body-sm}` | 14px | 400 | 卡片 meta、辅助说明 |
| `{typography.caption}` | 13px | 500 | 属性行 label、输入框标签 |
| `{typography.mono-data}` | 14px | 500 | 针数/尺寸/色号等读数 |
| `{typography.mono-label}` | 12px | 500 | 大写微标（+0.24px tracking） |
| `{typography.stitch-tag}` | 10px | 600 | 针法贴纸（+0.4px tracking, 大写） |
| `{typography.button-md}` / `button-sm` | 15/13px | 600 | 按钮 |
| `{typography.nav-link}` | 15px | 600 | 导航 |

### Principles
- **按钮字重 600 而不是 500**：SuperHi 的按钮比 Airbnb 更"响亮"，因为创作工具的 CTA 是行动邀请而非表单提交。
- **Mono 大写微标**（mono-label / stitch-tag）是系统的"标签机"声音：一切分类、格式、状态都用它 —— 像绣线轴上印的小字。
- **hero 时刻极简**：display-hero 只允许出现在欢迎页和空态，一处一页，绝不连用。

## Layout

### Spacing System
- **基准 4px**，token 比 Airbnb 更疏朗（学习软件的节奏）：`{spacing.xxs}` 4 · `{spacing.xs}` 8 · `{spacing.sm}` 12 · `{spacing.base}` 16 · `{spacing.md}` 24 · `{spacing.lg}` 32 · `{spacing.xl}` 48 · `{spacing.xxl}` 64 · `{spacing.section}` 96。
- **面板内边距**：`{spacing.md}`（24px）为 panel / plan-card / modal 标准；`{spacing.base}`（16px）为卡片 meta；`{spacing.xs}`（8px）为 chip/tag 间隙。
- **区块间距**：工作台页面 `{spacing.lg}`（32px）；欢迎页/营销感页面 `{spacing.section}`（96px，SuperHi 的呼吸感）。

### Grid & Container
- **编辑器主界面**：三栏 —— 左工具栏（64px icon rail）+ 中央画布（弹性）+ 右检查器（320px，可折叠到 48px rail）。
- **首页/历史**：图稿卡片 3-4 列 grid，间距 `{spacing.base}`。
- **Agent 面板**：右侧抽屉 360px，从右滑入，scrim 45%。
- **最大内容宽**：1280px 居中（首页/设置/插件市场）。

### Whitespace Philosophy
编辑器密度优先（创作者要信息），欢迎页与插件市场呼吸优先（SuperHi 式 96px 区块）。对比即意图：进去是工作室，出来是展厅。

## Elevation

**一个阴影层级，加零层。**

- **Flat**：95% 的界面 —— 面板、卡片、工具栏默认无影，靠 1px hairline + 色块分割。
- **Hover float**：`box-shadow: rgba(17,17,24,0.04) 0 0 0 1px, rgba(17,17,24,0.06) 0 2px 6px, rgba(17,17,24,0.10) 0 6px 12px` —— 卡片 hover、dropdown、Agent 抽屉、modal。全系统唯一定义。
- **Scrim**：ink @ 45%。

深度来自黄色选中描边、色块贴纸和圆角裁切，不来自投影。

## Components

### Buttons
**`button-primary`** — Emby Blue 填充、白字、8px 圆角、44px 高、字重 600。系统主力 CTA：确认方案、导出、保存。
**`button-generate-pill`** — pill 形态 + 48px 高 + 更宽 padding 的"热"CTA，全站只出现一次：编辑器里的「生成刺绣」。相当于 Airbnb 的 search orb 时刻。
**`button-secondary`** — 白底 + 1px ink 描边（SuperHi 式"诚实描边"，不用 grey）：取消、上一步、次要动作。
**`button-tertiary-text`** — 纯 ink 文字，hover 下划线：显示更多、跳过。
**`icon-button-tool-active`** — 工具选中 = 黄底圆贴纸。左工具栏里同时只有一个黄色。

### 应用壳
**`topbar`** — 64px 白底 + 底部 hairline。左：logo + 项目名（mono-label）；中：页面 tabs；右：环境状态点（status-dot）+ 设置。
**`sidebar-nav-item-active`** — blue-tint 底 + primary-deep 字，8px 圆角（不是 pill —— 导航用方角，按钮用圆角，形成层级区分）。
**`panel`** — 24px 圆角 + 1px hairline + 24px padding。检查器、方案卡、导出卡共用此骨架。

### 上传与图稿
**`upload-dropzone`** — 2px 虚线 border-strong + surface-soft 底 + 48px padding，中央 display-md 标题 + mono-label 格式说明（PNG/JPG · MAX 20MB）。
**`upload-dropzone-hover`** — 拖入瞬间变黄底（thread-yellow-soft）+ 虚线转 ink —— SuperHi 高光笔动作，全站最 playful 的 100ms。
**`artwork-card`** — 图稿优先：16px 圆角裁图，下方标题（title-md）+ 一行 mono meta（尺寸/色数/针数），右上 status-dot。

### 编辑器（核心）
**`canvas-viewport`** — 唯一深色区域（ink 底 + 24px 圆角）。针迹线以 thread palette 实色渲染，在深底上呈"发光"效果 —— 灯箱看稿。
**`editor-toolbar`** — 悬浮 pill（白底 + hairline + hover-float 阴影），内含 icon-button 组，选中项变黄。
**`inspector-row/value`** — 检查器属性行：caption 灰 label + mono-data ink 值，右对齐。任何数字都用 mono。
**`thread-chip`** — 绣线色片 pill：左 12px 实色圆点（真实线色）+ mono-label 色号（如 `#DC0000 · MADEIRA 1147`）。点击换色，拖拽排序即换色顺序编排。
**`stitch-tag-*`** — 针法贴纸四色：satin 橙 / tatami 绿 / run 粉 / special 天蓝。出现在区域列表、画布 hover tooltip、方案卡。
**`selection-outline`** — 画布选区：2px 黄实线 + 四角 8px 黄圆点手柄。

### Agent 面板
**`agent-message`** — surface-soft 底 16px 圆角；`user-message` 用 primary-tint 底区分。
**`agent-message-thinking`** — 橙色脉冲点 + "正在分析构图…"灰字。
**`plan-card`** — Agent 产出的制版方案：面板骨架 + 顶部 stitch-tag 行 + thread-chip 色板条 + mono 参数表 + 底部 button-primary「应用方案」。

### 表单
**`text-input`** — 白底 1px hairline、8px 圆角、44px 高；focus 时边框变 2px ink（无 glow 无 ring，SuperHi 式诚实）；error 时 2px thread-red + error-tint 底。
**`slider`** — 轨道 surface-strong、填充 primary、滑块白底 + 2px ink 描边。
**`stepper`** — pill 容器内 mono-data 数字 + ± 按钮：色数、密度、尺寸。
**`consent-toggle-on`** — 数据飞轮授权开关 on 态用绿底白字（贡献是正向行为）。

### 反馈与徽章
**`badge-new`** — 黄底黑字 10px 大写贴纸，钉在新功能入口右上角（插件市场、Agent 技能）。
**`status-dot-ok/err`** — 8px 绿/红圆点：ComfyUI、sidecar 连接状态。
**`toast`** — ink 底白字 16px 圆角，底部居中滑入，成功时左缘 4px 绿条、失败红条。
**`progress-bar`** — 8px pill 轨道 + 黄填充：生成/训练/导出进度。
**`marquee-strip`** — 欢迎页底部跑马灯：黄底 + mono-label 大写循环（"STITCH BY STITCH · 一针一线 · MADE BY COMMUNITY ·"），SuperHi 签名动作，全站仅此一处。
**`empty-state`** — display-md 灰字 + 一枚黄色贴纸徽章 + 一个 button-generate-pill。

## Responsive Behavior

桌面创作工具优先（Electron 窗口），窗口分级：

| 档位 | 宽度 | 变化 |
|---|---|---|
| Compact | < 1024px | 右检查器折叠为 48px rail；Agent 抽屉改全屏遮罩；图稿 grid 2 列 |
| Standard | 1024–1440px | 完整三栏编辑器；图稿 grid 3 列 |
| Wide | > 1440px | 编辑器画布吸收余量；首页内容 cap 1280px；检查器可拉宽至 400px |

### Touch / 交互目标
- 主 CTA ≥ 44×44px；generate-pill 48px。
- 工具栏 icon-button 36px + 6px 间距。
- thread-chip 高度 32px，拖拽手柄区 ≥ 24px。
- 画布缩放步进按钮 40px。

### 折叠策略
- 检查器先于工具栏折叠（工具是手，检查器是眼 —— 手比眼后收）。
- 导航 label 在 < 1100px 时隐去文字只留 icon。
- 永不出现横向滚动条：面板内部用 mono 数值截断（`12,340 sts` → `12.3k`）。

## Frameless & Neumorphism（alpha.2 修订）

窗口为**无边框**（frame: false）：自绘标题栏（42px，整条可拖拽，右侧 min/max/close 控制钮，close hover 红）。关窗 = 退出全部进程（sidecar 进程树 taskkill /T /F，无后台驻留）。

表面系统从 SuperHi 式 flat + hairline 修订为**新拟物（Neumorphism）**：
- 基面改为软灰 `#e6eaf0`（--neu-bg）—— 新拟物的凹凸不能用纯白，需要灰阶余地。
- 每个表面一对阴影：亮侧 `#ffffff`（左上）+ 暗侧 `#c3c9d4`（--neu-dark，右下）。
- 三态：**凸起**（--neu-out：卡片/导航/按钮/色片）· **凹陷**（--neu-in：图片相框/上传槽/输入框/选中导航）· **平**（hover 过渡中间态）。
- 交互语义：按钮按下 = 凸起转凹陷；选中导航项 = 凹陷；可"放入"的容器（dropzone、image frame）恒凹陷。
- 色彩系统不变：Emby Blue 仍是唯一品牌电压，thread palette 仍做针法编码 —— 新拟物只改变表面，不改变色彩语义。
- 单阴影层级原则保留：--neu-out / --neu-in 各两档（标准/sm），全系统无第三套投影。

## Known Gaps

- **针迹仿真渲染规范**：canvas-viewport 内针迹线的线宽-密度映射、光泽渐变（模拟丝线高光）需单独的视觉规范，待渲染引擎（Canvas2D/WebGL）选型后补充。
- **Hover 色系**：按全局 no-hover 精确提取政策，hover 仅定义为"色温位移一档"（soft→strong、tint→yellow-soft），逐组件值未锁定。
- **加载骨架屏**：生成中（ComfyUI 出图）的 skeleton 与跑马灯式进度文案待设计。
- **中文排版微调**：CJK 与 Inter 混排时的 line-height 补偿（建议 1.5→1.6）待实测。
- **主题扩展位**：绣线色板目前是固定 6 色；企业/工作室主题（如绣线品牌 Madeira/Gunold 联名色板）预留 theme 插件通道，规范待定。
- **暗色模式**：工艺上不允许（绣线色评估失真），但"暗色检查器 + 亮色画布"的混合模式有真实需求，待验证。
