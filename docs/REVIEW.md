# open_emby 架构 / 性能 / UX 审查（2026-09-20，两轮）

视角：软件架构师 + Apple HIG（Design Principles / Foundations）。克制原则：只列真实证据支撑的问题；标注 [已修]（本轮改动）与 [遗留]（建议，未动）。

## 总评

三层分工（Electron = UI/编排，sidecar = TS 编排层，Rust = 计算密集）清晰且被执行到位；ComfyUI 兼容的原生引擎、项目级 Git 版本化、双语 i18n（207 键完全对齐）是同级项目里少见的成熟度。主要欠债集中在：**针迹数据的存储放大**、**几个热点路径的重复渲染**、以及 **HIG 细节（焦点/动效/反馈）**。

## 架构

1. [已修] `state.json` 内嵌完整针迹序列（数万点、数 MB），每次 persist 全量重写并进入 Git 提交。现外置为 `stitches.json` 引用（`{$artifact}`），读写对渲染进程透明，Git 跟踪与回退一致性不变。
2. [已修] 主进程无单实例锁：二次启动会重复拉起 sidecar/engine 并撞端口。已加 `requestSingleInstanceLock` + 第二实例聚焦已有窗口。
3. [已修·第二轮] `Editor.tsx` 从约 1100 行单组件拆为编排器（状态与副作用）+ `pages/editor/` 五个步骤组件（Import/Stylize/Plan/Stitches/Export）+ 共享展示组件（`AssetThumb`/`PanZoomStage`/`StitchPreview`/`HistoryPanel`，后者合并了两份重复的历史 UI）。行为不变，已由运行时冒烟验证。
4. [遗留] `settings.setSettings` 是浅合并，嵌套对象会被整体覆盖。目前唯一嵌套字段 `contribution` 由 IPC 特判保护，无实际 bug；新增嵌套设置项时需改深合并。
5. [遗留] 引擎结果链路为 PNG → base64 data URL → 渲染进程 → base64 解码落盘，往返两次。引擎本就写了 `output/` 文件，可改传文件路径，省一次大字符串 IPC。
6. [说明] sidecar/engine 仅监听 127.0.0.1，无鉴权在本机场景可接受；renderer CSP 已限制 `default-src 'self'`。

## 性能

1. [已修] 项目缩略图原实现：每张缩略图都是全尺寸图片的 base64 data URL（解码 + 内存双份）。现新增 `files.readImageThumb`（主进程 `nativeImage` 缩放至 ≤320px JPEG + mtime 缓存），不支持的格式自动回退原路径。
2. [已修] `StitchPreview` 进度滑杆每帧全量重绘（最坏 5 万次 `stroke`/帧）。现增量绘制：进度前进只补画新增段，回退/换层/换数据才全量重绘。
3. [已修] `StitchPreview3D` 切换隐藏层会 dispose 并重建整个 WebGL 渲染器与场景。现拆为两个 effect：渲染器/相机/灯光只随针迹数据重建，隐藏层切换只替换线迹 InstancedMesh 组。
4. [遗留] `readImageDataUrl` 在主进程同步 `readFileSync` 大图（原图预览仍走此路径），>50MB 的 TIFF 会卡主进程；可加大小护栏或改异步流式。
5. [说明] three.js chunk 约 1.2MB，已 `lazy()` 按需加载，首屏不受影响。

## UX（对照 Apple HIG）

1. [已修] 键盘可达性：此前仅缩略图按钮有 `:focus-visible`，现补全局焦点环（品牌蓝 2px，鼠标点击不触发）。
2. [已修] 动效：新增 `prefers-reduced-motion` 支持，关闭循环动画/过渡（HIG Accessibility）。
3. [已修] 反馈完整性（HIG: Feedback）：Edit > Undo 在无消费者时原先是静默无反应，现提示"此处没有可撤销的操作"；菜单与新建项目对话框支持 Esc 关闭；菜单补 `aria-haspopup/expanded` 与 `role=menu/menuitem`；Toast 补 `aria-live` 与 `role=status/alert`。
4. [已修] `<html lang>` 原为硬编码 `zh-CN`，与默认英文 UI 矛盾；现随语言设置同步。
5. [已修] 新建项目原先不进导航历史（前进/后退栈断裂），现统一走 `navTo`。
6. [已修·第二轮] 归档/重命名/历史回退的 `window.confirm`/`window.prompt` 已全部换成应用内模态（`stores/dialog.ts` + `DialogHost`），支持 Esc/遮罩取消、Enter 确认，破坏性操作（归档）主按钮标红。
7. [遗留] 标题栏菜单无快捷键提示（如 Ctrl+N），Edit 菜单只有 Undo 一项，桌面软件惯例上偏单薄。
8. [已修·第二轮] 设置页数据根目录可修改（目录选择对话框）。项目库即刻生效；sidecar/engine 以启动时环境变量为准，toast 提示重启后全量生效，与 README 描述对齐。
9. [遗留] 错误 toast 直接透传技术串（如 `sidecar 500: /digitize/plan`）。本轮已让后端错误带上响应正文便于诊断，但面向用户仍建议按场景包装一层人话。
10. [已修·第二轮] 深色模式跟随系统外观（`design-tokens.css` 整套 token 暗色取值，主窗口背景同步 `nativeTheme`）；画布/预览的白色为布料语义，刻意保留。窗口最小尺寸 1080×700。

## 安全

1. [已修] 渲染进程 `sandbox: false` → `true`（preload 仅使用 contextBridge/ipcRenderer/webUtils，沙箱内均可用）。
2. [说明] `contextIsolation: true`、`nodeIntegration: false`、CSP、只监听环回地址，基线良好。

## 验证

- 第一轮：`tsc --noEmit`（主进程 + 渲染进程）、`electron-vite build` 通过。
- 第二轮：`pnpm run dev` 运行时冒烟完成 —— `scripts/smoke.mjs`（sidecar/引擎/Rust 核心 6/6 PASS：health、plan、stitches、export DST、引擎色块工作流）；GUI 截图验证主页、导入步骤（原生缩略图生效）、针迹步骤；交互跑通"生成针迹 → 2D 仿真/检查/换色层 → 3D 预览"；`state.json` 外置引用与 `stitches.json` 落盘已核实；退出后无残留进程。
