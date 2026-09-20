import { useCallback, useEffect, useState } from 'react'
import type { CommitInfo, DigitizePlan, EngineProgressEvent, ProjectImage, ProjectInfo, StitchPostProcess, StitchResult } from '@shared/types'
import { toast } from '../stores/toast'
import { confirmDialog, promptDialog } from '../stores/dialog'
import { useT } from '../i18n'
import { useWorkbench, type StepId } from '../stores/workbench'
import HistoryPanel from '../components/HistoryPanel'
import ImportStep, { type CanvasMode } from './editor/ImportStep'
import StylizeStep from './editor/StylizeStep'
import PlanStep from './editor/PlanStep'
import StitchesStep, { type StitchPostInput } from './editor/StitchesStep'
import ExportStep from './editor/ExportStep'
import { FLOW_NODES, type NodeState } from './editor/flow'

interface Props {
  project: ProjectInfo
  onProjectChanged: () => void
}

/** 步骤化工作台编排器：持有项目状态与全部副作用，步骤 UI 由 pages/editor/* 渲染（产物留在产生它的步骤里）。 */
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
  const [plan, setPlan] = useState<DigitizePlan | null>(null)
  const [stitches, setStitches] = useState<StitchResult | null>(null)
  const [exportFiles, setExportFiles] = useState<string[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // 'stage2' | 'blocks' | 'lineart' | 'plan' | 'stitch' | 'export' | 'import'
  const [progress, setProgress] = useState('')
  const [nodeStates, setNodeStates] = useState<Record<string, NodeState>>({})
  const [nodePct, setNodePct] = useState<{ value: number; max: number } | null>(null)
  const [history, setHistory] = useState<CommitInfo[]>([])
  const [canvasMm, setCanvasMm] = useState<{ width: number; height: number } | null>(null)
  const [canvasW, setCanvasW] = useState('100')
  const [canvasH, setCanvasH] = useState('100')
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('fit')
  const [stitchPost, setStitchPost] = useState<StitchPostInput>({ min: '0.6', max: '3.0', tolerance: '0.15' })

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
    if (s.stitches) setStitches(s.stitches)
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
    if (!(await confirmDialog(t('editor.archiveConfirm', { name: img.name }), { danger: true }))) return
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
    const name = await promptDialog(t('editor.renamePrompt'), currentName)
    if (name == null || name === currentName) return
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

  /** 选择历史产物（风格化画廊点击） */
  async function selectStage2Asset(img: ProjectImage) {
    const url = await window.openEmby.files.readImageDataUrl(img.path)
    if (img.kind === 'lineart') {
      setLineArtPath(img.path)
      setLineArtUrl(url)
    } else {
      setStylizedPath(img.path)
      setStylizedUrl(url)
    }
  }

  /** 图层精修保存：色块/线稿回存为新版本 */
  async function saveRefinedLayers(blocks: string, line: string | null) {
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
  }

  /** 回退到指定版本（HistoryPanel 已确认） */
  async function restoreVersion(oid: string) {
    try {
      await window.openEmby.projects.restore(project.id, oid)
      await refreshImages()
      await refreshHistory()
      await restoreState()
      onProjectChanged()
      toast.success(t('toast.restored'))
    } catch (e) {
      toast.error(t('toast.fail.restore', { error: String(e) }))
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

  return (
    <div className="workbench">
      <section className="step-content">
        {activeStep === 'import' && (
          <ImportStep
            originals={originals}
            imagePath={imagePath}
            importing={busy === 'import'}
            canvasMm={canvasMm}
            canvasW={canvasW}
            canvasH={canvasH}
            canvasMode={canvasMode}
            onPickImage={pickImage}
            onImportPath={importIntoProject}
            onSelectImage={selectImage}
            onRename={renameAsset}
            onArchive={archiveAsset}
            onCanvasWChange={setCanvasW}
            onCanvasHChange={setCanvasH}
            onCanvasModeChange={setCanvasMode}
            onApplyCanvas={applyCanvas}
          />
        )}

        {activeStep === 'stylize' && (
          <StylizeStep
            imageUrl={imageUrl}
            imagePath={imagePath}
            stylizedUrl={stylizedUrl}
            stylizedPath={stylizedPath}
            lineArtUrl={lineArtUrl}
            lineArtPath={lineArtPath}
            busy={busy}
            progress={progress}
            nodeStates={nodeStates}
            nodePct={nodePct}
            stage2Assets={stage2Assets}
            history={history}
            onGenerate={generateStage2}
            onRegenerateLineArt={regenerateLineArt}
            onRegenerateBlocks={regenerateColorBlocks}
            onSaveLayers={saveRefinedLayers}
            onSelectAsset={selectStage2Asset}
            onRename={renameAsset}
            onArchive={archiveAsset}
            onRestoreVersion={restoreVersion}
          />
        )}

        {activeStep === 'plan' && (
          <PlanStep plan={plan} busy={busy} hasImage={!!imagePath} onMakePlan={makePlan} />
        )}

        {activeStep === 'stitches' && (
          <StitchesStep
            stitches={stitches}
            busy={busy}
            hasSource={!!(stylizedPath || imagePath)}
            stitchPost={stitchPost}
            onStitchPostChange={setStitchPost}
            onMakeStitches={makeStitches}
          />
        )}

        {activeStep === 'export' && (
          <ExportStep stitches={stitches} busy={busy} exportFiles={exportFiles} onExport={exportDst} />
        )}

        {historyOpen && activeStep !== 'stylize' && (
          <HistoryPanel detailed history={history} onRestore={restoreVersion} />
        )}
      </section>
    </div>
  )
}
