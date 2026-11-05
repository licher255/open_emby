import type { DraftProgress } from '@shared/types'

export default function ProcessProgress({ ready, total, active, progress, zh }: {
  ready: number; total: number; active: number; progress: DraftProgress | null; zh: boolean
}) {
  const labels: Record<DraftProgress['stage'], string> = zh ? {
    queued: '等待生成', loading: '加载本地模型', encoding: '读取参考图', sampling: '正在生成',
    decoding: '生成预览', saving: '保存图稿', generating: '正在处理', reconnecting: '正在重连', completed: '保存图稿'
  } : {
    queued: 'Queued', loading: 'Loading local model', encoding: 'Reading reference', sampling: 'Generating',
    decoding: 'Creating preview', saving: 'Saving design', generating: 'Processing', reconnecting: 'Reconnecting', completed: 'Saving design'
  }
  const stage = progress?.stage ?? 'queued'
  const measured = stage === 'sampling' && Number.isFinite(progress?.value) && (progress?.max ?? 0) > 0
  const fraction = measured ? Math.max(0, Math.min(1, progress!.value! / progress!.max!)) : undefined
  const label = `${zh ? `第 ${active + 1} 张` : `Option ${active + 1}`} · ${labels[stage]}`
  return <div className="studio-process">
    <div className="studio-process-label"><span>{zh ? '生成进度' : 'Design progress'}</span><span>{ready} / {total} {zh ? '已完成' : 'saved'}</span></div>
    <div className="studio-process-track" role="progressbar" aria-label={zh ? '已保存图稿' : 'Saved designs'} aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready}>
      <div style={{ transform: `scaleX(${ready / Math.max(total, 1)})` }} />
    </div>
    <div className="studio-process-label"><span role="status">{label}</span>{measured && <span>{progress!.value} / {progress!.max} {zh ? '步' : 'steps'}</span>}</div>
    <div className={`studio-process-track current ${measured ? '' : 'indeterminate'}`} role="progressbar" aria-label={label} aria-valuemin={measured ? 0 : undefined} aria-valuemax={measured ? progress!.max! : undefined} aria-valuenow={measured ? progress!.value! : undefined}>
      <div style={measured ? { transform: `scaleX(${fraction})` } : undefined} />
    </div>
  </div>
}
