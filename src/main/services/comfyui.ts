import { getSettings } from './settings'

/** ComfyUI 连接器：REST + WebSocket(进度) */
async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`ComfyUI ${res.status}: ${url}`)
  return res.json()
}

export async function comfyStatus(): Promise<{ reachable: boolean; url: string }> {
  const url = getSettings().comfyuiUrl
  try {
    await fetchJson(`${url}/system_stats`)
    return { reachable: true, url }
  } catch {
    return { reachable: false, url }
  }
}

/** 提交工作流 prompt JSON，返回 prompt_id；进度经 WebSocket 由 ipc 层推送 */
export async function submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
  const url = getSettings().comfyuiUrl
  const data = await fetchJson(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow })
  })
  return data.prompt_id as string
}
