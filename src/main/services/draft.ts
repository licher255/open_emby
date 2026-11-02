/** Draft generation: goes through the engine's stylize harness; the provider decides cloud or local. */
import type { StylizeHarnessResult } from '../../shared/types'

export interface DraftOptions {
  engineUrl: string
  maxColors?: number
  seed?: number
  intent?: string
  style?: 'clean' | 'soft'
  providerId?: string
  modelId?: string
  widthMm?: number
  requestId?: string
  retry?: boolean
}

export async function generateDraft(imagePath: string, opts: DraftOptions): Promise<StylizeHarnessResult> {
  const base = opts.engineUrl.replace(/\/$/, '')
  const url = base + '/api/harness/stylize/jobs'
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imagePath,
        requestId: opts.requestId,
        retry: opts.retry ?? false,
        maxColors: opts.maxColors ?? 8,
        seed: opts.seed ?? -1,
        intent: opts.intent ?? '',
        style: opts.style ?? 'clean',
        providerId: opts.providerId,
        modelId: opts.modelId,
        widthMm: opts.widthMm
      }),
      signal: AbortSignal.timeout(30_000)
    })
  } catch (error) {
    throw new Error(`cannot reach emby-engine: ${String(error)}`)
  }
  const text = await res.text()
  if (!res.ok) {
    let detail = text
    try { detail = JSON.parse(text)?.error ?? text } catch { /* keep the raw body */ }
    throw new Error(`stylize failed: ${detail}`)
  }
  const submitted = JSON.parse(text) as { id: string }
  if (!submitted.id) throw new Error('Engine returned no task id')
  const deadline = Date.now() + 30 * 60_000
  while (Date.now() < deadline) {
    let status: Response
    try {
      status = await fetch(`${base}/api/harness/jobs/${encodeURIComponent(submitted.id)}`, { signal: AbortSignal.timeout(15_000) })
    } catch {
      // Polling is safe to retry because generation belongs to the durable job.
      await new Promise(resolve => setTimeout(resolve, 1000))
      continue
    }
    if (!status.ok) throw new Error(`Cannot read draft task ${submitted.id}: HTTP ${status.status}`)
    const job = await status.json() as { phase: string; result?: StylizeHarnessResult; error?: string }
    if (job.phase === 'succeeded' && job.result) return job.result
    if (!['queued', 'running'].includes(job.phase)) throw new Error(`Draft task ${submitted.id}: ${job.error ?? job.phase}`)
    await new Promise(resolve => setTimeout(resolve, 350))
  }
  throw new Error(`Draft task ${submitted.id} is still pending. Its result can be retrieved from ${base}/api/harness/jobs/${submitted.id}`)
}
