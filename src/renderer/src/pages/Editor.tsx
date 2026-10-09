import { useCallback, useEffect, useState } from 'react'
import type { AgentOptions, CommitInfo, DigitizePlan, EngineProgressEvent, ProjectImage, ProjectInfo, StitchPostProcess, StitchResult } from '@shared/types'
import { toast } from '../stores/toast'
import { confirmDialog, promptDialog } from '../stores/dialog'
import { useI18n, useT } from '../i18n'
import AgentPanel from './editor/AgentPanel'
import Studio from './editor/Studio'
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
  const zh = useI18n(s => s.locale) === 'zh-CN'
  const setActiveStep = useWorkbench(s => s.setActiveStep)
  const expertMode = useWorkbench(s => s.expertMode)
  const setExpertMode = useWorkbench(s => s.setExpertMode)
  const [agentOptions, setAgentOptions] = useState<AgentOptions>({ intent: '', maxColors: 6, widthMm: 100, fabric: 'woven', texture: 'flow', stitchBackend: 'paper', artStyle: 'clean' })
  const [agentStatus, setAgentStatus] = useState('')
  const [studioError, setStudioError] = useState('')
  const [repairPreview, setRepairPreview] = useState<{ data: string; source: string } | null>(null)
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
  const [stitchPost, setStitchPost] = useState<StitchPostInput>({ min: '0.3', max: '3.0', tolerance: '0.15' })

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
    if (s.agentOptions) setAgentOptions({ stitchBackend: 'paper', artStyle: 'clean', ...s.agentOptions })
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
    setPlan(s.plan ?? null)
    setStitches(s.stitches ?? null)
    if (!s.stylizedPath) { setStylizedPath(null); setStylizedUrl(null) }
    if (!s.lineArtPath) { setLineArtPath(null); setLineArtUrl(null) }
    if (!s.imagePath) { setImagePath(null); setImageUrl(null) }
    setExportFiles(null)
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
      stitchPostProcess: overrides.stitchPostProcess ?? getStitchPostProcess(),
      agentOptions
    }
    try {
      await window.openEmby.projects.saveState(project.id, state, message)
      await refreshHistory()
    } catch (e) {
      toast.error(zh ? '保存没有完成，请检查磁盘空间。' : 'Could not save. Check available disk space.')
      throw e
    }
  }, [project.id, imagePath, stylizedPath, lineArtPath, canvasMm, plan, stitches, stitchPost, agentOptions, refreshHistory]) // eslint-disable-line react-hooks/exhaustive-deps

  function getStitchPostProcess(): StitchPostProcess {
    const minStitchMm = Math.min(2, Math.max(0.1, Number(stitchPost.min) || 0.3))
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
      setAgentOptions(v => ({ ...v, widthMm: w }))
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
    await persist('Select reference image', { imagePath: path, stylizedPath: null, lineArtPath: null, plan: null, stitches: null })
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
        await persist(`Archive image ${img.name}`, { stylizedPath: null, lineArtPath: null, plan: null, stitches: null })
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
      setPlan(null); setStitches(null); setExportFiles(null)
      setLineArtPath(null); setLineArtUrl(null)
      await persist('Select artwork for digitizing', { stylizedPath: img.path, lineArtPath: null, plan: null, stitches: null })
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
    await persist('Refine layers', { stylizedPath: saved, lineArtPath: savedLine, plan: null, stitches: null })
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
      const { colorBlocks: blocks, draft } = await window.openEmby.engine.generateColorBlocks(imagePath, null, agentOptions.maxColors, agentOptions.intent)
      if (draft) await window.openEmby.projects.saveImage(project.id, draft, 'ai_draft', 'stylized', srcName)
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
      await persist('Stage 2 · color blocks + line art', { stylizedPath: savedBlocks, lineArtPath: savedLine, plan: null, stitches: null })
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
      const srcName = imagePath.split(/[\\/]/).pop()
      const { colorBlocks: blocks, draft } = await window.openEmby.engine.generateColorBlocks(imagePath, lineArtPath, agentOptions.maxColors, agentOptions.intent)
      if (draft) await window.openEmby.projects.saveImage(project.id, draft, 'ai_draft', 'stylized', srcName)
      const savedBlocks = await window.openEmby.projects.saveImage(project.id, blocks, 'stylized', 'stylized', srcName)
      setStylizedUrl(blocks)
      setStylizedPath(savedBlocks)
      setStitches(null)
      setExportFiles(null)
      await refreshImages()
      onProjectChanged()
      toast.success(t('toast.blocksDone'))
      await persist('Regenerate color blocks from line art', { stylizedPath: savedBlocks, plan: null, stitches: null })
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
    const src = stylizedPath ?? imagePath
    if (!src) return
    setBusy('plan')
    try {
      const p = await window.openEmby.sidecar.digitizePlan(src, agentOptions.intent, agentOptions.widthMm, agentOptions.maxColors, agentOptions.fabric, agentOptions.texture)
      setPlan(p)
      setStitches(null); setExportFiles(null)
      toast.success(t('toast.planDone'))
      await persist('Build digitizing plan', { plan: p, stitches: null })
    } catch (err) {
      toast.error(t('toast.fail.plan', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  function editPlan(next: DigitizePlan) {
    setPlan(next); setStitches(null); setExportFiles(null)
  }

  useEffect(() => {
    if (plan && plan.imagePath !== (stylizedPath ?? imagePath)) { setPlan(null); setStitches(null); setExportFiles(null) }
  }, [stylizedPath, imagePath, plan])

  async function repairRegion(label: number, intent: string) {
    if (!plan || busy) return
    setBusy('repair')
    try {
      const data = await window.openEmby.engine.repairRegion(plan, label, intent)
      setRepairPreview({ data, source: plan.imagePath })
    } catch (error) { toast.error(String(error)) }
    finally { setBusy(null) }
  }

  async function applyRepair() {
    if (!plan || !repairPreview || repairPreview.source !== plan.imagePath || busy) return
    setBusy('repair')
    try {
      const data = repairPreview.data
      const saved = await window.openEmby.projects.saveImage(project.id, data, 'region_edit', 'stylized', plan.imagePath.split(/[\\/]/).pop())
      setRepairPreview(null)
      setStylizedPath(saved); setStylizedUrl(data); setPlan(null); setStitches(null); setExportFiles(null); setLineArtPath(null); setLineArtUrl(null)
      await persist('Agent · region repair checkpoint', { stylizedPath: saved, lineArtPath: null, plan: null, stitches: null })
      await refreshImages()
      const p = await window.openEmby.sidecar.digitizePlan(saved, agentOptions.intent, plan.widthMm, plan.maxColors, agentOptions.fabric, agentOptions.texture)
      setPlan(p)
      await persist('Agent · repaired object plan', { stylizedPath: saved, lineArtPath: null, plan: p, stitches: null })
      toast.success(zh ? '选区已更新，请检查区域方案再生成针迹。' : 'Region updated. Review the plan before stitching.')
    } catch (error) { toast.error(String(error)) }
    finally { setBusy(null) }
  }

  // Save object edits after the user stops moving a slider; preserve exact masks and parameters.
  useEffect(() => {
    if (!imagePath || busy) return
    const timer = setTimeout(() => { void persist('Update region plan').catch(() => {}) }, 800)
    return () => clearTimeout(timer)
  }, [plan, busy, persist])

  async function runAgent() {
    if (!imagePath || busy) return
    if (!Number.isFinite(agentOptions.widthMm) || agentOptions.widthMm < 10 || agentOptions.widthMm > 400 || !Number.isInteger(agentOptions.maxColors) || agentOptions.maxColors < 2 || agentOptions.maxColors > 16) {
      toast.error(zh ? '宽度须为 10–400 mm，色数须为 2–16 的整数。' : 'Width: 10–400 mm. Colors: integer between 2 and 16.'); return
    }
    setBusy('agent'); setExportFiles(null); setStudioError('')
    let stage = zh ? 'AI 初稿' : 'AI draft'
    try {
      setAgentStatus(zh ? '正在把照片整理成绣稿…' : 'Turning your photo into artwork…')
      const draft = await window.openEmby.engine.generateDraft(imagePath, agentOptions.maxColors, agentOptions.intent, agentOptions.artStyle)
      const srcName = imagePath.split(/[\\/]/).pop()
      const src = await window.openEmby.projects.saveImage(project.id, draft, 'ai_draft', 'stylized', srcName)
      setStylizedPath(src); setStylizedUrl(draft)
      setPlan(null); setStitches(null); setLineArtPath(null); setLineArtUrl(null)
      await persist('Agent · artwork checkpoint', { stylizedPath: src, lineArtPath: null, plan: null, stitches: null })
      await refreshImages()
      stage = zh ? '区域方案' : 'Object plan'
      setAgentStatus(zh ? '正在安排颜色和纹理方向…' : 'Planning colors and texture…')
      const p = await window.openEmby.sidecar.digitizePlan(src, agentOptions.intent, agentOptions.widthMm, agentOptions.maxColors, agentOptions.fabric, agentOptions.texture)
      setPlan(p)
      await persist('Agent · object plan checkpoint', { stylizedPath: src, lineArtPath: null, plan: p, stitches: null })
      stage = zh ? '针迹与检查' : 'Stitches and checks'
      setAgentStatus(zh ? '正在铺设针迹，精细生成可能需要几分钟…' : 'Laying out stitches. Refinement may take a few minutes…')
      const post = getStitchPostProcess()
      const result = await window.openEmby.sidecar.digitizeStitches(src, p.maxColors, p.widthMm, post, p, agentOptions.stitchBackend ?? 'paper')
      setStitches(result)
      await persist('Agent · stitch preview and checks', { stylizedPath: src, lineArtPath: null, plan: p, stitches: result })
      setAgentStatus(zh ? '绣稿已准备好，可以预览或调整细节。' : 'Your embroidery is ready to preview and refine.')
      setActiveStep('stitches'); onProjectChanged()
    } catch (error) {
      setStudioError(String(error))
      setAgentStatus(`${stage}: ${String(error)}`)
      toast.error(String(error))
      await refreshImages()
    } finally { setBusy(null) }
  }

  /** 生成针迹：对风格化色块图（没有则退回原图）跑 Rust 针迹生成器 */
  async function makeStitches() {
    const src = stylizedPath ?? imagePath
    if (!src) return
    setBusy('stitch'); setExportFiles(null); setStudioError(''); setAgentStatus(zh ? '正在为当前绣稿生成针迹…' : 'Creating stitches for this artwork…')
    try {
      const postProcess = getStitchPostProcess()
      const p = plan?.mapWidth && plan.imagePath === src ? plan : await window.openEmby.sidecar.digitizePlan(src, agentOptions.intent, agentOptions.widthMm, agentOptions.maxColors, agentOptions.fabric, agentOptions.texture)
      setPlan(p)
      const result = await window.openEmby.sidecar.digitizeStitches(src, p.maxColors, p.widthMm, postProcess, p, agentOptions.stitchBackend ?? 'paper')
      setStitches(result)
      toast.success(t('toast.stitchDone', { stitches: result.stitchCount.toLocaleString(), changes: result.colorChanges }))
      await persist(`Generate stitches (${result.stitchCount} stitches)`, { plan: p, stitches: result, stitchPostProcess: postProcess })
      setActiveStep('stitches')
    } catch (err) {
      setStudioError(String(err))
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
      const r = await window.openEmby.sidecar.exportSave({
        points: stitches.points,
        palette: stitches.palette,
        name: project.name,
        format: 'dst'
      })
      if (!r) return
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
    { id: 'stylize', done: !!stylizedPath, artifact: stylizedPath ? (lineArtPath ? t('editor.twoLayers') : (zh ? 'AI 初稿' : 'Artwork')) : '' },
    { id: 'plan', done: !!plan, artifact: plan ? `${plan.palette.length} colors` : '' },
    { id: 'stitches', done: !!stitches, artifact: stitches ? `${stitches.stitchCount.toLocaleString()} st` : '' },
    { id: 'export', done: !!exportFiles, artifact: exportFiles ? `${exportFiles.length} files` : '' }
  ]

  // 发布步骤树到共享 store（App 侧边栏项目树下渲染）
  useEffect(() => { setWbSteps(steps) }, [imagePath, stylizedPath, plan, stitches, exportFiles, setWbSteps]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setWbHistoryCount(history.length) }, [history.length, setWbHistoryCount])

  const originals = images.filter((i) => i.kind === 'original' || i.kind === 'other')
  const stage2Assets = images.filter((i) => i.kind === 'stylized' || i.kind === 'lineart')

  if (!expertMode) return <>
    <Studio imageUrl={imageUrl} artworkUrl={stylizedUrl} stitches={stitches} options={agentOptions} busy={busy} status={agentStatus} error={studioError} files={exportFiles}
      onOptions={next => { setAgentOptions(next); setPlan(null); setStitches(null); setExportFiles(null) }} onPick={pickImage} onImport={importIntoProject} onGenerate={runAgent} onResume={makeStitches} onExport={exportDst}
      onRefine={() => { setExpertMode(true); setActiveStep(plan ? 'plan' : stylizedPath ? 'stylize' : 'import') }} onHistory={() => useWorkbench.getState().setHistoryOpen(!historyOpen)} />
    {historyOpen && <HistoryPanel detailed history={history} onRestore={restoreVersion} />}
  </>

  return (
    <div className="workbench">
      <section className="step-content">
        <button className="studio-back" disabled={!!busy} onClick={() => { setExpertMode(false); setActiveStep('import') }}>← {zh ? '返回简洁预览' : 'Back to preview'}</button>
        <AgentPanel options={agentOptions} onChange={next => { setAgentOptions(next); setPlan(null); setStitches(null); setExportFiles(null) }} busy={!!busy} hasImage={!!imagePath} onRun={runAgent} status={agentStatus} compact={activeStep !== 'import'} />
        {activeStep === 'import' && (
          <ImportStep
            originals={originals}
            imagePath={imagePath}
            importing={!!busy}
            canvasMm={canvasMm}
            canvasW={canvasW}
            canvasH={canvasH}
            canvasMode={canvasMode}
            onPickImage={pickImage}
            onImportPath={importIntoProject}
            onSelectImage={path => { if (!busy) void selectImage(path) }}
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
            onSelectAsset={img => { if (!busy) return selectStage2Asset(img) }}
            onRename={renameAsset}
            onArchive={archiveAsset}
            onRestoreVersion={restoreVersion}
          />
        )}

        {activeStep === 'plan' && (
          <PlanStep plan={plan} busy={busy} hasImage={!!(stylizedPath || imagePath)} onMakePlan={makePlan} onChange={editPlan} onPreview={makeStitches} onRepair={repairRegion}
            repairPreview={repairPreview?.source === plan?.imagePath ? repairPreview?.data ?? null : null} originalUrl={stylizedUrl ?? imageUrl} onApplyRepair={applyRepair} onDiscardRepair={() => setRepairPreview(null)} />
        )}

        {activeStep === 'stitches' && (
          <StitchesStep
            stitches={stitches}
            busy={busy}
            hasSource={!!(stylizedPath || imagePath)}
            stitchPost={stitchPost}
            onStitchPostChange={next => { setStitchPost(next); setStitches(null); setExportFiles(null) }}
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
