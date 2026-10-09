/** Geometry planning and numerical checks for the guided Agent.
 * Qwen handles the user's visual brief; region decisions here are deterministic and editable. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { loadCore } from '../native.js'
import type { AgentOptions, DigitizePlan, StitchResult } from '../../../src/shared/types.js'

export const sourceHash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')

export function plan(imagePath: string, intent: string, maxColors: number, widthMm: number,
  fabric: AgentOptions['fabric'] = 'woven', texture: AgentOptions['texture'] = 'flow'): DigitizePlan {
  if (!['woven', 'knit'].includes(fabric) || !['curved', 'tatami', 'flow'].includes(texture)) throw new Error('Invalid fabric or texture')
  const a = loadCore().analyzeArtwork(imagePath, maxColors, widthMm)
  for (const r of a.regions) {
    if (texture === 'flow') { r.stitchType = 'flow'; r.angleDeg = 0 }
    if (r.stitchType === 'curved') r.stitchType = texture
    r.density = fabric === 'knit' ? 0.5 : 0.45
  }
  const skipped = a.regions.filter(r => !r.enabled).length
  return { ...a, imagePath, maxColors, intent, fabric, sourceHash: sourceHash(imagePath),
    sizeMm: { width: a.widthMm, height: a.heightMm },
    notes: [
      `${a.regions.length} 个独立区域；${a.palette.length} 种前景颜色。白色连通背景留作底布。`,
      '连续毛流由图像结构张量估计并跨色块平滑；它可能跟随花纹边缘而非真实毛发。可在图上拖画毛流引导，或从圆弧中心向外拖画法线引导。',
      `${skipped} 个小于 0.35 mm² 的区域默认关闭，可在区域表中恢复；这里不自动识别眼睛或五官。`,
      fabric === 'knit' ? '针织布试验预设：较疏行距与底针，需结合衬布试绣校准。' : '梭织布试验预设：0.45 mm 行距，大区域使用疏底针。',
      '缎面针目前使用固定方向截面；复杂弯曲缎面需人工分区。曲线填针为几何曲线，不代表已识别真实毛流。'
    ] }
}

export function inspectStitches(result: StitchResult, minLength: number): NonNullable<StitchResult['quality']> {
  let x = 0, y = 0, jumpCount = 0, longJumps = 0, shortStitches = 0, maxLengthMm = 0
  let jumpLengthMm = 0, travelLengthMm = 0
  const travel = new Uint8Array(result.points.length)
  const ranges = result.travelRanges ?? []
  for (let i = 0; i < ranges.length; i += 2) travel.fill(1, ranges[i], ranges[i + 1])
  const cells = new Map<string, number>()
  for (let i = 0; i < result.points.length; i++) {
    const p = result.points[i]
    if (![p.x, p.y].every(Number.isFinite)) throw new Error('Non-finite stitch coordinate')
    if (p.flag === 2) continue
    const length = Math.hypot(p.x - x, p.y - y)
    if (p.flag === 1) { jumpCount++; jumpLengthMm += length; if (length > 5) longJumps++ }
    else {
      if (travel[i]) travelLengthMm += length
      if (length < minLength) shortStitches++
      maxLengthMm = Math.max(maxLengthMm, length)
      const key = `${Math.floor(p.x)},${Math.floor(p.y)}`
      cells.set(key, (cells.get(key) ?? 0) + 1)
    }
    x = p.x; y = p.y
  }
  const denseCells = [...cells.values()].filter(n => n > 12).length
  const warnings = ['尚未实机试绣。几何检查不能预测布料变形、断线或张力；导出后先试绣。']
  if (ranges.length) warnings.push(`增加 ${Math.round(travelLengthMm)} mm 区域内部走线，按后续面针覆盖范围估计；可突出显示检查，是否露线仍需试绣。`)
  if (longJumps) warnings.push(`${longJumps} 次超过 5 mm 的跳针；检查跨区域连线及剪线。`)
  if (shortStitches) warnings.push(`${shortStitches} 个短于 ${minLength} mm 的落针段；保留了边界与纹理，请检查局部密度。`)
  if (denseCells) warnings.push(`${denseCells} 个 1 mm² 网格有超过 12 个落针点；这是检查提示，不是面料合格标准。`)
  return { jumpCount, jumpLengthMm, travelLengthMm, travelCount: ranges.length / 2, longJumps, shortStitches, maxLengthMm, denseCells, warnings }
}

export function stitchPlan(p: DigitizePlan, minLength = 0.3, maxLength = 3): StitchResult {
  if (!p?.mapWidth || !p.sourceHash || sourceHash(p.imagePath) !== p.sourceHash) throw new Error('图稿已变化或方案版本过旧，请重新分析区域。')
  const result = loadCore().stitchArtwork(p, minLength, maxLength) as StitchResult
  result.quality = inspectStitches(result, minLength)
  return result
}
