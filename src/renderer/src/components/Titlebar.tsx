import { useEffect, useRef, useState } from 'react'
import { useT } from '../i18n'
import Icon from './Icon'

export type MenuAction =
  | 'newProject' | 'openSettings' | 'quit'
  | 'undo'
  | 'toggleSidebar' | 'zoomIn' | 'zoomOut' | 'actualSize'
  | 'about' | 'feedback' | 'feature' | 'docs'

interface Props {
  page: string
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
  onToggleSidebar: () => void
  onMenuAction: (a: MenuAction) => void
}

/** 菜单定义（桌面惯例：File / Edit / View / Help） */
const MENUS: Array<{ id: 'file' | 'edit' | 'view' | 'help'; items: Array<MenuAction | 'sep'> }> = [
  { id: 'file', items: ['newProject', 'openSettings', 'sep', 'quit'] },
  { id: 'edit', items: ['undo'] },
  { id: 'view', items: ['toggleSidebar', 'sep', 'zoomIn', 'zoomOut', 'actualSize'] },
  { id: 'help', items: ['about', 'feedback', 'feature', 'docs'] }
]

/** 自绘标题栏：侧栏开关 + 前进/后退 + 菜单栏 + 当前页面 + 窗口控制。整条可拖拽。 */
export default function Titlebar({ page, canBack, canForward, onBack, onForward, onToggleSidebar, onMenuAction }: Props) {
  const t = useT()
  const [maximized, setMaximized] = useState(false)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.openEmby.window.isMaximized().then(setMaximized).catch(() => {})
    const off = window.openEmby.window.onMaximizedChanged(setMaximized)
    return () => { off() }
  }, [])

  // 点击别处收起菜单
  useEffect(() => {
    if (!openMenu) return
    const close = (e: MouseEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpenMenu(null)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [openMenu])

  return (
    <div className="titlebar" ref={barRef}>
      <div className="titlebar-left">
        <div className="titlebar-nav">
          <button className="tb-btn" data-tip={t('menu.toggleSidebar')} onClick={onToggleSidebar}>
            <Icon name="bars" size={13} />
          </button>
          <button className="tb-btn" data-tip={t('menu.back')} disabled={!canBack} onClick={onBack}>
            <Icon name="arrow-left" size={13} />
          </button>
          <button className="tb-btn" data-tip={t('menu.forward')} disabled={!canForward} onClick={onForward}>
            <Icon name="arrow-right" size={13} />
          </button>
        </div>
        <div className="tb-menus">
          {MENUS.map((m) => (
            <div key={m.id} className="tb-menu">
              <button
                className={`tb-menu-label ${openMenu === m.id ? 'open' : ''}`}
                onClick={() => setOpenMenu(openMenu === m.id ? null : m.id)}
                onMouseEnter={() => { if (openMenu) setOpenMenu(m.id) }}
              >
                {t(`menu.${m.id}` as never)}
              </button>
              {openMenu === m.id && (
                <div className="tb-dropdown">
                  {m.items.map((item, i) =>
                    item === 'sep' ? (
                      <div key={i} className="tb-sep" />
                    ) : (
                      <button
                        key={item}
                        className="tb-item"
                        onClick={() => { setOpenMenu(null); onMenuAction(item) }}
                      >
                        {t(`menu.${item}` as never)}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
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
