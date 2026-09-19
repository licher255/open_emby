import type { ProjectInfo } from '@shared/types'
import { localeTag, useT } from '../i18n'

interface Props {
  projects: ProjectInfo[]
  onOpen: (p: ProjectInfo) => void
  onCreate: () => void
}

/** 项目主页：工业软件的项目库入口，选项目或新建项目开始制版 */
export default function Projects({ projects, onOpen, onCreate }: Props) {
  const t = useT()
  return (
    <div>
      <header className="editor-head">
        <h1>{t('projects.title')}</h1>
      </header>
      <div className="project-grid">
        <button className="project-card new" onClick={onCreate}>
          <div className="project-card-plus">＋</div>
          <div className="project-card-name">{t('projects.newCard')}</div>
          <div className="project-card-meta">{t('projects.newHint')}</div>
        </button>
        {projects.map((p) => (
          <button key={p.id} className="project-card" onClick={() => onOpen(p)}>
            <div className="project-card-name">{p.name}</div>
            <div className="project-card-meta">
              {t('projects.imageCount', { count: p.imageCount })} · {new Date(p.createdAt).toLocaleDateString(localeTag())}
            </div>
          </button>
        ))}
      </div>
      {projects.length === 0 && (
        <p className="mono-meta" style={{ marginTop: 24 }}>
          {t('projects.storageNote')}
        </p>
      )}
    </div>
  )
}
