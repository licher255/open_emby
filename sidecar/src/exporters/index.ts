/** 刺绣机文件导出编排：真实针迹序列（Rust 生成） -> DST 编码（Rust）。
 *  针迹路径生成见 crates/emby-core/src/stitch.rs；此处只做相对位移换算与落盘。 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadCore, type StitchPoint, type StitchRecord } from '../native.js'

/** 绝对坐标针迹点 → DST 相对位移记录 */
function toRecords(points: StitchPoint[]): StitchRecord[] {
  const out: StitchRecord[] = []
  let cx = 0
  let cy = 0
  for (const p of points) {
    if (p.flag === 2) { // color change：位移为零的控制记录
      out.push({ dxMm: 0, dyMm: 0, flag: 2 })
      continue
    }
    out.push({ dxMm: p.x - cx, dyMm: p.y - cy, flag: p.flag })
    cx = p.x
    cy = p.y
  }
  return out
}

/** 生产单（色序表）：多色编排随 DST 一起产出，车间按此换线 */
interface ColorSheetEntry { order: number; colorIndex: number; stitches: number }

export function exportStitches(
  points: StitchPoint[],
  palette: string[] | undefined,
  name: string,
  format: string,
  outDir: string
): string[] {
  mkdirSync(outDir, { recursive: true })
  if (format !== 'dst') {
    throw new Error(`暂不支持格式 ${format}（当前 dst；pes/jef 编解码器将在 crates/emby-core 扩展）`)
  }
  if (!points?.length) throw new Error('没有可导出的针迹（请先生成针迹）')
  const safe = (name.replace(/[^a-zA-Z0-9_]/g, '_') || 'design').slice(0, 16)
  const buf = loadCore().dstEncode(toRecords(points), safe)
  const path = join(outDir, `${safe}.dst`)
  writeFileSync(path, buf)

  // 生产单：色序 + 每色针数 + 预估时长（按 800 针/分钟）
  const counts = new Map<number, number>()
  let stitches = 0
  for (const p of points) {
    if (p.flag === 0) {
      stitches++
      counts.set(p.color, (counts.get(p.color) ?? 0) + 1)
    }
  }
  const sheet: ColorSheetEntry[] = []
  const seen = new Set<number>()
  for (const p of points) {
    if (!seen.has(p.color) && counts.has(p.color)) {
      seen.add(p.color)
      sheet.push({ order: sheet.length + 1, colorIndex: p.color, stitches: counts.get(p.color)! })
    }
  }
  const sheetDoc = {
    name: safe,
    stitches,
    colorChanges: Math.max(0, sheet.length - 1),
    estimatedMinutes: Math.round((stitches / 800) * 10) / 10,
    colorOrder: sheet.map((e) => ({
      order: e.order,
      color: palette?.[e.colorIndex] ?? `#${e.colorIndex}`,
      stitches: e.stitches
    }))
  }
  const sheetPath = join(outDir, `${safe}.colorsheet.json`)
  writeFileSync(sheetPath, JSON.stringify(sheetDoc, null, 2), 'utf-8')
  return [path, sheetPath]
}
