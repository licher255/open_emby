import { useEffect, useState } from 'react'
import { useEnvStore } from '../stores/env'
import { LOCALES, useI18n, useT, type Locale } from '../i18n'
import type { LocaleKey } from '../i18n/en'
import type { ModelInfo, PluginManifest } from '@shared/types'
import { MODEL_LINEUP } from '@shared/modelLineup'
import Icon, { type IconName } from '../components/Icon'

const LOCALE_LABEL: Record<Locale, string> = { en: 'English', 'zh-CN': '简体中文' }

type SettingsTab = 'general' | 'backend' | 'models' | 'plugins' | 'about'

const TAB_KEY: Record<SettingsTab, LocaleKey> = {
  general: 'settings.tab.general',
  backend: 'settings.tab.backend',
  models: 'settings.tab.models',
  plugins: 'settings.tab.plugins',
  about: 'settings.tab.about'
}

const TAB_ICON: Record<SettingsTab, IconName> = {
  general: 'sliders',
  backend: 'server',
  models: 'cubes',
  plugins: 'puzzle-piece',
  about: 'circle-info'
}

export default function Dashboard() {
  const t = useT()
  const { status, refresh } = useEnvStore()
  const locale = useI18n((s) => s.locale)
  const setLocale = useI18n((s) => s.setLocale)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [plugins, setPlugins] = useState<PluginManifest[]>([])
  const [tab, setTab] = useState<SettingsTab>('general')

  useEffect(() => {
    refresh()
    window.openEmby.models.list().then(setModels).catch(() => {})
    window.openEmby.plugins.list().then(setPlugins).catch(() => {})
  }, [refresh])

  async function changeLocale(l: Locale) {
    setLocale(l)
    await window.openEmby.settings.set({ locale: l })
  }

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>
      <div className="settings-layout">
        {/* 子菜单（macOS 系统设置式） */}
        <div className="settings-nav">
          {(Object.keys(TAB_KEY) as SettingsTab[]).map((k) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              <Icon name={TAB_ICON[k]} /> {t(TAB_KEY[k])}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'general' && (
            <>
              <div className="card">
                <h2>{t('settings.language')}</h2>
                <div className="view-tabs">
                  {LOCALES.map((l) => (
                    <button key={l} className={l === locale ? 'active' : ''} onClick={() => changeLocale(l)}>
                      {LOCALE_LABEL[l]}
                    </button>
                  ))}
                </div>
              </div>
              {status && (
                <div className="card">
                  <h2>{t('settings.dataRoot')}</h2>
                  <p className="mono-meta">{status.dataRoot}</p>
                </div>
              )}
            </>
          )}

          {tab === 'backend' && (
            <div className="card">
              <h2>{t('settings.backend')}</h2>
              {status ? (
                <>
                  <p>
                    <span className={`badge ${status.engine.reachable ? 'ok' : 'err'}`}>
                      {status.engine.reachable ? t('settings.running') : t('settings.notRunning')}
                    </span>
                    {t('settings.engine')} — {status.engine.url}
                  </p>
                  <p>
                    <span className={`badge ${status.sidecar.running ? 'ok' : 'err'}`}>
                      {status.sidecar.running ? t('settings.running') : t('settings.notRunning')}
                    </span>
                    {t('settings.sidecar')} — {status.sidecar.url}
                  </p>
                </>
              ) : (
                <p>{t('settings.loading')}</p>
              )}
            </div>
          )}

          {tab === 'models' && (
            <>
              <div className="card">
                <h2>{t('settings.modelLineup')}</h2>
                <table>
                  <thead><tr><th>ID</th><th>{t('settings.colName')}</th><th>{t('settings.colType')}</th><th>{t('settings.colVersion')}</th></tr></thead>
                  <tbody>
                    {MODEL_LINEUP.map((m) => (
                      <tr key={m.id}>
                        <td>{m.id}</td>
                        <td>{m.codename}</td>
                        <td>{m.kind}</td>
                        <td>{t(m.status === 'planned' ? 'settings.statusPlanned' : m.status === 'training' ? 'settings.statusTraining' : 'settings.statusAvailable')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card">
                <h2>{t('settings.models', { count: models.length })}</h2>
                <table>
                  <thead><tr><th>{t('settings.colName')}</th><th>{t('settings.colType')}</th><th>{t('settings.colPath')}</th></tr></thead>
                  <tbody>
                    {models.map((m) => (
                      <tr key={m.path}><td>{m.id}</td><td>{m.kind}</td><td>{m.path}</td></tr>
                    ))}
                    {models.length === 0 && <tr><td colSpan={3}>{t('settings.modelsEmpty')}</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'plugins' && (
            <div className="card">
              <h2>{t('settings.plugins', { count: plugins.length })}</h2>
              <table>
                <thead><tr><th>{t('settings.colId')}</th><th>{t('settings.colName')}</th><th>{t('settings.colType')}</th><th>{t('settings.colVersion')}</th></tr></thead>
                <tbody>
                  {plugins.map((p) => (
                    <tr key={p.id}><td>{p.id}</td><td>{p.name}</td><td>{p.type}</td><td>{p.version}</td></tr>
                  ))}
                  {plugins.length === 0 && <tr><td colSpan={4}>{t('settings.pluginsEmpty')}</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'about' && (
            <div className="card about-card">
              <div className="about-logo">open<em>emby</em></div>
              <p className="about-tagline">{t('about.tagline')}</p>
              <table>
                <tbody>
                  <tr><td>{t('settings.version')}</td><td>v{status?.version ?? '…'}</td></tr>
                  <tr><td>{t('settings.engine')}</td><td>{status?.engine.url ?? '…'}</td></tr>
                  <tr><td>{t('settings.sidecar')}</td><td>{status?.sidecar.url ?? '…'}</td></tr>
                  <tr><td>{t('settings.dataRoot')}</td><td>{status?.dataRoot ?? '…'}</td></tr>
                </tbody>
              </table>
              <p className="mono-meta">{t('about.license')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
