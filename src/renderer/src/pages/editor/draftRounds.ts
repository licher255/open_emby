import type { DraftRound } from '@shared/types'

export function createDraftRound(input: Omit<DraftRound, 'id' | 'createdAt' | 'candidates'>): DraftRound {
  if (input.intent.length > 1500) throw new Error('设计要求合计请控制在 1500 字以内 / Keep the combined brief under 1500 characters.')
  const seeds = new Set<number>()
  while (seeds.size < 4) seeds.add(crypto.getRandomValues(new Uint32Array(1))[0])
  return { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    candidates: [...seeds].map(seed => ({ id: crypto.randomUUID(), seed, status: 'queued' })) }
}

/** Sequential requests keep a four-choice round within a single GPU's memory budget.
 * Checkpoints fail fast on disk errors; model failures retain other candidates. */
export async function runDraftRound(round: DraftRound, generate: (seed: number, requestId: string, retry: boolean) => Promise<string>,
  checkpoint: (next: DraftRound) => Promise<void>): Promise<DraftRound> {
  let next: DraftRound = { ...round, candidates: round.candidates.map(c => ({ ...c })) }
  for (let i = 0; i < next.candidates.length; i++) {
    if (next.candidates[i].status === 'ready') continue
    const retry = next.candidates[i].status === 'error'
    next = { ...next, candidates: next.candidates.map((c, j) => j === i ? { ...c, status: 'generating', error: undefined } : c) }
    await checkpoint(next)
    try {
      const path = await generate(next.candidates[i].seed, next.candidates[i].id, retry)
      next = { ...next, candidates: next.candidates.map((c, j) => j === i ? { ...c, status: 'ready', path } : c) }
    } catch (error) {
      next = { ...next, candidates: next.candidates.map((c, j) => j === i ? { ...c, status: 'error', error: String(error) } : c) }
    }
    await checkpoint(next)
  }
  return next
}
