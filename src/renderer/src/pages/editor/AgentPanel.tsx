import type { AgentOptions } from '@shared/types'
import { useI18n } from '../../i18n'
import { useEffect, useState } from 'react'

export default function AgentPanel({ options, onChange, busy, hasImage, onRun, status, compact }: {
  options: AgentOptions; onChange: (v: AgentOptions) => void; busy: boolean; hasImage: boolean; onRun: () => void; status: string; compact: boolean
}) {
  const zh = useI18n(s => s.locale) === 'zh-CN'
  const [expanded, setExpanded] = useState(!compact)
  useEffect(() => { setExpanded(!compact || busy) }, [compact, busy])
  return <details className="agent-panel" open={expanded} onToggle={e => setExpanded(e.currentTarget.open)} aria-label={zh ? 'AI 制版助手' : 'AI digitizing assistant'}>
    <summary className="agent-heading"><strong>{zh ? 'AI 制版助手' : 'AI digitizing assistant'}</strong><span>{zh ? '初稿 → 区域方案 → 针迹 → 检查' : 'Draft → Objects → Stitches → Checks'}</span></summary>
    <fieldset disabled={busy}>
      <label className="agent-intent">{zh ? '设计要求' : 'Design brief'}<textarea maxLength={1500} rows={2} value={options.intent} placeholder={zh ? '例如：保留猫眼颜色，简化毛发，白色背景' : 'Keep the eye color; simplify fur; white background'} onChange={e => onChange({ ...options, intent: e.target.value })} /></label>
      <div className="agent-controls">
        <label>{zh ? '宽度 mm' : 'Width mm'}<input type="number" min={10} max={400} value={options.widthMm} onChange={e => onChange({ ...options, widthMm: Number(e.target.value) })} /></label>
        <label>{zh ? '绣线色数' : 'Thread colors'}<input type="number" min={2} max={16} value={options.maxColors} onChange={e => onChange({ ...options, maxColors: Number(e.target.value) })} /></label>
        <label>{zh ? '面料预设' : 'Fabric preset'}<select value={options.fabric} onChange={e => onChange({ ...options, fabric: e.target.value as AgentOptions['fabric'] })}><option value="woven">{zh ? '普通梭织布' : 'Woven'}</option><option value="knit">{zh ? '针织布（试验）' : 'Knit (experimental)'}</option></select></label>
        <label>{zh ? '针迹方式' : 'Stitch method'}<select value={options.stitchBackend ?? 'paper'} onChange={e => onChange({ ...options, stitchBackend: e.target.value as AgentOptions['stitchBackend'] })}><option value="paper">{zh ? '精细流线' : 'Paper streamlines'}</option><option value="native">{zh ? '快速预览' : 'Native preview'}</option></select></label>
        <label>{zh ? '大区域纹理' : 'Fill texture'}<select value={options.texture} onChange={e => onChange({ ...options, texture: e.target.value as AgentOptions['texture'] })}><option value="flow">{zh ? '连续毛流（可引导）' : 'Continuous flow (guided)'}</option><option value="curved">{zh ? '柔和曲线' : 'Gentle curves'}</option><option value="tatami">{zh ? '错位填针' : 'Staggered tatami'}</option></select></label>
        <button className="btn-pill" disabled={!hasImage} onClick={onRun}>{zh ? '生成初稿与针迹预览' : 'Generate draft & stitch preview'}</button>
      </div>
    </fieldset>
    <p className="mono-meta" role="status">{status || (zh ? '适用于约 10 cm 人物／宠物图案。生成后可点击区域调整；导出前检查并试绣。' : 'For portraits and pets around 10 cm. Edit regions after generation; inspect and test sew before production.')}</p>
  </details>
}

