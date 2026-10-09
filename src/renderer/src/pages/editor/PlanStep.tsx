import { useEffect, useRef, useState } from 'react'
import type { DigitizePlan, StitchRegion } from '@shared/types'
import { useI18n, useT } from '../../i18n'

interface Props {
  plan: DigitizePlan | null; busy: string | null; hasImage: boolean
  onMakePlan: () => void; onChange: (plan: DigitizePlan) => void; onPreview: () => void
  onRepair: (label: number, intent: string) => void
  repairPreview: string | null; originalUrl: string | null; onApplyRepair: () => void; onDiscardRepair: () => void
}

export default function PlanStep({ plan, busy, hasImage, onMakePlan, onChange, onPreview, onRepair, repairPreview, originalUrl, onApplyRepair, onDiscardRepair }: Props) {
  const t = useT(); const zh = useI18n(s => s.locale) === 'zh-CN'
  const canvas = useRef<HTMLCanvasElement>(null)
  const [selected, setSelected] = useState(0)
  const [showSmall, setShowSmall] = useState(false)
  const [page, setPage] = useState(0)
  const [repair, setRepair] = useState('')
  const [guideMode, setGuideMode] = useState<'select' | 'flow' | 'radial'>('select')
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const valid = !!plan?.mapWidth
  useEffect(() => { setSelected(0); setPage(0) }, [plan?.sourceHash])
  useEffect(() => {
    if (!plan?.mapWidth || !canvas.current) return
    const c = canvas.current; c.width = plan.mapWidth; c.height = plan.mapHeight
    const ctx = c.getContext('2d')!; const img = ctx.createImageData(c.width, c.height)
    const regions = new Map(plan.regions.map(r => [r.label, r]))
    for (let i = 0; i < plan.labels.length; i++) {
      const r = regions.get(plan.labels[i]); const hex = r?.color ?? '#ffffff'
      const rgb = [1, 3, 5].map(j => parseInt(hex.slice(j, j + 2), 16))
      const active = !selected || r?.label === selected
      for (let j = 0; j < 3; j++) img.data[i * 4 + j] = !r ? 255 : !r.enabled ? (i % c.width % 4 < 2 ? 225 : 245) : active ? rgb[j] : rgb[j] * 0.25 + 190
      img.data[i * 4 + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    for (const g of plan.directionGuides ?? []) {
      const x = g.xMm / plan.widthMm * c.width; const y = g.yMm / plan.heightMm * c.height
      const a = g.angleDeg * Math.PI / 180
      ctx.strokeStyle = g.kind === 'radial' ? '#1597a5' : '#e34080'; ctx.lineWidth = 2
      ctx.beginPath()
      if (g.kind === 'radial') ctx.ellipse(x, y, g.radiusMm / plan.widthMm * c.width, g.radiusMm / plan.heightMm * c.height, 0, 0, Math.PI * 2)
      else { ctx.moveTo(x - Math.cos(a) * 12, y - Math.sin(a) * 12); ctx.lineTo(x + Math.cos(a) * 12, y + Math.sin(a) * 12) }
      ctx.stroke(); ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.stroke()
    }
    const r = regions.get(selected)
    if (r && !['flow', 'radial'].includes(r.stitchType)) {
      const x = (r.xMm + r.widthMm / 2) / plan.widthMm * c.width
      const y = (r.yMm + r.heightMm / 2) / plan.heightMm * c.height
      const a = r.angleDeg * Math.PI / 180; const len = 20
      ctx.strokeStyle = '#f02e87'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * len, y - Math.sin(a) * len); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke()
    }
  }, [plan, selected])
  const r = plan?.regions.find(r => r.label === selected)
  const edit = (patch: Partial<StitchRegion>) => { if (plan && r) onChange({ ...plan, regions: plan.regions.map(v => v.label === r.label ? { ...v, ...patch } : v) }) }
  const filtered = plan?.regions.filter(r => showSmall || r.enabled) ?? []
  const names = zh ? { flow: '连续毛流', radial: '区域椭圆法线', curved: '旧曲线填针', tatami: '错位填针', satin: '缎面针', run: '中心走针' } : { flow: 'Continuous flow', radial: 'Ellipse normals', curved: 'Legacy curved fill', tatami: 'Tatami', satin: 'Satin', run: 'Center run' }
  return <div className="step-panel">
    <h1>{t('step.plan')}</h1>
    <div className="editor-actions">
      {valid && plan && <label><input type="checkbox" checked={plan.routeTravel !== false} disabled={!!busy} onChange={e => onChange({ ...plan, routeTravel: e.target.checked })} />{zh ? '优化区域顺序与内部走线' : 'Optimize object order and internal travel'}</label>}
      <button className="btn-pill" disabled={!!busy || !hasImage} onClick={onMakePlan}>{busy === 'plan' ? t('editor.planning') : t('editor.plan')}</button>
      <button className="btn-outline" disabled={!!busy || !valid} onClick={onPreview}>{zh ? '按当前方案生成针迹' : 'Preview this plan'}</button>
    </div>
    {plan && !valid && <p>{zh ? '旧方案需要重新分析，才能编辑区域针法。' : 'Analyze again to upgrade this older plan.'}</p>}
    {repairPreview && <section className="card repair-preview">
      <h2>{zh ? '局部修改预览' : 'Review regional edit'}</h2>
      <div className="repair-images"><figure>{originalUrl && <img src={originalUrl} alt={zh ? '修改前' : 'Before'} />}<figcaption>{zh ? '修改前' : 'Before'}</figcaption></figure><figure><img src={repairPreview} alt={zh ? '修改建议' : 'Proposed edit'} /><figcaption>{zh ? '修改建议 · 检查接缝与细节' : 'Proposed edit · check seams and details'}</figcaption></figure></div>
      <div className="editor-actions"><button className="btn-pill" disabled={!!busy} onClick={onApplyRepair}>{zh ? '采用并重新分析' : 'Apply & reanalyze'}</button><button className="btn-outline" disabled={!!busy} onClick={onDiscardRepair}>{zh ? '丢弃修改' : 'Discard'}</button></div>
    </section>}
    {valid && plan && <div className="object-layout">
      <div className="card"><h2>{zh ? '点击图中区域' : 'Select a region'}</h2>
        {plan.directionField && <>
          <div className="editor-actions">
            <select aria-label={zh ? '方向引导工具' : 'Direction guide tool'} value={guideMode} disabled={!!busy} onChange={e => setGuideMode(e.target.value as typeof guideMode)}>
              <option value="select">{zh ? '选择区域' : 'Select region'}</option><option value="flow">{zh ? '拖画毛流方向' : 'Draw flow direction'}</option><option value="radial">{zh ? '拖画圆弧法线' : 'Draw arc normals'}</option>
            </select>
            <button disabled={!!busy || !plan.directionGuides?.length} onClick={() => onChange({ ...plan, directionGuides: plan.directionGuides?.slice(0, -1) })}>{zh ? '撤销引导' : 'Undo guide'}</button>
            <button disabled={!!busy} onClick={() => onChange({ ...plan, regions: plan.regions.map(r => ({ ...r, stitchType: 'flow', angleDeg: 0 })) })}>{zh ? '所有区域使用连续毛流' : 'Use flow for all regions'}</button>
          </div>
          <p className="mono-meta">{zh ? '毛流：顺毛发拖一条线。圆弧法线：从圆心拖到边缘，圆内针迹沿径向。引导跨越色块共享，重新生成针迹后生效。' : 'Flow: drag along the fur. Arc normals: drag from the center to the rim. Guides span color boundaries; regenerate to apply.'}</p>
        </>}
        <canvas ref={canvas} className="object-canvas" style={{ touchAction: 'none' }} aria-label={zh ? '制版区域图，可在右侧列表选择' : 'Object map; also selectable in the region list'}
        onPointerDown={e => {
          if (guideMode === 'select' || busy) return
          const rect = e.currentTarget.getBoundingClientRect()
          dragStart.current = { x: (e.clientX - rect.left) / rect.width * plan.widthMm, y: (e.clientY - rect.top) / rect.height * plan.heightMm }
          e.currentTarget.setPointerCapture(e.pointerId)
        }} onPointerCancel={() => { dragStart.current = null }} onPointerUp={e => {
          const start = dragStart.current; dragStart.current = null
          if (!start || busy || guideMode === 'select') return
          const rect = e.currentTarget.getBoundingClientRect()
          const x = Math.max(0, Math.min(plan.widthMm, (e.clientX - rect.left) / rect.width * plan.widthMm))
          const y = Math.max(0, Math.min(plan.heightMm, (e.clientY - rect.top) / rect.height * plan.heightMm))
          const length = Math.hypot(x - start.x, y - start.y)
          if (length < 1 || (plan.directionGuides?.length ?? 0) >= 256) return
          const radial = guideMode === 'radial'
          const guide = { kind: guideMode, xMm: radial ? start.x : (x + start.x) / 2, yMm: radial ? start.y : (y + start.y) / 2, angleDeg: Math.atan2(y - start.y, x - start.x) * 180 / Math.PI, radiusMm: radial ? Math.min(100, length) : Math.min(30, Math.max(5, length)) }
          onChange({ ...plan, directionGuides: [...(plan.directionGuides ?? []), guide] })
        }} onClick={e => {
          if (guideMode !== 'select' || busy) return
          const rect = e.currentTarget.getBoundingClientRect(); const x = Math.min(plan.mapWidth - 1, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * plan.mapWidth)))
          const y = Math.min(plan.mapHeight - 1, Math.max(0, Math.floor((e.clientY - rect.top) / rect.height * plan.mapHeight)))
          setSelected(plan.labels[y * plan.mapWidth + x])
        }} />
        <p className="mono-meta">{plan.widthMm.toFixed(1)} × {plan.heightMm.toFixed(1)} mm · {plan.palette.length} {zh ? '色' : 'colors'} · {plan.regions.filter(r => r.enabled).length} {zh ? '个启用区域' : 'enabled objects'}</p>
        <p>{zh ? '粉色线表示针迹方向。灰格区域不绣，可选中后恢复。眼睛、嘴部等细节请逐一检查。' : 'Pink indicates stitch direction. Hatched regions are disabled and can be restored. Check eyes and mouth individually.'}</p>
      </div>
      <div className="card object-controls"><h2>{r ? `${zh ? '区域' : 'Region'} ${r.id}` : (zh ? '选择后调整针法' : 'Select to edit stitches')}</h2>
        {r && <fieldset disabled={!!busy}>
          <label><input type="checkbox" checked={r.enabled} onChange={e => edit({ enabled: e.target.checked })} />{zh ? '绣制此区域' : 'Stitch this region'}</label>
          <p><span className="thread-chip"><i style={{ background: r.color }} />{r.color}</span> · {r.areaMm2.toFixed(2)} mm²</p>
          <label>{zh ? '绣线颜色（同线色区域一起更新）' : 'Thread color (updates all regions using this thread)'}<input type="color" value={r.color} onChange={e => {
            const palette = [...plan.palette]; palette[r.colorIndex] = e.target.value
            onChange({ ...plan, palette, regions: plan.regions.map(v => v.colorIndex === r.colorIndex ? { ...v, color: e.target.value } : v) })
          }} /></label>
          <label>{zh ? '针法' : 'Stitch type'}<select value={r.stitchType} onChange={e => edit({ stitchType: e.target.value as StitchRegion['stitchType'], ...(['flow', 'radial'].includes(e.target.value) ? { angleDeg: 0 } : {}) })}>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
          <label>{r.stitchType === 'flow' ? (zh ? '方向场偏转' : 'Field rotation') : (zh ? '方向' : 'Direction')} {r.angleDeg.toFixed(0)}°<input type="range" min={-90} max={180} step={5} value={r.angleDeg} onChange={e => edit({ angleDeg: Number(e.target.value) })} /></label>
          <label>{zh ? '行距 mm（越大越疏）' : 'Row spacing mm (larger = lighter)'}<input type="number" min={0.25} max={1.5} step={0.05} value={r.density} onChange={e => { const v = Number(e.target.value); if (v >= 0.25 && v <= 1.5) edit({ density: v }) }} /></label>
          <label><input type="checkbox" checked={r.underlay} disabled={r.stitchType === 'run'} onChange={e => edit({ underlay: e.target.checked })} />{zh ? '疏底针' : 'Sparse underlay'}</label>
          <label>{zh ? 'AI 修改此区域' : 'AI edit this region'}<textarea rows={2} maxLength={1000} value={repair} onChange={e => setRepair(e.target.value)} placeholder={zh ? '例如：改为深棕色，删除细碎纹理' : 'Make it dark brown and simplify details'} /></label>
          <button className="btn-outline" disabled={!repair.trim()} onClick={() => onRepair(r.label, repair)}>{busy === 'repair' ? (zh ? '修改中…' : 'Editing…') : (zh ? '仅修改选中区域' : 'Edit selected region')}</button>
          <small>{zh ? '选区外像素由程序保留。修改图稿后会重新分析区域，原针法调整需重新检查。' : 'Pixels outside the mask are preserved. Editing artwork rebuilds the regions; review stitch settings again.'}</small>
        </fieldset>}
        <hr /><label><input type="checkbox" checked={showSmall} onChange={e => { setShowSmall(e.target.checked); setPage(0) }} />{zh ? '包括关闭的小区域' : 'Include disabled details'}</label>
        <div className="object-list">{filtered.slice(page * 40, page * 40 + 40).map(v => <button key={v.id} className={selected === v.label ? 'active' : ''} onClick={() => setSelected(v.label)}><i style={{ background: v.color }} />{v.id} · {names[v.stitchType]} · {v.areaMm2.toFixed(1)} mm²</button>)}</div>
        <div className="editor-actions"><button disabled={page === 0} onClick={() => setPage(page - 1)}>←</button><span>{page + 1} / {Math.max(1, Math.ceil(filtered.length / 40))}</span><button disabled={(page + 1) * 40 >= filtered.length} onClick={() => setPage(page + 1)}>→</button></div>
      </div>
      <details className="card"><summary>{zh ? '方案说明与限制' : 'Plan notes & limitations'}</summary>{plan.notes.map((n, i) => <p key={i}>{n}</p>)}</details>
    </div>}
  </div>
}
