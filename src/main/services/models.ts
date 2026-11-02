/** Model + AI gateway service. All state lives in the Rust engine; this file only forwards HTTP. */
import { getSettings } from './settings'
import type {
  AiProvider, AiStatus, InstalledModelInfo, ModelCatalogItem, ModelInstallStatus
} from '@shared/types'

export interface ImportUrlBody {
  url: string
  id?: string
  name?: string
  family?: string
}

export interface ImportLocalBody {
  files: string[]
  id?: string
  name?: string
  family?: string
}

function base(): string {
  return getSettings().engineUrl.replace(/\/$/, '')
}

async function call<T>(path: string, init?: RequestInit, timeoutMs = 15000): Promise<T> {
  let res: Response
  try {
    res = await fetch(base() + path, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new Error(`emby-engine is unreachable: ${String(error)}. Check that the engine is running.`)
  }
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : null } catch { /* non-JSON error body */ }
  if (!res.ok) throw new Error(data?.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

export interface ModelsOverview {
  installed: InstalledModelInfo[]
  catalog: Array<{ manifest: ModelCatalogItem['manifest']; installed: boolean }>
}

export function listModelState(): Promise<ModelsOverview> {
  return call('/api/models')
}

export function startModelInstall(id: string): Promise<{ job: string }> {
  return call('/api/models/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }, 30000)
}

export function modelInstallStatus(job: string): Promise<ModelInstallStatus> {
  return call(`/api/models/install/${encodeURIComponent(job)}`)
}

export function cancelModelInstall(job: string): Promise<{ ok: boolean }> {
  return call(`/api/models/install/${encodeURIComponent(job)}/cancel`, { method: 'POST' })
}

export function removeModel(id: string): Promise<{ ok: boolean }> {
  return call('/api/models/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  }, 60000)
}

export function importModelUrl(body: ImportUrlBody): Promise<{ job: string; model: ModelCatalogItem['manifest'] }> {
  return call('/api/models/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 30000)
}

export function importLocalModel(body: ImportLocalBody): Promise<{ installed: ModelCatalogItem['manifest']; dir: string }> {
  return call('/api/models/import-local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 120000)
}

export function aiGatewayStatus(): Promise<AiStatus> {
  return call('/api/ai/status')
}

export function saveProvider(provider: AiProvider): Promise<{ providers: AiProvider[] }> {
  return call('/api/ai/providers', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(provider)
  })
}

export function deleteProvider(id: string): Promise<{ providers: AiProvider[] }> {
  return call(`/api/ai/providers/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function testProvider(id: string): Promise<{ ok: boolean; detail: string }> {
  return call(`/api/ai/providers/${encodeURIComponent(id)}/test`, { method: 'POST' }, 30000)
}
