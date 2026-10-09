import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDraftWorkflow, generateDraft } from '../src/main/services/draft'

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'emby-draft-check-'))
  const input = join(dir, 'input.png')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9S8AAAAASUVORK5CYII=', 'base64')
  await writeFile(input, png)
  let mode = 'success'
  let submitted: ReturnType<typeof buildDraftWorkflow>
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk)
    let data: unknown = {}
    if (req.url === '/object_info') data = mode === 'missing' ? {} : Object.fromEntries(Object.values(buildDraftWorkflow('x')).map(n => [n.class_type, {}]))
    if (req.url === '/upload/image') data = { name: 'uploaded.png', subfolder: 'incoming' }
    if (req.url === '/prompt') {
      submitted = JSON.parse(Buffer.concat(chunks).toString()).prompt
      data = { prompt_id: 'own-task' }
    }
    if (req.url === '/history/own-task') data = { 'unrelated-task': { outputs: {} }, 'own-task': mode === 'error'
      ? { status: { status_str: 'error', messages: ['out of memory'] } }
      : { status: { completed: true }, outputs: { save: { images: [{ filename: 'result.png' }] } } } }
    if (req.url?.startsWith('/view?')) { res.end(png); return }
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(data))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  const opts = { url: `http://127.0.0.1:${port}`, dataRoot: dir, maxColors: 6 }
  try {
    const result = await generateDraft(input, opts)
    assert.deepEqual(await readFile(result), png)
    assert.equal(submitted!.load.inputs.image, 'incoming/uploaded.png')
    assert.match(String(submitted!.text.inputs.prompt), /6种主要颜色/)
    assert.match(String(submitted!.text.inputs.prompt), /避免：/)
    assert.equal(submitted!.sample.inputs.cfg, 1)
    const soft = buildDraftWorkflow('x', 6, 42, '保留眼睛', 'soft')
    assert.match(String(soft.text.inputs.prompt), /圆润、简洁的平面插画/)
    assert.match(String(soft.text.inputs.prompt), /6种主要颜色/)
    assert.match(String(soft.text.inputs.prompt), /保留眼睛/)
    assert.throws(() => buildDraftWorkflow('x', 1))
    mode = 'error'
    await assert.rejects(generateDraft(input, opts), /out of memory/)
    mode = 'missing'
    await assert.rejects(generateDraft(input, opts), /缺少节点/)
    mode = 'success'
    await assert.rejects(generateDraft(input, { ...opts, timeoutMs: 0 }), /队列/)
    console.log('Draft checks passed: upload, prompt, output, validation, failure, missing nodes, timeout.')
  } finally {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(dir, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
