import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Editor from './pages/Editor'

const PAGES = [
  { id: 'dashboard', label: '环境总览', comp: Dashboard },
  { id: 'editor', label: '制版编辑器', comp: Editor }
] as const

export default function App() {
  const [page, setPage] = useState<(typeof PAGES)[number]['id']>('dashboard')
  const Current = PAGES.find((p) => p.id === page)!.comp

  return (
    <div className="app">
      <nav>
        <div className="logo">open<em>emby</em></div>
        {PAGES.map((p) => (
          <button key={p.id} className={p.id === page ? 'active' : ''} onClick={() => setPage(p.id)}>
            {p.label}
          </button>
        ))}
      </nav>
      <main>
        <Current />
      </main>
    </div>
  )
}
