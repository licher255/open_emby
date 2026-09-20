/** emby-engine 服务：守护进程 + ComfyUI 兼容 API 客户端。
 *  引擎是 crates/emby-engine 编译出的 Rust 二进制，借鉴 ComfyUI 后端架构
 *  （/prompt 队列、/history、/view、/ws 节点级进度），替代原先对外部 ComfyUI 的调用。 */
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { basename, join } from 'path'
import WebSocket from 'ws'
import type { EngineProgressEvent } from '@shared/types'
import { getSettings } from './settings'
import { stopProcessTree } from './processTree'

let proc: ChildProcess | null = null
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 引擎二进制位置（dev: cargo target；prod: 打包进 resources/bin） */
function engineBin(): string | null {
  const candidates = [
    join(__dirname, '../../build/bin/emby-engine.exe'),
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
    detached: process.platform !== 'win32',
    env: { ...process.env, OPEN_EMBY_DATA_ROOT: getSettings().dataRoot }
  })
  proc.stdout?.on('data', (d) => onLog(`[engine] ${String(d).trim()}`))
  proc.stderr?.on('data', (d) => onLog(`[engine] ${String(d).trim()}`))
  proc.on('exit', () => { proc = null })
}

export function stopEngine(): void {
  if (!proc) return
  const child = proc
  proc = null
  stopProcessTree(child)
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`emby-engine ${res.status}: ${url}${detail ? ` — ${detail.slice(0, 300)}` : ''}`)
  }
  return res.json()
}

async function ensureEngineReady(): Promise<void> {
  if (!proc) startEngine(() => {})
  const url = getSettings().engineUrl
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(300) })
      if (response.ok) return
    } catch { /* service is still starting */ }
    await delay(100)
  }
  throw new Error('emby-engine 启动超时')
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
  await ensureEngineReady()
  const data = await fetchJson(`${getSettings().engineUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  return data.prompt_id as string
}

/** 色块工作流：先去除边缘连通背景，再平滑限色；线稿存在时作为闭合区域引导。 */
export function buildColorBlocksWorkflow(imagePath: string, lineArtPath?: string | null, maxColors = 8): Record<string, unknown> {
  const workflow: Record<string, unknown> = {
    load: { class_type: 'LoadImage', inputs: { image: imagePath } },
    background: { class_type: 'EmbyBackgroundRemove', inputs: { image: ['load', 0], tolerance: 24 } }
  }
  if (lineArtPath) {
    workflow.loadLine = { class_type: 'LoadImage', inputs: { image: lineArtPath } }
    workflow.blocks = { class_type: 'EmbyColorBlockFromLineArt', inputs: { image: ['background', 0], line_art: ['loadLine', 0], max_colors: maxColors, smooth: 3 } }
  } else {
    workflow.blocks = { class_type: 'EmbyColorBlockStylize', inputs: { image: ['background', 0], max_colors: maxColors, smooth: 3 } }
  }
  workflow.saveBlocks = { class_type: 'SaveImage', inputs: { images: ['blocks', 0], filename_prefix: 'open_emby_blocks' } }
  return workflow
}

/** 线稿工作流：只读取当前色块，独立提取边界。 */
export function buildLineArtWorkflow(colorBlocksPath: string): Record<string, unknown> {
  return {
    loadBlocks: { class_type: 'LoadImage', inputs: { image: colorBlocksPath } },
    lineart: { class_type: 'EmbyLineArtExtract', inputs: { image: ['loadBlocks', 0], thickness: 1, contrast: 1 } },
    saveLine: { class_type: 'SaveImage', inputs: { images: ['lineart', 0], filename_prefix: 'open_emby_lineart' } }
  }
}

/** 提交单产物工作流并等待完成，通过 /ws 推送节点级进度。 */
async function runImageWorkflow(
  workflow: Record<string, unknown>,
  outputNode: string,
  onEvent?: (ev: EngineProgressEvent) => void
): Promise<string> {
  await ensureEngineReady()
  const url = getSettings().engineUrl
  const wsUrl = url.replace(/^http/, 'ws') + '/ws'

  return new Promise<string>((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let promptId: string | null = null
    let settled = false
    const timer = setTimeout(() => finish(new Error('引擎生成超时（120s）')), 120_000)

    const finish = (err: Error | null, result?: string) => {
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
              try { finish(null, await fetchImage(promptId, outputNode)) } catch (e) { finish(e as Error) }
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

export function generateColorBlocks(
  imagePath: string,
  opts: { lineArtPath?: string | null; maxColors?: number },
  onEvent?: (ev: EngineProgressEvent) => void
): Promise<string> {
  return runImageWorkflow(buildColorBlocksWorkflow(imagePath, opts.lineArtPath, opts.maxColors), 'saveBlocks', onEvent)
}

export function generateLineArt(
  colorBlocksPath: string,
  onEvent?: (ev: EngineProgressEvent) => void
): Promise<string> {
  return runImageWorkflow(buildLineArtWorkflow(colorBlocksPath), 'saveLine', onEvent)
}

/** 上传图片到引擎 input 目录（LoadImage 按文件名引用时可用；绝对路径可跳过） */
export async function uploadImage(localPath: string): Promise<string> {
  await ensureEngineReady()
  const fd = new FormData()
  fd.append('image', new Blob([readFileSync(localPath)]), basename(localPath))
  const data = await fetchJson(`${getSettings().engineUrl}/upload/image`, { method: 'POST', body: fd })
  return data.name as string
}
