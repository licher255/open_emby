import { useState } from 'react'
import type { CommitInfo, ProjectImage } from '@shared/types'
import Icon from '../../components/Icon'
import AssetThumb from '../../components/AssetThumb'
import PanZoomStage from '../../components/PanZoomStage'
import LayerEditor from '../../components/LayerEditor'
import HistoryPanel from '../../components/HistoryPanel'
import { useT } from '../../i18n'
import { useWorkbench } from '../../stores/workbench'
import { FLOW_NODES, type NodeState } from './flow'

interface Props {
  imageUrl: string | null
  imagePath: string | null
  stylizedUrl: string | null
  stylizedPath: string | null
  lineArtUrl: string | null
  lineArtPath: string | null
  busy: string | null
  progress: string
  nodeStates: Record<string, NodeState>
  nodePct: { value: number; max: number } | null
  stage2Assets: ProjectImage[]
  history: CommitInfo[]
  onGenerate: () => void
  onRegenerateLineArt: () => void
  onRegenerateBlocks: () => void
  onSaveLayers: (blocks: string, line: string | null) => Promise<void>
  onSelectAsset: (img: ProjectImage) => void | Promise<void>
  onRename: (img: ProjectImage) => void
  onArchive: (img: ProjectImage) => void
  onRestoreVersion: (oid: string) => void | Promise<void>
}

type LayerView = 'blocks' | 'lineart' | 'overlay' | 'edit'

/** 风格化步骤：色块/线稿生成与叠加预览、图层精修、历史产物、版本历史 */
export default function StylizeStep(props: Props) {
  const t = useT()
  const historyOpen = useWorkbench((s) => s.historyOpen)
  const setHistoryOpen = useWorkbench((s) => s.setHistoryOpen)
  const [layerView, setLayerView] = useState<LayerView>('overlay')
  const [pastOutputsVisible, setPastOutputsVisible] = useState(true)
  const [refVisible, setRefVisible] = useState(true)
  const { imageUrl, imagePath, stylizedUrl, stylizedPath, lineArtUrl, lineArtPath, busy, progress, nodeStates, nodePct, stage2Assets, history } = props
  const stage2Busy = busy === 'stage2' || busy === 'blocks' || busy === 'lineart'

  async function selectAsset(img: ProjectImage) {
    await props.onSelectAsset(img)
    setLayerView(img.kind === 'lineart' ? 'lineart' : 'blocks')
  }

  return (
    <div className="step-panel fill">
      <div className="ws">
        <div className="ws-canvas">
          {layerView === 'edit' && stylizedUrl ? (
            <LayerEditor
              blocksUrl={stylizedUrl}
              lineArtUrl={lineArtUrl}
              onSave={async (blocks, line) => {
                await props.onSaveLayers(blocks, line)
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
                  <button className="btn-pill" disabled={!imagePath} onClick={props.onGenerate}>{t('editor.stylize')}</button>
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
              <button className="ws-action" data-tip={t('editor.regenerateLineArt')} onClick={props.onRegenerateLineArt} disabled={!!busy || !stylizedPath}>
                <Icon name="pen-nib" /><span>{t('editor.lineArtShort')}</span>
              </button>
              <button className="ws-action" data-tip={t('editor.regenerateBlocks')} onClick={props.onRegenerateBlocks} disabled={!!busy || !imagePath}>
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
                        onClick={() => selectAsset(img)}
                        title={img.derivedFrom ? `${img.name} ← ${img.derivedFrom}` : img.name}
                      >
                        <AssetThumb path={img.path} />
                        <span>{img.kind === 'lineart' ? `${t('editor.layerLineart')} · ` : ''}{img.name}</span>
                      </button>
                      <button className="ws-gallery-rename" onClick={() => props.onRename(img)} title={t('editor.rename')} aria-label={t('editor.rename')}>
                        <Icon name="pen-nib" size={11} />
                      </button>
                      <button className="ws-gallery-archive" onClick={() => props.onArchive(img)} title={t('editor.archive')} aria-label={t('editor.archive')}>
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
          <HistoryPanel
            className="ws-history card"
            history={history}
            onRestore={props.onRestoreVersion}
            onClose={() => setHistoryOpen(false)}
          />
        )}
      </div>
    </div>
  )
}
