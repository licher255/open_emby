import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CommitInfo, DigitizePlan, EngineProgressEvent, ProjectImage, ProjectInfo, StitchPostProcess, StitchResult } from '@shared/types'
import { toast } from '../stores/toast'
import LayerEditor from '../components/LayerEditor'
import { localeTag, useT } from '../i18n'
import type { LocaleKey } from '../i18n/en'
import Icon, { type IconName } from '../components/Icon'
import { useWorkbench, type StepId } from '../stores/workbench'
import { useCanvasView } from '../hooks/useCanvasView'

const StitchPreview3D = lazy(() => import('../components/StitchPreview3D'))

const CANVAS_MODE_KEY: Record<'fit' | 'fill' | 'stretch', LocaleKey> = {
  fit: 'canvas.mode.fit',
  fill: 'canvas.mode.fill',
  stretch: 'canvas.mode.stretch'
}

/** Stage 2：前处理后生成规整色域，线稿始终从同一张色域图提取。 */
const FLOW_NODES = [
  { id: 'load', label: 'LoadImage' },
  { id: 'background', label: 'RemoveBG' },
  { id: 'blocks', label: 'Stylize·ColorBlocks' },
  { id: 'saveBlocks', label: 'SaveImage·色块' },
  { id: 'lineart', label: 'LineArt' },
  { id: 'saveLine', label: 'SaveImage·线稿' }
] as const

type NodeState = 'pending' | 'running' | 'done' | 'error'

interface Props {
  project: ProjectInfo
  onProjectChanged: () => void
}

/** 步骤化工作台：步骤树在应用侧边栏（项目树下），此处是当前步骤的输入/输出槽。
 *  产物留在产生它的步骤里，不混入其他步骤。 */
export default function Editor({ project, onProjectChanged }: Props) {
  const t = useT()
  const activeStep = useWorkbench((s) => s.activeStep)
  const historyOpen = useWorkbench((s) => s.historyOpen)
  const setWbSteps = useWorkbench((s) => s.setSteps)
  const setWbHistoryCount = useWorkbench((s) => s.setHistoryCount)
  const [images, setImages] = useState<ProjectImage[]>([])
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [stylizedUrl, setStylizedUrl] = useState<string | null>(null)
  const [stylizedPath, setStylizedPath] = useState<string | null>(null)
  const [lineArtUrl, setLineArtUrl] = useState<string | null>(null)
  const [lineArtPath, setLineArtPath] = useState<string | null>(null)
  const [layerView, setLayerView] = useState<'blocks' | 'lineart' | 'overlay' | 'edit'>('overlay')
  const [plan, setPlan] = useState<DigitizePlan | null>(null)
  const [stitches, setStitches] = useState<StitchResult | null>(null)
  const [exportFiles, setExportFiles] = useState<string[] | null>(null)
  const [progress100, setProgress100] = useState(100)
  const [hiddenLayers, setHiddenLayers] = useState<Set<number>>(new Set())
  const [view3d, setView3d] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // 'stylize' | 'plan' | 'stitch' | 'export' | 'import'
  const [progress, setProgress] = useState('')
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({})
  const [nodePct, setNodePct] = useState<{ value: number; max: number } | null>(null)
  const [history, setHistory] = useState<CommitInfo[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [refVisible, setRefVisible] = useState(true)
  const [pastOutputsVisible, setPastOutputsVisible] = useState(true)
  const [canvasMm, setCanvasMm] = useState<{ width: number; height: number } | null>(null)
  const [canvasW, setCanvasW] = useState('100')
  const [canvasH, setCanvasH] = useState('100')
  const [canvasMode, setCanvasMode] = useState<'fit' | 'fill' | 'stretch'>('fit')
  const [stitchPost, setStitchPost] = useState({ min: '0.6', max: '3.0', tolerance: '0.15' })

  const refreshImages = useCallback(async () => {
    setImages(await window.openEmby.projects.images(project.id))
  }, [project.id])

  const refreshHistory = useCallback(async () => {
    try { setHistory(await window.openEmby.projects.history(project.id)) } catch { /* 忽略 */ }
  }, [project.id])

  /** 恢复上次保存的工作台状态（重新打开项目时） */
  const restoreState = useCallback(async () => {
    const s = await window.openEmby.projects.loadState(project.id)
    if (!s) return
    if (s.stylizedPath) {
      setStylizedPath(s.stylizedPath)
      setStylizedUrl(await window.openEmby.files.readImageDataUrl(s.stylizedPath).catch(() => null))
    }
    if (s.lineArtPath) {
      setLineArtPath(s.lineArtPath)
      setLineArtUrl(await window.openEmby.files.readImageDataUrl(s.lineArtPath).catch(() => null))
    }
    if (s.imagePath) {
      setImagePath(s.imagePath)
      setImageUrl(await window.openEmby.files.readImageDataUrl(s.imagePath).catch(() => null))
    }
    if (s.plan) setPlan(s.plan)
    if (s.stitches) { setStitches(s.stitches); setProgress100(100) }
    if (s.stitchPostProcess) {
      setStitchPost({
        min: String(s.stitchPostProcess.minStitchMm),
        max: String(s.stitchPostProcess.maxStitchMm),
        tolerance: String(s.stitchPostProcess.curveToleranceMm)
      })
    }
    if (s.canvasMm) {
      setCanvasMm(s.canvasMm)
      setCanvasW(String(s.canvasMm.width))
      setCanvasH(String(s.canvasMm.height))
    }
  }, [project.id])

  useEffect(() => {
    refreshImages()
    refreshHistory()
    restoreState()
  }, [refreshImages, refreshHistory, restoreState])

  /** 保存工作台状态并留一个版本（Git 提交） */
  const persist = useCallback(async (message: string, overrides: Partial<{ plan: DigitizePlan | null; stitches: StitchResult | null; stylizedPath: string | null; lineArtPath: string | null; imagePath: string | null; canvasMm: { width: number; height: number } | null; stitchPostProcess: StitchPostProcess }> = {}) => {
    const state = {
      imagePath: overrides.imagePath !== undefined ? overrides.imagePath : imagePath,
      stylizedPath: overrides.stylizedPath !== undefined ? overrides.stylizedPath : stylizedPath,
      lineArtPath: overrides.lineArtPath !== undefined ? overrides.lineArtPath : lineArtPath,
      canvasMm: overrides.canvasMm !== undefined ? overrides.canvasMm : canvasMm,
      plan: overrides.plan !== undefined ? overrides.plan : plan,
      stitches: overrides.stitches !== undefined ? overrides.stitches : stitches,
      stitchPostProcess: overrides.stitchPostProcess ?? getStitchPostProcess()
    }
    try {
      await window.openEmby.projects.saveState(project.id, state, message)
      await refreshHistory()
    } catch (e) {
      console.warn('状态保存失败', e)
    }
  }, [project.id, imagePath, stylizedPath, lineArtPath, canvasMm, plan, stitches, stitchPost, refreshHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  function getStitchPostProcess(): StitchPostProcess {
    const minStitchMm = Math.min(5, Math.max(0.1, Number(stitchPost.min) || 0.6))
    return {
      minStitchMm,
      maxStitchMm: Math.min(12, Math.max(minStitchMm * 2, Number(stitchPost.max) || 3.0)),
      curveToleranceMm: Math.min(2, Math.max(0.01, Number(stitchPost.tolerance) || 0.15))
    }
  }

  /** 应用画布设置：Rust canvas_resize 产出新参考图，物理尺寸记入状态（决定针迹基准） */
  async function applyCanvas() {
    if (!imagePath) return
    const w = Number(canvasW)
    const h = Number(canvasH)
    if (!(w > 0) || !(h > 0)) return
    setBusy('import')
    try {
      const dest = await window.openEmby.projects.canvasAdjust(project.id, imagePath, w, h, canvasMode)
      setCanvasMm({ width: w, height: h })
      await refreshImages()
      onProjectChanged()
      await selectImage(dest)
      setCanvasMm({ width: w, height: h }) // selectImage 不重置 canvasMm
      toast.success(t('toast.canvasDone', { w, h }))
      await persist(`Canvas ${w}×${h}mm (${canvasMode})`, { imagePath: dest, canvasMm: { width: w, height: h }, plan: null, stitches: null, stylizedPath: null, lineArtPath: null })
    } catch (err) {
      toast.error(t('toast.fail.canvas', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    const off = window.openEmby.engine.onProgress((ev: EngineProgressEvent) => {
      if (ev.type === 'executing' && ev.nodeId) {
        setNodeStates((prev) => {
          const next = { ...prev }
          for (const k of Object.keys(next)) if (next[k] === 'running') next[k] = 'done'
          next[ev.nodeId!] = 'running'
          return next
        })
        const label = FLOW_NODES.find((n) => n.id === ev.nodeId)?.label ?? ev.nodeId
        setProgress(`${label}…`)
      } else if (ev.type === 'progress' && ev.max) {
        setNodePct({ value: ev.value ?? 0, max: ev.max })
        const label = FLOW_NODES.find((n) => n.id === ev.nodeId)?.label ?? ev.nodeId ?? 'Processing'
        setProgress(`${label} ${ev.value}/${ev.max}`)
      } else if (ev.type === 'executed' && ev.nodeId) {
        setNodeStates((prev) => ({ ...prev, [ev.nodeId!]: 'done' }))
      } else if (ev.type === 'error') {
        setNodeStates((prev) => {
          const next = { ...prev }
          for (const k of Object.keys(next)) if (next[k] === 'running') next[k] = 'error'
          return next
        })
        setProgress(ev.message ?? '')
      }
    })
    return () => { off() }
  }, [])

  async function selectImage(path: string) {
    setImagePath(path)
    setImageUrl(await window.openEmby.files.readImageDataUrl(path))
    setStylizedUrl(null)
    setStylizedPath(null)
    setLineArtUrl(null)
    setLineArtPath(null)
    setStitches(null)
    setExportFiles(null)
    setPlan(null)
    setNodeStates({})
    setNodePct(null)
  }

  async function archiveAsset(img: ProjectImage) {
    if (!window.confirm(t('editor.archiveConfirm', { name: img.name }))) return
    try {
      await window.openEmby.projects.archiveImage(project.id, img.path)
      if (img.path === imagePath) {
        const next = images.find((item) => item.path !== img.path && (item.kind === 'original' || item.kind === 'other'))
        if (next) {
          await selectImage(next.path)
        } else {
          setImagePath(null); setImageUrl(null); setStylizedPath(null); setStylizedUrl(null); setLineArtPath(null); setLineArtUrl(null)
          setPlan(null); setStitches(null); setExportFiles(null)
        }
        await persist(`Archive image ${img.name}`, {
          imagePath: next?.path ?? null,
          stylizedPath: null,
          lineArtPath: null,
          plan: null,
          stitches: null
        })
      } else if (img.path === stylizedPath) {
        setStylizedPath(null); setStylizedUrl(null); setLineArtPath(null); setLineArtUrl(null)
        await persist(`Archive image ${img.name}`, { stylizedPath: null, lineArtPath: null, stitches: null })
      } else if (img.path === lineArtPath) {
        setLineArtPath(null); setLineArtUrl(null)
        await persist(`Archive image ${img.name}`, { lineArtPath: null, stitches: null })
      }
      await refreshImages()
      onProjectChanged()
      toast.success(t('toast.archived'))
    } catch (err) {
      toast.error(t('toast.fail.archive', { error: String(err) }))
    }
  }

  async function renameAsset(img: ProjectImage) {
    const dot = img.name.lastIndexOf('.')
    const currentName = dot > 0 ? img.name.slice(0, dot) : img.name
    const name = window.prompt(t('editor.renamePrompt'), currentName)
    if (name == null || name.trim() === '' || name.trim() === currentName) return
    try {
      const renamedPath = await window.openEmby.projects.renameImage(project.id, img.path, name)
      if (img.path === imagePath) setImagePath(renamedPath)
      if (img.path === stylizedPath) setStylizedPath(renamedPath)
      if (img.path === lineArtPath) setLineArtPath(renamedPath)
      await refreshImages()
      await refreshHistory()
      onProjectChanged()
      toast.success(t('toast.renamed'))
    } catch (err) {
      toast.error(t('toast.fail.rename', { error: String(err) }))
    }
  }

  /** 导入图稿到项目（复制进项目目录） */
  async function importIntoProject(srcPath: string) {
    setBusy('import')
    try {
      const dest = await window.openEmby.projects.importImage(project.id, srcPath)
      await refreshImages()
      onProjectChanged()
      await selectImage(dest)
      toast.success(t('toast.imported'))
      await persist('Import artwork', { imagePath: dest, plan: null, stitches: null, stylizedPath: null, lineArtPath: null })
    } catch (err) {
      toast.error(t('toast.fail.import', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  async function pickImage() {
    const p = await window.openEmby.files.selectImage()
    if (p) await importIntoProject(p)
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    try {
      await importIntoProject(window.openEmby.files.pathForFile(f))
    } catch {
      toast.error(t('toast.fail.drop'))
    }
  }

  async function generateStage2() {
    if (!imagePath) return
    setBusy('stage2'); setProgress('')
    setNodeStates(Object.fromEntries(FLOW_NODES.map((n) => [n.id, 'pending'])))
    setNodePct(null)
    try {
      const srcName = imagePath.split(/[\\/]/).pop()
      const blocks = await window.openEmby.engine.generateColorBlocks(imagePath, null, plan?.maxColors ?? 8)
      const savedBlocks = await window.openEmby.projects.saveImage(project.id, blocks, 'stylized', 'stylized', srcName)
      setStylizedUrl(blocks)
      setStylizedPath(savedBlocks)
      const lineArt = await window.openEmby.engine.generateLineArt(savedBlocks)
      const savedLine = await window.openEmby.projects.saveImage(project.id, lineArt, 'lineart', 'lineart', srcName)
      setLineArtUrl(lineArt)
      setLineArtPath(savedLine)
      setNodeStates(Object.fromEntries(FLOW_NODES.map((n) => [n.id, 'done'])))
      setProgress('')
      setStitches(null)
      setExportFiles(null)
      await refreshImages()
      onProjectChanged()
      toast.success(t('toast.stylizeDone'))
      await persist('Stage 2 · color blocks + line art', { stylizedPath: savedBlocks, lineArtPath: savedLine, stitches: null })
    } catch (err) {
      toast.error(t('toast.fail.stylize', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  async function regenerateColorBlocks() {
    if (!imagePath) return
    setBusy('blocks'); setProgress('')
    setNodeStates({ load: 'pending', background: 'pending', blocks: 'pending', saveBlocks: 'pending', lineart: 'done', saveLine: 'done' })
    setNodePct(null)
    try {
      const blocks = await window.openEmby.engine.generateColorBlocks(imagePath, lineArtPath, plan?.maxColors ?? 8)
      const srcName = imagePath.split(/[\\/]/).pop()
      const savedBlocks = await window.openEmby.projects.saveImage(project.id, blocks, 'stylized', 'stylized', srcName)
      setStylizedUrl(blocks)
      setStylizedPath(savedBlocks)
      setStitches(null)
      setExportFiles(null)
      await refreshImages()
      onProjectChanged()
      toast.success(t('toast.blocksDone'))
      await persist('Regenerate color blocks from line art', { stylizedPath: savedBlocks, stitches: null })
    } catch (err) {
      toast.error(t('toast.fail.blocks', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  async function regenerateLineArt() {
    if (!stylizedPath) return
    setBusy('lineart'); setProgress('')
    setNodeStates({ load: 'done', background: 'done', blocks: 'done', saveBlocks: 'done', lineart: 'pending', saveLine: 'pending' })
    setNodePct(null)
    try {
      const lineArt = await window.openEmby.engine.generateLineArt(stylizedPath)
      const srcName = stylizedPath.split(/[\\/]/).pop()
      const savedLine = await window.openEmby.projects.saveImage(project.id, lineArt, 'lineart', 'lineart', srcName)
      setLineArtUrl(lineArt)
      setLineArtPath(savedLine)
      setStitches(null)
      setExportFiles(null)
      await refreshImages()
      onProjectChanged()
      toast.success(t('toast.lineArtDone'))
      await persist('Regenerate line art', { lineArtPath: savedLine, stitches: null })
    } catch (err) {
      toast.error(t('toast.fail.lineArt', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  async function makePlan() {
    if (!imagePath) return
    setBusy('plan')
    try {
      const p = await window.openEmby.sidecar.digitizePlan(imagePath, '', canvasMm?.width ?? 100)
      setPlan(p)
      toast.success(t('toast.planDone'))
      await persist('Build digitizing plan', { plan: p })
    } catch (err) {
      toast.error(t('toast.fail.plan', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  /** 生成针迹：对风格化色块图（没有则退回原图）跑 Rust 针迹生成器 */
  async function makeStitches() {
    const src = stylizedPath ?? imagePath
    if (!src) return
    setBusy('stitch'); setExportFiles(null)
    try {
      const postProcess = getStitchPostProcess()
      const result = await window.openEmby.sidecar.digitizeStitches(src, plan?.maxColors ?? 8, canvasMm?.width ?? plan?.sizeMm.width ?? 100, postProcess)
      setStitches(result)
      setProgress100(100)
      setHiddenLayers(new Set())
      toast.success(t('toast.stitchDone', { stitches: result.stitchCount.toLocaleString(), changes: result.colorChanges }))
      await persist(`Generate stitches (${result.stitchCount} stitches)`, { stitches: result, stitchPostProcess: postProcess })
    } catch (err) {
      toast.error(t('toast.fail.stitch', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  /** 导出 DST 到数据根 exports/ */
  async function exportDst() {
    if (!stitches) return
    setBusy('export')
    try {
      const env = await window.openEmby.envStatus()
      const r = await window.openEmby.sidecar.export({
        points: stitches.points,
        palette: stitches.palette,
        name: project.name,
        format: 'dst',
        outDir: `${env.dataRoot}\\exports`
      })
      setExportFiles(r.files)
      toast.success(t('toast.exportDone'))
      await persist('Export DST')
    } catch (err) {
      toast.error(t('toast.fail.export', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  /** 可绣性检查（类比切片软件的模型检查，在切片前发现问题） */
  const checks = useMemo(() => {
    if (!stitches) return []
    const list: Array<{ level: 'ok' | 'warn' | 'info'; text: string }> = []
    const colorCount = new Set(stitches.points.map((p) => p.color)).size
    const estMin = Math.round((stitches.stitchCount / 800) * 10) / 10
    let longJumps = 0
    let px = 0; let py = 0
    for (const p of stitches.points) {
      if (p.flag === 1 && Math.hypot(p.x - px, p.y - py) > 5) longJumps++
      px = p.x; py = p.y
    }
    list.push({ level: 'info', text: t('check.size', { w: stitches.widthMm, h: stitches.heightMm }) })
    list.push({ level: 'info', text: t('check.estTime', { min: estMin }) })
    if (stitches.backgroundIndex >= 0) list.push({ level: 'ok', text: t('check.bgOk') })
    if (colorCount > 12) list.push({ level: 'warn', text: t('check.colorsWarn', { count: colorCount }) })
    else list.push({ level: 'ok', text: t('check.colorsOk', { count: colorCount }) })
    if (longJumps > 0) list.push({ level: 'warn', text: t('check.jumpsWarn', { count: longJumps }) })
    if (stitches.stitchCount > 50000) list.push({ level: 'warn', text: t('check.denseWarn') })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stitches, t])

  /** 换色层（类比切片分层）：按绣制顺序聚合每色针数 */
  const layers = useMemo(() => {
    if (!stitches) return []
    const counts = new Map<number, number>()
    for (const p of stitches.points) {
      if (p.flag === 0) counts.set(p.color, (counts.get(p.color) ?? 0) + 1)
    }
    const order: number[] = []
    for (const p of stitches.points) {
      if (counts.has(p.color) && !order.includes(p.color)) order.push(p.color)
    }
    return order.map((c, i) => ({
      order: i + 1,
      color: c,
      hex: stitches.palette[c] ?? '#111118',
      stitches: counts.get(c) ?? 0
    }))
  }, [stitches])

  /** 步骤定义：产物摘要显示在步骤行上（产物留在自己的槽里） */
  const steps: Array<{ id: StepId; done: boolean; artifact: string }> = [
    { id: 'import', done: !!imagePath, artifact: imagePath ? (imagePath.split(/[\\/]/).pop() ?? '') : '' },
    { id: 'stylize', done: !!stylizedPath && !!lineArtPath, artifact: stylizedPath && lineArtPath ? t('editor.twoLayers') : '' },
    { id: 'plan', done: !!plan, artifact: plan ? `${plan.palette.length} colors` : '' },
    { id: 'stitches', done: !!stitches, artifact: stitches ? `${stitches.stitchCount.toLocaleString()} st` : '' },
    { id: 'export', done: !!exportFiles, artifact: exportFiles ? `${exportFiles.length} files` : '' }
  ]

  // 发布步骤树到共享 store（App 侧边栏项目树下渲染）
  useEffect(() => { setWbSteps(steps) }, [imagePath, stylizedPath, plan, stitches, exportFiles, setWbSteps]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWbHistoryCount(history.length) }, [history.length, setWbHistoryCount])

  const originals = images.filter((i) => i.kind === 'original' || i.kind === 'other')
  const stage2Assets = images.filter((i) => i.kind === 'stylized' || i.kind === 'lineart')
  const stage2Busy = busy === 'stage2' || busy === 'blocks' || busy === 'lineart'

  return (
    <div className="workbench">
      {/* 右侧：当前步骤的输入/输出槽 */}
      <section className="step-content">
        {activeStep === 'import' && (
          <div className="step-panel">
            <h1>{t('step.import')}</h1>
            <div
              className={`slot dropzone-slot ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <button className="btn-pill" onClick={pickImage} disabled={busy === 'import'}>
                {busy === 'import' ? t('editor.importing') : t('editor.importImage')}
              </button>
              <span className="asset-hint">{t('editor.dropHint')}</span>
            </div>
            <h3>{t('editor.output')}</h3>
            <div className="thumb-strip">
              {originals.map((img) => (
                <div key={img.path} className={`thumb-cell ${img.path === imagePath ? 'active' : ''}`}>
                  <button className="thumb-select" onClick={() => selectImage(img.path)} title={img.name}>
                    <AssetThumb path={img.path} />
                    <span className="thumb-name">{img.name}</span>
                  </button>
                  <button className="thumb-rename" onClick={() => renameAsset(img)} title={t('editor.rename')} aria-label={t('editor.rename')}>
                    <Icon name="pen-nib" size={12} />
                  </button>
                  <button className="thumb-archive" onClick={() => archiveAsset(img)} title={t('editor.archive')} aria-label={t('editor.archive')}>
                    <Icon name="trash-can" size={12} />
                  </button>
                </div>
              ))}
              {originals.length === 0 && <p className="mono-meta">{t('editor.noReference')}</p>}
            </div>

            {/* 画布修改器：物理尺寸（mm）直接决定下游针迹行距与补针基准 */}
            {imagePath && (
              <div className="slot canvas-slot">
                <h3>{t('canvas.title')}</h3>
                <div className="canvas-row">
                  <label>
                    {t('canvas.width')}
                    <input type="number" min={1} value={canvasW} onChange={(e) => setCanvasW(e.target.value)} />
                  </label>
                  <span className="canvas-x">×</span>
                  <label>
                    {t('canvas.height')}
                    <input type="number" min={1} value={canvasH} onChange={(e) => setCanvasH(e.target.value)} />
                  </label>
                  <span className="canvas-x">mm</span>
                  <div className="view-tabs" style={{ marginBottom: 0 }}>
                    {(['fit', 'fill', 'stretch'] as const).map((m) => (
                      <button key={m} className={canvasMode === m ? 'active' : ''} onClick={() => setCanvasMode(m)}>
                        {t(CANVAS_MODE_KEY[m])}
                      </button>
                    ))}
                  </div>
                  <button className="btn-pill btn-sm-pill" disabled={busy === 'import'} onClick={applyCanvas}>
                    {t('canvas.apply')}
                  </button>
                </div>
                {canvasMm && (
                  <p className="mono-meta">{t('canvas.current', { w: canvasMm.width, h: canvasMm.height })}</p>
                )}
              </div>
            )}
          </div>
        )}

        {activeStep === 'stylize' && (
          <div className="step-panel fill">
            <div className="ws">
              <div className="ws-canvas">
                {layerView === 'edit' && stylizedUrl ? (
                  <LayerEditor
                    blocksUrl={stylizedUrl}
                    lineArtUrl={lineArtUrl}
                    onSave={async (blocks, line) => {
                      const srcName = imagePath?.split(/[\\/]/).pop()
                      const saved = await window.openEmby.projects.saveImage(project.id, blocks, 'stylized', 'stylized', srcName)
                      let savedLine = lineArtPath
                      if (line) savedLine = await window.openEmby.projects.saveImage(project.id, line, 'lineart', 'lineart', srcName)
                      setStylizedUrl(blocks)
                      setStylizedPath(saved)
                      if (line && savedLine) { setLineArtUrl(line); setLineArtPath(savedLine) }
                      setStitches(null)
                      setExportFiles(null)
                      await refreshImages()
                      onProjectChanged()
                      toast.success(t('toast.refineDone'))
                      await persist('Refine layers', { stylizedPath: saved, lineArtPath: savedLine, stitches: null })
                      setLayerView('overlay')
                    }}
                  />
                ) : (
                  <div className="ws-stage">
                    {stage2Busy ? (
                      <div className="ws-progress">
                        <div className="progress-track" style={{ width: 260 }}>
                          {nodePct
                            ? <div className="progress-fill" style={{ width: `${Math.round((nodePct.value / nodePct.max) * 100)}%` }} />
                            : <div className="progress-fill indeterminate" />}
                        </div>
                        <p className="mono-meta">{progress || t('editor.generating')}</p>
                        <div className="flow-strip" style={{ background: 'transparent', border: 'none' }}>
                          {FLOW_NODES.map((n, i) => (
                            <span key={n.id} className="flow-item">
                              {i > 0 && <span className="flow-arrow">→</span>}
                              <span className={`flow-node ${nodeStates[n.id] ?? 'pending'}`}>{n.label}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : stylizedUrl && layerView === 'blocks' ? (
                      <PanZoomStage url={stylizedUrl} />
                    ) : layerView === 'lineart' && lineArtUrl ? (
                      <PanZoomStage url={lineArtUrl} />
                    ) : stylizedUrl ? (
                      <PanZoomStage url={stylizedUrl} lineUrl={lineArtUrl} overlay />
                    ) : (
                      <div className="ws-empty">
                        {imageUrl ? <img src={imageUrl} alt="input" /> : <Icon name="image" size={44} />}
                        <p>{imageUrl ? t('editor.readyToStylize') : t('editor.noInput')}</p>
                        <button className="btn-pill" disabled={!imagePath} onClick={generateStage2}>{t('editor.stylize')}</button>
                      </div>
                    )}
                  </div>
                )}

                {!stage2Busy && stylizedUrl && layerView !== 'edit' && (
                  <div className="ws-topbar">
                    <div className="view-tabs" style={{ marginBottom: 0 }}>
                      <button className={layerView === 'blocks' ? 'active' : ''} onClick={() => setLayerView('blocks')}>{t('editor.layerBlocks')}</button>
                      <button className={layerView === 'lineart' ? 'active' : ''} onClick={() => setLayerView('lineart')}>{t('editor.layerLineart')}</button>
                      <button className={layerView === 'overlay' ? 'active' : ''} onClick={() => setLayerView('overlay')}>{t('editor.layerOverlay')}</button>
                    </div>
                    <span className="le-sep" />
                    <button className="le-tool" data-tip={t('refine.open')} onClick={() => setLayerView('edit')}><Icon name="pen-nib" /></button>
                    <button className="ws-action" data-tip={t('editor.regenerateLineArt')} onClick={regenerateLineArt} disabled={!!busy || !stylizedPath}>
                      <Icon name="pen-nib" /><span>{t('editor.lineArtShort')}</span>
                    </button>
                    <button className="ws-action" data-tip={t('editor.regenerateBlocks')} onClick={regenerateColorBlocks} disabled={!!busy || !imagePath}>
                      <Icon name="fill-drip" /><span>{t('editor.blocksShort')}</span>
                    </button>
                  </div>
                )}

                {layerView !== 'edit' && stage2Assets.length > 0 && (
                  <div className={`ws-gallery ${pastOutputsVisible ? '' : 'collapsed'}`}>
                    <div className="ws-gallery-head">
                      <span><Icon name="image" /> {t('editor.pastOutputs')}</span>
                      <button
                        className="le-tool"
                        data-tip={t(pastOutputsVisible ? 'editor.hidePastOutputs' : 'editor.showPastOutputs')}
                        aria-expanded={pastOutputsVisible}
                        onClick={() => setPastOutputsVisible((visible) => !visible)}
                      >
                        <Icon name={pastOutputsVisible ? 'eye-slash' : 'eye'} />
                      </button>
                    </div>
                    {pastOutputsVisible && (
                      <div className="ws-gallery-strip">
                        {stage2Assets.map((img) => (
                          <div key={img.path} className="ws-gallery-card">
                            <button
                              className={`ws-gallery-item ${(img.kind === 'stylized' ? img.path === stylizedPath : img.path === lineArtPath) ? 'active' : ''}`}
                              onClick={async () => {
                                if (img.kind === 'lineart') {
                                  setLineArtPath(img.path)
                                  setLineArtUrl(await window.openEmby.files.readImageDataUrl(img.path))
                                  setLayerView('lineart')
                                } else {
                                  setStylizedPath(img.path)
                                  setStylizedUrl(await window.openEmby.files.readImageDataUrl(img.path))
                                  setLayerView('blocks')
                                }
                              }}
                              title={img.derivedFrom ? `${img.name} ← ${img.derivedFrom}` : img.name}
                            >
                              <AssetThumb path={img.path} />
                              <span>{img.kind === 'lineart' ? `${t('editor.layerLineart')} · ` : ''}{img.name}</span>
                            </button>
                            <button className="ws-gallery-rename" onClick={() => renameAsset(img)} title={t('editor.rename')} aria-label={t('editor.rename')}>
                              <Icon name="pen-nib" size={11} />
                            </button>
                            <button className="ws-gallery-archive" onClick={() => archiveAsset(img)} title={t('editor.archive')} aria-label={t('editor.archive')}>
                              <Icon name="trash-can" size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {layerView !== 'edit' && imageUrl && refVisible && (
                  <div className="ws-ref">
                    <img src={imageUrl} alt="reference" />
                    <button className="ws-ref-close" onClick={() => setRefVisible(false)}>×</button>
                  </div>
                )}
                {layerView !== 'edit' && !refVisible && imageUrl && (
                  <button className="ws-ref-toggle le-tool" data-tip={t('editor.input')} onClick={() => setRefVisible(true)}><Icon name="eye" /></button>
                )}
              </div>

              {historyOpen && layerView !== 'edit' && (
                <div className="ws-history card">
                  <h2>{t('history.title')}<button className="ws-ref-close" onClick={() => useWorkbench.getState().setHistoryOpen(false)}>×</button></h2>
                  <div className="history-list">
                    {history.map((c) => (
                      <div key={c.oid} className="history-row">
                        <code className="history-oid">{c.oid.slice(0, 7)}</code>
                        <span className="history-msg">{c.message}</span>
                        <button className="btn-outline btn-sm" onClick={async () => {
                          if (!window.confirm(t('history.confirm', { message: c.message }))) return
                          try {
                            await window.openEmby.projects.restore(project.id, c.oid)
                            await refreshImages(); await refreshHistory(); await restoreState(); onProjectChanged()
                            toast.success(t('toast.restored'))
                          } catch (e) { toast.error(t('toast.fail.restore', { error: String(e) })) }
                        }}>{t('history.restore')}</button>
                      </div>
                    ))}
                    {history.length === 0 && <p className="mono-meta">{t('history.empty')}</p>}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeStep === 'plan' && (
          <div className="step-panel">
            <h1>{t('step.plan')}</h1>
            <div className="editor-actions">
              <button className="btn-pill" disabled={!!busy || !imagePath} onClick={makePlan}>
                {busy === 'plan' ? t('editor.planning') : t('editor.plan')}
              </button>
            </div>
            {busy === 'plan' && <div className="progress-track slim"><div className="progress-fill indeterminate" /></div>}
            {plan && (
              <div className="slot">
                <h3>{t('editor.output')}</h3>
                <div className="card plan-card">
                  <h2>{t('plan.title', { w: plan.sizeMm.width, h: plan.sizeMm.height })}</h2>
                  <div className="chip-row">
                    {plan.palette.map((c) => (
                      <span key={c} className="thread-chip"><i style={{ background: c }} />{c}</span>
                    ))}
                  </div>
                  <table>
                    <thead><tr><th>{t('plan.region')}</th><th>{t('plan.color')}</th><th>{t('plan.stitchType')}</th><th>{t('plan.density')}</th></tr></thead>
                    <tbody>
                      {plan.regions.map((r) => (
                        <tr key={r.id}>
                          <td>{r.id}</td>
                          <td><span className="thread-chip sm"><i style={{ background: r.color }} />{r.color}</span></td>
                          <td><span className={`stitch-tag ${r.stitchType}`}>{r.stitchType}</span></td>
                          <td className="mono-meta">{r.density.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {plan.notes.map((n, i) => <p key={i} className="mono-meta">· {n}</p>)}
                </div>
              </div>
            )}
          </div>
        )}

        {activeStep === 'stitches' && (
          <div className="step-panel">
            <h1>{t('step.stitches')}</h1>
            <div className="stitch-post-controls">
              <strong>{t('stitch.postProcess')}</strong>
              <label>
                {t('stitch.minLength')}
                <input type="number" min={0.1} max={5} step={0.1} value={stitchPost.min} onChange={(e) => setStitchPost((value) => ({ ...value, min: e.target.value }))} />
                <span>mm</span>
              </label>
              <label>
                {t('stitch.maxLength')}
                <input type="number" min={Math.max(0.2, (Number(stitchPost.min) || 0.1) * 2)} max={12} step={0.1} value={stitchPost.max} onChange={(e) => setStitchPost((value) => ({ ...value, max: e.target.value }))} />
                <span>mm</span>
              </label>
              <label>
                {t('stitch.curveTolerance')}
                <input type="number" min={0.01} max={2} step={0.05} value={stitchPost.tolerance} onChange={(e) => setStitchPost((value) => ({ ...value, tolerance: e.target.value }))} />
                <span>mm</span>
              </label>
            </div>
            <p className="mono-meta stitch-post-hint">{t('stitch.postProcessHint')}</p>
            <div className="editor-actions">
              <button className="btn-pill" disabled={!!busy || (!stylizedPath && !imagePath)} onClick={makeStitches}>
                {busy === 'stitch' ? t('editor.stitching') : t('editor.stitch')}
              </button>
            </div>
            {busy === 'stitch' && <div className="progress-track slim"><div className="progress-fill indeterminate" /></div>}
            {stitches && (
              <div className="slot">
                <h3>{t('editor.output')}</h3>
                <div className="card">
                  <h2>{t('stitch.title')}</h2>
                  <div className="stitch-layout">
                    <div>
                      <div className="view-tabs">
                        <button className={view3d ? '' : 'active'} onClick={() => setView3d(false)}>{t('stitch.view2d')}</button>
                        <button className={view3d ? 'active' : ''} onClick={() => setView3d(true)}>{t('stitch.view3d')}</button>
                      </div>
                      {view3d ? (
                        <Suspense fallback={<div className="stitch-3d mono-meta">{t('settings.loading')}</div>}>
                          <StitchPreview3D stitches={stitches} hidden={hiddenLayers} />
                        </Suspense>
                      ) : (
                        <>
                          <StitchPreview stitches={stitches} progress={progress100 / 100} hidden={hiddenLayers} />
                          <div className="scrub-row">
                            <span className="mono-meta">{t('stitch.progress')}</span>
                            <input type="range" min={0} max={100} value={progress100} onChange={(e) => setProgress100(Number(e.target.value))} />
                            <span className="mono-meta">{progress100}%</span>
                          </div>
                        </>
                      )}
                    </div>
                    <div className="stitch-side">
                      <h3>{t('stitch.checks')}</h3>
                      <ul className="check-list">
                        {checks.map((c, i) => <li key={i} className={`check-${c.level}`}>{c.text}</li>)}
                      </ul>
                      <h3>{t('stitch.layers', { count: layers.length })}</h3>
                      <div className="layer-list">
                        {layers.map((l) => (
                          <button
                            key={l.color}
                            className={`layer-row ${hiddenLayers.has(l.color) ? 'off' : ''}`}
                            onClick={() => setHiddenLayers((prev) => {
                              const next = new Set(prev)
                              if (next.has(l.color)) next.delete(l.color)
                              else next.add(l.color)
                              return next
                            })}
                            title={l.hex}
                          >
                            <i style={{ background: l.hex }} />
                            <span className="layer-name">{t('stitch.layerName', { order: l.order })}</span>
                            <span className="layer-meta">{t('stitch.layerStitches', { count: l.stitches.toLocaleString() })}</span>
                          </button>
                        ))}
                      </div>
                      <div className="chip-row" style={{ marginTop: 12 }}>
                        <span className="thread-chip sm">{t('stitch.stitchCount', { count: stitches.stitchCount.toLocaleString() })}</span>
                        <span className="thread-chip sm">{t('stitch.colorChanges', { count: stitches.colorChanges })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeStep === 'export' && (
          <div className="step-panel">
            <h1>{t('step.export')}</h1>
            <div className="editor-actions">
              <button className="btn-pill" disabled={!!busy || !stitches} onClick={exportDst}>
                {busy === 'export' ? t('editor.exporting') : t('editor.export')}
              </button>
            </div>
            {busy === 'export' && <div className="progress-track slim"><div className="progress-fill indeterminate" /></div>}
            {exportFiles && (
              <div className="slot">
                <h3>{t('editor.output')}</h3>
                <div className="card">
                  {exportFiles.map((f) => <p key={f} className="mono-meta">{f}</p>)}
                </div>
              </div>
            )}
          </div>
        )}

        {historyOpen && activeStep !== 'stylize' && (
          <div className="card">
            <h2>{t('history.title')} <span className="mono-meta" style={{ marginLeft: 8 }}>{t('history.count', { count: history.length })}</span></h2>
            <div className="history-list">
              {history.map((c) => (
                <div key={c.oid} className="history-row">
                  <code className="history-oid">{c.oid.slice(0, 7)}</code>
                  <span className="history-msg">{c.message}</span>
                  <span className="history-time">{new Date(c.time).toLocaleString(localeTag())}</span>
                  <button
                    className="btn-outline btn-sm"
                    onClick={async () => {
                      if (!window.confirm(t('history.confirm', { message: c.message }))) return
                      try {
                        await window.openEmby.projects.restore(project.id, c.oid)
                        await refreshImages()
                        await refreshHistory()
                        await restoreState()
                        onProjectChanged()
                        toast.success(t('toast.restored'))
                      } catch (e) {
                        toast.error(t('toast.fail.restore', { error: String(e) }))
                      }
                    }}
                  >{t('history.restore')}</button>
                </div>
              ))}
              {history.length === 0 && <p className="mono-meta">{t('history.empty')}</p>}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/** 项目图稿缩略图（data URL 渲染） */
function AssetThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    window.openEmby.files.readImageDataUrl(path).then((u) => { if (alive) setUrl(u) }).catch(() => {})
    return () => { alive = false }
  }, [path])
  return url ? <img src={url} alt="" /> : <span className="asset-loading">…</span>
}

/** 自由画布预览：默认居中适配；拖拽平移、滚轮/双指捏合缩放（鼠标/触屏/Pencil 统一） */
function PanZoomStage({ url, lineUrl, overlay }: { url: string; lineUrl?: string | null; overlay?: boolean }) {
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const cv = useCanvasView()

  useEffect(() => {
    const img = new Image()
    img.onload = () => setNat({ w: img.naturalWidth, h: img.naturalHeight })
    img.src = url
  }, [url])

  // 内容就绪后居中适配
  useEffect(() => { if (nat) cv.fit(nat.w, nat.h) }, [nat]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={cv.ref} className="ws-panzoom" style={{ touchAction: 'none' }} {...cv.panHandlers}>
      {nat && (
        <div
          className="ws-pan-stage"
          style={{
            width: nat.w,
            height: nat.h,
            transform: `translate(${cv.view.tx}px, ${cv.view.ty}px) scale(${cv.view.scale})`
          }}
        >
          <img className="ws-pan-img" src={url} alt="" draggable={false} />
          {overlay && lineUrl && <img className="ws-pan-img layer-lineart" src={lineUrl} alt="" draggable={false} />}
        </div>
      )}
    </div>
  )
}

/** 针迹仿真：按绣制顺序把针迹点画成彩色折线（跳针与换色不落笔）。
 *  progress = 绣制进度 0..1（类比切片软件的层滑杆）；hidden = 隐藏的换色层 */
function StitchPreview({ stitches, progress, hidden }: { stitches: StitchResult; progress: number; hidden: Set<number> }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || stitches.points.length === 0) return
    const W = 640
    const H = Math.max(1, Math.round((W * stitches.heightMm) / Math.max(stitches.widthMm, 1)))
    const dpr = window.devicePixelRatio || 1
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, W, H)

    const s = W / stitches.widthMm
    let px = 0
    let py = 0
    const total = stitches.points.length
    const upto = Math.floor(total * progress)
    ctx.lineWidth = 1.0
    ctx.lineCap = 'round'
    for (let i = 0; i < upto; i++) {
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
  }, [stitches, progress, hidden])

  return (
    <div className="stitch-canvas-wrap">
      <canvas ref={ref} className="stitch-canvas" />
    </div>
  )
}
