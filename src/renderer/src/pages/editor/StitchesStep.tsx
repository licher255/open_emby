import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { StitchResult } from '@shared/types'
import StitchPreview from '../../components/StitchPreview'
import { useT } from '../../i18n'

const StitchPreview3D = lazy(() => import('../../components/StitchPreview3D'))

export interface StitchPostInput { min: string; max: string; tolerance: string }

interface Props {
  stitches: StitchResult | null
  busy: string | null
  hasSource: boolean
  stitchPost: StitchPostInput
  onStitchPostChange: (next: StitchPostInput) => void
  onMakeStitches: () => void
}

/** 针迹步骤：后处理参数 + 2D/3D 仿真 + 可绣性检查 + 换色层 */
export default function StitchesStep({ stitches, busy, hasSource, stitchPost, onStitchPostChange, onMakeStitches }: Props) {
  const t = useT()
  const [view3d, setView3d] = useState(false)
  const [progress100, setProgress100] = useState(100)
  const [hiddenLayers, setHiddenLayers] = useState<Set<number>>(new Set())

  // 新针迹结果：进度拉满、取消图层隐藏
  useEffect(() => {
    setProgress100(100)
    setHiddenLayers(new Set())
  }, [stitches])

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

  return (
    <div className="step-panel">
      <h1>{t('step.stitches')}</h1>
      <div className="stitch-post-controls">
        <strong>{t('stitch.postProcess')}</strong>
        <label>
          {t('stitch.minLength')}
          <input type="number" min={0.1} max={5} step={0.1} value={stitchPost.min} onChange={(e) => onStitchPostChange({ ...stitchPost, min: e.target.value })} />
          <span>mm</span>
        </label>
        <label>
          {t('stitch.maxLength')}
          <input type="number" min={Math.max(0.2, (Number(stitchPost.min) || 0.1) * 2)} max={12} step={0.1} value={stitchPost.max} onChange={(e) => onStitchPostChange({ ...stitchPost, max: e.target.value })} />
          <span>mm</span>
        </label>
        <label>
          {t('stitch.curveTolerance')}
          <input type="number" min={0.01} max={2} step={0.05} value={stitchPost.tolerance} onChange={(e) => onStitchPostChange({ ...stitchPost, tolerance: e.target.value })} />
          <span>mm</span>
        </label>
      </div>
      <p className="mono-meta stitch-post-hint">{t('stitch.postProcessHint')}</p>
      <div className="editor-actions">
        <button className="btn-pill" disabled={!!busy || !hasSource} onClick={onMakeStitches}>
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
  )
}
