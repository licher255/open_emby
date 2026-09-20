import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '../stores/toast'
import { useT } from '../i18n'
import Icon from './Icon'
import { useCanvasView } from '../hooks/useCanvasView'

type Tool = 'pan' | 'marquee' | 'pen' | 'fill' | 'eraser'
type LayerKind = 'fill' | 'line'

interface Props {
  blocksUrl: string
  lineArtUrl: string | null
  onSave: (blocksDataUrl: string, lineArtDataUrl: string | null) => Promise<void>
}

interface Pt { x: number; y: number }
interface EditLayer {
  id: string
  name: string
  kind: LayerKind
  canvas: HTMLCanvasElement
  visible: boolean
}

function extractPalette(data: Uint8ClampedArray): string[] {
  const counts = new Map<string, number>()
  for (let i = 0; i < data.length; i += 4) {
    const hex = '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([c]) => c)
}

function blankCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 自由画布图层编辑器：底部工具条、右侧图层面板，支持多线稿/填充图层。 */
export default function LayerEditor({ blocksUrl, lineArtUrl, onSave }: Props) {
  const t = useT()
  const displayRef = useRef<HTMLCanvasElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const layersRef = useRef<EditLayer[]>([])
  const activeLayerIdRef = useRef('')
  const undoRef = useRef<Array<{ layerId: string; data: ImageData }>>([])
  const lastPen = useRef<Pt | null>(null)
  const renderRef = useRef(() => {})
  const floodFillRef = useRef((_p: Pt) => {})
  const drawRef = useRef((_from: Pt, _to: Pt, _erase: boolean, _pressure: number) => {})

  const [ready, setReady] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [layers, setLayers] = useState<EditLayer[]>([])
  const [activeLayerId, setActiveLayerId] = useState('')
  const [tool, setTool] = useState<Tool>('pan')
  const [brushSizes, setBrushSizes] = useState({ pen: 5, eraser: 18 })
  const [color, setColor] = useState('#2727e6')
  const [palette, setPalette] = useState<string[]>([])
  const [sel, setSel] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const [saving, setSaving] = useState(false)

  layersRef.current = layers
  activeLayerIdRef.current = activeLayerId
  const activeLayer = layers.find((layer) => layer.id === activeLayerId) ?? null

  const onToolDown = useCallback((p: Pt, e: PointerEvent) => {
    if (tool === 'fill') { floodFillRef.current(p); return }
    if (tool === 'pen' || tool === 'eraser') {
      pushUndoActive()
      drawRef.current(p, p, tool === 'eraser', e.pressure)
      lastPen.current = p
      renderRef.current()
      return
    }
    if (tool === 'marquee') setSel({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
  }, [tool])

  const onToolMove = useCallback((p: Pt, e: PointerEvent) => {
    if ((tool === 'pen' || tool === 'eraser') && lastPen.current) {
      drawRef.current(lastPen.current, p, tool === 'eraser', e.pressure)
      lastPen.current = p
      renderRef.current()
    } else if (tool === 'marquee') {
      setSel((current) => current ? { ...current, x1: p.x, y1: p.y } : current)
    }
  }, [tool])

  const onToolUp = useCallback(() => { lastPen.current = null }, [])
  const cv = useCanvasView(tool === 'pan' ? undefined : { onToolDown, onToolMove, onToolUp })

  useEffect(() => {
    let alive = true
    const load = (url: string) => new Promise<HTMLCanvasElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => {
        const canvas = blankCanvas(image.naturalWidth, image.naturalHeight)
        canvas.getContext('2d')!.drawImage(image, 0, 0)
        resolve(canvas)
      }
      image.onerror = reject
      image.src = url
    })
    const loadAll = async () => {
      const blocks = await load(blocksUrl)
      const initial: EditLayer[] = [{ id: 'fill-base', name: t('layers.colorBase'), kind: 'fill', canvas: blocks, visible: true }]
      if (lineArtUrl) initial.push({ id: 'line-base', name: t('layers.lineBase'), kind: 'line', canvas: await load(lineArtUrl), visible: true })
      if (!alive) return
      setLayers(initial)
      setActiveLayerId(initial[0].id)
      setSize({ w: blocks.width, h: blocks.height })
      setPalette(extractPalette(blocks.getContext('2d')!.getImageData(0, 0, blocks.width, blocks.height).data))
      setReady(true)
    }
    loadAll().catch(() => {})
    return () => { alive = false }
  }, [blocksUrl, lineArtUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  const render = useCallback(() => {
    const canvas = displayRef.current
    if (!canvas || !size.w || !size.h) return
    canvas.width = size.w
    canvas.height = size.h
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, size.w, size.h)
    for (const layer of layers) {
      if (!layer.visible) continue
      ctx.globalCompositeOperation = layer.kind === 'line' ? 'multiply' : 'source-over'
      ctx.drawImage(layer.canvas, 0, 0)
    }
    ctx.globalCompositeOperation = 'source-over'
    if (sel) {
      ctx.strokeStyle = '#2727e6'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 6])
      ctx.strokeRect(Math.min(sel.x0, sel.x1), Math.min(sel.y0, sel.y1), Math.abs(sel.x1 - sel.x0), Math.abs(sel.y1 - sel.y0))
      ctx.setLineDash([])
    }
  }, [layers, sel, size])

  useEffect(() => { renderRef.current = render }, [render])
  useEffect(() => { if (ready) render() }, [ready, render])
  useEffect(() => { if (ready && size.w) cv.fit(size.w, size.h) }, [ready, size]) // eslint-disable-line react-hooks/exhaustive-deps

  function currentLayer(): EditLayer | undefined {
    return layersRef.current.find((layer) => layer.id === activeLayerIdRef.current)
  }

  function pushUndoActive() {
    const layer = currentLayer()
    if (!layer) return
    undoRef.current.push({ layerId: layer.id, data: layer.canvas.getContext('2d')!.getImageData(0, 0, layer.canvas.width, layer.canvas.height) })
    if (undoRef.current.length > 20) undoRef.current.shift()
  }

  function undo() {
    const last = undoRef.current.pop()
    if (!last) return
    const layer = layersRef.current.find((item) => item.id === last.layerId)
    if (layer) layer.canvas.getContext('2d')!.putImageData(last.data, 0, 0)
    renderRef.current()
  }

  function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }

  function fillSelection() {
    const layer = currentLayer()
    if (!layer || layer.kind !== 'fill' || !sel) return
    pushUndoActive()
    const [r, g, b] = hexToRgb(color)
    const x = Math.max(0, Math.floor(Math.min(sel.x0, sel.x1)))
    const y = Math.max(0, Math.floor(Math.min(sel.y0, sel.y1)))
    const width = Math.min(layer.canvas.width - x, Math.ceil(Math.abs(sel.x1 - sel.x0)))
    const height = Math.min(layer.canvas.height - y, Math.ceil(Math.abs(sel.y1 - sel.y0)))
    if (width <= 0 || height <= 0) return
    const ctx = layer.canvas.getContext('2d')!
    const data = ctx.getImageData(x, y, width, height)
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = r; data.data[i + 1] = g; data.data[i + 2] = b; data.data[i + 3] = 255
    }
    ctx.putImageData(data, x, y)
    setSel(null)
    renderRef.current()
  }

  function floodFill(pt: Pt) {
    const layer = currentLayer()
    if (!layer || layer.kind !== 'fill') return
    const x = Math.round(pt.x)
    const y = Math.round(pt.y)
    const canvas = layer.canvas
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
    const ctx = canvas.getContext('2d')!
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    const start = (y * canvas.width + x) * 4
    const target = [data[start], data[start + 1], data[start + 2], data[start + 3]]
    const [r, g, b] = hexToRgb(color)
    if (target[0] === r && target[1] === g && target[2] === b && target[3] === 255) return
    pushUndoActive()
    const stack = [x + y * canvas.width]
    const matches = (index: number) => data[index * 4] === target[0] && data[index * 4 + 1] === target[1] && data[index * 4 + 2] === target[2] && data[index * 4 + 3] === target[3]
    while (stack.length) {
      const index = stack.pop()!
      if (!matches(index)) continue
      data[index * 4] = r; data[index * 4 + 1] = g; data[index * 4 + 2] = b; data[index * 4 + 3] = 255
      const px = index % canvas.width
      const py = Math.floor(index / canvas.width)
      if (px > 0) stack.push(index - 1)
      if (px < canvas.width - 1) stack.push(index + 1)
      if (py > 0) stack.push(index - canvas.width)
      if (py < canvas.height - 1) stack.push(index + canvas.width)
    }
    ctx.putImageData(image, 0, 0)
    renderRef.current()
  }

  function draw(from: Pt, to: Pt, erase: boolean, pressure: number) {
    const layer = currentLayer()
    if (!layer) return
    const ctx = layer.canvas.getContext('2d')!
    ctx.save()
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    ctx.strokeStyle = layer.kind === 'line' ? '#1d1d1f' : color
    ctx.fillStyle = ctx.strokeStyle
    const baseSize = erase ? brushSizes.eraser : brushSizes.pen
    const pressureScale = pressure > 0 ? 0.5 + pressure : 1
    ctx.lineWidth = Math.max(1, baseSize * pressureScale)
    ctx.lineCap = 'round'
    if (from.x === to.x && from.y === to.y) {
      ctx.beginPath()
      ctx.arc(to.x, to.y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  useEffect(() => { floodFillRef.current = floodFill })
  useEffect(() => { drawRef.current = draw })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'z') { event.preventDefault(); undo() }
    }
    const onMenuUndo = (e: Event) => { e.preventDefault(); undo() } // preventDefault = 已消费（App 据此决定是否提示"无可撤销"）
    window.addEventListener('keydown', onKey)
    window.addEventListener('emby:undo', onMenuUndo)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('emby:undo', onMenuUndo)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function addLayer(kind: LayerKind) {
    if (!size.w || !size.h) return
    const count = layers.filter((layer) => layer.kind === kind).length + 1
    const layer: EditLayer = {
      id: crypto.randomUUID(),
      name: t(kind === 'line' ? 'layers.newLineName' : 'layers.newFillName', { count }),
      kind,
      canvas: blankCanvas(size.w, size.h),
      visible: true
    }
    setLayers((current) => [...current, layer])
    setActiveLayerId(layer.id)
    setTool(kind === 'line' ? 'pen' : 'fill')
  }

  function toggleLayer(id: string) {
    setLayers((current) => current.map((layer) => layer.id === id ? { ...layer, visible: !layer.visible } : layer))
  }

  function removeLayer(id: string) {
    if (layers.length <= 1) return
    const index = layers.findIndex((layer) => layer.id === id)
    const next = layers.filter((layer) => layer.id !== id)
    setLayers(next)
    if (activeLayerId === id) setActiveLayerId(next[Math.max(0, index - 1)].id)
  }

  async function save() {
    if (!size.w || !size.h) return
    setSaving(true)
    try {
      const blocks = blankCanvas(size.w, size.h)
      const blocksCtx = blocks.getContext('2d')!
      for (const layer of layers) if (layer.visible && layer.kind === 'fill') blocksCtx.drawImage(layer.canvas, 0, 0)

      const visibleLines = layers.filter((layer) => layer.visible && layer.kind === 'line')
      let lineDataUrl: string | null = null
      if (visibleLines.length) {
        const line = blankCanvas(size.w, size.h)
        const lineCtx = line.getContext('2d')!
        lineCtx.fillStyle = '#fff'
        lineCtx.fillRect(0, 0, size.w, size.h)
        lineCtx.globalCompositeOperation = 'multiply'
        for (const layer of visibleLines) lineCtx.drawImage(layer.canvas, 0, 0)
        lineDataUrl = line.toDataURL('image/png')
      }
      await onSave(blocks.toDataURL('image/png'), lineDataUrl)
    } catch (error) {
      toast.error(t('toast.fail.refine', { error: String(error) }))
    } finally {
      setSaving(false)
    }
  }

  function zoomCenter(factor: number) {
    const element = cv.ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    cv.zoomAt(rect.width / 2, rect.height / 2, factor)
  }

  function updateBrushCursor(event: React.PointerEvent) {
    const cursor = cursorRef.current
    const element = cv.ref.current
    if (!cursor || !element || (tool !== 'pen' && tool !== 'eraser')) return
    const rect = element.getBoundingClientRect()
    cursor.style.left = `${event.clientX - rect.left}px`
    cursor.style.top = `${event.clientY - rect.top}px`
    cursor.dataset.visible = 'true'
  }

  function hideBrushCursor() {
    if (cursorRef.current) cursorRef.current.dataset.visible = 'false'
  }

  const brushSize = tool === 'eraser' ? brushSizes.eraser : brushSizes.pen
  const cursorDiameter = Math.max(4, brushSize * cv.view.scale)

  return (
    <div className="layer-editor le-root">
      <div
        ref={cv.ref}
        className={`le-canvas-wrap tool-${tool}`}
        style={{ touchAction: 'none' }}
        onPointerEnter={updateBrushCursor}
        onPointerLeave={hideBrushCursor}
        onPointerDown={(event) => { updateBrushCursor(event); cv.panHandlers.onPointerDown(event) }}
        onPointerMove={(event) => { updateBrushCursor(event); cv.panHandlers.onPointerMove(event) }}
        onPointerUp={cv.panHandlers.onPointerUp}
        onPointerCancel={(event) => { hideBrushCursor(); cv.panHandlers.onPointerCancel(event) }}
      >
        <div className="le-stage" style={{ transform: `translate(${cv.view.tx}px, ${cv.view.ty}px) scale(${cv.view.scale})` }}>
          <canvas ref={displayRef} className={`le-canvas tool-${tool}`} />
        </div>
        {(tool === 'pen' || tool === 'eraser') && (
          <div
            ref={cursorRef}
            className={`le-brush-cursor ${tool}`}
            data-visible="false"
            style={{ width: cursorDiameter, height: cursorDiameter, borderColor: tool === 'pen' ? color : undefined }}
          >
            <span className="le-cursor-icon"><Icon name={tool === 'pen' ? 'pen-nib' : 'eraser'} size={9} /></span>
          </div>
        )}
      </div>

      <aside className="le-layers-panel">
        <div className="le-panel-head">
          <span><Icon name="layer-group" /> {t('layers.title')}</span>
          <div>
            <button className="le-tool" data-tip={t('layers.addFill')} onClick={() => addLayer('fill')}><Icon name="fill-drip" /></button>
            <button className="le-tool" data-tip={t('layers.addLine')} onClick={() => addLayer('line')}><Icon name="pen-nib" /></button>
          </div>
        </div>
        <div className="le-layer-list">
          {[...layers].reverse().map((layer) => (
            <div key={layer.id} className={`le-layer-row ${layer.id === activeLayerId ? 'active' : ''}`}>
              <button className="le-layer-main" onClick={() => setActiveLayerId(layer.id)}>
                <Icon name={layer.kind === 'line' ? 'pen-nib' : 'fill-drip'} />
                <span>{layer.name}</span>
              </button>
              <button className="le-layer-action" data-tip={layer.visible ? t('layers.hide') : t('layers.show')} onClick={() => toggleLayer(layer.id)}>
                <Icon name={layer.visible ? 'eye' : 'eye-slash'} size={12} />
              </button>
              <button className="le-layer-action danger" data-tip={t('layers.delete')} disabled={layers.length <= 1} onClick={() => removeLayer(layer.id)}>
                <Icon name="trash-can" size={11} />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <div className="le-float-toolbar">
        <button className={`le-tool ${tool === 'pan' ? 'active' : ''}`} data-tip={t('refine.tool.pan')} onClick={() => setTool('pan')}><Icon name="hand" /></button>
        <button className={`le-tool ${tool === 'marquee' ? 'active' : ''}`} data-tip={t('refine.tool.marquee')} onClick={() => setTool('marquee')}><Icon name="crop-simple" /></button>
        <button className={`le-tool ${tool === 'pen' ? 'active' : ''}`} data-tip={t('refine.tool.pen')} onClick={() => setTool('pen')}><Icon name="pen-nib" /></button>
        <button className={`le-tool ${tool === 'fill' ? 'active' : ''}`} data-tip={t('refine.tool.fill')} disabled={activeLayer?.kind !== 'fill'} onClick={() => setTool('fill')}><Icon name="fill-drip" /></button>
        <button className={`le-tool ${tool === 'eraser' ? 'active' : ''}`} data-tip={t('refine.tool.eraser')} onClick={() => setTool('eraser')}><Icon name="eraser" /></button>
        {(tool === 'pen' || tool === 'eraser') && (
          <label className="le-brush-size" data-tip={t('refine.brushSize')}>
            <input
              type="range"
              min={tool === 'pen' ? 1 : 2}
              max={tool === 'pen' ? 40 : 100}
              value={brushSize}
              aria-label={t('refine.brushSize')}
              onChange={(event) => setBrushSizes((sizes) => ({ ...sizes, [tool]: Number(event.target.value) }))}
            />
            <output>{brushSize}px</output>
          </label>
        )}
        <span className="le-sep" />
        <div className="le-palette">
          {palette.map((item) => <button key={item} className={`le-swatch ${color === item ? 'active' : ''}`} style={{ background: item }} onClick={() => setColor(item)} title={item} />)}
          <input type="color" className="le-custom" value={color} onChange={(event) => setColor(event.target.value)} title={color} />
        </div>
        {tool === 'marquee' && sel && activeLayer?.kind === 'fill' && <button className="le-tool apply" data-tip={t('refine.tool.fill')} onClick={fillSelection}><Icon name="check" /></button>}
        <span className="le-sep" />
        <button className="le-tool" data-tip={`${t('refine.undo')} (Ctrl+Z)`} onClick={undo}><Icon name="arrow-rotate-left" /></button>
        <button className="le-tool" data-tip={t('refine.zoomOut')} onClick={() => zoomCenter(1 / 1.25)}><Icon name="magnifying-glass-minus" /></button>
        <span className="le-zoom">{Math.round(cv.view.scale * 100)}%</span>
        <button className="le-tool" data-tip={t('refine.zoomIn')} onClick={() => zoomCenter(1.25)}><Icon name="magnifying-glass-plus" /></button>
        <button className="le-tool" data-tip={t('refine.zoomFit')} onClick={() => cv.fit(size.w, size.h)}><Icon name="expand" /></button>
        <span className="le-sep" />
        <button className="le-tool apply" data-tip={t('refine.apply')} disabled={saving || !ready} onClick={save}><Icon name="check" /></button>
      </div>
    </div>
  )
}
