# open_emby
An AI enhanced  embroidery software, turning every picture into  embroidery

## License

This project is released under the [open_emby License (Personal, Non-Commercial Open Edition)](LICENSE).

- ✅ Free for personal, non-commercial use (learning, research, evaluation).
- ❌ Any commercial use — including SaaS/API deployment, integration into paid products, or paid services — requires prior written permission and a commercial license.
- Contact: your@email.com (commercial licensing inquiries).

See [LICENSE](LICENSE) for full terms.

## 环境搭建（Setup）

### 前置依赖

| 工具 | 版本 | 用途 | 安装 |
|---|---|---|---|
| Node.js | ≥ 20 | Electron / sidecar 运行时 | https://nodejs.org |
| pnpm | ≥ 9 | 包管理 | `npm i -g pnpm` |
| Rust (cargo) | ≥ 1.75 | 构建原生核心 emby-core 与生成引擎 emby-engine | https://rustup.rs |

Windows 上 Rust 需要 MSVC 构建工具（安装 Visual Studio Build Tools，勾选「使用 C++ 的桌面开发」）。

### 一键安装

```bash
git clone https://github.com/licher255/open_emby.git
cd open_emby
pnpm run setup   # = pnpm install + sidecar 依赖 + cargo 构建 crates/emby-core
pnpm run dev     # 启动 Electron（自动拉起 sidecar: http://127.0.0.1:8100）
```

### 数据目录（独立于代码仓库）

首次运行前创建（默认根为 `E:\Project-刺绣机`，可在 App 设置页修改）：

```
<数据根>/
├── datasets/        # raw/ processed/ stitch_pairs/ flywheel/{inbox,curated,rejected}
├── models/          # checkpoints/ loras/ controlnet/ gguf/
├── exports/         # 导出的 DST/PES/JEF
├── projects/        # 制版项目（Git 版本库：project.json + state.json + images/，每步处理自动提交可回退）
└── engine/          # emby-engine 的 input/output/temp（ComfyUI 同布局）
```

### 常用命令

```bash
pnpm run dev          # Electron + Vite HMR + 自动拉起 sidecar
pnpm run build        # 生产构建
pnpm run dist         # electron-builder 打包安装包（先确保已跑过 engine:build 生成 release 二进制）
pnpm run typecheck    # TS 类型检查（主进程 + 渲染进程）
pnpm run sidecar      # 单独启动 sidecar（调试后端时）
pnpm run core:build   # 重新构建 Rust 原生核心（改了 crates/emby-core 后）
pnpm run engine:build # 重新构建 Rust 生成引擎（改了 crates/emby-engine 后）
pnpm run engine:dev   # 单独启动生成引擎（调试用）
```

## 开发

### 打包说明

- `pnpm run dist` 产出 `dist/open_emby Setup <version>.exe`（NSIS 安装包）。打包前会自动执行 sidecar 的 esbuild bundle（`sidecar/dist/sidecar.cjs`）。
- 随包分发：`resources/bin/emby-engine.exe`（Rust 生成引擎）、`resources/bin/emby-core.win32-x64-msvc.node`（原生核心）、`resources/sidecar/sidecar.cjs`（编排层，由 Electron 内置 Node 以 `ELECTRON_RUN_AS_NODE` 运行）、`resources/plugins/`。
- 未配置代码签名证书时，先设 `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'` 再打包。若 electron-builder 在解压 winCodeSign 缓存时因符号链接权限报错（macOS dylib 条目，Windows 上无关紧要），手动把 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<随机>.7z` 解压到同目录 `winCodeSign-2.6.0\` 后重试即可。

```bash
pnpm run setup      # 一次性安装全部依赖并构建 Rust 核心（需 Node ≥ 20 + cargo）
pnpm run dev        # 开发模式（Electron + Vite HMR，自动拉起 sidecar）
pnpm run dist       # 打包安装包
```

架构分工：**Electron = UI 与生态编排；Rust = 性能密集计算与生成**（crates/emby-core：DST 编解码、图像分析、phash；crates/emby-engine：借鉴 ComfyUI 架构的原生节点图生成引擎）；**sidecar（Node.js/TS）= API/Agent/数据飞轮编排层**。无 Python 运行时依赖（模型微调工具链除外，独立隔离）。

## 架构

核心文档：[DESIGN.md](DESIGN.md)（设计语言）· [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/ENGINE.html](docs/ENGINE.html)（生成引擎）· [docs/DATA_FLYWHEEL.md](docs/DATA_FLYWHEEL.md) · [docs/PLUGIN_GUIDE.html](docs/PLUGIN_GUIDE.html) · [docs/AGENT_DESIGN.md](docs/AGENT_DESIGN.md) · [docs/research/digitizing-workflow.html](docs/research/digitizing-workflow.html)（制版师工作流与术语调研，双语）· [docs/research/inkstitch-study.html](docs/research/inkstitch-study.html)（Ink/Stitch 算法研读）。

核心链路：
图片 → 制版 Agent 方案 → emby-engine 风格化/局部修改（Rust 原生节点图）→ 制版核心转针迹 → 导出 DST/PES/JEF。

数据与代码分离：数据集在 `E:\Project-刺绣机\datasets`，模型在 `E:\Project-刺绣机\models`，导出在 `E:\Project-刺绣机\exports`。
