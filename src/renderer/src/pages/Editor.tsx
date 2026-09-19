import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CommitInfo, DigitizePlan, EngineProgressEvent, ProjectImage, ProjectInfo, StitchResult } from '@shared/types'
import { toast } from '../stores/toast'
import StitchPreview3D from '../components/StitchPreview3D'
import { localeTag, useT } from '../i18n'
import type { LocaleKey } from '../i18n/en'
import Icon, { type IconName } from '../components/Icon'

const STEP_KEY: Record<StepId, LocaleKey> = {
  import: 'step.import',
  stylize: 'step.stylize',
  plan: 'step.plan',
  stitches: 'step.stitches',
  export: 'step.export'
}

const STEP_ICON: Record<StepId, IconName> = {
  import: 'image',
  stylize: 'palette',
  plan: 'clipboard-list',
  stitches: 'route',
  export: 'file-export'
}

/** 风格化工作流的固定节点（对应 main/services/engine.ts buildStylizeWorkflow），
 *  借鉴 ComfyUI 的节点执行高亮：pending → running → done / error */
const FLOW_NODES = [
  { id: 'load', label: 'LoadImage' },
  { id: 'stylize', label: 'EmbyColorBlockStylize' },
  { id: 'lineart', label: 'EmbyLineArtExtract' },
  { id: 'save', label: 'SaveImage·色块' },
  { id: 'saveLine', label: 'SaveImage·线稿' }
] as const

type NodeState = 'pending' | 'running' | 'done' | 'error'
type StepId = 'import' | 'stylize' | 'plan' | 'stitches' | 'export'

interface Props {
  project: ProjectInfo
  onProjectChanged: () => void
}

/** 步骤化工作台：左侧步骤轨（每步的状态与产物一目了然），右侧当前步骤的输入/输出槽。
 *  产物留在产生它的步骤里，不混入其他步骤。 */
export default function Editor({ project, onProjectChanged }: Props) {
  const t = useT()
  const [images, setImages] = useState<ProjectImage[]>([])
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [stylizedUrl, setStylizedUrl] = useState<string | null>(null)
  const [stylizedPath, setStylizedPath] = useState<string | null>(null)
  const [lineArtUrl, setLineArtUrl] = useState<string | null>(null)
  const [lineArtPath, setLineArtPath] = useState<string | null>(null)
  const [layerView, setLayerView] = useState<'blocks' | 'lineart' | 'overlay'>('overlay')
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
  const [historyOpen, setHistoryOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [activeStep, setActiveStep] = useState<StepId>('import')

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
  }, [project.id])

  useEffect(() => {
    refreshImages()
    refreshHistory()
    restoreState()
  }, [refreshImages, refreshHistory, restoreState])

  /** 保存工作台状态并留一个版本（Git 提交） */
  const persist = useCallback(async (message: string, overrides: Partial<{ plan: DigitizePlan | null; stitches: StitchResult | null; stylizedPath: string | null; lineArtPath: string | null; imagePath: string | null }> = {}) => {
    const state = {
      imagePath: overrides.imagePath !== undefined ? overrides.imagePath : imagePath,
      stylizedPath: overrides.stylizedPath !== undefined ? overrides.stylizedPath : stylizedPath,
      lineArtPath: overrides.lineArtPath !== undefined ? overrides.lineArtPath : lineArtPath,
      plan: overrides.plan !== undefined ? overrides.plan : plan,
      stitches: overrides.stitches !== undefined ? overrides.stitches : stitches
    }
    try {
      await window.openEmby.projects.saveState(project.id, state, message)
      await refreshHistory()
    } catch (e) {
      console.warn('状态保存失败', e)
    }
  }, [project.id, imagePath, stylizedPath, lineArtPath, plan, stitches, refreshHistory])

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
        setProgress(`KMeans ${ev.value}/${ev.max}`)
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

  /** 导入图稿到项目（复制进项目目录） */
  async function importIntoProject(srcPath: string) {
    setBusy('import')
    try {
      const dest = await window.openEmby.projects.importImage(project.id, srcPath)
      await refreshImages()
      onProjectChanged()
      await selectImage(dest)
      toast.success(t('toast.imported'))
      await persist('Import artwork', { imagePath: dest, plan: null, stitches: null, stylizedPath: null })
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

  async function stylize() {
    if (!imagePath) return
    setBusy('stylize'); setProgress('')
    setNodeStates(Object.fromEntries(FLOW_NODES.map((n) => [n.id, 'pending'])))
    setNodePct(null)
    try {
      const result = await window.openEmby.engine.stylize(imagePath, plan?.maxColors ?? 8)
      setStylizedUrl(result.colorBlocks)
      setLineArtUrl(result.lineArt)
      setNodeStates(Object.fromEntries(FLOW_NODES.map((n) => [n.id, 'done'])))
      setProgress('')
      // 双层产出存回项目，记录来源谱系
      const srcName = imagePath.split(/[\\/]/).pop()
      const saved = await window.openEmby.projects.saveImage(project.id, result.colorBlocks, 'stylized', 'stylized', srcName)
      const savedLine = await window.openEmby.projects.saveImage(project.id, result.lineArt, 'lineart', 'lineart', srcName)
      setStylizedPath(saved)
      setLineArtPath(savedLine)
      setStitches(null)
      setExportFiles(null)
      await refreshImages()
      onProjectChanged()
      toast.success(t('toast.stylizeDone'))
      await persist('Stylize · color blocks + line art', { stylizedPath: saved, lineArtPath: savedLine, stitches: null })
    } catch (err) {
      toast.error(t('toast.fail.stylize', { error: String(err) }))
    } finally {
      setBusy(null)
    }
  }

  async function makePlan() {
    if (!imagePath) return
    setBusy('plan')
    try {
      const p = await window.openEmby.sidecar.digitizePlan(imagePath, '')
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
      const result = await window.openEmby.sidecar.digitizeStitches(src, plan?.maxColors ?? 8, plan?.sizeMm.width ?? 100)
      setStitches(result)
      setProgress100(100)
      setHiddenLayers(new Set())
      toast.success(t('toast.stitchDone', { stitches: result.stitchCount.toLocaleString(), changes: result.colorChanges }))
      await persist(`Generate stitches (${result.stitchCount} stitches)`, { stitches: result })
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
    { id: 'stylize', done: !!stylizedPath, artifact: stylizedPath ? (stylizedPath.split(/[\\/]/).pop() ?? '') : '' },
    { id: 'plan', done: !!plan, artifact: plan ? `${plan.palette.length} colors` : '' },
    { id: 'stitches', done: !!stitches, artifact: stitches ? `${stitches.stitchCount.toLocaleString()} st` : '' },
    { id: 'export', done: !!exportFiles, artifact: exportFiles ? `${exportFiles.length} files` : '' }
  ]

  const originals = images.filter((i) => i.kind === 'original' || i.kind === 'other')
  const stylizedAssets = images.filter((i) => i.kind === 'stylized')

  return (
    <div className="workbench">
      {/* 左侧步骤轨（项目树）：步骤 + 状态 + 产物摘要 */}
      <aside className="step-rail">
        <div className="step-rail-title">{project.name}</div>
        {steps.map((s, i) => (
          <button
            key={s.id}
            className={`step-item ${activeStep === s.id ? 'active' : ''} ${s.done ? 'done' : ''}`}
            onClick={() => setActiveStep(s.id)}
          >
            <span className="step-num">{s.done ? '✓' : <Icon name={STEP_ICON[s.id]} size={11} />}</span>
            <span className="step-body">
              <span className="step-name">{t(STEP_KEY[s.id])}</span>
              {s.artifact && <span className="step-artifact">{s.artifact}</span>}
            </span>
          </button>
        ))}
        <div className="step-rail-foot">
          <button className="step-item plain" onClick={() => setHistoryOpen(!historyOpen)}>
            <Icon name="clock-rotate-left" />
            <span className="step-name">{t('history.title')}</span>
            <span className="step-artifact">{history.length}</span>
          </button>
        </div>
      </aside>

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
            <div className="thumb-grid">
              {originals.map((img) => (
                <button
                  key={img.path}
                  className={`thumb-cell ${img.path === imagePath ? 'active' : ''}`}
                  onClick={() => selectImage(img.path)}
                  title={img.name}
                >
                  <AssetThumb path={img.path} />
                  <span className="thumb-name">{img.name}</span>
                </button>
              ))}
              {originals.length === 0 && <p className="mono-meta">{t('editor.noReference')}</p>}
            </div>
          </div>
        )}

        {activeStep === 'stylize' && (
          <div className="step-panel">
            <h1>{t('step.stylize')}</h1>
            <div className="io-grid">
              <div className="pane">
                <h3>{t('editor.input')}</h3>
                <div className="img-frame">
                  {imageUrl
                    ? <img src={imageUrl} alt="input" />
                    : <div className="img-placeholder">{t('editor.noInput')}</div>}
                </div>
              </div>
              <div className="pane">
                <h3>{t('editor.output')}</h3>
                {(stylizedUrl || busy === 'stylize') && (
                  <div className="view-tabs" style={{ marginBottom: 6 }}>
                    <button className={layerView === 'blocks' ? 'active' : ''} onClick={() => setLayerView('blocks')}>{t('editor.layerBlocks')}</button>
                    <button className={layerView === 'lineart' ? 'active' : ''} onClick={() => setLayerView('lineart')}>{t('editor.layerLineart')}</button>
                    <button className={layerView === 'overlay' ? 'active' : ''} onClick={() => setLayerView('overlay')}>{t('editor.layerOverlay')}</button>
                  </div>
                )}
                <div className="img-frame">
                  {stylizedUrl ? (
                    layerView === 'blocks' ? <img src={stylizedUrl} alt="color blocks" />
                    : layerView === 'lineart' && lineArtUrl ? <img src={lineArtUrl} alt="line art" />
                    : (
                      <div className="layer-stack">
                        <img src={stylizedUrl} alt="color blocks" />
                        {lineArtUrl && <img src={lineArtUrl} alt="line art" className="layer-lineart" />}
                      </div>
                    )
                  ) : (
                    <div className="img-placeholder">{busy === 'stylize' ? progress || t('editor.generating') : t('editor.notGenerated')}</div>
                  )}
                </div>
                {busy === 'stylize' && (
                  <div className="progress-track">
                    {nodePct
                      ? <div className="progress-fill" style={{ width: `${Math.round((nodePct.value / nodePct.max) * 100)}%` }} />
                      : <div className="progress-fill indeterminate" />}
                  </div>
                )}
              </div>
            </div>
            {(busy === 'stylize' || Object.keys(nodeStates).length > 0) && (
              <div className="flow-strip">
                {FLOW_NODES.map((n, i) => (
                  <span key={n.id} className="flow-item">
                    {i > 0 && <span className="flow-arrow">→</span>}
                    <span className={`flow-node ${nodeStates[n.id] ?? 'pending'}`}>{n.label}</span>
                  </span>
                ))}
              </div>
            )}
            <div className="editor-actions">
              <button className="btn-pill" disabled={!!busy || !imagePath} onClick={stylize}>
                {busy === 'stylize' ? t('editor.stylizing') : t('editor.stylize')}
              </button>
            </div>
            {stylizedAssets.length > 0 && (
              <>
                <h3>{t('editor.pastOutputs')}</h3>
                <div className="thumb-grid">
                  {stylizedAssets.map((img) => (
                    <button
                      key={img.path}
                      className={`thumb-cell ${img.path === stylizedPath ? 'active' : ''}`}
                      onClick={async () => {
                        setStylizedPath(img.path)
                        setStylizedUrl(await window.openEmby.files.readImageDataUrl(img.path))
                      }}
                      title={img.derivedFrom ? `${img.name} ← ${img.derivedFrom}` : img.name}
                    >
                      <AssetThumb path={img.path} />
                      <span className="thumb-name">{img.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
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
                        <StitchPreview3D stitches={stitches} hidden={hiddenLayers} />
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

        {historyOpen && (
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
