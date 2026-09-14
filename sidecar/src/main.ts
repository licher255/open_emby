/** open_emby sidecar — 制版核心 + 制版 Agent + 数据飞轮的本地 HTTP 服务（纯 TS 编排层）。
 *  计算密集工作（图像分析/DST 编码/phash/缩放）全部委托 crates/emby-core (Rust)。
 *  仅监听 127.0.0.1，由 Electron 主进程拉起。 */
import Fastify from 'fastify'
import multipart from '@fastify/multipart'
import { plan as agentPlan } from './agent/core.js'
import { exportPlan } from './exporters/index.js'
import * as collector from './flywheel/collector.js'
import * as training from './training/prepare.js'

const DATA_ROOT = process.env.OPEN_EMBY_DATA_ROOT ?? 'E:\\Project-刺绣机'
const PORT = Number(process.env.OPEN_EMBY_SIDECAR_PORT ?? 8100)

const app = Fastify({ logger: false })
await app.register(multipart)

app.get('/health', async () => ({ ok: true, service: 'open_emby-sidecar', version: '0.1.0', runtime: 'node+rust' }))

interface PlanBody { imagePath: string; intent?: string; maxColors?: number; widthMm?: number }
app.post('/digitize/plan', async (req) => {
  const b = req.body as PlanBody
  return agentPlan(b.imagePath, b.intent ?? '', b.maxColors ?? 6, b.widthMm ?? 100)
})

interface ExportBody { plan: any; format?: string; outDir: string }
app.post('/export', async (req) => {
  const b = req.body as ExportBody
  const files = exportPlan(b.plan, b.format ?? 'dst', b.outDir)
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
