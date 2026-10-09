/** Start the locally installed inference service on demand. Models remain outside the application. */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { stopProcessTree } from './processTree'
let processHandle: ChildProcess | null = null
let starting: Promise<void> | null = null
async function available(url: string) {
  try { return (await fetch(url.replace(/\/$/, '') + '/system_stats', { signal: AbortSignal.timeout(1200) })).ok } catch { return false }
}
export function stopComfy() { if (processHandle) stopProcessTree(processHandle); processHandle = null }
export async function ensureComfy(url: string, root: string, pythonOverride?: string, mainOverride?: string) {
  if (await available(url)) return
  if (starting) return starting
  starting = (async () => {
    const target = new URL(url)
    if (!['127.0.0.1', 'localhost'].includes(target.hostname)) throw new Error('图片生成服务暂时无法连接，请检查设置中的服务地址。')
    const python = pythonOverride || join(homedir(), 'Documents/ComfyUI/.venv/Scripts/python.exe')
    const main = mainOverride || ['D:/Comfy-Desktop/ComfyUI-Installs/ComfyUI/ComfyUI/main.py', join(root, 'ComfyUI-master/ComfyUI-master/main.py')].find(existsSync)
    if (!existsSync(python) || !main || !existsSync(main)) throw new Error('图片生成环境尚未配置，请在设置中指定 ComfyUI 的 Python 和 main.py。')
    const folder = join(root, 'engine'); mkdirSync(folder, { recursive: true })
    const modelPaths = join(folder, 'product-model-paths.yaml')
    const homeModels = join(homedir(), 'Documents/ComfyUI/models')
    const homeCustomNodes = join(homedir(), 'Documents/ComfyUI/custom_nodes')
    writeFileSync(modelPaths, `product_models:\n  base_path: ${JSON.stringify(join(root, 'models'))}\n  diffusion_models: unet\n  text_encoders: text_encoders\n  vae: vae\ninstalled_models:\n  base_path: ${JSON.stringify(homeModels)}\n  diffusion_models: diffusion_models\n  text_encoders: text_encoders\n  vae: vae\ninstalled_custom_nodes:\n  custom_nodes: ${JSON.stringify(homeCustomNodes)}\n`)
    const child = spawn(python, [main, '--listen', '127.0.0.1', '--port', target.port || '8188', '--extra-model-paths-config', modelPaths,
      '--input-directory', join(folder, 'input'), '--output-directory', join(folder, 'output'), '--temp-directory', join(folder, 'temp'),
      '--database-url', 'sqlite:///:memory:', '--disable-auto-launch',
      '--disable-all-custom-nodes', '--whitelist-custom-nodes', 'ComfyUI-GGUF', '--disable-api-nodes'],
    { cwd: dirname(main), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    processHandle = child; let failure = ''
    const log = join(folder, 'comfy-product.log')
    child.stdout?.on('data', d => appendFileSync(log, d)); child.stderr?.on('data', d => appendFileSync(log, d))
    child.on('error', e => { failure = e.message }); child.on('exit', code => { failure ||= `进程已退出（${code}）`; if (processHandle === child) processHandle = null })
    for (let i = 0; i < 90; i++) {
      if (await available(url)) return
      if (failure) throw new Error(`图片服务未能启动：${failure}`)
      await new Promise(r => setTimeout(r, 1000))
    }
    throw new Error('图片服务启动较慢，请稍后重试。')
  })().finally(() => { starting = null })
  return starting
}
