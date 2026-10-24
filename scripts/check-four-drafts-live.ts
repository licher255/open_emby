import { mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join } from 'node:path'
import { generateDraft } from '../src/main/services/draft'
import { ensureComfy, stopComfy } from '../src/main/services/comfy'
import { createDraftRound, runDraftRound } from '../src/renderer/src/pages/editor/draftRounds'

async function main() {
  const root = resolve('..'), out = join(root, 'doc/four-choice-tests/live')
  mkdirSync(out, { recursive: true })
  const input = join(root, 'doc/prompt-tests/inputs/cat.png'), url = 'http://127.0.0.1:8188'
  try {
    await ensureComfy(url, root)
    const queue = await (await fetch(url + '/queue')).json()
    if (queue.queue_running?.length || queue.queue_pending?.length) throw new Error('Existing model jobs are running; live test deferred.')
    const round = createDraftRound({ originalPath: input, sourcePath: input, feedback: '', intent: '猫的头部肖像，保留绿色眼睛，简化毛发碎纹。', maxColors: 6, style: 'soft' })
    const started = Date.now()
    const result = await runDraftRound(round, async seed => {
      const index = round.candidates.findIndex(c => c.seed === seed) + 1
      console.log(`Generating ${index}/4, seed ${seed}`)
      const path = await generateDraft(input, { url, dataRoot: root, seed, maxColors: round.maxColors, style: round.style, intent: round.intent })
      const target = join(out, `option-${index}.png`); copyFileSync(path, target)
      console.log(`Saved ${index}/4`)
      return target
    }, async next => { writeFileSync(join(out, 'round.json'), JSON.stringify(next, null, 2)) })
    const ready = result.candidates.filter(c => c.status === 'ready')
    const hashes = ready.map(c => createHash('sha256').update(readFileSync(c.path!)).digest('hex'))
    const summary = { passed: ready.length === 4 && new Set(hashes).size === 4, seconds: (Date.now() - started) / 1000, ready: ready.length, distinctImageHashes: new Set(hashes).size, hashes, mockedInference: false }
    writeFileSync(join(out, 'result.json'), JSON.stringify(summary, null, 2))
    console.log(summary)
    if (!summary.passed) throw new Error('Four distinct outputs were not produced; inspect round.json')
  } finally { stopComfy() }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
