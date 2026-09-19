import { useEffect, useState } from 'react'
import { useT } from '../i18n'

/** 自绘标题栏（无边框窗口）：左侧品牌 + 页面名，右侧窗口控制。整条可拖拽。 */
export default function Titlebar({ page }: { page: string }) {
  const t = useT()
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.openEmby.window.isMaximized().then(setMaximized).catch(() => {})
    const off = window.openEmby.window.onMaximizedChanged(setMaximized)
    return () => { off() }
  }, [])

  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <span className="titlebar-logo">open<em>emby</em></span>
        <span className="titlebar-page">{page}</span>
      </div>
      <div className="titlebar-controls">
        <button className="win-btn" title={t('win.minimize')} onClick={() => window.openEmby.window.minimize()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><line x1="1" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.4"/></svg>
        </button>
        <button className="win-btn" title={maximized ? t('win.restore') : t('win.maximize')} onClick={() => window.openEmby.window.toggleMaximize()}>
          {maximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="3" y="1" width="8" height="8" fill="none" stroke="currentColor" strokeWidth="1.2"/><path d="M1 4v7h7" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          )}
        </button>
        <button className="win-btn close" title={t('win.close')} onClick={() => window.openEmby.window.close()}>
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.4"/></svg>
        </button>
      </div>
    </div>
  )
}
