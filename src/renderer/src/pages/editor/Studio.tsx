import { useEffect, useState } from 'react'
import type { AgentOptions, DraftRound, StitchResult } from '@shared/types'
import { useI18n } from '../../i18n'
import StitchPreview from '../../components/StitchPreview'
import PanZoomStage from '../../components/PanZoomStage'
import Icon from '../../components/Icon'

export default function Studio({ imageUrl, artworkUrl, selectedPath, rounds, draftUrls, stitches, options, busy, status, error, files, onOptions, onPick, onImport, onGenerate, onFeedback, onRetry, onChoose, onResume, onExport, onRefine, onHistory }: {
  imageUrl: string | null; artworkUrl: string | null; selectedPath: string | null
  rounds: DraftRound[]; draftUrls: Record<string, string>; stitches: StitchResult | null; options: AgentOptions
  busy: string | null; status: string; error: string; files: string[] | null
  onOptions: (options: AgentOptions) => void; onPick: () => void; onImport: (path: string) => void
  onGenerate: () => void; onFeedback: (text: string) => void; onRetry: (id: string) => void; onChoose: (path: string) => void
  onResume: () => void; onExport: () => void; onRefine: () => void; onHistory: () => void
}) {
  const zh = useI18n(s => s.locale) === 'zh-CN'
  const [roundIndex, setRoundIndex] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [view, setView] = useState<'choices' | 'original' | 'artwork' | 'stitches'>('original')
  const [drag, setDrag] = useState(false)
  const [layers] = useState(() => new Set<number>())
  useEffect(() => { setRoundIndex(Math.max(0, rounds.length - 1)); if (rounds.length) setView('choices') }, [rounds.length])
  useEffect(() => { if (selectedPath) setView('artwork'); setFeedback('') }, [selectedPath])
  useEffect(() => { if (stitches) setView('stitches') }, [stitches])
  useEffect(() => { if (busy === 'drafts') setView('choices') }, [busy])
  const round = rounds[roundIndex] ?? rounds.at(-1)
  const displayedView = view === 'choices' && !round ? 'original' : view === 'stitches' && !stitches ? (artworkUrl ? 'artwork' : 'original') : view === 'artwork' && !artworkUrl ? 'original' : view
  const working = !!busy && !['export', 'import', 'choose', 'drafts'].includes(busy)
  const selectedNumber = round?.candidates.findIndex(c => c.path === selectedPath) ?? -1
  const tabs = [
    { id: 'choices' as const, label: zh ? '四张候选' : 'Four options', enabled: !!round },
    { id: 'original' as const, label: zh ? '原图' : 'Original', enabled: !!imageUrl },
    { id: 'artwork' as const, label: zh ? '已选图稿' : 'Selected', enabled: !!artworkUrl },
    ...(stitches ? [{ id: 'stitches' as const, label: zh ? '针迹预览' : 'Stitches', enabled: true }] : [])
  ]
  return <div className="studio">
    <header className="studio-heading"><h1>{zh ? '挑一张绣稿' : 'Pick a design'}</h1><button className="studio-history" disabled={!!busy} onClick={onHistory}><Icon name="clock-rotate-left" />{zh ? '历史版本' : 'History'}</button></header>
    <div className="studio-layout">
      <section className={`studio-preview ${drag ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (busy) return; const file = e.dataTransfer.files[0]; if (file) onImport(window.openEmby.files.pathForFile(file)) }}>
        {imageUrl ? <>
          <div className="studio-tabs" role="tablist" aria-label={zh ? '预览内容' : 'Preview'}>{tabs.map(tab => <button key={tab.id} data-view={tab.id} role="tab" aria-selected={displayedView === tab.id} className={displayedView === tab.id ? 'active' : ''} disabled={!tab.enabled} onClick={() => setView(tab.id)}>{tab.label}</button>)}</div>
          {displayedView === 'choices' && round ? <div className="studio-choices-panel">
            <div className="studio-round-bar"><label>{zh ? '候选组' : 'Round'} <select aria-label={zh ? '候选组' : 'Round'} disabled={!!busy} value={roundIndex} onChange={e => setRoundIndex(Number(e.target.value))}>{rounds.map((r, i) => <option key={r.id} value={i}>{zh ? `第 ${i + 1} 组` : `Round ${i + 1}`}{r.feedback ? (zh ? ' · 微调' : ' · Refined') : ''}</option>)}</select></label><span>{round.candidates.filter(c => c.status === 'ready').length} / 4 {zh ? '已完成' : 'ready'}</span></div>
            {round.feedback && <p className="studio-round-feedback">{zh ? '本轮反馈：' : 'Feedback: '}{round.feedback}</p>}
            <div className="studio-candidate-grid">{round.candidates.map((candidate, index) => <button key={candidate.id} className={`studio-candidate ${selectedPath === candidate.path && candidate.path ? 'selected' : ''}`} aria-label={zh ? `选择图稿 ${index + 1}` : `Choose option ${index + 1}`} aria-pressed={!!candidate.path && selectedPath === candidate.path} disabled={!!busy || candidate.status !== 'ready'} onClick={() => candidate.path && onChoose(candidate.path)}>
              <div className="studio-candidate-image">{candidate.path && draftUrls[candidate.path] ? <img src={draftUrls[candidate.path]} alt={zh ? `候选绣稿 ${index + 1}` : `Design option ${index + 1}`} /> : <div className="studio-candidate-placeholder">{candidate.status === 'generating' && <div className="studio-spinner" />}<span>{candidate.status === 'error' ? (zh ? '未完成' : 'Not completed') : candidate.status === 'ready' ? (zh ? '预览暂不可用' : 'Preview unavailable') : candidate.status === 'generating' ? (zh ? '正在生成…' : 'Creating…') : (zh ? '等待生成' : 'Queued')}</span></div>}</div>
              <div className="studio-candidate-caption"><b>{String(index + 1).padStart(2, '0')}</b>{candidate.path && selectedPath === candidate.path && <span>{zh ? '已选 ✓' : 'Selected ✓'}</span>}</div>
            </button>)}</div>
            {busy === 'drafts' && <p className="studio-batch-status" role="status">{status || (zh ? '正在准备四张图稿…' : 'Preparing four options…')}</p>}
            {!busy && round.candidates.some(c => c.status !== 'ready') && <button className="studio-secondary studio-retry" onClick={() => onRetry(round.id)}>{zh ? '补齐这一组' : 'Retry missing options'}</button>}
            {round.candidates.some(c => c.error) && <details className="studio-round-errors"><summary>{zh ? '失败原因' : 'Why some failed'}</summary>{round.candidates.filter(c => c.error).map(c => <p key={c.id}>{c.error}</p>)}</details>}
          </div> : <div className="studio-stage">{displayedView === 'stitches' && stitches ? <StitchPreview stitches={stitches} progress={1} hidden={layers} /> : <PanZoomStage url={(displayedView === 'original' ? imageUrl : artworkUrl) ?? imageUrl} />}</div>}
          <footer className="studio-preview-footer"><button disabled={!!busy} onClick={onPick}>{zh ? '换张照片' : 'Change photo'}</button></footer>
        </> : <button className="studio-upload" disabled={!!busy} onClick={onPick}><span className="studio-upload-icon"><Icon name="image" size={42} /></span><strong>{zh ? '上传一张照片' : 'Upload a photo'}</strong><span>{zh ? '或拖入图片' : 'Or drop an image'}</span><small>PNG · JPG · WEBP</small></button>}
        {working && <div className="studio-working" role="status"><div className="studio-spinner" /><strong>{status}</strong></div>}
      </section>
      <aside className="studio-options">
        <fieldset disabled={!!busy}>
          <button className="studio-generate" disabled={!imageUrl} onClick={onGenerate}>{busy === 'drafts' ? (zh ? '正在生成四张…' : 'Creating four options…') : rounds.length ? (zh ? '再生成 4 张' : 'Create 4 more') : (zh ? '生成 4 张图稿' : 'Create 4 designs')}</button>
          <details className="studio-more"><summary>{zh ? '风格与颜色' : 'Style & colors'}</summary><div>
            <div className="studio-style"><button className={options.artStyle !== 'soft' ? 'active' : ''} onClick={() => onOptions({ ...options, artStyle: 'clean' })}><b>{zh ? '简洁自然' : 'Clean & natural'}</b></button><button className={options.artStyle === 'soft' ? 'active' : ''} onClick={() => onOptions({ ...options, artStyle: 'soft' })}><b>{zh ? '柔和插画' : 'Soft illustration'}</b></button></div>
            <label>{zh ? '颜色数量' : 'Colors'}<select value={options.maxColors} onChange={e => onOptions({ ...options, maxColors: Number(e.target.value) })}>{[4,5,6,8,10,12].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
            <label>{zh ? '初始要求' : 'Initial brief'}<textarea rows={2} maxLength={1000} value={options.intent} onChange={e => onOptions({ ...options, intent: e.target.value })} /></label>
          </div></details>
          {artworkUrl && <div className="studio-feedback">
            <h2>{zh ? '微调' : 'Refine'}</h2>
            <div className="studio-selected-summary"><img src={artworkUrl} alt={zh ? '当前选中图稿' : 'Selected design'} /><span>{selectedNumber >= 0 ? (zh ? `已选图稿 ${selectedNumber + 1}` : `Option ${selectedNumber + 1} selected`) : (zh ? '当前已选图稿' : 'Current selection')}</span></div>
            <label htmlFor="draft-feedback">{zh ? '想改哪里？' : 'What would you change?'}</label><textarea id="draft-feedback" className="studio-feedback-input" rows={3} maxLength={500} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder={zh ? '例如：眼睛保留绿色，毛发再简洁一点' : 'Keep the green eyes; simplify the fur'} />
            <div className="studio-feedback-chips">{(zh ? ['更简洁', '保留五官', '减少碎色块'] : ['Simpler shapes', 'Keep facial details', 'Fewer tiny patches']).map(text => <button key={text} onClick={() => setFeedback(value => (value ? value + '；' + text : text).slice(0,500))}>{text}</button>)}</div>
            <button className="studio-secondary studio-refine-batch" disabled={!feedback.trim()} onClick={() => onFeedback(feedback)}>{zh ? '微调 · 生成 4 张' : 'Refine into 4'}</button>
            <div className="studio-digitize">
              <details className="studio-more"><summary>{zh ? '刺绣设置' : 'Embroidery settings'}</summary><div><label>{zh ? '宽度（mm）' : 'Width (mm)'}<input type="number" min={10} max={400} value={options.widthMm} onChange={e => onOptions({ ...options, widthMm: Number(e.target.value) })} /></label><label>{zh ? '针迹方式' : 'Stitch generation'}<select value={options.stitchBackend ?? 'paper'} onChange={e => onOptions({ ...options, stitchBackend: e.target.value as AgentOptions['stitchBackend'] })}><option value="paper">{zh ? '精细流线' : 'Refined streamlines'}</option><option value="native">{zh ? '快速预览' : 'Quick preview'}</option></select></label></div></details>
              {!stitches && <button className="studio-download studio-use-choice" onClick={onResume}>{zh ? '就选这张，生成针迹' : 'Use this · Create stitches'}</button>}
            </div>
          </div>}
        </fieldset>
        {error && <div className="studio-error" role="alert">{error}</div>}
        {stitches && <div className="studio-ready"><strong>{zh ? '针迹已就绪' : 'Stitches ready'}</strong><button className="studio-download" disabled={!!busy} onClick={onExport}>{zh ? '下载刺绣文件 · DST' : 'Download embroidery · DST'}</button><small>{zh ? '首次请先试绣。' : 'Test sew before production.'}</small></div>}
        {files && <div className="studio-saved" role="status">{zh ? '文件已保存' : 'Files saved'}<details><summary>{zh ? '查看文件位置' : 'File location'}</summary>{files.map(path => <p key={path}>{path}</p>)}</details></div>}
        <button className="studio-advanced" disabled={!!busy} onClick={onRefine}>{zh ? '精修工具' : 'Advanced tools'} →</button>
      </aside>
    </div>
  </div>
}
