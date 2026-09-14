import { useEffect, useState } from 'react'
import { useEnvStore } from '../stores/env'
import type { ModelInfo, PluginManifest } from '@shared/types'

export default function Dashboard() {
  const { status, refresh } = useEnvStore()
  const [models, setModels] = useState<ModelInfo[]>([])
  const [plugins, setPlugins] = useState<PluginManifest[]>([])

  useEffect(() => {
    refresh()
    window.openEmby.models.list().then(setModels).catch(() => {})
    window.openEmby.plugins.list().then(setPlugins).catch(() => {})
  }, [refresh])

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