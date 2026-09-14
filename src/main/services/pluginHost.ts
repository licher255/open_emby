import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { PluginManifest } from '@shared/types'

const REQUIRED = ['id', 'name', 'version', 'type', 'entry'] as const
const VALID_TYPES = new Set(['workflow', 'exporter', 'tool', 'agent-skill', 'theme'])

/** 扫描内置 plugins/ 目录，校验 manifest（社区插件目录后续从 settings 扩展） */
export function listPlugins(builtinDir: string): Array<{ manifest: PluginManifest; dir: string }> {
  const out: Array<{ manifest: PluginManifest; dir: string }> = []
  if (!existsSync(builtinDir)) return out
  for (const name of readdirSync(builtinDir)) {
    const dir = join(builtinDir, name)
    const mp = join(dir, 'plugin.json')
    if (!existsSync(mp)) continue
    try {
      const m = JSON.parse(readFileSync(mp, 'utf-8')) as PluginManifest
      for (const k of REQUIRED) if (!(k in m)) throw new Error(`缺少字段 ${k}`)
      if (!VALID_TYPES.has(m.type)) throw new Error(`非法 type: ${m.type}`)
      out.push({ manifest: m, dir })
    } catch (e) {
      console.warn(`[pluginHost] 跳过无效插件 ${name}:`, e)
    }
  }
  return out
}

/** 调用插件（workflow 类型：取工作流 JSON 交给 ComfyUI） */
export async function invokePlugin(pluginDir: string, manifest: PluginManifest, input: unknown): Promise<unknown> {
  if (manifest.type === 'workflow') {
    const wf = JSON.parse(readFileSync(join(pluginDir, manifest.entry), 'utf-8'))
    return { workflow: wf, input }
  }
  throw new Error(`插件类型 ${manifest.type} 的调用尚未实现`)
}
