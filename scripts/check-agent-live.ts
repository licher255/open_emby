import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { generateDraft } from '../src/main/services/draft'
import type { DigitizePlan, StitchResult } from '../src/shared/types'

async function main() {
  const root = resolve(process.argv[2] ?? '..')
  const out = join(root, 'doc/agent-stitch-tests'); mkdirSync(out, { recursive: true })
  async function post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`http://127.0.0.1:8100${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  const draft = await generateDraft(join(root, 'doc/prompt-tests/inputs/cat.png'), { url: 'http://127.0.0.1:8188', dataRoot: root, maxColors: 8, intent: '猫的头部肖像；保留绿色眼睛与嘴部轮廓，合并毛发碎纹。四周留白，适合约10厘米刺绣。' })
  copyFileSync(draft, join(out, 'agent-live-draft.png'))
  const plan = await post<DigitizePlan>('/digitize/plan', { imagePath: draft, maxColors: 8, widthMm: 100, texture: 'curved', fabric: 'woven' })
  const stitches = await post<StitchResult>('/digitize/stitches', { plan, minStitchMm: 0.3, maxStitchMm: 3 })
  assert(stitches.quality && stitches.stitchCount > 100)
  writeFileSync(join(out, 'live-plan.json'), JSON.stringify(plan))
  writeFileSync(join(out, 'live-stitches.json'), JSON.stringify(stitches))
  // Choose a large connected region, edit through the same model, then lock every other pixel.
  const region = [...plan.regions].sort((a, b) => b.areaMm2 - a.areaMm2)[0]
  const edited = await generateDraft(draft, { url: 'http://127.0.0.1:8188', dataRoot: root, maxColors: 8, intent: '保持猫的轮廓和五官位置，将最大的浅棕色毛发区域改成均匀深棕色，不增加纹理。' })
  const destination = join(out, 'agent-live-region-edit.png')
  await post('/digitize/repair-region', { plan, label: region.label, edited, destination })
  assert(readFileSync(destination).length > 100)
  const files = await post<{ files: string[] }>('/export', { points: stitches.points, palette: stitches.palette, format: 'dst', name: 'agent_live', outDir: out })
  assert.equal(files.files.length, 2)
  writeFileSync(join(out, 'live-result.json'), JSON.stringify({ label: region.label, draft, destination, stitchCount: stitches.stitchCount, quality: stitches.quality, files: files.files }, null, 2))
  console.log('PASS live AI brief → plan → stitches → checks → export, and selected-region AI repair.', stitches.stitchCount)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
