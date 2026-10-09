import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DigitizePlan, StitchPoint, StitchResult } from '../../../src/shared/types.js'
import { loadCore } from '../native.js'
import { inspectStitches, sourceHash } from './core.js'

export async function paperStitches(plan: DigitizePlan, root: string, min: number, max: number): Promise<StitchResult> {
  if (!plan.sourceHash || sourceHash(plan.imagePath) !== plan.sourceHash) throw new Error('图稿已变化，请重新生成方案。')
  const python = process.env.OPEN_EMBY_PAPER_PYTHON || join(root, 'reference/embroidery-repro-env/Scripts/python.exe')
  const repo = process.env.OPEN_EMBY_PAPER_REPO || join(root, 'reference/embroidery-streamlines')
  const worker = process.env.OPEN_EMBY_PAPER_WORKER || join(process.cwd(), 'workers/paper_digitize.py')
  if (![python, worker, join(repo, 'embroidery/pipeline.py')].every(existsSync)) throw new Error('精细针迹环境未就绪。请在设置中配置论文运行环境，或选择快速模式。')
  const folder = join(root, 'engine/paper', randomUUID()); mkdirSync(folder, { recursive: true })
  const input = join(folder, 'request.json'), output = join(folder, 'result.json')
  writeFileSync(input, JSON.stringify({ ...plan, maxStitchMm: max }))
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, ['-u', worker, input, output, repo], { windowsHide: true, cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8', MPLBACKEND: 'Agg' } })
    let log = ''; const collect = (data: Buffer) => { log = (log + data.toString()).slice(-100000) }
    child.stdout.on('data', collect); child.stderr.on('data', collect)
    const timer = setTimeout(() => { child.kill(); reject(new Error('精细针迹生成超时，已保留图稿。可重试或选择快速模式。')) }, 15 * 60_000)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); writeFileSync(join(folder, 'worker.log'), log); code === 0 ? resolve() : reject(new Error(`精细针迹生成失败（${code}）。记录：${folder}`)) })
  })
  const result = JSON.parse(readFileSync(output, 'utf8')) as { components: Array<{ label: number; color: number; points: StitchPoint[]; areaMm2: number }>; fallback: number[]; records: unknown[] }
  if (!result.components.length) throw new Error('这张图暂时不适合精细流线。请简化图案，或在高级设置选择快速模式。')
  const chunks: Array<{ color: number; points: StitchPoint[]; underlay: number[]; travel: number[] }> = result.components.map(component => {
    const region = plan.regions.find(r => r.label === component.label)!
    const bottom: StitchPoint[] = []
    if (region.underlay) {
      const native = loadCore().stitchArtwork({ ...plan, routeTravel: false, regions: plan.regions.map(r => ({ ...r, enabled: r.label === region.label, stitchType: 'tatami' })) }, min, max) as StitchResult
      const ranges = native.underlayRanges ?? []
      for (let i = 0; i < ranges.length; i += 2) for (let j = ranges[i]; j < ranges[i + 1]; j++) bottom.push(native.points[j])
    }
    return { color: component.color, points: bottom.concat(component.points), underlay: bottom.length ? [0, bottom.length] : [], travel: [] }
  })
  if (result.fallback.length) {
    const labels = new Set(result.fallback)
    const fallbackPlan = { ...plan, regions: plan.regions.map(r => ({ ...r, enabled: r.enabled && labels.has(r.label) })) }
    if (fallbackPlan.regions.some(r => r.enabled)) {
      const native = loadCore().stitchArtwork(fallbackPlan, min, max) as StitchResult
      let start = 0
      for (let i = 0; i <= native.points.length; i++) if (i === native.points.length || native.points[i].flag === 2) {
        if (i > start) {
          const local = (ranges: number[] = []) => ranges.flatMap((_, j) => j % 2 || ranges[j] >= i || ranges[j + 1] <= start ? [] : [Math.max(start, ranges[j]) - start, Math.min(i, ranges[j + 1]) - start])
          chunks.push({ color: native.points[start].color, points: native.points.slice(start, i), underlay: local(native.underlayRanges), travel: local(native.travelRanges) })
        }
        start = i + 1
      }
    }
  }
  chunks.sort((a, b) => a.color - b.color)
  const points: StitchPoint[] = [], underlayRanges: number[] = [], travelRanges: number[] = []
  let colorChanges = 0
  for (const chunk of chunks) {
    const last = points.at(-1)
    if (last && last.color !== chunk.color) { points.push({ ...last, color: chunk.color, flag: 2 }); colorChanges++ }
    underlayRanges.push(...chunk.underlay.map(i => i + points.length)); travelRanges.push(...chunk.travel.map(i => i + points.length))
    for (const point of chunk.points) points.push(point)
  }
  if (points.length > 1_000_000 || points.some(p => ![p.x, p.y].every(Number.isFinite))) throw new Error('针迹数据异常，请简化图案后重试。')
  const enabledArea = plan.regions.filter(r => r.enabled).reduce((n, r) => n + r.areaMm2, 0)
  const stitches: StitchResult = { points, palette: plan.palette, widthMm: plan.widthMm, heightMm: plan.heightMm, stitchCount: points.filter(p => p.flag === 0).length, colorChanges, backgroundIndex: -1, underlayRanges, travelRanges,
    method: { backend: 'paper', paperRegions: result.components.length, detailRegions: result.fallback.length, paperAreaRatio: result.components.reduce((n, r) => n + r.areaMm2, 0) / enabledArea, recordPath: folder } }
  stitches.quality = inspectStitches(stitches, min)
  stitches.quality.warnings.push('精细流线采用作者密度优化与连接；细小或不适用区域采用基础针法。需试绣确认重复覆盖与面料变形。')
  writeFileSync(join(folder, 'stitches.json'), JSON.stringify(stitches))
  return stitches
}
