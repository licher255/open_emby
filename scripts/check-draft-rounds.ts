import assert from 'node:assert/strict'
import { createDraftRound, runDraftRound } from '../src/renderer/src/pages/editor/draftRounds'

async function main() {
  const round = createDraftRound({ originalPath: 'original.png', sourcePath: 'selected.png',
    feedback: '保留绿色眼睛', intent: '保留绿色眼睛', maxColors: 6, style: 'clean' })
  assert.equal(new Set(round.candidates.map(c => c.seed)).size, 4)
  let active = 0, maxActive = 0, calls = 0
  const snapshots: typeof round[] = []
  const first = await runDraftRound(round, async seed => {
    active++; maxActive = Math.max(maxActive, active); calls++
    await new Promise(resolve => setTimeout(resolve, 5)); active--
    if (seed === round.candidates[1].seed) throw new Error('GPU unavailable')
    return `saved-${seed}.png`
  }, async next => { snapshots.push(JSON.parse(JSON.stringify(next))) })
  assert.equal(calls, 4); assert.equal(maxActive, 1)
  assert.equal(first.candidates.filter(c => c.status === 'ready').length, 3)
  assert.equal(first.candidates[1].status, 'error')
  assert.equal(snapshots.length, 8)
  const retried: number[] = []
  const completed = await runDraftRound(first, async seed => { retried.push(seed); return `saved-${seed}.png` }, async () => {})
  assert.deepEqual(retried, [round.candidates[1].seed])
  assert(completed.candidates.every(c => c.status === 'ready'))
  assert.equal(first.candidates[1].status, 'error', 'prior state must not be mutated')
  await assert.rejects(runDraftRound(round, async () => { throw new Error('must not generate') }, async () => { throw new Error('disk full') }), /disk full/)
  assert.throws(() => createDraftRound({ ...round, intent: 'x'.repeat(1501) }), /1500/)
  console.log('PASS: four unique seeds, sequential generation, per-image persistence, partial failure, retry only missing, disk failure, brief limit.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
