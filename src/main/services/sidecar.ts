import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { getSettings } from './settings'

let proc: ChildProcess | null = null

/** sidecar 源码目录（dev: 仓库内；prod: 打包进 resources，后续 esbuild 单文件化） */
function sidecarDir(): string {
  return join(__dirname, '../../sidecar')
}

/** 用 sidecar 自带的 tsx 运行 TypeScript（无需预编译，HMR 友好；生产构建时改为 esbuild bundle） */
function resolveRunner(): { cmd: string; args: string[] } {
  const tsxCli = join(sidecarDir(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const entry = join(sidecarDir(), 'src', 'main.ts')
  if (existsSync(tsxCli)) return { cmd: 'node', args: [tsxCli, entry] }
  return { cmd: 'node', args: [entry] } // 预编译产物入口（后续）
}

export function startSidecar(onLog: (line: string) => void): void {
  if (proc) return
  const { cmd, args } = resolveRunner()
  proc = spawn(cmd, args, {
    cwd: sidecarDir(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPEN_EMBY_DATA_ROOT: getSettings().dataRoot }
  })
  proc.stdout?.on('data', (d) => onLog(String(d).trim()))
  proc.stderr?.on('data', (d) => onLog(String(d).trim()))
  proc.on('exit', () => { proc = null })
}

export function stopSidecar(): void {
  proc?.kill()
  proc = null
}

export async function sidecarStatus(): Promise<{ running: boolean; url: string }> {
  const url = getSettings().sidecarUrl
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    return { running: res.ok, url }
  } catch {
    return { running: false, url }
  }
}

/** 通用 sidecar 调用（制版方案 / 导出等） */
export async function sidecarCall<T>(path: string, body: unknown): Promise<T> {
  const url = getSettings().sidecarUrl
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`sidecar ${res.status}: ${path}`)
  return res.json() as Promise<T>
}
