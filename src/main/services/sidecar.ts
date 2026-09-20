import { spawn, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { getSettings } from './settings'
import { stopProcessTree } from './processTree'

let proc: ChildProcess | null = null
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** sidecar 源码目录（dev: 仓库内；prod: 打包进 resources/sidecar） */
function sidecarDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'sidecar')
  return join(__dirname, '../../sidecar')
}

/** dev: 用 sidecar 自带的 tsx 直跑 TS（HMR 友好）；
 *  prod: 用 Electron 内置 Node（ELECTRON_RUN_AS_NODE）跑 esbuild 打包的 sidecar.cjs */
function resolveRunner(): { cmd: string; args: string[] } {
  if (app.isPackaged) {
    return { cmd: process.execPath, args: [join(sidecarDir(), 'sidecar.cjs')] }
  }
  const tsxCli = join(sidecarDir(), 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const entry = join(sidecarDir(), 'src', 'main.ts')
  if (existsSync(tsxCli)) return { cmd: 'node', args: [tsxCli, entry] }
  return { cmd: 'node', args: [entry] } // 预编译产物入口（后续）
}

export function startSidecar(onLog: (line: string) => void): void {
  if (proc) return
  const { cmd, args } = resolveRunner()
  const url = new URL(getSettings().sidecarUrl)
  proc = spawn(cmd, args, {
    cwd: sidecarDir(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      OPEN_EMBY_DATA_ROOT: getSettings().dataRoot,
      OPEN_EMBY_SIDECAR_PORT: url.port || '8100',
      // prod: ELECTRON_RUN_AS_NODE 让 Electron 作为纯 Node 运行 sidecar bundle
      ...(app.isPackaged ? {
        ELECTRON_RUN_AS_NODE: '1',
        EMBY_CORE_NODE: join(process.resourcesPath, 'bin', 'emby-core.win32-x64-msvc.node')
      } : {})
    }
  })
  proc.stdout?.on('data', (d) => onLog(String(d).trim()))
  proc.stderr?.on('data', (d) => onLog(String(d).trim()))
  proc.on('exit', () => { proc = null })
}

export function stopSidecar(): void {
  if (!proc) return
  const child = proc
  proc = null
  stopProcessTree(child)
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

async function ensureSidecarReady(): Promise<void> {
  if (!proc) startSidecar(() => {})
  const url = getSettings().sidecarUrl
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(300) })
      if (response.ok) return
    } catch { /* service is still starting */ }
    await delay(100)
  }
  throw new Error('sidecar 启动超时')
}

/** 通用 sidecar 调用（制版方案 / 导出等） */
export async function sidecarCall<T>(path: string, body: unknown): Promise<T> {
  await ensureSidecarReady()
  const url = getSettings().sidecarUrl
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`sidecar ${res.status}: ${path}`)
  return res.json() as Promise<T>
}
