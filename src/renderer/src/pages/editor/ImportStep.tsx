import { useState } from 'react'
import type { ProjectImage } from '@shared/types'
import Icon from '../../components/Icon'
import AssetThumb from '../../components/AssetThumb'
import { useT } from '../../i18n'
import type { LocaleKey } from '../../i18n/en'
import { toast } from '../../stores/toast'

export type CanvasMode = 'fit' | 'fill' | 'stretch'

const CANVAS_MODE_KEY: Record<CanvasMode, LocaleKey> = {
  fit: 'canvas.mode.fit',
  fill: 'canvas.mode.fill',
  stretch: 'canvas.mode.stretch'
}

interface Props {
  originals: ProjectImage[]
  imagePath: string | null
  importing: boolean
  canvasMm: { width: number; height: number } | null
  canvasW: string
  canvasH: string
  canvasMode: CanvasMode
  onPickImage: () => void
  onImportPath: (path: string) => void
  onSelectImage: (path: string) => void
  onRename: (img: ProjectImage) => void
  onArchive: (img: ProjectImage) => void
  onCanvasWChange: (v: string) => void
  onCanvasHChange: (v: string) => void
  onCanvasModeChange: (m: CanvasMode) => void
  onApplyCanvas: () => void
}

/** 导入步骤：图稿拖放/导入 + 资产列表 + 画布物理尺寸修改器 */
export default function ImportStep(props: Props) {
  const t = useT()
  const [dragOver, setDragOver] = useState(false)
  const { originals, imagePath, importing, canvasMm, canvasW, canvasH, canvasMode } = props

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    try {
      props.onImportPath(window.openEmby.files.pathForFile(f))
    } catch {
      toast.error(t('toast.fail.drop'))
    }
  }

  return (
    <div className="step-panel">
      <h1>{t('step.import')}</h1>
      <div
        className={`slot dropzone-slot ${dragOver ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <button className="btn-pill" onClick={props.onPickImage} disabled={importing}>
          {importing ? t('editor.importing') : t('editor.importImage')}
        </button>
        <span className="asset-hint">{t('editor.dropHint')}</span>
      </div>
      <h3>{t('editor.output')}</h3>
      <div className="thumb-strip">
        {originals.map((img) => (
          <div key={img.path} className={`thumb-cell ${img.path === imagePath ? 'active' : ''}`}>
            <button className="thumb-select" onClick={() => props.onSelectImage(img.path)} title={img.name}>
              <AssetThumb path={img.path} />
              <span className="thumb-name">{img.name}</span>
            </button>
            <button className="thumb-rename" onClick={() => props.onRename(img)} title={t('editor.rename')} aria-label={t('editor.rename')}>
              <Icon name="pen-nib" size={12} />
            </button>
            <button className="thumb-archive" onClick={() => props.onArchive(img)} title={t('editor.archive')} aria-label={t('editor.archive')}>
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
              <input type="number" min={1} value={canvasW} onChange={(e) => props.onCanvasWChange(e.target.value)} />
            </label>
            <span className="canvas-x">×</span>
            <label>
              {t('canvas.height')}
              <input type="number" min={1} value={canvasH} onChange={(e) => props.onCanvasHChange(e.target.value)} />
            </label>
            <span className="canvas-x">mm</span>
            <div className="view-tabs" style={{ marginBottom: 0 }}>
              {(['fit', 'fill', 'stretch'] as const).map((m) => (
                <button key={m} className={canvasMode === m ? 'active' : ''} onClick={() => props.onCanvasModeChange(m)}>
                  {t(CANVAS_MODE_KEY[m])}
                </button>
              ))}
            </div>
            <button className="btn-pill btn-sm-pill" disabled={importing} onClick={props.onApplyCanvas}>
              {t('canvas.apply')}
            </button>
          </div>
          {canvasMm && (
            <p className="mono-meta">{t('canvas.current', { w: canvasMm.width, h: canvasMm.height })}</p>
          )}
        </div>
      )}
    </div>
  )
}
