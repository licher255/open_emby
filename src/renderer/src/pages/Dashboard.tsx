import { useEffect, useState } from 'react'
import { useEnvStore } from '../stores/env'
import { LOCALES, useI18n, useT, type Locale } from '../i18n'
import type { LocaleKey } from '../i18n/en'
import type { AppSettings, ModelInfo, PluginManifest } from '@shared/types'
import { MODEL_LINEUP } from '@shared/modelLineup'
import Icon, { type IconName } from '../components/Icon'
import { toast } from '../stores/toast'

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
  const [draftSettings, setDraftSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    refresh()
    window.openEmby.models.list().then(setModels).catch(() => {})
    window.openEmby.plugins.list().then(setPlugins).catch(() => {})
    window.openEmby.settings.get().then(setDraftSettings).catch(() => {})
  }, [refresh])

  async function changeLocale(l: Locale) {
    setLocale(l)
    await window.openEmby.settings.set({ locale: l })
  }

  /** 修改数据根：项目库即刻生效；sidecar/engine 以启动时的环境变量为准，重启后使用新目录 */
  async function changeDataRoot() {
    const dir = await window.openEmby.files.selectDirectory()
    if (!dir || dir === status?.dataRoot) return
    await window.openEmby.settings.set({ dataRoot: dir })
    await refresh()
    toast.info(t('toast.dataRootChanged'))
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
                  <button className="btn-outline btn-sm" onClick={changeDataRoot}>{t('settings.changeDataRoot')}</button>
                </div>
              )}
            </>
          )}

          {tab === 'backend' && (
            <div className="card">
              <h2>{t('settings.backend')}</h2>
              {draftSettings && (
                <div>
                  <label>{t('settings.draftBackend')} <select value={draftSettings.draftBackend} onChange={async (e) => {
                    const draftBackend = e.target.value as AppSettings['draftBackend']
                    try { setDraftSettings(await window.openEmby.settings.set({ draftBackend })) }
                    catch (error) { toast.error(String(error)) }
                  }}>
                    <option value="qwen">{t('settings.draftQwen')}</option>
                    <option value="native">{t('settings.draftNative')}</option>
                  </select></label>
                  <p>{t('settings.draftHint')}</p>
                  <label>ComfyUI URL <input value={draftSettings.comfyUrl} onChange={(e) => setDraftSettings({ ...draftSettings, comfyUrl: e.target.value })} /></label>
                  <button className="btn-outline btn-sm" onClick={async () => {
                    try {
                      const url = new URL(draftSettings.comfyUrl)
                      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('HTTP(S) URL required')
                      setDraftSettings(await window.openEmby.settings.set({ comfyUrl: url.href.replace(/\/$/, '') }))
                    } catch (error) { toast.error(String(error)) }
                  }}>{t('settings.saveDraft')}</button>
                  <details className="studio-more"><summary>{locale === 'zh-CN' ? '本地生成环境（高级）' : 'Local generation environment (advanced)'}</summary><div>
                    {(['comfyPythonPath', 'comfyMainPath', 'paperPythonPath', 'paperRepoPath'] as const).map(key => <label key={key}>{({ comfyPythonPath: 'ComfyUI Python', comfyMainPath: 'ComfyUI main.py', paperPythonPath: 'Paper Python', paperRepoPath: 'Paper repository' })[key]}<input value={draftSettings[key] ?? ''} placeholder={locale === 'zh-CN' ? '留空自动查找' : 'Auto-detect when blank'} onChange={e => setDraftSettings({ ...draftSettings, [key]: e.target.value })} /></label>)}
                    <button className="btn-outline btn-sm" onClick={async () => { try { setDraftSettings(await window.openEmby.settings.set({ comfyPythonPath: draftSettings.comfyPythonPath, comfyMainPath: draftSettings.comfyMainPath, paperPythonPath: draftSettings.paperPythonPath, paperRepoPath: draftSettings.paperRepoPath })); toast.info(locale === 'zh-CN' ? '已保存，重启软件后生效。' : 'Saved. Restart the application to apply.') } catch (error) { toast.error(String(error)) } }}>{locale === 'zh-CN' ? '保存环境' : 'Save environment'}</button>
                  </div></details>
                </div>
              )}
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
