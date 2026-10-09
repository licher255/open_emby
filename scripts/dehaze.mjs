import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

const DEFAULT_PROMPT = 'Remove only the atmospheric haze, fog, smoke-like veil, and washed-out cast from this image. Restore clear natural visibility, balanced contrast, accurate colors, and crisp but realistic detail. Preserve the exact subjects, identity, geometry, composition, crop, lighting direction, text, and all existing objects. Do not add, remove, replace, or redesign anything. Avoid oversaturation, halos, HDR artifacts, excessive sharpening, and artificial-looking colors.'

function workflow(image, prompt, seed) {
  const node = (class_type, inputs) => ({ class_type, inputs })
  return {
    load: node('LoadImage', { image }),
    scale: node('FluxKontextImageScale', { image: ['load', 0] }),
    model: node('UnetLoaderGGUF', { unet_name: 'Qwen-Image-Edit-2509-Q4_K_M.gguf' }),
    sampling: node('ModelSamplingAuraFlow', { model: ['model', 0], shift: 3 }),
    cfg: node('CFGNorm', { model: ['sampling', 0], strength: 1 }),
    clip: node('CLIPLoader', { clip_name: 'qwen_2.5_vl_7b_fp8_scaled.safetensors', type: 'qwen_image', device: 'default' }),
    vae: node('VAELoader', { vae_name: 'qwen_image_vae.safetensors' }),
    positive: node('TextEncodeQwenImageEditPlus', { clip: ['clip', 0], vae: ['vae', 0], image1: ['scale', 0], prompt }),
    negative: node('TextEncodeQwenImageEditPlus', { clip: ['clip', 0], vae: ['vae', 0], image1: ['scale', 0], prompt: '' }),
    latent: node('VAEEncode', { pixels: ['scale', 0], vae: ['vae', 0] }),
    sample: node('KSampler', { model: ['cfg', 0], positive: ['positive', 0], negative: ['negative', 0], latent_image: ['latent', 0], seed, steps: 20, cfg: 4, sampler_name: 'euler', scheduler: 'simple', denoise: 1 }),
    decode: node('VAEDecode', { samples: ['sample', 0], vae: ['vae', 0] }),
    save: node('SaveImage', { images: ['decode', 0], filename_prefix: 'open_emby_dehaze' })
  }
}

async function request(base, path, init) {
  const response = await fetch(base + path, { ...init, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`ComfyUI ${response.status}: ${(await response.text()).slice(0, 500)}`)
  return response
}

async function main() {
  const input = process.argv[2]
  if (!input) throw new Error('用法: pnpm dehaze <图片路径> [输出目录]')
  const inputPath = resolve(input)
  const outputDir = resolve(process.argv[3] || join('..', 'engine', 'dehaze', randomUUID()))
  const base = (process.env.COMFY_URL || 'http://127.0.0.1:8188').replace(/\/$/, '')
  const graph = workflow('', process.env.DEHAZE_PROMPT || DEFAULT_PROMPT, Number(process.env.DEHAZE_SEED || 20261005))

  const info = await (await request(base, '/object_info')).json()
  for (const { class_type } of Object.values(graph)) {
    if (!info[class_type]) throw new Error(`ComfyUI 缺少节点 ${class_type}`)
  }

  const form = new FormData()
  form.append('image', new Blob([await readFile(inputPath)]), `dehaze_${randomUUID()}${extname(inputPath)}`)
  const uploaded = await (await request(base, '/upload/image', { method: 'POST', body: form })).json()
  graph.load.inputs.image = [uploaded.subfolder, uploaded.name].filter(Boolean).join('/')

  const submitted = await (await request(base, '/prompt', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph })
  })).json()
  if (!submitted.prompt_id) throw new Error(`提交失败: ${JSON.stringify(submitted)}`)
  console.log(`已提交 ${submitted.prompt_id}，正在本地去雾…`)

  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    const history = await (await request(base, `/history/${encodeURIComponent(submitted.prompt_id)}`)).json()
    const record = history[submitted.prompt_id]
    if (record?.status?.status_str === 'error') throw new Error(JSON.stringify(record.status.messages ?? record.status))
    const result = record?.outputs?.save?.images?.[0]
    if (result) {
      const query = new URLSearchParams({ filename: result.filename, subfolder: result.subfolder || '', type: result.type || 'output' })
      await mkdir(outputDir, { recursive: true })
      const outputPath = join(outputDir, `${basename(inputPath, extname(inputPath))}-dehazed.png`)
      const response = await request(base, `/view?${query}`)
      await writeFile(outputPath, Buffer.from(await response.arrayBuffer()))
      await writeFile(join(outputDir, 'request.json'), JSON.stringify({ inputPath, promptId: submitted.prompt_id, workflow: graph }, null, 2))
      console.log(outputPath)
      return
    }
    if (record?.status?.completed) throw new Error('任务已完成，但没有输出图片')
    await new Promise(resolve => setTimeout(resolve, 1500))
  }
  throw new Error(`等待超时，任务仍可能在队列中: ${submitted.prompt_id}`)
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
