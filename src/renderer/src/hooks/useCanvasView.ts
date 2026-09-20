import { useCallback, useEffect, useRef, useState } from 'react'

export interface ViewTransform { scale: number; tx: number; ty: number }
interface Pt { x: number; y: number }

/** 画布视图：拖拽平移 + 滚轮/双指捏合缩放（Pointer Events，鼠标/触屏/iPad Pencil 统一）。
 *  容器 ref + spread panHandlers；内容套一层 div 应用 transform。
 *  onToolDown/Move/Up 可选接管绘画工具（鼠标/压感笔触发；手指触摸永远平移/捏合）。 */
export function useCanvasView(opts?: {
  onToolDown?: (p: Pt, e: PointerEvent) => void
  onToolMove?: (p: Pt, e: PointerEvent) => void
  onToolUp?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<ViewTransform>({ scale: 1, tx: 0, ty: 0 })
  const pointers = useRef(new Map<number, Pt>())
  const panStart = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const pinch = useRef<{ lastDist: number; lastCx: number; lastCy: number } | null>(null)
  const toolActive = useRef(false)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const viewRef = useRef(view)
  viewRef.current = view

  /** 内容适配容器并居中（初始/「适应」） */
  const fit = useCallback((contentW: number, contentH: number) => {
    const el = ref.current
    if (!el || !contentW || !contentH) return
    const rect = el.getBoundingClientRect()
    const scale = Math.min(rect.width / contentW, rect.height / contentH) * 0.96
    setView({ scale, tx: (rect.width - contentW * scale) / 2, ty: (rect.height - contentH * scale) / 2 })
  }, [])

  /** 以容器内 (cx,cy) 为锚点缩放 */
  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setView((v) => {
      const scale = Math.min(8, Math.max(0.1, v.scale * factor))
      const k = scale / v.scale
      return { scale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k }
    })
  }, [])

  const toLocal = useCallback((e: React.PointerEvent): Pt => {
    const rect = ref.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  /** 容器内坐标 → 内容（图像）坐标 */
  const toContent = useCallback((p: Pt): Pt => ({
    x: (p.x - viewRef.current.tx) / viewRef.current.scale,
    y: (p.y - viewRef.current.ty) / viewRef.current.scale
  }), [])

  // 滚轮缩放（必须非 passive 才能 preventDefault）
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  function onPointerDown(e: React.PointerEvent) {
    ref.current?.setPointerCapture(e.pointerId)
    const p = toLocal(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 2) {
      // 双指捏合开始：终止进行中的工具/平移
      toolActive.current = false
      panStart.current = null
      const [a, b] = [...pointers.current.values()]
      pinch.current = { lastDist: Math.hypot(a.x - b.x, a.y - b.y), lastCx: (a.x + b.x) / 2, lastCy: (a.y + b.y) / 2 }
      return
    }
    if (e.pointerType === 'touch') {
      panStart.current = { x: p.x, y: p.y, tx: viewRef.current.tx, ty: viewRef.current.ty }
    } else if (optsRef.current?.onToolDown) {
      toolActive.current = true
      optsRef.current.onToolDown(toContent(p), e.nativeEvent)
    } else {
      panStart.current = { x: p.x, y: p.y, tx: viewRef.current.tx, ty: viewRef.current.ty }
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return
    const p = toLocal(e)
    pointers.current.set(e.pointerId, p)

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const cx = (a.x + b.x) / 2
      const cy = (a.y + b.y) / 2
      const ps = pinch.current
      // 增量式：锚点跟随捏合中心，中心位移即平移
      zoomAt(cx, cy, dist / Math.max(ps.lastDist, 1))
      setView((v) => ({ ...v, tx: v.tx + (cx - ps.lastCx), ty: v.ty + (cy - ps.lastCy) }))
      pinch.current = { lastDist: dist, lastCx: cx, lastCy: cy }
      return
    }
    if (toolActive.current && optsRef.current?.onToolMove) {
      optsRef.current.onToolMove(toContent(p), e.nativeEvent)
      return
    }
    if (panStart.current) {
      const ps = panStart.current
      setView((v) => ({ ...v, tx: ps.tx + (p.x - ps.x), ty: ps.ty + (p.y - ps.y) }))
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) {
      if (toolActive.current) optsRef.current?.onToolUp?.()
      toolActive.current = false
      panStart.current = null
    }
  }

  return {
    ref,
    view,
    setView,
    fit,
    zoomAt,
    toContent,
    panHandlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp }
  }
}
