import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import type { ProjectInfo } from '@shared/types'
import Projects from './pages/Projects'
import Titlebar, { type MenuAction } from './components/Titlebar'
import Toasts from './components/Toasts'
import Icon from './components/Icon'
import { useT } from './i18n'
import { STEP_ICON, STEP_KEY, STEP_ORDER } from './steps'
import { useWorkbench } from './stores/workbench'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Editor = lazy(() => import('./pages/Editor'))

const REPO = 'https://github.com/licher255/open_emby'

type View = { kind: 'home' } | { kind: 'editor'; project: ProjectInfo } | { kind: 'settings' }

export default function App() {
  const t = useT()
  const [view, setView] = useState<View>({ kind: 'home' })
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [helpOpen, setHelpOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  // 导航历史（前进/后退）
  const [hist, setHist] = useState<{ stack: View[]; idx: number }>({ stack: [{ kind: 'home' }], idx: 0 })
  const wb = useWorkbench()

  const navTo = useCallback((v: View) => {
    setView(v)
    setHist((h) => ({ stack: [...h.stack.slice(0, h.idx + 1), v], idx: h.idx + 1 }))
  }, [])
  const navBack = useCallback(() => {
    setHist((h) => {
      if (h.idx <= 0) return h
      setView(h.stack[h.idx - 1])
      return { ...h, idx: h.idx - 1 }
    })
  }, [])
  const navForward = useCallback(() => {
    setHist((h) => {
      if (h.idx >= h.stack.length - 1) return h
      setView(h.stack[h.idx + 1])
      return { ...h, idx: h.idx + 1 }
    })
  }, [])

  const onMenuAction = useCallback((a: MenuAction) => {
    switch (a) {
      case 'newProject': setCreating(true); break
      case 'openSettings': navTo({ kind: 'settings' }); break
      case 'quit': window.openEmby.window.close(); break
      case 'undo': window.dispatchEvent(new CustomEvent('emby:undo')); break
      case 'toggleSidebar': setSidebarVisible((v) => !v); break
      case 'zoomIn': setZoom((z) => Math.min(1.6, z + 0.1)); break
      case 'zoomOut': setZoom((z) => Math.max(0.7, z - 0.1)); break
      case 'actualSize': setZoom(1); break
      case 'about': navTo({ kind: 'settings' }); break
      case 'feedback': window.open(`${REPO}/issues`); break
      case 'feature': window.open(`${REPO}/issues/new`); break
      case 'docs': window.open(REPO); break
    }
  }, [navTo])

  const refreshProjects = useCallback(async () => {
    try { setProjects(await window.openEmby.projects.list()) } catch { /* 忽略 */ }
  }, [])

  useEffect(() => { refreshProjects() }, [refreshProjects])

  async function createProject() {
    const p = await window.openEmby.projects.create(newName.trim() || '未命名制版')
    setCreating(false)
    setNewName('')
    await refreshProjects()
    setView({ kind: 'editor', project: p })
  }

  const pageTitle =
    view.kind === 'editor' ? view.project.name
    : view.kind === 'settings' ? t('app.page.settings')
    : t('app.page.projects')

  return (
    <div className="app-shell">
      <Titlebar
        page={pageTitle}
        canBack={hist.idx > 0}
        canForward={hist.idx < hist.stack.length - 1}
        onBack={navBack}
        onForward={navForward}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        onMenuAction={onMenuAction}
      />
      <Toasts />
      <div className="app">
        {sidebarVisible && (
        <nav>
          <div className="nav-brand">open<em>emby</em></div>

          {/* 顶部主行动（Codex 侧栏语言：新建在最上） */}
          <button className="nav-new" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t('app.newProject')}
          </button>

          {/* 中部：项目列表 */}
          <div className="nav-section">{t('app.projects')}</div>
          <div className="nav-list">
            {projects.map((p) => (
              <div key={p.id} className="nav-project">
              <button
                className={view.kind === 'editor' && view.project.id === p.id ? 'active' : ''}
                onClick={() => navTo({ kind: 'editor', project: p })}
                  title={p.name}
                >
                  <Icon name="folder-open" />
                  <span className="nav-item-name">{p.name}</span>
                  <span className="nav-item-meta">{t('projects.imageCount', { count: p.imageCount })}</span>
                </button>
                {/* 活动项目的步骤树（项目树内嵌） */}
                {view.kind === 'editor' && view.project.id === p.id && (
                  <div className="nav-steps">
                    {STEP_ORDER.map((sid) => {
                      const info = wb.steps.find((s) => s.id === sid)
                      return (
                        <button
                          key={sid}
                          className={`nav-step ${wb.activeStep === sid ? 'active' : ''}`}
                          onClick={() => wb.setActiveStep(sid)}
                        >
                          <span className={`nav-step-dot ${info?.done ? 'done' : ''}`}>
                            {info?.done ? '✓' : <Icon name={STEP_ICON[sid]} size={10} />}
                          </span>
                          <span className="nav-item-name">{t(STEP_KEY[sid])}</span>
                          {info?.artifact && <span className="nav-item-meta">{info.artifact}</span>}
                        </button>
                      )
                    })}
                    <button
                      className={`nav-step ${wb.historyOpen ? 'active' : ''}`}
                      onClick={() => wb.setHistoryOpen(!wb.historyOpen)}
                    >
                      <span className="nav-step-dot"><Icon name="clock-rotate-left" size={10} /></span>
                      <span className="nav-item-name">{t('history.title')}</span>
                      <span className="nav-item-meta">{wb.historyCount}</span>
                    </button>
                  </div>
                )}
              </div>
            ))}
            {projects.length === 0 && (
              <div className="nav-empty">{t('app.noProjects')}</div>
            )}
          </div>

          {/* 底部：设置沉底 */}
          <div className="nav-bottom">
            <button
              className={`nav-bottom-btn ${view.kind === 'settings' ? 'active' : ''}`}
              data-tip={t('app.settings')}
              onClick={() => navTo({ kind: 'settings' })}
            >
              <Icon name="gear" />
            </button>
            <button
              className={`nav-bottom-btn ${helpOpen ? 'active' : ''}`}
              data-tip={t('help.title')}
              onClick={() => setHelpOpen(!helpOpen)}
            >
              <Icon name="circle-question" />
            </button>
            {helpOpen && (
              <div className="help-pop">
                <div className="help-pop-title">{t('help.title')}</div>
                <button onClick={() => { setHelpOpen(false); window.open(`${REPO}/issues`) }}>
                  {t('menu.feedback')}
                </button>
                <button onClick={() => { setHelpOpen(false); window.open(`${REPO}/issues/new`) }}>
                  {t('menu.feature')}
                </button>
                <button onClick={() => { setHelpOpen(false); window.open(REPO) }}>
                  {t('menu.docs')}
                </button>
              </div>
            )}
          </div>
        </nav>
        )}
        <main className={view.kind === 'editor' && wb.activeStep === 'stylize' ? 'canvas-main' : ''} style={{ zoom }}>
          <Suspense fallback={<div className="page-loading">{t('settings.loading')}</div>}>
            {view.kind === 'editor' && (
              <Editor
                key={view.project.id}
                project={view.project}
                onProjectChanged={refreshProjects}
              />
            )}
            {view.kind === 'settings' && <Dashboard />}
            {view.kind === 'home' && (
              <Projects
                projects={projects}
                onOpen={(p) => navTo({ kind: 'editor', project: p })}
                onCreate={() => setCreating(true)}
              />
            )}
          </Suspense>
        </main>
      </div>

      {creating && (
        <div className="modal-scrim" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('modal.newProject')}</h2>
            <input
              autoFocus
              value={newName}
              placeholder={t('modal.namePlaceholder')}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createProject() }}
            />
            <div className="modal-actions">
              <button className="btn-outline" onClick={() => setCreating(false)}>{t('modal.cancel')}</button>
              <button className="btn-pill" onClick={createProject}>{t('modal.create')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
