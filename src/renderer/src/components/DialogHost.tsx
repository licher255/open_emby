import { useEffect, useState } from 'react'
import { useDialogStore, type DialogRequest } from '../stores/dialog'
import { useT } from '../i18n'

function settle(req: DialogRequest, ok: boolean, value: string): void {
  if (req.kind === 'confirm') req.resolve(ok)
  else req.resolve(ok && value.trim() !== '' ? value.trim() : null)
}

/** 全局对话框宿主：确认/输入模态（应用内视觉，Esc 或点击遮罩取消，Enter 确认） */
export default function DialogHost() {
  const t = useT()
  const current = useDialogStore((s) => s.current)
  const close = useDialogStore((s) => s.close)
  const [value, setValue] = useState('')

  useEffect(() => {
    setValue(current?.kind === 'prompt' ? current.initial : '')
  }, [current])

  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { settle(current, false, value); close() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // 每次渲染重挂：拿到最新的 current/value 闭包

  if (!current) return null

  const cancel = () => { settle(current, false, value); close() }
  const ok = () => { settle(current, true, value); close() }

  return (
    <div className="modal-scrim" onClick={cancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{current.message}</h2>
        {current.kind === 'prompt' && (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ok() }}
          />
        )}
        <div className="modal-actions">
          <button className="btn-outline" onClick={cancel}>{t('modal.cancel')}</button>
          <button
            className={`btn-pill ${current.kind === 'confirm' && current.danger ? 'danger' : ''}`}
            autoFocus={current.kind === 'confirm'}
            onClick={ok}
          >
            {t('modal.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
