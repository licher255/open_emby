/** 训练数据准备：curated 样本 -> datasets/processed（LoRA 微调格式）。
 *  Track A (风格 LoRA): artwork.png 缩放(Rust) + 同名 .txt caption
 *  Track B (制版策略): plan.json + feedback 汇总 strategy_records.jsonl
 *  注：微调执行器（kohya 等）是唯一允许的 Python 环节，独立隔离于训练工具链。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadCore } from '../native.js'

function readJson(p: string): any {
  return JSON.parse(readFileSync(p, 'utf-8').replace(/^\uFEFF/, ''))
}

function caption(manifest: any): string {
  const parts = ['embroidery', 'stitched thread texture']
  const tags: string[] = manifest.tags ?? []
  if (tags.length) parts.push(tags.join(', '))
  const colors = manifest.plan?.palette?.length
  if (colors) parts.push(`${colors} colors`)
  return parts.join(', ')
}

export function prepare(dataRoot: string, size = 1024): Record<string, unknown> {
  const curated = join(dataRoot, 'datasets', 'flywheel', 'curated')
  const processed = join(dataRoot, 'datasets', 'processed')
  const stitchPairs = join(dataRoot, 'datasets', 'stitch_pairs')
  mkdirSync(processed, { recursive: true })
  mkdirSync(stitchPairs, { recursive: true })

  let nImages = 0, nStrategy = 0
  const strategyFile = join(stitchPairs, 'strategy_records.jsonl')

  if (existsSync(curated)) {
    for (const name of readdirSync(curated)) {
      const dir = join(curated, name)
      const sj = join(dir, 'sample.json')
      if (!existsSync(sj)) continue
      const manifest = readJson(sj)
      const sid = manifest.sample_id

      // Track A
      const artwork = join(dir, 'artwork.png')
      const dstImg = join(processed, `${sid}.png`)
      if (existsSync(artwork) && !existsSync(dstImg)) {
        loadCore().saveResizedPng(artwork, dstImg, size)
        writeFileSync(join(processed, `${sid}.txt`), caption(manifest), 'utf-8')
        nImages++
      }

      // Track B
      const plan = join(dir, 'plan.json')
      if (existsSync(plan)) {
        appendFileSync(strategyFile, JSON.stringify({
          sample_id: sid,
          plan: readJson(plan),
          feedback: manifest.feedback ?? {},
          quality: manifest.quality ?? {},
          machine: manifest.machine ?? {}
        }) + '\n', 'utf-8')
        nStrategy++
      }
    }
  }
  return { lora_images: nImages, strategy_records: nStrategy, processed_dir: processed, strategy_file: strategyFile }
}

export function stats(dataRoot: string): Record<string, unknown> {
  const out: Record<string, any> = { pools: {}, rating_dist: {}, tag_dist: {} }
  for (const pool of ['inbox', 'curated', 'rejected']) {
    const d = join(dataRoot, 'datasets', 'flywheel', pool)
    const samples = existsSync(d) ? readdirSync(d).filter((n) => existsSync(join(d, n, 'sample.json'))) : []
    out.pools[pool] = samples.length
    if (pool === 'curated') {
      for (const n of samples) {
        const m = readJson(join(d, n, 'sample.json'))
        const r = m.feedback?.rating
        if (r) out.rating_dist[String(r)] = (out.rating_dist[String(r)] ?? 0) + 1
        for (const t of m.tags ?? []) out.tag_dist[t] = (out.tag_dist[t] ?? 0) + 1
      }
    }
  }
  return out
}
