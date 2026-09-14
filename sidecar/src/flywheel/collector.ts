/** 样本采集与策展：inbox -> (phash 去重[Rust] + 评分) -> curated / rejected */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadCore } from '../native.js'
import { scoreSample, type SampleManifest } from './quality.js'

function poolDir(dataRoot: string, pool: string): string {
  const d = join(dataRoot, 'datasets', 'flywheel', pool)
  mkdirSync(d, { recursive: true })
  return d
}

export function saveSample(
  dataRoot: string,
  payload: Partial<SampleManifest>,
  files: Record<string, Buffer>
): { sample_id: string; pool: string } {
  const sampleId = payload.sample_id ?? randomUUID().replaceAll('-', '')
  const dir = join(poolDir(dataRoot, 'inbox'), sampleId)
  mkdirSync(dir, { recursive: true })

  const manifest: SampleManifest = {
    sample_id: sampleId,
    created_at: new Date().toISOString(),
    contributor_id: payload.contributor_id!,
    app_version: payload.app_version ?? 'unknown',
    consent: payload.consent,
    machine: payload.machine!,
    feedback: payload.feedback ?? { edit_rounds: 0, machine_run: 'unknown' },
    phash: '',
    tags: payload.tags ?? []
  } as SampleManifest

  for (const [name, blob] of Object.entries(files)) {
    writeFileSync(join(dir, name), blob)
  }
  // phash（Rust 图像处理）
  const original = join(dir, 'original.png')
  if (existsSync(original)) {
    try { manifest.phash = loadCore().phash(original) } catch { /* 图片缺失时容忍 */ }
  }
  writeFileSync(join(dir, 'sample.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  return { sample_id: sampleId, pool: 'inbox' }
}

export function listSamples(dataRoot: string, pool: string): SampleManifest[] {
  const base = poolDir(dataRoot, pool)
  const out: SampleManifest[] = []
  for (const name of readdirSync(base)) {
    const sj = join(base, name, 'sample.json')
    if (existsSync(sj)) {
      try { out.push(JSON.parse(readFileSync(sj, 'utf-8').replace(/^\uFEFF/, ''))) } catch { /* skip */ }
    }
  }
  return out
}

function hamming(h1: string, h2: string): number {
  if (!h1 || !h2) return 999
  let d = 0
  for (let i = 0; i < Math.min(h1.length, h2.length); i++) {
    let v = parseInt(h1[i], 16) ^ parseInt(h2[i], 16)
    while (v) { d += v & 1; v >>= 1 }
  }
  return d
}

export function curate(dataRoot: string, dupThreshold = 12): Record<string, number> {
  const stats = { curated: 0, rejected: 0, duplicate: 0, low_confidence: 0 }
  const seenHashes = listSamples(dataRoot, 'curated').map((s) => s.phash ?? '')
  for (const manifest of listSamples(dataRoot, 'inbox')) {
    const src = join(poolDir(dataRoot, 'inbox'), manifest.sample_id)
    if (seenHashes.some((h) => hamming(manifest.phash ?? '', h) <= dupThreshold)) {
      renameSync(src, join(poolDir(dataRoot, 'rejected'), manifest.sample_id))
      stats.duplicate++
      continue
    }
    const q = scoreSample(manifest)
    manifest.quality = q
    let dstPool: string
    if (q.verdict === 'rejected') {
      dstPool = 'rejected'
      stats.rejected++
    } else {
      dstPool = 'curated'
      seenHashes.push(manifest.phash ?? '')
      if (q.verdict === 'review') {
        manifest.low_confidence = true
        stats.low_confidence++
      }
      stats.curated++
    }
    writeFileSync(join(src, 'sample.json'), JSON.stringify(manifest, null, 2), 'utf-8')
    renameSync(src, join(poolDir(dataRoot, dstPool), manifest.sample_id))
  }
  return stats
}

export function deleteContributor(dataRoot: string, contributorId: string): number {
  let removed = 0
  for (const pool of ['inbox', 'curated', 'rejected']) {
    for (const s of listSamples(dataRoot, pool)) {
      if (s.contributor_id === contributorId) {
        rmSync(join(poolDir(dataRoot, pool), s.sample_id), { recursive: true, force: true })
        removed++
      }
    }
  }
  return removed
}
