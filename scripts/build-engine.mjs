import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = join(root, 'crates', 'emby-engine', 'Cargo.toml')
const result = spawnSync('cargo', ['build', '--release', '--manifest-path', manifest], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (result.status !== 0) process.exit(result.status ?? 1)

const executable = `emby-engine${process.platform === 'win32' ? '.exe' : ''}`
const source = join(root, 'crates', 'emby-engine', 'target', 'release', executable)
const destination = join(root, 'build', 'bin', executable)
mkdirSync(dirname(destination), { recursive: true })
copyFileSync(source, destination)
console.log(`Engine copied to ${destination}`)
