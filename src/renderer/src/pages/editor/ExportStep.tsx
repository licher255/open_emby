import type { StitchResult } from '@shared/types'
import { useT } from '../../i18n'

interface Props {
  stitches: StitchResult | null
  busy: string | null
  exportFiles: string[] | null
  onExport: () => void
}

/** 导出步骤：DST + 生产单（色序表） */
export default function ExportStep({ stitches, busy, exportFiles, onExport }: Props) {
  const t = useT()
  return (
    <div className="step-panel">
      <h1>{t('step.export')}</h1>
      <div className="editor-actions">
        <button className="btn-pill" disabled={!!busy || !stitches} onClick={onExport}>
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
  )
}
