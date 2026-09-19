# 可商用开源 img2img / 多模态模型选型（刺绣图稿管线）

> 目标：替换当前 runwayml SD1.5-inpainting（OpenRAIL-M，可商用但非完全开源），
> 建立一套 **Apache 2.0 / MIT 许可证** 的模型栈，支撑「线框轮廓 → 轮廓优化 → 色块填充 → 工程化布线」四阶段管线，
> 并可持续 LoRA 微调进化。硬件约束：**RTX 4060 Ti 16GB**。

## 0. 许可证红线

| 许可证 | 判定 | 代表 |
|---|---|---|
| Apache 2.0 / MIT / CC0 | ✅ 完全开源，商用零限制 | 本表所有推荐项 |
| OpenRAIL-M / OpenRAIL++ | ⚠️ 可商用但带用途限制，不算"完全开源" | SD1.5 / SDXL / MistoLine |
| FLUX.1-dev / Kontext、SD 3.5 Community | ❌ 非商用或有收入上限，排除 | Black Forest Labs dev 系列 |
| 腾讯混元 / Playground v2.5 Community | ⚠️ 有地域/规模限制，谨慎 | Hunyuan-DiT |

## 1. 主力 img2img 多模态生成模型（阶段 1/3 的核心）

| 模型 | 许可证 | 规模 | 16GB 可行性 | 特点 | ComfyUI |
|---|---|---|---|---|---|
| **Qwen-Image-Edit-2509**（首选） | Apache 2.0 | 20B MMDiT | GGUF Q4/Q6 + fp8 文本编码器可跑（需内存 offload） | 多图输入、一致性保持最强的开源编辑模型，提示词可直接驱动"转线稿/平铺色块"；VLM（Qwen2.5-VL）做文本编码，天然多模态 | 官方原生支持 |
| **OmniGen2**（备选） | Apache 2.0 | ~7B | fp8 可跑 | 上下文图像编辑，自带 LoRA 训练脚本 | 有社区节点 |
| **BAGEL-7B-MoT** | Apache 2.0 | 7B MoT | 量化可跑 | 理解+生成一体，可做"看图改图 + 看图说话"统一 Agent 底座 | 有社区节点 |
| **FLUX.1-schnell / Chroma** | Apache 2.0 | 12B | GGUF Q8 可跑 | 4 步出图、速度快，img2img 低重绘幅度精修轮廓好用 | 原生支持 |
| **HiDream-I1** | MIT | 17B | 仅 NF4/Q4 勉强 | 画质强但显存吃紧，暂不推荐为主力 | 原生支持 |
| **Lumina-Image-2.0** | Apache 2.0 | 2.6B | 轻松 | 轻量备胎，适合批量草图/数据增广 | 支持 |

> 结论：**主力 = Qwen-Image-Edit-2509（GGUF 量化）**，轻量高速备胎 = FLUX.1-schnell。
> 生态加成：HF 已有现成刺绣风格 LoRA（如 `ostris/embroidery_style_lora_sdxl`、HiDream yarn-art LoRA）可作 baseline 与评测参照。

## 2. 四阶段管线映射

### 阶段 1 — 线框轮廓（图片 → 干净线稿）
- **生成式**：Qwen-Image-Edit-2509，prompt：`convert to clean black line art, uniform stroke, white background`。
- **可控式**：ControlNet lineart / lineart_anime（lllyasviel sd15 系列，Apache 2.0）作反推预处理器提取线稿；注意 MistoLine（SDXL）是 OpenRAIL++，仅作参考。
- **纯算法**（无许可风险、可进 Rust core）：边缘检测 + 形态学清理。

### 阶段 2 — 轮廓优化（线稿 → 可绣轮廓）
- **矢量化**：**VTracer**（MIT/Apache 双许可，纯 Rust crate —— 可直接编进 `crates/emby-core`，与本项目 Rust 核心天然契合）；ComfyUI 内可用 ComfyUI-ToSVG-Potracer（注意 potrace 本体 GPL，仅作节点调用）。
- **几何约束**：Douglas-Peucker 简化、最小细节尺寸 ≥ 针距、消除闭合小环、连通域合并 —— 建议在 emby-core 用 Rust 实现为"可绣性检查器"。
- **生成式精修**：FLUX.1-schnell img2img 低 denoise（0.2–0.35）平滑线条。

### 阶段 3 — 色块填充（轮廓 → 有限色平涂）
- Qwen-Image-Edit-2509：`flat color fill, limited N-color palette, no gradient, posterized`。
- **颜色量化**：K-means 到 **绣线色号表**（DMC/兄弟牌色卡，Rust 实现，直接产出换色编排数据）。
- 风格 LoRA：用 `datasets/processed/` 训"刺绣平涂风" LoRA，让色块边缘天然贴合轮廓。

### 阶段 4 — 工程化布线（色块图 → DST/PES/JEF）
- 本项目已有 emby-core DST 编解码；补齐：
  - **Ink/Stitch**（GPLv3，作为外部 CLI 工具调用，不受 GPL 传染；SVG → 针迹，支持 tatami/satin/run）；
  - **pyembroidery**（MIT，Python 侧原型验证针迹格式）；
  - 长期：基于 `datasets/stitch_pairs/`（图稿↔针迹配对）训练"制版模型"，这是项目最深的护城河。

## 3. 数据飞轮与自动标注（支撑持续进化）

| 用途 | 模型 | 许可证 |
|---|---|---|
| 批量 caption / 图稿质量打分 / 制版 Agent 视觉理解 | **Qwen2.5-VL-7B**（GGUF 放 `models/gguf` 供 sidecar） | Apache 2.0 |
| 轻量 caption / 目标检测 | **Florence-2** | MIT |

对接现有 `datasets/flywheel/{inbox,curated,rejected}`：VLM 自动打标 → 人工在 App 内审核 → curated 进 LoRA 训练集。

## 4. LoRA / 微调工具链（全部 Apache 2.0）

| 框架 | 适配模型 | 16GB 可行性 |
|---|---|---|
| **DiffSynth-Studio** | Qwen-Image / Qwen-Image-Edit LoRA | fp8 + offload 可训 |
| ai-toolkit（ostris） | FLUX / SDXL | low_vram 模式可训 |
| kohya sd-scripts | SDXL / SD1.5 | 轻松 |
| OneTrainer | 多架构 GUI | 轻松 |

训练产物约定写入 `models/loras/`（与现有 README 约定一致）。

## 5. 落地顺序建议

1. 下载 **Qwen-Image-Edit-2509 GGUF（Q4_K_M）+ 文本编码器 + VAE** → `models/unet` + `models/text_encoders` + `models/vae`（已下载 ✅），验证"照片→线稿→平涂色块"两步提示词链路；
2. emby-core 集成 **VTracer**，实现 矢量化 + 可绣性检查（阶段 2 算法层）；
3. 建 DMC 色卡表 + K-means 量化（阶段 3 工程层）；
4. 用 Florence-2 / Qwen2.5-VL 给 flywheel 存量图自动打标，启动第一轮刺绣平涂风 LoRA（DiffSynth-Studio）；
5. Ink/Stitch CLI 打通"SVG→DST"最后一公里，与 stitch_pairs 对照评估。

## 6. 去 ComfyUI 化路线图（独立推理架构）

> 原则：**ComfyUI 降级为"实验室"**——只用于快速验证新模型/新工作流；产品主链路自带推理引擎。
> open_emby 是宿主，ComfyUI 最多是可选外挂，绝不能让产品形态变成"ComfyUI 插件"。

### 6.1 引擎选型：stable-diffusion.cpp（MIT）

- leejet/stable-diffusion.cpp：C++ GGUF 扩散推理引擎，**已原生支持 Qwen-Image-Edit**（PR #877，及更新的 2511 版 PR #1096）、img2img、ControlNet（SD1.5/SDXL）、LoRA 加载，CUDA 加速；
- 与本次下载的 GGUF 模型**同一份权重直接复用**，无需转换；
- MIT 许可，可静态链接进商业产品，无 GPL 传染；
- 配套：VLM/Agent 走 llama.cpp（MIT，GGUF 入 `models/gguf`，符合现有目录约定）。

### 6.2 三阶段集成路径

| 里程碑 | 形态 | 说明 |
|---|---|---|
| M1（进行中） | ComfyUI 验证链路 | GGUF 模型 + ComfyUI-GGUF 节点，跑通"照片→线稿→色块"提示词管线，沉淀 prompt 模板与参数 |
| M2 | sidecar 调 sd-server 子进程 | stable-diffusion.cpp 内置 HTTP server 模式；sidecar（Fastify）按现有 ComfyUI Connector 同款接口适配，**对 Electron 前端透明**；ComfyUI 不再需要常驻 |
| M3 | emby-core napi-rs FFI 绑定 | sd.cpp 提供 C API，可直接绑进 Rust 核心，Electron 进程内本地推理，零子进程零外部依赖；ComfyUI 退为纯可选插件 |
| M4 | 制版模型自训 | `datasets/stitch_pairs/` 训练图稿→针迹模型，完全自有资产 |

### 6.3 需自研补齐的能力（ComfyUI 当前承担的部分）

| 能力 | 替代方案 |
|---|---|
| img2img / 编辑采样 | sd.cpp 内置 |
| LoRA 热加载 | sd.cpp 内置（safetensors→GGUF 转换脚本随训练管线产出） |
| ControlNet 线稿控制 | sd.cpp（SD1.5/SDXL）+ 算法路线（VTracer 矢量化约束）双轨 |
| 预处理（线稿提取、颜色量化、矢量化） | **emby-core（Rust）原生实现**——这部分本就该是自己的核心 |
| 工作流编排 | sidecar Agent（已有设计），把 ComfyUI JSON 工作流翻译为固定管线参数 |

### 6.4 架构定位变化

```
之前: 图片 → Agent → 【ComfyUI】→ 制版核心 → DST
之后: 图片 → Agent → sidecar/sd.cpp(内嵌) → 制版核心(emby-core + VTracer) → DST
                       ↑ ComfyUI 仅作为"实验室模式"可选挂载，验证后固化为内置管线
```

