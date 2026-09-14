/** Rust 原生核心 (crates/emby-core) 加载器。
 *  架构约定：性能密集计算（编解码/图像处理/索引）一律走 Rust；TS 只做编排与 IO。
 *  原生模块缺失时抛出明确错误并提示构建命令。 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const crateDir = join(here, '..', '..', 'crates', 'emby-core')

export interface StitchRegion {
  id: string
  color: string
  stitchType: string
  density: number
  angleDeg: number
}
export interface AnalysisResult {
  palette: string[]
  regions: StitchRegion[]
  widthMm: number
  heightMm: number
}
export interface StitchRecord { dxMm: number; dyMm: number; flag: number }

interface EmbyCore {
  analyzeImage(path: string, maxColors: number, widthMm: number): AnalysisResult
  phash(path: string): string
  dstEncode(records: StitchRecord[], name: string): Buffer
  saveResizedPng(src: string, dst: string, size: number): void
}

let core: EmbyCore | null = null

export function loadCore(): EmbyCore {
  if (core) return core
  const candidates = [
    join(crateDir, 'emby-core.win32-x64-msvc.node'),
    join(crateDir, 'index.js')
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const req = createRequire(import.meta.url)
      core = req(c) as EmbyCore
      return core
    }
  }
  throw new Error(
    'emby-core 原生模块未构建。请先执行: cd crates/emby-core && pnpm install && pnpm run build'
  )
}

export const FLAG = { STITCH: 0, JUMP: 1, COLOR: 2 } as const
