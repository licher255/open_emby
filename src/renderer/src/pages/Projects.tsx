import type { ProjectInfo } from '@shared/types'
import { localeTag, useI18n, useT } from '../i18n'
import AssetThumb from '../components/AssetThumb'

interface Props {
  projects: ProjectInfo[]
  onOpen: (p: ProjectInfo) => void
  onCreate: () => void
}

/** 项目主页：工业软件的项目库入口，选项目或新建项目开始制版 */
export default function Projects({ projects, onOpen, onCreate }: Props) {
  const t = useT()
  const zh = useI18n(s => s.locale) === 'zh-CN'
  return (
    <div className="projects-page">
      <header className="editor-head">
        <h1>{zh ? '我的绣作' : 'My embroideries'}</h1>
      </header>
      <div className="project-grid">
        <button className="project-card new" onClick={onCreate}>
          <div className="project-card-plus">＋</div>
          <div className="project-card-name">{t('projects.newCard')}</div>
        </button>
        {projects.map((p) => (
          <button key={p.id} className="project-card" onClick={() => onOpen(p)}>
            {p.coverPath && <div className="studio-project-cover"><AssetThumb path={p.coverPath} /></div>}
            <div className="project-card-name">{p.name}</div>
            <div className="project-card-meta">
              {t('projects.imageCount', { count: p.imageCount })} · {new Date(p.createdAt).toLocaleDateString(localeTag())}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
