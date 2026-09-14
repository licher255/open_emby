import { useEffect, useState } from 'react'
import { useEnvStore } from '../stores/env'
import type { AppSettings, ModelInfo, PluginManifest } from '@shared/types'

export default function Dashboard() {
  const { status, refresh } = useEnvStore()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [plugins, setPlugins] = useState<PluginManifest[]>([])
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [flyStats, setFlyStats] = useState<Record<string, unknown> | null>(null)

  const loadFlyStats = () => window.openEmby.flywheel.stats().then(setFlyStats).catch(() => {})

  useEffect(() => {
    refresh()
    window.openEmby.models.list().then(setModels).catch(() => {})
    window.openEmby.plugins.list().then(setPlugins).catch(() => {})
    window.openEmby.settings.get().then(setSettings).catch(() => {})
    loadFlyStats()
  }, [refresh])

  const toggleContribution = async (enabled: boolean) => {
    const s = await window.openEmby.settings.set({
      contribution: {
        ...(settings?.contribution ?? { contributorId: '' }),
        enabled,
        scope: enabled ? 'anonymous_training' : 'off'
      }
    })
    setSettings(s)
  }

  return (
    <div>
      <h1>环境总览</h1>
      <div className="card">
        <h2>后端服务</h2>
        {status ? (
          <>
            <p>
              <span className={`badge ${status.comfyui.reachable ? 'ok' : 'err'}`}>
                {status.comfyui.reachable ? '已连接' : '未连接'}
              </span>
              ComfyUI — {status.comfyui.url}
            </p>
            <p>
              <span className={`badge ${status.sidecar.running ? 'ok' : 'err'}`}>
                {status.sidecar.running ? '运行中' : '未运行'}
              </span>
              制版 Sidecar — {status.sidecar.url}
            </p>
            <p>数据根目录：{status.dataRoot}</p>
          </>
        ) : (
          <p>加载中…</p>
        )}
      </div>

      <div className="card">
        <h2>模型仓库（{models.length}）</h2>
        <table>
          <thead><tr><th>名称</th><th>类型</th><th>路径</th></tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.path}><td>{m.id}</td><td>{m.kind}</td><td>{m.path}</td></tr>
            ))}
            {models.length === 0 && <tr><td colSpan={3}>models/ 目录暂无模型，从 HuggingFace 下载后自动列出</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>数据飞轮（社区共建）</h2>
        <p>
          授权后，你的「原图 + 制版结果 + 使用反馈」将匿名用于训练更好的刺绣模型。
          数据存放在本机 <code>datasets/flywheel/</code>，可随时关闭或删除。
        </p>
        <p>
          <label>
            <input
              type="checkbox"
              checked={settings?.contribution.enabled ?? false}
              onChange={(e) => toggleContribution(e.target.checked)}
            />{' '}
            参与匿名训练数据贡献
          </label>
          {settings?.contribution.contributorId && (
            <span style={{ marginLeft: 12, color: '#8a91a0', fontSize: 12 }}>
              匿名 ID: {settings.contribution.contributorId.slice(0, 8)}…
            </span>
          )}
        </p>
        {flyStats && (
          <p style={{ fontSize: 13, color: '#aeb4c0' }}>
            训练池：待策展 {(flyStats.pools as Record<string, number>)?.inbox ?? 0} ·
            已入选 {(flyStats.pools as Record<string, number>)?.curated ?? 0} ·
            已淘汰 {(flyStats.pools as Record<string, number>)?.rejected ?? 0}
            {'  '}
            <button onClick={async () => { await window.openEmby.flywheel.curate(); loadFlyStats() }}>
              运行策展
            </button>
          </p>
        )}
      </div>

      <div className="card">
        <h2>插件（{plugins.length}）</h2>
        <table>
          <thead><tr><th>ID</th><th>名称</th><th>类型</th><th>版本</th></tr></thead>
          <tbody>
            {plugins.map((p) => (
              <tr key={p.id}><td>{p.id}</td><td>{p.name}</td><td>{p.type}</td><td>{p.version}</td></tr>
            ))}
            {plugins.length === 0 && <tr><td colSpan={4}>plugins/ 目录暂无插件</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
