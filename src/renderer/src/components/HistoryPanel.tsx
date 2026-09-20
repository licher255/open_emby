import type { CommitInfo } from '@shared/types'
import { localeTag, useT } from '../i18n'
import { confirmDialog } from '../stores/dialog'

interface Props {
  history: CommitInfo[]
  onRestore: (oid: string) => void | Promise<void>
  onClose?: () => void
  /** 完整形态：标题带数量、行内带时间戳（步骤页卡片）；缺省为紧凑侧栏形态 */
  detailed?: boolean
  className?: string
}

/** 项目版本历史面板：紧凑（风格化工作区侧栏，可关闭）与完整（步骤页卡片）两种形态 */
export default function HistoryPanel({ history, onRestore, onClose, detailed, className }: Props) {
  const t = useT()
  return (
    <div className={className ?? 'card'}>
      <h2>
        {t('history.title')}
        {detailed && <span className="mono-meta" style={{ marginLeft: 8 }}>{t('history.count', { count: history.length })}</span>}
        {onClose && <button className="ws-ref-close" onClick={onClose}>×</button>}
      </h2>
      <div className="history-list">
        {history.map((c) => (
          <div key={c.oid} className="history-row">
            <code className="history-oid">{c.oid.slice(0, 7)}</code>
            <span className="history-msg">{c.message}</span>
            {detailed && <span className="history-time">{new Date(c.time).toLocaleString(localeTag())}</span>}
            <button
              className="btn-outline btn-sm"
              onClick={async () => {
                if (!(await confirmDialog(t('history.confirm', { message: c.message })))) return
                await onRestore(c.oid)
              }}
            >
              {t('history.restore')}
            </button>
          </div>
        ))}
        {history.length === 0 && <p className="mono-meta">{t('history.empty')}</p>}
      </div>
    </div>
  )
}
