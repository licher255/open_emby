import { useEffect, useRef } from 'react'
import type { StitchResult } from '@shared/types'

/** 针迹仿真：按绣制顺序把针迹点画成彩色折线（跳针与换色不落笔）。
 *  progress = 绣制进度 0..1（类比切片软件的层滑杆）；hidden = 隐藏的换色层 */
export default function StitchPreview({ stitches, progress, hidden }: { stitches: StitchResult; progress: number; hidden: Set<number> }) {
  const ref = useRef<HTMLCanvasElement>(null)
  // 增量绘制状态：进度前进时只补画新增针迹，避免拖动滑杆每帧重绘数万次 stroke
  const drawn = useRef<{ stitches: StitchResult | null; hidden: Set<number> | null; upto: number }>({ stitches: null, hidden: null, upto: 0 })

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || stitches.points.length === 0) return
    const W = 640
    const H = Math.max(1, Math.round((W * stitches.heightMm) / Math.max(stitches.widthMm, 1)))
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const s = W / stitches.widthMm
    const total = stitches.points.length
    const upto = Math.floor(total * progress)
    // 全量重绘：换了针迹/隐藏层，或进度回退（画布无法"撤销"已画内容）
    const full = drawn.current.stitches !== stitches || drawn.current.hidden !== hidden || drawn.current.upto > upto
    if (full) {
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)
    }

    let px = 0
    let py = 0
    ctx.lineWidth = 1.0
    ctx.lineCap = 'round'
    // 增量起点的前一点是折线起点；跳针/换色不落笔，隐藏层只推进坐标
    const from = full ? 0 : drawn.current.upto
    if (from > 0) {
      for (let i = 0; i < from; i++) {
        const p = stitches.points[i]
        if (hidden.has(p.color)) {
          if (p.flag !== 2) { px = p.x * s; py = p.y * s }
        } else {
          px = p.x * s; py = p.y * s
        }
      }
    }
    for (let i = from; i < upto; i++) {
      const p = stitches.points[i]
      if (hidden.has(p.color)) {
        if (p.flag !== 2) { px = p.x * s; py = p.y * s }
        continue
      }
      const x = p.x * s
      const y = p.y * s
      if (p.flag === 0) {
        ctx.strokeStyle = stitches.palette[p.color] ?? '#111118'
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(x, y)
        ctx.stroke()
      }
      px = x
      py = y
    }
    drawn.current = { stitches, hidden, upto }
  }, [stitches, progress, hidden])

  return (
    <div className="stitch-canvas-wrap">
      <canvas ref={ref} className="stitch-canvas" />
    </div>
  )
}
