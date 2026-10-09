import { useEffect, useState } from 'react'
import type { AgentOptions, StitchResult } from '@shared/types'
import { useI18n } from '../../i18n'
import StitchPreview from '../../components/StitchPreview'
import PanZoomStage from '../../components/PanZoomStage'
import Icon from '../../components/Icon'

export default function Studio({ imageUrl, artworkUrl, stitches, options, busy, status, error, files, onOptions, onPick, onImport, onGenerate, onResume, onExport, onRefine, onHistory }: {
  imageUrl: string | null; artworkUrl: string | null; stitches: StitchResult | null; options: AgentOptions
  busy: string | null; status: string; error: string; files: string[] | null
  onOptions: (options: AgentOptions) => void; onPick: () => void; onImport: (path: string) => void
  onGenerate: () => void; onResume: () => void; onExport: () => void; onRefine: () => void; onHistory: () => void
}) {
  const zh = useI18n(s => s.locale) === 'zh-CN'
  const [view, setView] = useState<'original' | 'artwork' | 'stitches'>('original')
  const [drag, setDrag] = useState(false)
  const [layers] = useState(() => new Set<number>())
  useEffect(() => { if (stitches) setView('stitches'); else if (artworkUrl) setView('artwork'); else setView('original') }, [stitches, artworkUrl])
  const url = view === 'original' ? imageUrl : artworkUrl ?? imageUrl
  const working = !!busy && !['export', 'import'].includes(busy)
  return <div className="studio">
    <header className="studio-heading"><div><p className="studio-eyebrow">OPEN EMBY</p><h1>{zh ? '照片变刺绣' : 'Turn a photo into embroidery'}</h1><p>{zh ? '上传照片，生成可预览和调整的绣稿。' : 'Upload a photo. Preview and refine your embroidery.'}</p></div><button className="studio-history" disabled={!!busy} onClick={onHistory}><Icon name="clock-rotate-left" />{zh ? '历史版本' : 'History'}</button></header>
    <div className="studio-layout">
      <section className={`studio-preview ${drag ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (busy) return; const file = e.dataTransfer.files[0]; if (file) onImport(window.openEmby.files.pathForFile(file)) }}>
        {imageUrl ? <>
          <div className="studio-tabs" role="tablist" aria-label={zh ? '预览内容' : 'Preview'}>{(['original', 'artwork', 'stitches'] as const).map((key, i) => <button role="tab" key={key} aria-selected={view === key} className={view === key ? 'active' : ''} disabled={key === 'artwork' ? !artworkUrl : key === 'stitches' ? !stitches : false} onClick={() => setView(key)}>{(zh ? ['原图', '绣稿', '针迹预览'] : ['Original', 'Artwork', 'Stitches'])[i]}</button>)}</div>
          <div className="studio-stage">{view === 'stitches' && stitches ? <StitchPreview stitches={stitches} progress={1} hidden={layers} /> : url && <PanZoomStage url={url} />}</div>
          <footer className="studio-preview-footer"><span>{view === 'stitches' && stitches ? `${stitches.widthMm.toFixed(0)} × ${stitches.heightMm.toFixed(0)} mm · ${stitches.stitchCount.toLocaleString()} ${zh ? '针' : 'stitches'}` : (zh ? '滚轮放大 · 拖动查看' : 'Scroll to zoom · Drag to pan')}</span><button disabled={!!busy} onClick={onPick}>{zh ? '换张图片' : 'Change photo'}</button></footer>
        </> : <button className="studio-upload" disabled={!!busy} onClick={onPick}><span className="studio-upload-icon"><Icon name="image" size={42} /></span><strong>{zh ? '上传一张照片' : 'Upload a photo'}</strong><span>{zh ? '也可以把图片拖到这里' : 'Or drag an image here'}</span><small>PNG · JPG · WEBP</small></button>}
        {working && <div className="studio-working" role="status"><div className="studio-spinner" /><strong>{status || (zh ? '正在生成…' : 'Creating…')}</strong><span>{zh ? '结果会自动保存，首次生成可能需要几分钟。' : 'Results are saved automatically. The first run may take a few minutes.'}</span></div>}
      </section>
      <aside className="studio-options">
        <fieldset disabled={!!busy}>
          <h2>{zh ? '你的绣作' : 'Your embroidery'}</h2>
          <label>{zh ? '宽度' : 'Width'}</label><div className="studio-choices">{[80,100,150].map(width => <button key={width} className={options.widthMm === width ? 'active' : ''} onClick={() => onOptions({ ...options, widthMm: width })}>{width/10} cm</button>)}</div>
          <label>{zh ? '图稿风格' : 'Artwork style'}</label><div className="studio-style"><button className={options.artStyle !== 'soft' ? 'active' : ''} onClick={() => onOptions({ ...options, artStyle: 'clean' })}><b>{zh ? '简洁自然' : 'Clean & natural'}</b><small>{zh ? '保留主体特征' : 'Keep defining features'}</small></button><button className={options.artStyle === 'soft' ? 'active' : ''} onClick={() => onOptions({ ...options, artStyle: 'soft' })}><b>{zh ? '柔和插画' : 'Soft illustration'}</b><small>{zh ? '圆润轮廓与色块' : 'Softer shapes and colors'}</small></button></div>
          <details className="studio-more"><summary>{zh ? '更多选项' : 'More options'}</summary><div>
            <label>{zh ? '自定义宽度（mm）' : 'Custom width (mm)'}<input type="number" min={10} max={400} value={options.widthMm} onChange={e => onOptions({ ...options, widthMm: Number(e.target.value) })} /></label>
            <label>{zh ? '颜色数量' : 'Colors'}<select value={options.maxColors} onChange={e => onOptions({ ...options, maxColors: Number(e.target.value) })}>{[4,5,6,8,10,12].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{zh ? '生成方式' : 'Generation'}<select value={options.stitchBackend ?? 'paper'} onChange={e => onOptions({ ...options, stitchBackend: e.target.value as AgentOptions['stitchBackend'] })}><option value="paper">{zh ? '精细流线' : 'Refined streamlines'}</option><option value="native">{zh ? '快速预览' : 'Quick preview'}</option></select></label>
            <label>{zh ? '想保留或改变什么？' : 'Anything to keep or change?'}<textarea rows={3} maxLength={1200} value={options.intent} placeholder={zh ? '例如：保留绿色眼睛，只要头部' : 'Keep the green eyes; head only'} onChange={e => onOptions({ ...options, intent: e.target.value })} /></label>
          </div></details>
          <button className={`studio-generate ${stitches ? 'secondary' : ''}`} disabled={!imageUrl} onClick={onGenerate}>{working ? (zh ? '正在生成…' : 'Creating…') : artworkUrl ? (zh ? '再生成一版' : 'Create another version') : (zh ? '生成我的绣稿' : 'Create my embroidery')}</button>
          {artworkUrl && !stitches && <button className="studio-secondary" onClick={onResume}>{zh ? '使用当前绣稿继续' : 'Continue with this artwork'}</button>}
        </fieldset>
        {error && <div className="studio-error" role="alert"><b>{zh ? '这一步没有完成，已保留现有结果。' : 'This step did not finish. Your work is saved.'}</b><details><summary>{zh ? '查看原因' : 'Details'}</summary>{error}</details></div>}
        {stitches && <div className="studio-ready"><span className="studio-ready-dot" /> <strong>{zh ? '预览已准备好' : 'Your preview is ready'}</strong><p>{zh ? '可以先调整局部，再下载到绣花机。' : 'Refine details or download for your machine.'}</p><button className="studio-download" disabled={!!busy} onClick={onExport}>{busy === 'export' ? (zh ? '正在导出…' : 'Exporting…') : (zh ? '下载刺绣文件 · DST' : 'Download embroidery · DST')}</button><button className="studio-secondary" disabled={!!busy} onClick={onRefine}>{zh ? '调整局部细节' : 'Refine details'}</button><small>{zh ? '首次请先试绣，确认面料上的实际效果。' : 'Make a test sew-out before production.'}</small></div>}
        {files && <div className="studio-saved" role="status">{zh ? '已保存到导出文件夹' : 'Saved to your export folder'}<details><summary>{zh ? '查看文件位置' : 'File location'}</summary>{files.map(path => <p key={path}>{path}</p>)}</details></div>}
        {!stitches && <button className="studio-advanced" disabled={!!busy} onClick={onRefine}>{zh ? '专业工具' : 'Advanced tools'} →</button>}
      </aside>
    </div>
  </div>
}
