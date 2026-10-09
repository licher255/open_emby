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

### 人物／宠物制版助手

**0.0.2-beta：默认改为简洁工作台。** 上传图片 → 选择宽度与风格 → 生成绣稿 → 预览／局部调整 → 选择保存位置并导出 DST。默认 100 mm、6 色、精细流线；专业的五步工作台收进“专业工具／调整局部细节”。

产品流程直接保存 Qwen 原始图稿，不先做容易损伤五官的强色块清理。两种风格使用报告推荐的通用长版与柔和色块段；每次生成记录实际提示词和 seed。精细流线调用 `sidecar/workers/paper_digitize.py`，实际运行作者的 `main_pipeline`（密度优化与连接）；区域底针与小细节由 Rust 处理，精细算法覆盖面积和细节回退数量存入结果元数据。

默认复用数据根 `reference/embroidery-repro-env/Scripts/python.exe` 与 `reference/embroidery-streamlines`。ComfyUI 可按需启动本机已有环境；自定义运行路径在设置 → 后端 → 本地生成环境。安装包包含适配 worker，但不包含大模型、Python 环境或作者仓库，当前机器复用已有部署。换电脑需先部署这些资源。论文模式失效不会整张悄悄改成快速模式；可从保留的图稿继续。

验证入口：`./sidecar/node_modules/.bin/tsx scripts/check-product-backend.ts <数据根> --ai`；构建后 `electron scripts/ui-studio.cjs`。新的安装包位于 `dist/open_emby Setup 0.0.2-beta.exe`。运行前关闭旧版软件；后端 API 版本不匹配会明确提示。

内部走线更新：制版方案可切换“优化区域顺序与内部走线”。同色不相交对象重新排序；连接仅在当前区域和后续面针预计覆盖网格内搜索，限制长度、绕路与重复经过。针迹页可用粉色突出新增连接，并查看跳针总长与内部走线长度。原有面针／底针线段保留，新增连接是否露线仍需试绣。验证脚本：`node scripts/check-routing.mjs <数据根>`，报告在 `doc/routing-repro/index.html`。

本轮独立回读同时修复了 DST 编码器的位移编码错误。旧版本已导出的用户 DST 请重新导出；报告中的本轮和历史测试 DST 已使用修复后的编码器重建。

方向更新：新方案默认使用“连续毛流”。局部结构张量估计并平滑方向，流线跟随方向场，跨色块共享走势。它不是毛发生长方向的语义识别，仍可能跟随色斑或眼睛轮廓。制版方案左侧可选择“拖画毛流方向”修正走势，或选择“拖画圆弧法线”，从圆心拖向边缘；后者适合虹膜等圆形结构。方向场、引导和圆心均随方案保存。针迹预览默认隐藏底针，可单独勾选显示，导出始终包含启用的底针。

方向算法对照：`node scripts/check-flow.mjs <数据根>`，结果写入 `doc/flow-stitch-tests/`。使用同一猫图比较旧主轴、自动方向场、人工毛流引导、全区域法线及混合方案。人工标注在报告中单独说明；面针方向实验不代表生产合格，流线方案目前会增加跳针。

专业工具中的“AI 制版助手”保留面料、色数、纹理与生成后端选项。助手在图稿、区域方案和针迹完成后分别保存项目版本；失败时可从已有产物继续。

“制版方案”支持点击图中区域，调整针法（曲线填针、错位填针、固定方向缎面针、中心走针）、方向、行距、底针、启用状态和绣线颜色。修改后原针迹失效，必须重新生成。小于 0.35 mm² 的区域默认关闭，可勾选恢复。区域标签图与参数存入项目状态；生成针迹直接读取该图，不再重新量化或重新识别区域。

局部 AI 编辑会用原区域蒙版合成，保留所有选区外像素；结果先显示前后对照，可采用或丢弃。采用后重新分区，需要复核原来的针法调整。单纯换绣线颜色直接用颜色控件，更新使用该线色的全部区域。

**当前能力边界：** 这是可编辑的 AI 辅助制版流程。Qwen 解释图像设计要求，区域决策按几何规则计算，尚无视觉模型自动识别眼睛、毛流或自动评审图稿。曲线填针是受区域裁切的平滑曲线；缎面针用固定方向截面，较宽跨度按最大针长分割。底针、行距和局部密度提示需试绣验证，尚未实现完整的锁针、自动剪线、面料形变仿真或拉力补偿。碎区域仍可能产生大量跳针，不能把预览通过当作生产合格。

验证：`cargo test --manifest-path crates/emby-core/Cargo.toml`；`./sidecar/node_modules/.bin/tsx scripts/check-agent.ts <数据根>`；构建后运行 `electron scripts/ui-agent.cjs`。实际模型与 HTTP 链路：启动 ComfyUI:8188 和 sidecar:8100 后运行 `./sidecar/node_modules/.bin/tsx scripts/check-agent-live.ts <数据根>`。对照、针迹 JSON、DST 与界面截图写入数据根的 `doc/agent-stitch-tests/`。

Windows x64 的 `pnpm run core:build` 直接编译并复制原生模块，避免 napi CLI 在不支持硬链接的磁盘上失败；构建前关闭正在加载该模块的软件或 sidecar。

### 初稿模型服务配置

“线稿与色块 → 同时生成线稿与色块”默认先生成 AI 初稿，再通过 Rust 引擎去背景、限色、清理小区域和提取线稿。已有线稿的重新上色继续使用原来的闭合区域约束。

- 设置 → 后端：选择“AI 初稿 + 色块清理”，ComfyUI 默认地址为 `http://127.0.0.1:8188`；Rust 服务仍使用 8189。也可选择“基础色块处理”。模型服务不可用时会报错，不会自动换成基础处理。
- 需要已安装支持 `TextEncodeQwenImage21` / `QwenImage21Cache` 的 ComfyUI，以及 `qwen_image_2.1_int8_convrot.safetensors`、`qwen3vl_8b_int8_convrot.safetensors` 和 `qwen_image_2.1_vae_bf16.safetensors`。应用按需启动已配置的本机环境，不自动下载模型或安装 Python。
- 提示词位于 `src/main/services/prompts/embroidery-draft.json`，来自项目外 `doc/prompt-tests` 的通用长版实测，主体改为自动提取、保持原图比例、按目标色数填入预算。使用 512 分辨率、20 步、CFG 1、Euler/simple；简洁工作台每次分配并记录 seed，复现脚本可固定 seed。负面规则随主提示词一起编码。
- 实际请求、任务 ID、seed 和原始初稿保存在数据根的 `engine/drafts/<id>/`；原始初稿（`ai_draft`）、清理后的色块和线稿同时进入项目图稿库与版本历史。图片通过 HTTP 上传到设置的 ComfyUI 地址。
- 数据集未接入训练。本阶段输出是可继续编辑的图稿，仍需人工检查细节和制版结果。

验证命令（在仓库根运行）：

```powershell
./sidecar/node_modules/.bin/tsx scripts/check-draft.ts
# 启动 ComfyUI:8188 与 emby-engine:8189 后，使用数据根已有三张样例测试真实后端：
node scripts/smoke-draft.mjs 'E:/Project-刺绣机'
```

### 打包说明

- `pnpm run dist` 产出 `dist/open_emby Setup <version>.exe`（NSIS 安装包）。打包前会自动执行 sidecar 的 esbuild bundle（`sidecar/dist/sidecar.cjs`）。
- 随包分发：`resources/bin/emby-engine.exe`（Rust 生成引擎）、`resources/bin/emby-core.win32-x64-msvc.node`（原生核心）、`resources/sidecar/sidecar.cjs`（编排层，由 Electron 内置 Node 以 `ELECTRON_RUN_AS_NODE` 运行）、`resources/plugins/`。
- 未配置代码签名证书时，先设 `$env:CSC_IDENTITY_AUTO_DISCOVERY='false'` 再打包。若 electron-builder 在解压 winCodeSign 缓存时因符号链接权限报错（macOS dylib 条目，Windows 上无关紧要），手动把 `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\<随机>.7z` 解压到同目录 `winCodeSign-2.6.0\` 后重试即可。

```bash
pnpm run setup      # 一次性安装全部依赖并构建 Rust 核心（需 Node ≥ 20 + cargo）
pnpm run dev        # 开发模式（Electron + Vite HMR，自动拉起 sidecar）
pnpm run dist       # 打包安装包
```

架构分工：**Electron = UI 与服务编排；Rust = 图像分析、基础针迹及 DST 编解码；sidecar（Node.js/TS）= API 与生成编排**。精细流线通过隔离 Python worker 调用论文实现；图生图通过本机 ComfyUI。基础针迹仍可独立使用 Rust。

## 架构

核心文档：[DESIGN.md](DESIGN.md)（设计语言）· [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/ENGINE.html](docs/ENGINE.html)（生成引擎）· [docs/DATA_FLYWHEEL.md](docs/DATA_FLYWHEEL.md) · [docs/PLUGIN_GUIDE.html](docs/PLUGIN_GUIDE.html) · [docs/AGENT_DESIGN.md](docs/AGENT_DESIGN.md) · [docs/research/digitizing-workflow.html](docs/research/digitizing-workflow.html)（制版师工作流与术语调研，双语）· [docs/research/inkstitch-study.html](docs/research/inkstitch-study.html)（Ink/Stitch 算法研读）。

核心链路：
图片 → 制版 Agent 方案 → emby-engine 风格化/局部修改（Rust 原生节点图）→ 制版核心转针迹 → 导出 DST/PES/JEF。

数据与代码分离：数据集在 `E:\Project-刺绣机\datasets`，模型在 `E:\Project-刺绣机\models`，导出在 `E:\Project-刺绣机\exports`。
