import type { DigitizePlan } from '@shared/types'
import { useT } from '../../i18n'

interface Props {
  plan: DigitizePlan | null
  busy: string | null
  hasImage: boolean
  onMakePlan: () => void
}

/** 制版方案步骤：色板 + 区域针法表 */
export default function PlanStep({ plan, busy, hasImage, onMakePlan }: Props) {
  const t = useT()
  return (
    <div className="step-panel">
      <h1>{t('step.plan')}</h1>
      <div className="editor-actions">
        <button className="btn-pill" disabled={!!busy || !hasImage} onClick={onMakePlan}>
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
  )
}
