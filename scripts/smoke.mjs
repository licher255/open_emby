/** 运行时冒烟：sidecar(制版核心) + emby-engine(生成引擎) 端到端 API 链路。
 *  前提：pnpm run dev 已启动（或服务已在 8100/8189 监听）。
 *  用法：node scripts/smoke.mjs [图片路径] */
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIDECAR = process.env.SIDECAR_URL ?? 'http://127.0.0.1:8100'
const ENGINE = process.env.ENGINE_URL ?? 'http://127.0.0.1:8189'
const image = process.argv[2] ?? fileURLToPath(new URL('../sidecar/test_input.png', import.meta.url))

let failed = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failed++
}

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000)
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

// 1. 健康检查
for (const [name, url] of [['sidecar', SIDECAR], ['engine', ENGINE]]) {
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    check(`${name} /health`, res.ok)
  } catch (e) {
    check(`${name} /health`, false, String(e))
  }
}

// 2. 制版方案（Rust analyzeImage）
try {
  const plan = await post(`${SIDECAR}/digitize/plan`, { imagePath: image, maxColors: 6, widthMm: 100 })
  check('digitize/plan', plan.palette?.length > 0 && plan.sizeMm?.width > 0, `${plan.palette?.length} colors, ${plan.sizeMm?.width}mm`)
} catch (e) {
  check('digitize/plan', false, String(e))
}

// 3. 针迹生成（Rust stitch generator）
let stitches = null
try {
  stitches = await post(`${SIDECAR}/digitize/stitches`, { imagePath: image, maxColors: 8, widthMm: 100 })
  check('digitize/stitches', stitches.points?.length > 0, `${stitches.stitchCount} stitches, ${stitches.colorChanges} color changes`)
} catch (e) {
  check('digitize/stitches', false, String(e))
}

// 4. 导出 DST + 生产单
if (stitches) {
  try {
    const outDir = join(tmpdir(), 'open_emby_smoke')
    mkdirSync(outDir, { recursive: true })
    const r = await post(`${SIDECAR}/export`, { points: stitches.points, palette: stitches.palette, name: 'smoke', format: 'dst', outDir })
    check('export dst', r.files?.length === 2 && r.files.every((f) => existsSync(f)), r.files?.[0])
  } catch (e) {
    check('export dst', false, String(e))
  }
}

// 5. 引擎色块工作流（ComfyUI 兼容 /prompt → /history）
try {
  const { prompt_id } = await post(`${ENGINE}/prompt`, {
    prompt: {
      load: { class_type: 'LoadImage', inputs: { image } },
      blocks: { class_type: 'EmbyColorBlockStylize', inputs: { image: ['load', 0], max_colors: 8, smooth: 3 } },
      save: { class_type: 'SaveImage', inputs: { images: ['blocks', 0], filename_prefix: 'open_emby_smoke' } }
    }
  })
  let done = null
  for (let i = 0; i < 120 && !done; i++) {
    await new Promise((r) => setTimeout(r, 500))
    const h = await fetch(`${ENGINE}/history/${prompt_id}`).then((r) => r.json())
    const outputs = h?.[prompt_id]?.outputs
    if (outputs?.save?.images?.length) done = outputs.save.images[0]
    else if (outputs && Object.keys(outputs).length > 0 && !outputs.save) throw new Error('工作流完成但 save 节点无输出')
  }
  check('engine color-blocks workflow', !!done, done?.filename)
} catch (e) {
  check('engine color-blocks workflow', false, String(e))
}

process.exit(failed ? 1 : 0)
