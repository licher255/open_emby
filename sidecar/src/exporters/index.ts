/** 刺绣机文件导出编排：DigitizePlan -> 针迹序列(TS) -> DST 编码(Rust)。
 *  MVP：按色块网格填充占位；真实针迹路径生成下沉至 Rust 后替换 buildRecords。 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadCore, FLAG, type StitchRecord } from '../native.js'

interface PlanRegion { color: string; stitchType: string; density: number }
interface Plan {
  palette?: string[]
  regions?: PlanRegion[]
  sizeMm: { width: number; height: number }
}

export function exportPlan(plan: Plan, format: string, outDir: string): string[] {
  mkdirSync(outDir, { recursive: true })
  if (format !== 'dst') {
    throw new Error(`暂不支持格式 ${format}（MVP 仅 dst；pes/jef 编解码器将在 crates/emby-core 实现）`)
  }
  const records = buildRecords(plan)
  const buf = loadCore().dstEncode(records, 'design')
  const path = join(outDir, 'design.dst')
  writeFileSync(path, buf)
  return [path]
}

/** 针迹序列编排：每色一块，换色记录分隔（多色编排顺序 = palette 顺序） */
function buildRecords(plan: Plan): StitchRecord[] {
  const out: StitchRecord[] = []
  const w = plan.sizeMm.width
  const h = plan.sizeMm.height
  const palette = plan.palette ?? []
  let cx = 0
  let cy = 0
  const move = (x: number, y: number, flag: number) => {
    out.push({ dxMm: x - cx, dyMm: y - cy, flag })
    cx = x
    cy = y
  }
  palette.forEach((color, i) => {
    if (i > 0) out.push({ dxMm: 0, dyMm: 0, flag: FLAG.COLOR })
    const regions = (plan.regions ?? []).filter((r) => r.color === color)
    if (regions.length === 0) {
      move(0, 0, FLAG.STITCH)
      move(w, 0, FLAG.STITCH)
      return
    }
    for (const r of regions) fillRegion(move, r, w, h)
  })
  return out
}

/** 网格扫描填充（占位实现）：蛇形往返直针 */
function fillRegion(
  move: (x: number, y: number, f: number) => void,
  region: PlanRegion,
  w: number,
  h: number
): void {
  const step = Math.max(1, (region.density || 0.4) * 4)
  move(0, 0, FLAG.JUMP)
  let y = 0
  let flip = false
  while (y <= h) {
    move(flip ? 0 : w, y, FLAG.STITCH)
    flip = !flip
    y += step
  }
}
