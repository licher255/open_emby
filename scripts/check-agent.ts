/** Native + planner integration: pnpm exec tsx scripts/check-agent.ts <data-root> */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { plan, stitchPlan } from '../sidecar/src/agent/core'
import { loadCore } from '../sidecar/src/native'
import { exportStitches, toRecords } from '../sidecar/src/exporters/index'
import type { StitchResult } from '../src/shared/types'

const root = resolve(process.argv[2] ?? '..')
const out = join(root, 'doc/agent-stitch-tests')
mkdirSync(out, { recursive: true })
const core = loadCore()
function svg(result: StitchResult): string {
  let x = 0, y = 0
  const paths = new Map<number, string[]>()
  for (const p of result.points) {
    if (p.flag === 0) {
      if (!paths.has(p.color)) paths.set(p.color, [])
      paths.get(p.color)!.push(`M${x.toFixed(3)},${y.toFixed(3)}L${p.x.toFixed(3)},${p.y.toFixed(3)}`)
    }
    if (p.flag !== 2) { x = p.x; y = p.y }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ${result.widthMm + 4} ${result.heightMm + 4}"><rect x="-2" y="-2" width="100%" height="100%" fill="#f8f5ef"/>${[...paths].map(([color, d]) => `<path d="${d.join('')}" stroke="${result.palette[color]}" stroke-width="0.22" fill="none" stroke-linecap="round"/>`).join('')}</svg>`
}
function directions(s: StitchResult) {
  const bins = Array(12).fill(0); let x = 0, y = 0
  for (const p of s.points) {
    if (p.flag === 0) { const a = ((Math.atan2(p.y - y, p.x - x) * 180 / Math.PI) + 180) % 180; bins[Math.min(11, Math.floor(a / 15))]++ }
    if (p.flag !== 2) { x = p.x; y = p.y }
  }
  return bins
}
const records = []
for (const name of ['cat', 'astronaut']) {
  const input = join(root, 'doc/backend-draft-tests', `${name}-draft.png`)
  const p = plan(input, '保留眼睛和嘴，简化毛发', 8, 100)
  assert.deepEqual(p.labels, plan(input, '', 8, 100).labels, 'segmentation must be repeatable')
  const restored = JSON.parse(JSON.stringify(p))
  const s = stitchPlan(restored, 0.3, 3)
  assert(s.points.length > 100)
  assert(s.quality!.maxLengthMm <= 3.000001)
  assert(s.points.every(v => Number.isFinite(v.x) && Number.isFinite(v.y) && v.x >= 0 && v.y >= 0 && v.x <= 100 && v.y <= s.heightMm))
  const previous = core.generateStitches(input, 8, 100, 0.3, 3, 0.15) as StitchResult
  const bins = directions(s)
  assert(bins.filter(n => n > s.stitchCount * 0.02).length >= 4, 'expected varied directions')
  const enabled = restored.regions.filter((r: { enabled: boolean }) => r.enabled)
  enabled.sort((a: { areaMm2: number }, b: { areaMm2: number }) => b.areaMm2 - a.areaMm2)
  const target = enabled[0]
  const rotated = structuredClone(restored); rotated.regions.find((r: { id: string }) => r.id === target.id).angleDeg += 55
  const updated = stitchPlan(rotated, 0.3, 3)
  assert.notDeepEqual(updated.points, s.points, 'editable direction must affect actual points')
  const disabled = structuredClone(restored); disabled.regions.find((r: { id: string }) => r.id === target.id).enabled = false
  assert(stitchPlan(disabled, 0.3, 3).stitchCount < s.stitchCount)
  const bad = structuredClone(restored); bad.labels[0] = 987654
  assert.throws(() => stitchPlan(bad, 0.3, 3), /label/)
  const stale = structuredClone(restored); stale.sourceHash = 'outdated'
  assert.throws(() => stitchPlan(stale, 0.3, 3), /图稿/)
  const recordsDst = toRecords(s.points)
  let x = 0, y = 0
  for (let i = 0; i < recordsDst.length; i++) {
    if (recordsDst[i].flag === 2) continue
    x += Math.round(recordsDst[i].dxMm * 10); y += Math.round(recordsDst[i].dyMm * 10)
    assert.equal(x, Math.round(s.points[i].x * 10)); assert.equal(y, Math.round(s.points[i].y * 10))
  }
  const files = exportStitches(s.points, s.palette, `${name}_agent`, 'dst', out)
  assert(files.every(existsSync)); assert(readFileSync(files[0]).length > 512)
  writeFileSync(join(out, `${name}-plan.json`), JSON.stringify(p))
  writeFileSync(join(out, `${name}-stitches.json`), JSON.stringify(s))
  writeFileSync(join(out, `${name}-before.svg`), svg(previous))
  writeFileSync(join(out, `${name}-after.svg`), svg(s))
  writeFileSync(join(out, `${name}-rotated.svg`), svg(updated))
  const record = { name, regions: p.regions.length, enabled: enabled.length, before: previous.stitchCount, after: s.stitchCount, directionsBefore: directions(previous), directionsAfter: bins, quality: s.quality }
  records.push(record); console.log(JSON.stringify(record))
}
writeFileSync(join(out, 'results.json'), JSON.stringify(records, null, 2))
console.log('PASS native plan persistence, deterministic segmentation, region edits, limits, stale-plan rejection, DST coordinates and exports.')
