import { useToastStore } from '../stores/toast'

/** 全局 toast 栈：右上角，可点击关闭 */
export default function Toasts() {
  const { toasts, dismiss } = useToastStore()
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} onClick={() => dismiss(t.id)}>
          {t.text}
        </button>
      ))}
    </div>
  )
}
