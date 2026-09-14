import { readFileSync } from 'fs'
import { basename } from 'path'
import { getSettings } from './settings'

/** ComfyUI 连接器：REST 上传/提交/轮询 */
async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`ComfyUI ${res.status}: ${url}`)
  return res.json()
}

export async function comfyStatus(): Promise<{ reachable: boolean; url: string }> {
  const url = getSettings().comfyuiUrl
  try {
    await fetchJson(`${url}/system_stats`)
    return { reachable: true, url }
  } catch {
    return { reachable: false, url }
  }
}

export async function submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
  const url = getSettings().comfyuiUrl
  const data = await fetchJson(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  return data.prompt_id as string
}

/** 上传图片到 ComfyUI input 目录 */
export async function uploadImage(localPath: string): Promise<string> {
  const url = getSettings().comfyuiUrl
  const fd = new FormData()
  fd.append('image', new Blob([readFileSync(localPath)]), basename(localPath))
  const data = await fetchJson(`${url}/upload/image`, { method: 'POST', body: fd })
  return data.name as string
}

/** 制版第一步：图生图"平涂色块化"工作流（img2img 低 denoise + 平涂提示词）。
 *  checkpoint 名可在设置中配置；节点结构按标准 ComfyUI API 格式。 */
export function buildStylizeWorkflow(imageName: string, checkpoint: string, denoise = 0.55, maxColors = 8): Record<string, unknown> {
  return {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
    '11': { class_type: 'LoadImage', inputs: { image: imageName } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['11', 0], vae: ['4', 2] } },
    '6': { class_type: 'CLIPTextEncode', inputs: {
      text: `flat color block illustration, vector style, clean solid shapes, max ${maxColors} colors, no gradients, no shading, crisp edges, embroidery pattern artwork`,
      clip: ['4', 1] } },
    '7': { class_type: 'CLIPTextEncode', inputs: {
      text: 'photo, realistic, gradient, shadow, texture, noise, blur, watermark, text',
      clip: ['4', 1] } },
    '3': { class_type: 'KSampler', inputs: {
      seed: Math.floor(Math.random() * 2 ** 32), steps: 20, cfg: 7.0,
      sampler_name: 'euler', scheduler: 'normal', denoise,
      model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] } },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'open_emby_stylize', images: ['8', 0] } }
  }
}

/** 提交并等待完成，返回结果图 data URL。onProgress 回传文本进度。 */
export async function stylizeImage(
  localPath: string,
  opts: { checkpoint: string; denoise?: number; maxColors?: number },
  onProgress?: (msg: string) => void
): Promise<string> {
  const url = getSettings().comfyuiUrl
  onProgress?.('uploading image to ComfyUI…')
  const imageName = await uploadImage(localPath)
  onProgress?.('running stylize workflow…')
  const promptId = await submitWorkflow(buildStylizeWorkflow(imageName, opts.checkpoint, opts.denoise, opts.maxColors))

  // 轮询 /history（MVP；后续换 WebSocket 节点级进度）
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const history = await fetchJson(`${url}/history/${promptId}`).catch(() => null)
    const entry = history?.[promptId]
    if (!entry) continue
    if (entry.status?.completed || entry.outputs) {
      const imgs = entry.outputs?.['9']?.images
      if (!imgs?.length) throw new Error('工作流完成但无输出图片')
      const img = imgs[0]
      onProgress?.('fetching result…')
      const res = await fetch(`${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`)
      if (!res.ok) throw new Error(`取结果图失败: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return `data:image/png;base64,${buf.toString('base64')}`
    }
    if (entry.status?.status_str === 'error') {
      throw new Error('ComfyUI 工作流执行失败: ' + JSON.stringify(entry.status.messages ?? {}))
    }
    onProgress?.('generating…')
  }
  throw new Error('ComfyUI 生成超时（180s）')
}
