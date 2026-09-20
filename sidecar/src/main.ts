/** open_emby sidecar — 制版核心 + 制版 Agent + 数据飞轮的本地 HTTP 服务（纯 TS 编排层）。
 *  计算密集工作（图像分析/DST 编码/phash/缩放）全部委托 crates/emby-core (Rust)。
 *  仅监听 127.0.0.1，由 Electron 主进程拉起。 */
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { plan as agentPlan } from './agent/core.js'
import { exportStitches } from './exporters/index.js'
import * as collector from './flywheel/collector.js'
import * as training from './training/prepare.js'
import { loadCore } from './native.js'

const DATA_ROOT = process.env.OPEN_EMBY_DATA_ROOT ?? 'E:\\Project-刺绣机'
const PORT = Number(process.env.OPEN_EMBY_SIDECAR_PORT ?? 8100)

async function main() {
// bodyLimit 放宽：针迹序列 JSON 可达数万点（数 MB）
const app = Fastify({ logger: false, bodyLimit: 64 * 1024 * 1024 })
await app.register(multipart)

app.get('/health', async () => ({ ok: true, service: 'open_emby-sidecar', version: '0.1.0', runtime: 'node+rust' }))

interface PlanBody { imagePath: string; intent?: string; maxColors?: number; widthMm?: number }
app.post('/digitize/plan', async (req) => {
  const b = req.body as PlanBody
  return agentPlan(b.imagePath, b.intent ?? '', b.maxColors ?? 6, b.widthMm ?? 100)
})

// 针迹生成：色块图 → 真实针迹序列（Rust 核心）
interface StitchesBody {
  imagePath: string
  maxColors?: number
  widthMm?: number
  minStitchMm?: number
  maxStitchMm?: number
  curveToleranceMm?: number
}
app.post('/digitize/stitches', async (req) => {
  const b = req.body as StitchesBody
  return loadCore().generateStitches(
    b.imagePath,
    b.maxColors ?? 8,
    b.widthMm ?? 100,
    b.minStitchMm ?? 0.6,
    b.maxStitchMm ?? 3.0,
    b.curveToleranceMm ?? 0.15
  )
})

// 画布调整（物理尺寸 mm → 像素，fit/fill/stretch）
interface CanvasBody { imagePath: string; destPath: string; widthMm: number; heightMm: number; mode?: string }
app.post('/canvas/resize', async (req) => {
  const b = req.body as CanvasBody
  loadCore().canvasResize(b.imagePath, b.destPath, b.widthMm, b.heightMm, b.mode ?? 'fit')
  return { ok: true, path: b.destPath }
})

interface ExportBody { points: Array<{ x: number; y: number; flag: number; color: number }>; palette?: string[]; name?: string; format?: string; outDir: string }
app.post('/export', async (req) => {
  const b = req.body as ExportBody
  const files = exportStitches(b.points, b.palette, b.name ?? 'design', b.format ?? 'dst', b.outDir)
  return { ok: true, files }
})

// ---------- 数据飞轮 ----------

app.post('/flywheel/contribute', async (req) => {
  const parts = req.parts()
  const files: Record<string, Buffer> = {}
  let payload: any = null
  for await (const part of parts) {
    if (part.fieldname === 'manifest') {
      // Fastify 会把 application/json 字段预解析为对象；string 形态容忍 BOM
      const raw: unknown = part.type === 'file' ? (await part.toBuffer()).toString('utf-8') : part.value
      payload = typeof raw === 'string' ? JSON.parse(raw.replace(/^\uFEFF/, '')) : raw
    } else if (part.type === 'file') {
      files[part.filename ?? part.fieldname] = await part.toBuffer()
    }
  }
  if (!payload) return { ok: false, reason: 'missing manifest' }
  if (payload.consent?.scope === 'off') return { ok: false, reason: 'consent off' }
  // 字段名对齐样本包规范文件名
  const mapped: Record<string, Buffer> = {}
  const nameMap: Record<string, string> = { original: 'original.png', artwork: 'artwork.png', preview: 'preview.png', design: 'design.dst', plan: 'plan.json' }
  for (const [field, buf] of Object.entries(files)) {
    mapped[nameMap[field] ?? field] = buf
  }
  const result = collector.saveSample(DATA_ROOT, payload, mapped)
  return { ok: true, ...result }
})

app.get('/flywheel/samples', async (req) => {
  const { pool } = req.query as { pool?: string }
  return collector.listSamples(DATA_ROOT, pool ?? 'inbox')
})

app.post('/flywheel/curate', async () => collector.curate(DATA_ROOT))

app.delete('/flywheel/contributor/:id', async (req) => {
  const { id } = req.params as { id: string }
  return { removed: collector.deleteContributor(DATA_ROOT, id) }
})

// ---------- 训练 ----------

app.post('/training/prepare', async (req) => {
  const { size } = (req.body ?? {}) as { size?: number }
  return training.prepare(DATA_ROOT, size ?? 1024)
})

app.get('/training/stats', async () => training.stats(DATA_ROOT))

await app.listen({ host: '127.0.0.1', port: PORT })
console.log(`[sidecar] open_emby sidecar listening on http://127.0.0.1:${PORT} (node+rust)`)
}

main().catch((e) => {
  console.error('[sidecar] fatal:', e)
  process.exit(1)
})
