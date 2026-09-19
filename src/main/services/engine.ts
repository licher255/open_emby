/** emby-engine 服务：守护进程 + ComfyUI 兼容 API 客户端。
 *  引擎是 crates/emby-engine 编译出的 Rust 二进制，借鉴 ComfyUI 后端架构
 *  （/prompt 队列、/history、/view、/ws 节点级进度），替代原先对外部 ComfyUI 的调用。 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import WebSocket from 'ws'
import type { EngineProgressEvent, StylizeResult } from '@shared/types'
import { getSettings } from './settings'

let proc: ChildProcess | null = null

/** 引擎二进制位置（dev: cargo target；prod: 打包进 resources/bin） */
function engineBin(): string | null {
  const candidates = [
    join(__dirname, '../../crates/emby-engine/target/release/emby-engine.exe'),
    join(__dirname, '../../crates/emby-engine/target/debug/emby-engine.exe'),
    join(process.resourcesPath ?? '', 'bin', 'emby-engine.exe')
  ]
  return candidates.find(existsSync) ?? null
}

export function startEngine(onLog: (line: string) => void): void {
  if (proc) return
  const bin = engineBin()
  if (!bin) {
    onLog('[engine] 未找到 emby-engine 二进制，请先运行 pnpm run engine:build')
    return
  }
  const url = new URL(getSettings().engineUrl)
  proc = spawn(bin, ['--host', url.hostname, '--port', url.port || '8189'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPEN_EMBY_DATA_ROOT: getSettings().dataRoot }
  })
  proc.stdout?.on('data', (d) => onLog(`[engine] ${String(d).trim()}`))
  proc.stderr?.on('data', (d) => onLog(`[engine] ${String(d).trim()}`))
  proc.on('exit', () => { proc = null })
}

export function stopEngine(): void {
  if (!proc) return
  const pid = proc.pid
  proc = null
  if (!pid) return
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { /* ignore */ }
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`emby-engine ${res.status}: ${url}`)
  return res.json()
}

export async function engineStatus(): Promise<{ reachable: boolean; url: string }> {
  const url = getSettings().engineUrl
  try {
    await fetchJson(`${url}/health`)
    return { reachable: true, url }
  } catch {
    return { reachable: false, url }
  }
}

export async function submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
  const data = await fetchJson(`${getSettings().engineUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  return data.prompt_id as string
}

/** 平涂色块化工作流（制版风格化第一步，纯原生节点，毫秒级）。
 *  双产物：色块层（EmbyColorBlockStylize）+ 线稿层（EmbyLineArtExtract，从色块边界提取）。
 *  节点 id 固定，供渲染进程展示节点级进度。 */
export function buildStylizeWorkflow(imagePath: string, maxColors = 8): Record<string, unknown> {
  return {
    load: { class_type: 'LoadImage', inputs: { image: imagePath } },
    stylize: { class_type: 'EmbyColorBlockStylize', inputs: { image: ['load', 0], max_colors: maxColors, smooth: 1 } },
    lineart: { class_type: 'EmbyLineArtExtract', inputs: { image: ['stylize', 0], thickness: 1 } },
    save: { class_type: 'SaveImage', inputs: { images: ['stylize', 0], filename_prefix: 'open_emby_stylize' } },
    saveLine: { class_type: 'SaveImage', inputs: { images: ['lineart', 0], filename_prefix: 'open_emby_lineart' } }
  }
}

/** 提交工作流并等待完成。通过 /ws 推送节点级进度（借鉴 ComfyUI 前端机制），双层结果转 data URL。 */
export async function stylizeImage(
  localPath: string,
  opts: { maxColors?: number },
  onEvent?: (ev: EngineProgressEvent) => void
): Promise<StylizeResult> {
  const url = getSettings().engineUrl
  const wsUrl = url.replace(/^http/, 'ws') + '/ws'
  const workflow = buildStylizeWorkflow(localPath, opts.maxColors)

  return new Promise<StylizeResult>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let promptId: string | null = null
    let settled = false
    const timer = setTimeout(() => finish(new Error('引擎生成超时（120s）')), 120_000)

    const finish = (err: Error | null, result?: StylizeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws.close() } catch { /* ignore */ }
      if (err) reject(err)
      else resolve(result!)
    }

    const fetchImage = async (pid: string, node: string) => {
      const history = await fetchJson(`${url}/history/${pid}`)
      const imgs = history?.[pid]?.outputs?.[node]?.images
      if (!imgs?.length) throw new Error(`工作流完成但节点 ${node} 无输出图片`)
      const img = imgs[0]
      const res = await fetch(`${url}/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${img.type ?? 'output'}`)
      if (!res.ok) throw new Error(`取结果图失败: ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      return `data:image/png;base64,${buf.toString('base64')}`
    }

    const fetchResult = async (pid: string): Promise<StylizeResult> => ({
      colorBlocks: await fetchImage(pid, 'save'),
      lineArt: await fetchImage(pid, 'saveLine')
    })

    ws.on('open', () => {
      submitWorkflow(workflow)
        .then((pid) => { promptId = pid })
        .catch((e) => finish(new Error('提交工作流失败: ' + String(e))))
    })

    ws.on('message', (raw) => {
      void (async () => {
        try {
          const msg = JSON.parse(String(raw))
          const d = msg.data ?? {}
          if (promptId && d.prompt_id && d.prompt_id !== promptId) return // 只关心本次提交
          switch (msg.type) {
            case 'executing':
              if (d.node == null) break // 全部完成
              onEvent?.({ type: 'executing', nodeId: d.node, classType: (workflow as any)[d.node]?.class_type })
              break
            case 'progress':
              onEvent?.({ type: 'progress', nodeId: d.node, value: d.value, max: d.max })
              break
            case 'executed':
              onEvent?.({ type: 'executed', nodeId: d.node })
              break
            case 'execution_success':
              if (!promptId) break
              try { finish(null, await fetchResult(promptId)) } catch (e) { finish(e as Error) }
              break
            case 'execution_error': {
              const msgText = d.exception_message ?? '未知错误'
              onEvent?.({ type: 'error', message: msgText })
              finish(new Error(msgText))
              break
            }
            case 'execution_interrupted':
              finish(new Error('生成被中断'))
              break
          }
        } catch { /* 忽略非 JSON 帧 */ }
      })()
    })

    ws.on('error', (e) => finish(new Error('引擎 WebSocket 连接失败: ' + String(e))))
  })
}

/** 上传图片到引擎 input 目录（LoadImage 按文件名引用时可用；绝对路径可跳过） */
export async function uploadImage(localPath: string): Promise<string> {
  const fd = new FormData()
  fd.append('image', new Blob([readFileSync(localPath)]), basename(localPath))
  const data = await fetchJson(`${getSettings().engineUrl}/upload/image`, { method: 'POST', body: fd })
  return data.name as string
}
