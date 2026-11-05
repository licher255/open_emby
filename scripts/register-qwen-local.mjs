// Register existing Qwen 2.1 weights and an installed inference runtime without
// copying weights, downloading models, or modifying the ComfyUI installation.
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const [rootArg, pythonArg, mainArg, modelsArg] = process.argv.slice(2)
if (![rootArg, pythonArg, mainArg, modelsArg].every(Boolean)) {
  throw new Error('Usage: node scripts/register-qwen-local.mjs DATA_ROOT PYTHON COMFY_MAIN COMFY_MODELS')
}
const root = resolve(rootArg), python = resolve(pythonArg), main = resolve(mainArg), models = resolve(modelsArg)
const paths = [
  join(models, 'diffusion_models/qwen_image_2.1_int8_convrot.safetensors'),
  join(models, 'text_encoders/qwen3vl_8b_int8_convrot.safetensors'),
  join(models, 'vae/qwen_image_2.1_vae_bf16.safetensors')
]
for (const path of [python, main, ...paths]) {
  if (!existsSync(path) || !statSync(path).isFile() || !statSync(path).size) throw new Error(`Missing: ${path}`)
}
const dir = join(root, 'models/runtime/qwen-image-2.1-local')
mkdirSync(dir, { recursive: true })
mkdirSync(join(root, 'runtime'), { recursive: true })
writeFileSync(join(dir, 'manifest.json'), JSON.stringify({
  id: 'qwen-image-2.1-local', name: 'Qwen Image 2.1 · 本地已验证',
  family: 'qwen-image-2.1', runtime: 'comfy-ui',
  description: 'doc/prompt-tests baseline: reference-conditioned image editing, 20 steps, CFG 1, Euler/simple, 512².',
  tags: ['local', 'image-edit', 'doc-baseline'],
  files: paths.map(name => ({ name, url: '', bytes: statSync(name).size })),
  defaults: { steps: 20, cfgScale: 1, width: 512, height: 512, negative: '' }
}, null, 2) + '\n')
writeFileSync(join(root, 'runtime/comfy.json'), JSON.stringify({ python, main }, null, 2) + '\n')
const providersPath = join(root, 'engine/ai/providers.json')
const providers = existsSync(providersPath) ? JSON.parse(readFileSync(providersPath, 'utf8')) : []
let local = providers.find(p => p.id === 'local')
if (!local) { local = { id: 'local', name: '本地运行时', kind: 'local' }; providers.push(local) }
Object.assign(local, { kind: 'local', enabled: true, imageModel: 'qwen-image-2.1-local' })
mkdirSync(join(root, 'engine/ai'), { recursive: true })
writeFileSync(providersPath, JSON.stringify(providers, null, 2) + '\n')
console.log(`Registered and pinned Qwen 2.1 at ${dir}; existing weights referenced in place.`)
