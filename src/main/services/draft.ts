/** Qwen 初稿；复用已实测的长版提示词和采样参数。无 Electron 依赖，可直接做端到端验证。 */
import { randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import template from './prompts/embroidery-draft.json'
import type { EngineProgressEvent } from '../../shared/types'

export function buildDraftWorkflow(image: string, maxColors = 5, seed = 20261002, intent = '', style: 'clean' | 'soft' = 'clean') {
  if (typeof intent !== 'string' || intent.length > 1500) throw new Error('设计要求请控制在 1500 字以内')
  if (!Number.isInteger(maxColors) || maxColors < 2 || maxColors > 32) throw new Error('色数必须为 2–32 的整数')
  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error('无效 seed')
  const node = (class_type: string, inputs: Record<string, unknown>) => ({ class_type, inputs })
  let prompt = template.prompt.replace('{maxColors}', String(maxColors))
  if (style === 'soft') prompt = prompt.replace(/【形状与结构】[^\n]+/, '【形状与结构】将主体转译为圆润、简洁的平面插画。使用自然曲线与大块闭合色面，保留真实比例和关键姿态。将复杂细节归并成少量结构块；轮廓平滑，转折自然，色块相接清楚。简洁但不幼稚，不使用统一卡通脸，不增加动漫大眼。适合动物、花卉、宠物与日常物件。')
  return {
    load: node('LoadImage', { image }),
    model: node('UNETLoader', { unet_name: 'qwen_image_2.1_int8_convrot.safetensors', weight_dtype: 'default' }),
    clip: node('CLIPLoader', { clip_name: 'qwen3vl_8b_int8_convrot.safetensors', type: 'qwen_image', device: 'default' }),
    vae: node('VAELoader', { vae_name: 'qwen_image_2.1_vae_bf16.safetensors' }),
    cache: node('QwenImage21Cache', { model: ['model', 0], device: 'auto', dtype: 'default' }),
    // CFG 1 不使用独立负面引导，模板已把负面规则追加在主提示词后。
    text: node('TextEncodeQwenImage21', { clip: ['clip', 0], vae: ['vae', 0], prompt: prompt + (intent.trim() ? `\n【用户设计要求】${intent.trim()}` : ''), negative_prompt: '', resolution: 512, 'images.image_1': ['load', 0] }),
    sample: node('KSampler', { model: ['cache', 0], positive: ['text', 0], negative: ['text', 1], latent_image: ['text', 2], seed, steps: 20, cfg: 1, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }),
    decode: node('VAEDecode', { samples: ['sample', 0], vae: ['vae', 0] }),
    save: node('SaveImage', { images: ['decode', 0], filename_prefix: 'open_emby_draft' })
  }
}

export async function generateDraft(
  imagePath: string,
  opts: { url: string; dataRoot: string; maxColors?: number; seed?: number; timeoutMs?: number; intent?: string; style?: 'clean' | 'soft' },
  onEvent?: (ev: EngineProgressEvent) => void
): Promise<string> {
  const url = opts.url.replace(/\/$/, '')
  const workflow = buildDraftWorkflow('', opts.maxColors, opts.seed, opts.intent, opts.style)
  const request = async (path: string, init?: RequestInit) => {
    const res = await fetch(url + path, { ...init, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`ComfyUI ${res.status}: ${(await res.text()).slice(0, 500)}`)
    return res
  }
  onEvent?.({ type: 'executing', nodeId: 'draft', classType: 'QwenImage21' })
  try {
    const info = await (await request('/object_info')).json()
    for (const n of Object.values(workflow)) {
      if (!info[n.class_type]) throw new Error(`ComfyUI 缺少节点 ${n.class_type}，请使用支持 Qwen Image 2.1 的版本`)
    }
    const id = randomUUID()
    const form = new FormData()
    form.append('image', new Blob([await readFile(imagePath)]), `emby_${id}${extname(imagePath)}`)
    const uploaded = await (await request('/upload/image', { method: 'POST', body: form })).json()
    if (!uploaded.name) throw new Error('ComfyUI 上传未返回图片名称')
    workflow.load.inputs.image = [uploaded.subfolder, uploaded.name].filter(Boolean).join('/')
    const submitted = await (await request('/prompt', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: workflow })
    })).json()
    if (!submitted.prompt_id) throw new Error('ComfyUI 未返回任务 ID')
    // 保留输入路径、实际提示词、seed、任务 ID 和原始输出，方便复核每次初稿。
    const dir = join(opts.dataRoot, 'engine', 'drafts', id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'request.json'), JSON.stringify({ version: template.version, imagePath, promptId: submitted.prompt_id, workflow }, null, 2))
    const deadline = Date.now() + (opts.timeoutMs ?? 20 * 60_000)
    while (Date.now() < deadline) {
      const history = await (await request(`/history/${encodeURIComponent(submitted.prompt_id)}`)).json()
      const record = history[submitted.prompt_id]
      if (record) {
        if (record.status?.status_str === 'error') throw new Error(`Qwen 生成失败: ${JSON.stringify(record.status.messages ?? record.status).slice(0, 1000)}`)
        const img = record.outputs?.save?.images?.[0]
        if (img) {
          const params = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder ?? '', type: img.type ?? 'output' })
          const result = await request(`/view?${params}`)
          const path = join(dir, 'draft.png')
          await writeFile(path, Buffer.from(await result.arrayBuffer()))
          await writeFile(join(dir, 'history.json'), JSON.stringify(record, null, 2))
          onEvent?.({ type: 'executed', nodeId: 'draft' })
          return path
        }
        if (record.status?.completed) throw new Error('Qwen 任务完成但没有输出图片')
      }
      await new Promise(resolve => setTimeout(resolve, 1500))
    }
    throw new Error(`Qwen 等待超时；任务 ${submitted.prompt_id} 可能仍在 ComfyUI 队列中，请先查看队列再重试`)
  } catch (error) {
    const message = `AI 初稿失败（${url}）：${String(error)}。请检查 ComfyUI 服务和模型，或在设置中选择基础色块处理。`
    onEvent?.({ type: 'error', nodeId: 'draft', message })
    throw new Error(message)
  }
}
