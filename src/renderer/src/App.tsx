import { useCallback, useEffect, useState } from 'react'
import type { ProjectInfo } from '@shared/types'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'
import Projects from './pages/Projects'
import Titlebar from './components/Titlebar'
import Toasts from './components/Toasts'
import Icon from './components/Icon'
import { useT } from './i18n'

type View = { kind: 'home' } | { kind: 'editor'; project: ProjectInfo } | { kind: 'settings' }

export default function App() {
  const t = useT()
  const [view, setView] = useState<View>({ kind: 'home' })
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

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
      <Titlebar page={pageTitle} />
      <Toasts />
      <div className="app">
        <nav>
          {/* 顶部主行动（Codex 侧栏语言：新建在最上） */}
          <button className="nav-new" onClick={() => setCreating(true)}>
            <Icon name="plus" /> {t('app.newProject')}
          </button>

          {/* 中部：项目列表 */}
          <div className="nav-section">{t('app.projects')}</div>
          <div className="nav-list">
            {projects.map((p) => (
              <button
                key={p.id}
                className={view.kind === 'editor' && view.project.id === p.id ? 'active' : ''}
                onClick={() => setView({ kind: 'editor', project: p })}
                title={p.name}
              >
                <Icon name="folder-open" />
                <span className="nav-item-name">{p.name}</span>
                <span className="nav-item-meta">{t('projects.imageCount', { count: p.imageCount })}</span>
              </button>
            ))}
            {projects.length === 0 && (
              <div className="nav-empty">{t('app.noProjects')}</div>
            )}
          </div>

          {/* 底部：设置沉底 */}
          <div className="nav-bottom">
            <button
              className={view.kind === 'settings' ? 'active' : ''}
              onClick={() => setView({ kind: 'settings' })}
            >
              <Icon name="gear" />
              <span className="nav-item-name">{t('app.settings')}</span>
            </button>
          </div>
        </nav>
        <main>
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
              onOpen={(p) => setView({ kind: 'editor', project: p })}
              onCreate={() => setCreating(true)}
            />
          )}
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
