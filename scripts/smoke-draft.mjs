// Runs the same Electron backend service with only settings replaced for a CLI check.
import { build } from '../sidecar/node_modules/esbuild/lib/main.js'
import { createRequire } from 'node:module'
import { writeFile, mkdir, readdir, copyFile, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

const root = resolve(process.argv[2] || '..')
const out = join(root, 'doc/backend-draft-tests')
const maxColors = Number(process.argv[3] ?? 8)
await mkdir(out, { recursive: true })
const bundled = await build({
  entryPoints: ['src/main/services/engine.ts'], bundle: true, platform: 'node', format: 'cjs', write: false,
  plugins: [{ name: 'cli-settings', setup(b) {
    b.onResolve({ filter: /^\.\/settings$/ }, () => ({ path: 'settings', namespace: 'cli' }))
    b.onLoad({ filter: /.*/, namespace: 'cli' }, () => ({ contents: `export const getSettings = () => (${JSON.stringify({ dataRoot: root, engineUrl: 'http://127.0.0.1:8189', comfyUrl: 'http://127.0.0.1:8188', draftBackend: 'qwen' })})` }))
  } }]
})
const bundlePath = join(out, 'backend.cjs')
await writeFile(bundlePath, bundled.outputFiles[0].contents)
const { generateColorBlocks, generateLineArt } = createRequire(import.meta.url)(bundlePath)
const records = []
for (const name of ['astronaut', 'cat', 'china']) {
  const input = join(root, `doc/prompt-tests/inputs/${name}.png`)
  const started = Date.now()
  console.log(`START ${name}`)
  const before = new Set(await readdir(join(root, 'engine/drafts')).catch(() => []))
  const { colorBlocks: blocks, draft } = await generateColorBlocks(input, { maxColors }, ev => console.log(name, ev.type, ev.nodeId ?? ev.message))
  if (!draft) throw new Error('Backend did not return the original AI draft')
  await writeFile(join(out, `${name}-draft.png`), Buffer.from(draft.split(',')[1], 'base64'))
  const blocksPath = join(out, `${name}-blocks.png`)
  await writeFile(blocksPath, Buffer.from(blocks.split(',')[1], 'base64'))
  const line = await generateLineArt(blocksPath)
  await writeFile(join(out, `${name}-line.png`), Buffer.from(line.split(',')[1], 'base64'))
  const dirs = (await readdir(join(root, 'engine/drafts'))).filter(d => !before.has(d))
  for (const d of dirs) {
    const folder = join(root, 'engine/drafts', d)
    const request = JSON.parse(await readFile(join(folder, 'request.json'), 'utf8'))
    if (request.imagePath !== input) continue
    await copyFile(join(folder, 'draft.png'), join(out, `${name}-draft.png`))
    await copyFile(join(folder, 'request.json'), join(out, `${name}-request.json`))
  }
  records.push({ name, maxColors, seconds: Math.round((Date.now() - started) / 1000), blocksPath })
  await writeFile(join(out, 'results.json'), JSON.stringify(records, null, 2))
  console.log('DONE', records.at(-1))
}
console.log('Results:', pathToFileURL(join(out, 'results.json')).href)
const guided = await generateColorBlocks(join(root, 'doc/prompt-tests/inputs/cat.png'), { lineArtPath: join(out, 'cat-line.png'), maxColors })
assert.equal(guided.draft, undefined, 'Line-guided recoloring must not redraw geometry with AI')
assert.ok(guided.colorBlocks.startsWith('data:image/png;base64,'))
console.log('Line-guided recoloring also passed (no AI redraw).')
