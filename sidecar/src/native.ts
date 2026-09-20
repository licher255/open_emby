/** Rust 原生核心 (crates/emby-core) 加载器。
 *  架构约定：性能密集计算（编解码/图像处理/索引）一律走 Rust；TS 只做编排与 IO。
 *  原生模块缺失时抛出明确错误并提示构建命令。 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// dev(tsx/ESM): import.meta 可用；prod(esbuild CJS bundle): import.meta 为空对象，走 EMBY_CORE_NODE
let here = ''
try {
  here = dirname(fileURLToPath(import.meta.url as string))
} catch {
  here = process.cwd()
}
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

export interface StitchPoint {
  x: number // mm，向右
  y: number // mm，向下
  flag: number // 0=stitch 1=jump 2=color_change
  color: number // palette 索引
}
export interface StitchResult {
  points: StitchPoint[]
  palette: string[]
  widthMm: number
  heightMm: number
  stitchCount: number
  colorChanges: number
  backgroundIndex: number
}

interface EmbyCore {
  analyzeImage(path: string, maxColors: number, widthMm: number): AnalysisResult
  generateStitches(imagePath: string, maxColors: number, widthMm: number, minStitchMm: number, maxStitchMm: number, curveToleranceMm: number): StitchResult
  phash(path: string): string
  dstEncode(records: StitchRecord[], name: string): Buffer
  saveResizedPng(src: string, dst: string, size: number): void
  canvasResize(src: string, dst: string, widthMm: number, heightMm: number, mode: string): void
}

let core: EmbyCore | null = null

export function loadCore(): EmbyCore {
  if (core) return core
  const candidates = [
    // 打包后：主进程通过环境变量指向 resources/bin 下的原生模块
    ...(process.env.EMBY_CORE_NODE ? [process.env.EMBY_CORE_NODE] : []),
    join(crateDir, 'emby-core.win32-x64-msvc.node'),
    join(crateDir, 'index.js')
  ]
  for (const c of candidates) {
    if (existsSync(c)) {
      const req = createRequire(join(here, 'noop.js'))
      core = req(c) as EmbyCore
      return core
    }
  }
  throw new Error(
    'emby-core 原生模块未构建。请先执行: cd crates/emby-core && pnpm install && pnpm run build'
  )
}

export const FLAG = { STITCH: 0, JUMP: 1, COLOR: 2 } as const
