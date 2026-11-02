import { useCallback, useEffect, useState } from 'react'
import { useEnvStore } from '../stores/env'
import { LOCALES, useI18n, useT, type Locale } from '../i18n'
import type { LocaleKey } from '../i18n/en'
import type {
  AiProvider, AiStatus, AppSettings, InstalledModelInfo, ModelCatalogItem, ModelInstallStatus,
  RuntimeDevices, RuntimeServer, ServerPhase
} from '@shared/types'
import Icon, { type IconName } from '../components/Icon'
import { toast } from '../stores/toast'
import { confirmDialog } from '../stores/dialog'

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

const PHASE_KEY: Record<ServerPhase, LocaleKey> = {
  starting: 'settings.serverStarting',
  ready: 'settings.serverReady',
  stopped: 'settings.serverStopped',
  failed: 'settings.serverFailed'
}

const KIND_KEY: Record<AiProvider['kind'], LocaleKey> = {
  'open-ai': 'settings.kindCloud',
  local: 'settings.kindLocal',
  builtin: 'settings.kindBuiltin'
}

function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  const gb = bytes / 1024 ** 3
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

function phaseKey(phase: ModelInstallStatus['phase']): LocaleKey {
  const map: Record<ModelInstallStatus['phase'], LocaleKey> = {
    queued: 'settings.phaseQueued',
    downloading: 'settings.phaseDownloading',
    verifying: 'settings.phaseVerifying',
    done: 'settings.phaseDone',
    error: 'settings.phaseError',
    cancelled: 'settings.phaseCancelled'
  }
  return map[phase]
}

export default function Dashboard() {
  const t = useT()
  const { status, refresh } = useEnvStore()
  const locale = useI18n((s) => s.locale)
  const setLocale = useI18n((s) => s.setLocale)
  const [plugins, setPlugins] = useState<import('@shared/types').PluginManifest[]>([])
  const [tab, setTab] = useState<SettingsTab>('general')
  const [draftSettings, setDraftSettings] = useState<AppSettings | null>(null)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [models, setModels] = useState<{ installed: InstalledModelInfo[]; catalog: ModelCatalogItem[] } | null>(null)
  const [jobs, setJobs] = useState<Record<string, { job: string; status: ModelInstallStatus }>>({})
  const [importUrl, setImportUrl] = useState('')
  const [devices, setDevices] = useState<RuntimeDevices | null>(null)
  const [servers, setServers] = useState<RuntimeServer[]>([])
  const [serverBusy, setServerBusy] = useState<string | null>(null)

  const reloadModels = useCallback(async () => {
    try { setModels(await window.openEmby.models.list()) } catch (error) { toast.error(String(error)) }
  }, [])

  const reloadAi = useCallback(async () => {
    try { setAi(await window.openEmby.ai.status()) } catch { /* engine not running yet: stay silent */ }
  }, [])

  useEffect(() => {
    refresh()
    window.openEmby.plugins.list().then(setPlugins).catch(() => {})
    window.openEmby.settings.get().then(setDraftSettings).catch(() => {})
    void reloadAi()
    void reloadModels()
    void window.openEmby.runtime.devices().then(setDevices).catch(() => { /* engine not ready */ })
  }, [refresh, reloadAi, reloadModels])

  // Server state is cheap to poll and changes without user action (idle eviction).
  useEffect(() => {
    let alive = true
    const tick = () => {
      window.openEmby.runtime.servers()
        .then((list) => { if (alive) setServers(list) })
        .catch(() => { /* engine not ready */ })
    }
    tick()
    const timer = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  // Poll install jobs and refresh the catalog when one finishes.
  const activeJobs = Object.values(jobs).filter((j) => !j.status.done)
  useEffect(() => {
    if (activeJobs.length === 0) return
    const timer = setInterval(() => {
      for (const job of Object.values(jobs)) {
        if (job.status.done) continue
        void window.openEmby.models.status(job.job).then((status) => {
          setJobs((current) => ({ ...current, [job.job]: { ...job, status } }))
          if (status.done) void reloadModels()
        }).catch(() => { /* retry on the next tick */ })
      }
    }, 1500)
    return () => clearInterval(timer)
  }, [activeJobs.length, jobs, reloadModels])

  async function changeLocale(l: Locale) {
    setLocale(l)
    await window.openEmby.settings.set({ locale: l })
  }

  async function changeDataRoot() {
    const dir = await window.openEmby.files.selectDirectory()
    if (!dir || dir === status?.dataRoot) return
    await window.openEmby.settings.set({ dataRoot: dir })
    await refresh()
    toast.info(t('toast.dataRootChanged'))
  }

  async function installModel(id: string) {
    try {
      const { job } = await window.openEmby.models.install(id)
      setJobs((current) => ({
        ...current,
        [job]: {
          job,
          status: {
            job, modelId: id, phase: 'queued', file: '', fileIndex: 0, fileCount: 0,
            received: 0, total: 0, message: '', done: false, error: ''
          }
        }
      }))
    } catch (error) { toast.error(String(error)) }
  }

  async function importFromUrl() {
    const url = importUrl.trim()
    if (!url) return
    try {
      const result = await window.openEmby.models.importUrl({ url })
      setImportUrl('')
      setJobs((current) => ({
        ...current,
        [result.job]: {
          job: result.job,
          status: {
            job: result.job, modelId: result.model.id, phase: 'queued', file: '', fileIndex: 0,
            fileCount: 0, received: 0, total: 0, message: '', done: false, error: ''
          }
        }
      }))
      toast.success(t('settings.modelImportDone'))
    } catch (error) { toast.error(String(error)) }
  }

  async function importLocal() {
    try {
      const files = await window.openEmby.models.pickFiles()
      if (!files.length) return
      const result = await window.openEmby.models.importLocal({ files })
      await reloadModels()
      toast.success(t('settings.modelImportDone') + ' · ' + result.installed.name)
    } catch (error) { toast.error(String(error)) }
  }

  async function toggleServer(modelId: string, action: 'start' | 'stop') {
    setServerBusy(modelId)
    try {
      const result = action === 'start'
        ? await window.openEmby.runtime.start(modelId)
        : await window.openEmby.runtime.stop(modelId)
      setServers((current) => [...current.filter((server) => server.modelId !== modelId), result])
      if (result.phase === 'failed') toast.error(result.error ?? 'Model server failed to start')
    } catch (error) {
      toast.error(String(error))
    } finally {
      setServerBusy(null)
    }
  }

  async function removeModel(id: string, name: string) {
    if (!(await confirmDialog(t('settings.modelRemoveConfirm', { name }), { danger: true }))) return
    try {
      await window.openEmby.models.remove(id)
      await reloadModels()
    } catch (error) { toast.error(String(error)) }
  }

  return (
    <div className="settings-page">
      <h1>{t('settings.title')}</h1>
      <div className="settings-layout">
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
            <>
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
                ) : <p>{t('settings.loading')}</p>}
              </div>

              <div className="card">
                <h2>{t('settings.runtime')}</h2>
                <p className="mono-meta">
                  {t('settings.runtimeSd')}: {ai?.runtime.sdBin ?? t('settings.runtimeMissing')}
                  {' · '}
                  {t('settings.runtimeLlama')}: {ai?.runtime.llamaBin ?? t('settings.runtimeMissing')}
                </p>
                <p className="mono-meta">{t('settings.runtimeHint', { path: ai?.runtime.modelsRoot ?? status?.dataRoot ?? '' })}</p>
              </div>

              <div className="card">
                <h2>{t('settings.hardware')}</h2>
                <p className="mono-meta">
                  {t('settings.recommendedBackend')}: <strong>{devices?.recommendedBackend ?? '—'}</strong>
                </p>
                <table>
                  <thead><tr>
                    <th>{t('settings.deviceName')}</th>
                    <th>{t('settings.deviceVendor')}</th>
                    <th>{t('settings.deviceMemory')}</th>
                    <th>{t('settings.deviceBackend')}</th>
                  </tr></thead>
                  <tbody>
                    {(devices?.devices ?? []).map((device, index) => (
                      <tr key={index}>
                        <td>{device.name}</td>
                        <td>{device.vendor}</td>
                        <td>{device.memoryMb ? Math.round(device.memoryMb / 1024) + ' GB' : '—'}</td>
                        <td className="mono">{device.backend}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mono-meta">
                  {t('settings.binaries')}: sd-server {devices?.binaries.sdServer ?? t('settings.runtimeMissing')}
                  {' · '}sd-cli {devices?.binaries.sdCli ?? t('settings.runtimeMissing')}
                </p>
              </div>

              <div className="card">
                <h2>{t('settings.aiProviders')}</h2>
                <p className="mono-meta">{t('settings.aiProvidersHint')}</p>
                {ai?.providers.map((provider) => (
                  <ProviderForm key={provider.id} provider={provider} onSaved={reloadAi} />
                ))}
                <button
                  className="btn-outline btn-sm"
                  onClick={async () => {
                    try {
                      await window.openEmby.ai.saveProvider({
                        id: '', name: 'Cloud API', kind: 'open-ai', baseUrl: 'https://api.openai.com/v1',
                        apiKey: '', imageModel: 'gpt-image-1', chatModel: 'gpt-4o-mini', enabled: false, note: ''
                      })
                      await reloadAi()
                    } catch (error) { toast.error(String(error)) }
                  }}
                >
                  <Icon name="plus" size={12} /> {t('settings.providerNew')}
                </button>
              </div>
            </>
          )}

          {tab === 'models' && (
            <>
              {draftSettings && (
                <div className="card">
                  <h2>{t('settings.draftBackend')}</h2>
                  <select
                    value={draftSettings.draftBackend}
                    onChange={async (e) => {
                      const draftBackend = e.target.value as AppSettings['draftBackend']
                      try { setDraftSettings(await window.openEmby.settings.set({ draftBackend })) }
                      catch (error) { toast.error(String(error)) }
                    }}
                  >
                    <option value="model">{t('settings.draftBackendModel')}</option>
                    <option value="builtin">{t('settings.draftBackendBuiltin')}</option>
                  </select>
                </div>
              )}

              <div className="card">
                <h2>{t('settings.modelImport')}</h2>
                <p className="mono-meta">{t('settings.modelImportHint')}</p>
                <div className="import-row">
                  <input
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    placeholder={t('settings.modelImportUrlPlaceholder')}
                    onKeyDown={(e) => { if (e.key === 'Enter') void importFromUrl() }}
                  />
                  <button className="btn-outline btn-sm" onClick={() => void importFromUrl()} disabled={!importUrl.trim()}>
                    {t('settings.modelImportUrl')}
                  </button>
                </div>
                <button className="btn-outline btn-sm" style={{ marginTop: 12 }} onClick={() => void importLocal()}>
                  {t('settings.modelImportLocal')}
                </button>
              </div>

              <div className="card">
                <h2>{t('settings.modelsInstalled')} ({models?.installed.length ?? 0})</h2>
                <table>
                  <thead><tr><th>{t('settings.colName')}</th><th>{t('settings.colType')}</th><th>{t('settings.colSize')}</th><th>{t('settings.serverState')}</th><th /></tr></thead>
                  <tbody>
                    {(models?.installed ?? []).map((model) => (
                      <tr key={model.manifest.id}>
                        <td>{model.manifest.name}</td>
                        <td>{model.manifest.runtime}</td>
                        <td>
                          {formatBytes(model.bytes)} ·{' '}
                          {model.ready ? t('settings.modelReady') : t('settings.modelPartial')}
                        </td>
                        <td>
                          {(() => {
                            const server = servers.find((item) => item.modelId === model.manifest.id)
                            const phase: ServerPhase = server?.phase ?? 'stopped'
                            return (
                              <div className="server-cell">
                                <span
                                  className={`badge ${phase === 'ready' ? 'ok' : phase === 'failed' ? 'err' : ''}`}
                                  title={server?.error ?? undefined}
                                >
                                  {t(PHASE_KEY[phase])}{phase === 'ready' && server ? ` :${server.port}` : ''}
                                </span>
                                {phase === 'ready' || phase === 'starting' ? (
                                  <button className="btn-outline btn-sm" disabled={serverBusy === model.manifest.id} onClick={() => void toggleServer(model.manifest.id, 'stop')}>
                                    {t('settings.serverStop')}
                                  </button>
                                ) : (
                                  <button className="btn-outline btn-sm" disabled={serverBusy === model.manifest.id} onClick={() => void toggleServer(model.manifest.id, 'start')}>
                                    {serverBusy === model.manifest.id ? t('settings.serverStarting') : t('settings.serverStart')}
                                  </button>
                                )}
                              </div>
                            )
                          })()}
                        </td>
                        <td>
                          <button className="btn-outline btn-sm" onClick={() => removeModel(model.manifest.id, model.manifest.name)}>
                            {t('settings.modelRemove')}
                          </button>
                        </td>
                      </tr>
                    ))}
                    {(models?.installed.length ?? 0) === 0 && (
                      <tr><td colSpan={5}>{t('settings.modelsEmpty')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="card">
                <div className="editor-actions" style={{ justifyContent: 'space-between' }}>
                  <h2>{t('settings.modelsCatalog')}</h2>
                  <button className="btn-outline btn-sm" onClick={() => { void reloadModels(); void reloadAi() }}>
                    {t('settings.refresh')}
                  </button>
                </div>
                {(models?.catalog ?? []).map((item) => {
                  const job = Object.values(jobs).find((j) => j.status.modelId === item.manifest.id && !j.status.done)
                  return (
                    <div key={item.manifest.id} className="model-row">
                      <div>
                        <strong>{item.manifest.name}</strong>
                        <span className="mono-meta"> · {formatBytes(item.manifest.approxBytes)} · {item.manifest.license}</span>
                        <p className="mono-meta">{item.manifest.description}</p>
                      </div>
                      {job ? (
                        <div>
                          <p className="mono-meta">
                            {t(phaseKey(job.status.phase))}
                            {job.status.total > 0 ? ` ${Math.round((job.status.received / job.status.total) * 100)}%` : ''}
                          </p>
                          <div className="progress-track slim">
                            <div className="progress-fill" style={{ width: job.status.total > 0 ? `${Math.round((job.status.received / job.status.total) * 100)}%` : '100%' }} />
                          </div>
                          <button className="btn-outline btn-sm" onClick={() => { void window.openEmby.models.cancel(job.job) }}>
                            {t('settings.modelCancel')}
                          </button>
                        </div>
                      ) : item.installed ? (
                        <span className="badge ok">{t('settings.modelReady')}</span>
                      ) : (
                        <button className="btn-outline btn-sm" onClick={() => installModel(item.manifest.id)}>
                          {t('settings.modelInstall')}
                        </button>
                      )}
                    </div>
                  )
                })}
                {(models?.catalog.length ?? 0) === 0 && <p className="mono-meta">{t('settings.modelsEmpty')}</p>}
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

/** Provider editor card: save, test and delete all go straight to the Rust gateway. */
function ProviderForm({ provider, onSaved }: { provider: AiProvider; onSaved: () => void }) {
  const t = useT()
  const [draft, setDraft] = useState<AiProvider>(provider)
  const [detail, setDetail] = useState('')
  useEffect(() => { setDraft(provider) }, [provider])

  async function save() {
    try {
      await window.openEmby.ai.saveProvider(draft)
      onSaved()
      toast.success(t('settings.providerSave'))
    } catch (error) { toast.error(String(error)) }
  }

  return (
    <details className="card provider-card" open={provider.kind === 'open-ai' && !provider.baseUrl ? false : undefined}>
      <summary>
        <strong>{provider.name}</strong>
        <span className="mono-meta"> · {t(KIND_KEY[provider.kind])}{provider.enabled ? '' : ' · off'}</span>
      </summary>
      <label>{t('settings.colName')}
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      {provider.kind === 'open-ai' && (
        <>
          <label>{t('settings.providerBaseUrl')}
            <input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </label>
          <label>{t('settings.providerKey')}
            <input value={draft.apiKey} onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })} placeholder="sk-…" />
          </label>
          <label>{t('settings.providerImageModel')}
            <input value={draft.imageModel} onChange={(e) => setDraft({ ...draft, imageModel: e.target.value })} />
          </label>
          <label>{t('settings.providerChatModel')}
            <input value={draft.chatModel} onChange={(e) => setDraft({ ...draft, chatModel: e.target.value })} />
          </label>
        </>
      )}
      {provider.kind === 'local' && (
        <>
          <label>{t('settings.providerImageModel')}
            <input value={draft.imageModel} onChange={(e) => setDraft({ ...draft, imageModel: e.target.value })} placeholder="auto" />
          </label>
          <label>{t('settings.providerChatModel')}
            <input value={draft.chatModel} onChange={(e) => setDraft({ ...draft, chatModel: e.target.value })} placeholder="auto" />
          </label>
        </>
      )}
      <label className="provider-toggle">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
        {t('settings.providerEnabled')}
      </label>
      {detail && <p className="mono-meta">{detail}</p>}
      <div className="editor-actions">
        <button className="btn-pill btn-sm-pill" onClick={save}>{t('settings.providerSave')}</button>
        <button className="btn-outline btn-sm" onClick={async () => {
          try {
            const result = await window.openEmby.ai.testProvider(provider.id)
            setDetail(`${result.ok ? '✓' : '✗'} ${result.detail}`)
          } catch (error) { setDetail(String(error)) }
        }}>{t('settings.providerTest')}</button>
        {provider.kind !== 'builtin' && (
          <button className="btn-outline btn-sm" onClick={async () => {
            if (!(await confirmDialog(t('settings.providerDeleteConfirm', { name: provider.name }), { danger: true }))) return
            try { await window.openEmby.ai.deleteProvider(provider.id); onSaved() }
            catch (error) { toast.error(String(error)) }
          }}>{t('settings.providerDelete')}</button>
        )}
      </div>
    </details>
  )
}
