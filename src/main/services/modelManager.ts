import { readdirSync, existsSync } from 'fs'
import { join, extname } from 'path'
import { getSettings } from './settings'
import type { ModelInfo } from '@shared/types'

const KIND_EXT: Record<ModelInfo['kind'], string[]> = {
  checkpoint: ['.safetensors', '.ckpt'],
  lora: ['.safetensors'],
  controlnet: ['.safetensors', '.pth'],
  gguf: ['.gguf']
}

/** 扫描外部模型仓库 E:/Project-刺绣机/models */
export function listModels(): ModelInfo[] {
  const root = join(getSettings().dataRoot, 'models')
  const out: ModelInfo[] = []
  for (const kind of Object.keys(KIND_EXT) as ModelInfo['kind'][]) {
    const dir = join(root, kind === 'checkpoint' ? 'checkpoints' : kind === 'lora' ? 'loras' : kind === 'controlnet' ? 'controlnet' : 'gguf')
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) {
      if (KIND_EXT[kind].includes(extname(f).toLowerCase())) {
        out.push({ id: f, kind, path: join(dir, f) })
      }
    }
  }
  return out
}

/** 下载 HuggingFace 模型到 models/（后续接入 hf_hub / aria2，支持断点续传） */
export async function downloadModel(repoId: string, file: string, kind: ModelInfo['kind']): Promise<void> {
  // TODO: 实现 HF 下载 + 进度推送 + ComfyUI extra_model_paths 注册
  throw new Error(`downloadModel 未实现: ${repoId}/${file} -> ${kind}`)
}

/** 启动 LoRA 微调任务（读取 datasets/processed，产物写入 models/loras） */
export async function startFinetune(datasetDir: string, baseModel: string): Promise<string> {
  // TODO: 调用 sidecar /finetune 或 kohya sd-scripts，返回 taskId
  throw new Error(`startFinetune 未实现: ${datasetDir} on ${baseModel}`)
}
