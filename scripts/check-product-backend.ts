import { resolve, join } from 'node:path'
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { paperStitches } from '../sidecar/src/agent/paper'
import { plan } from '../sidecar/src/agent/core'
import { exportStitches } from '../sidecar/src/exporters/index'
import { generateDraft } from '../src/main/services/draft'
import { ensureComfy, stopComfy } from '../src/main/services/comfy'

async function main() {
  const root = resolve(process.argv[2] || '..'), out = join(root, 'doc/product-flow-tests')
  mkdirSync(out, { recursive: true })
  process.env.OPEN_EMBY_PAPER_WORKER = resolve('sidecar/workers/paper_digitize.py')
  let input = join(root, 'doc/backend-draft-tests/cat-draft.png')
  try {
    if (process.argv.includes('--ai')) {
      console.log('Starting local image service…')
      await ensureComfy('http://127.0.0.1:8188', root)
      input = await generateDraft(join(root, 'doc/prompt-tests/inputs/cat.png'), { url: 'http://127.0.0.1:8188', dataRoot: root, maxColors: 6, style: 'soft', intent: '猫的头部肖像，保留绿色眼睛。', seed: 20261003 })
    }
    copyFileSync(input, join(out, 'artwork.png'))
    console.log('Analyzing artwork…')
    const p = plan(input, '猫的头部肖像', 6, 100, 'woven', 'flow')
    writeFileSync(join(out, 'plan.json'), JSON.stringify(p))
    console.log('Running paper pipeline…')
    const started = Date.now()
    const s = await paperStitches(p, root, .3, 3)
    assert(s.method?.backend === 'paper' && s.method.paperRegions! > 0)
    assert(s.quality!.maxLengthMm <= 3.00001)
    assert(s.points.every(q => [q.x, q.y].every(Number.isFinite) && q.x >= 0 && q.y >= 0 && q.x <= s.widthMm && q.y <= s.heightMm))
    const files = exportStitches(s.points, s.palette, 'product_flow', 'dst', out)
    writeFileSync(join(out, 'stitches.json'), JSON.stringify(s))
    writeFileSync(join(out, 'result.json'), JSON.stringify({ seconds: (Date.now() - started) / 1000, method: s.method, quality: s.quality, stitchCount: s.stitchCount, files }, null, 2))
    let x = 0, y = 0; const lines: string[] = []
    for (const q of s.points) { if (q.flag === 0) lines.push(`<path d="M${x},${y}L${q.x},${q.y}" stroke="${s.palette[q.color]}"/>`); if (q.flag !== 2) { x = q.x; y = q.y } }
    writeFileSync(join(out, 'stitches.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.widthMm} ${s.heightMm}"><rect width="100%" height="100%" fill="#faf7ef"/><g fill="none" stroke-width="0.25" stroke-linecap="round">${lines.join('')}</g></svg>`)
    console.log('PASS product pipeline', s.stitchCount, s.method)
  } finally { stopComfy() }
}
main().catch(e => { console.error(e); process.exitCode = 1 })
