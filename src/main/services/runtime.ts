/** Hardware probe and managed model server lifecycle (Rust emby-engine). */
import { getSettings } from './settings'
import type { RuntimeDevices, RuntimeServer } from '@shared/types'

function base(): string {
  return getSettings().engineUrl.replace(/\/$/, '')
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 30000): Promise<T> {
  let res: Response
  try {
    res = await fetch(base() + path, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(`emby-engine is unreachable: ${String(error)}`)
  }
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export function runtimeDevices(): Promise<RuntimeDevices> {
  return call('/api/runtime/devices')
}

export function runtimeServers(): Promise<RuntimeServer[]> {
  return call('/api/runtime/servers')
}

export function startServer(modelId: string): Promise<RuntimeServer> {
  return call(`/api/runtime/servers/${encodeURIComponent(modelId)}/start`, { method: 'POST' }, 300000)
}

export function stopServer(modelId: string): Promise<RuntimeServer> {
  return call(`/api/runtime/servers/${encodeURIComponent(modelId)}/stop`, { method: 'POST' }, 60000)
}
