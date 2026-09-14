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
| Rust (cargo) | ≥ 1.75 | 构建原生核心 emby-core | https://rustup.rs |
| ComfyUI | 任意 | 图像生成后端（可选，风格化/局部重绘） | 桌面版 https://www.comfy.org |

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
└── exports/         # 导出的 DST/PES/JEF
```

### 连接 ComfyUI（可选）

1. 启动 ComfyUI（默认 API: `http://127.0.0.1:8188`）
2. 把 `assets/comfyui_extra_model_paths.yaml` 复制到 ComfyUI 配置目录，使其直接读取 `models/` 仓库
3. App 内「环境总览」页确认 ComfyUI 状态为已连接

### 常用命令

```bash
pnpm run dev          # Electron + Vite HMR + 自动拉起 sidecar
pnpm run build        # 生产构建
pnpm run dist         # electron-builder 打包安装包
pnpm run typecheck    # TS 类型检查（主进程 + 渲染进程）
pnpm run sidecar      # 单独启动 sidecar（调试后端时）
pnpm run core:build   # 重新构建 Rust 原生核心（改了 crates/emby-core 后）
```

## 开发

```bash
pnpm run setup      # 一次性安装全部依赖并构建 Rust 核心（需 Node ≥ 20 + cargo）
pnpm run dev        # 开发模式（Electron + Vite HMR，自动拉起 sidecar）
pnpm run dist       # 打包安装包
```

架构分工：**Electron = UI 与生态编排；Rust（crates/emby-core）= 性能密集计算**（DST 编解码、图像分析、phash、后续文件索引/加解密）；**sidecar（Node.js/TS）= API/Agent/数据飞轮编排层**。无 Python 运行时依赖（模型微调工具链除外，独立隔离）。

## 架构

核心文档：[DESIGN.md](DESIGN.md)（设计语言）· [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DATA_FLYWHEEL.md](docs/DATA_FLYWHEEL.md) · [docs/PLUGIN_GUIDE.md](docs/PLUGIN_GUIDE.md) · [docs/AGENT_DESIGN.md](docs/AGENT_DESIGN.md) · [docs/research/digitizing-workflow.html](docs/research/digitizing-workflow.html)（制版师工作流与术语调研，双语）。

核心链路：
图片 → 制版 Agent 方案 → ComfyUI 风格化/局部修改 → 制版核心转针迹 → 导出 DST/PES/JEF。

数据与代码分离：数据集在 `E:\Project-刺绣机\datasets`，模型在 `E:\Project-刺绣机\models`，导出在 `E:\Project-刺绣机\exports`。