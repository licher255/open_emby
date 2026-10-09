// Windows build without napi CLI's hard-link reconciliation (unsupported on some workspace volumes).
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const crate = join(root, 'crates/emby-core')
if (process.platform !== 'win32' || process.arch !== 'x64') {
  const result = spawnSync('pnpm', ['--dir', crate, 'run', 'build'], { stdio: 'inherit' })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
const run = spawnSync('cargo', ['build', '--release', '--manifest-path', join(crate, 'Cargo.toml'), '--target-dir', join(crate, 'target')], { stdio: 'inherit' })
if (run.error) throw run.error
if (run.status !== 0) process.exit(run.status ?? 1)
const binary = 'emby-core.win32-x64-msvc.node'
copyFileSync(join(crate, 'target/release/emby_core.dll'), join(crate, binary))
mkdirSync(join(root, 'build/bin'), { recursive: true })
copyFileSync(join(crate, binary), join(root, 'build/bin', binary))
console.log('Built and copied native core to crate and build/bin.')
