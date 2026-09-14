/** 样本质量评分：决定样本进 curated 还是 rejected（纯函数，TS 编排层）。
 *  score = 0.35*机器结果 + 0.25*用户评分 + 0.20*工艺合理性 + 0.20*一次到位率 */
export interface SampleMachine {
  format: string
  size_mm: [number, number]
  stitch_count: number
  color_changes: number
}
export interface SampleFeedback {
  rating?: number
  edit_rounds: number
  machine_run: 'success' | 'failed' | 'unknown'
  failure_reason?: string | null
}
export interface SampleManifest {
  sample_id: string
  contributor_id: string
  machine: SampleMachine
  feedback: SampleFeedback
  phash?: string
  tags?: string[]
  quality?: QualityResult
  low_confidence?: boolean
  [k: string]: unknown
}
export interface QualityResult {
  score: number
  verdict: 'curated' | 'review' | 'rejected'
  parts: Record<string, number>
}

const MAX_STITCH_DENSITY_PER_CM2 = 400
const MAX_COLOR_CHANGES = 15

function machineScore(run: string): number {
  return run === 'success' ? 1.0 : run === 'failed' ? 0.0 : 0.5
}

function craftScore(m: SampleMachine): number {
  const areaCm2 = Math.max(1, (m.size_mm[0] * m.size_mm[1]) / 100)
  let score = 1.0
  if (m.stitch_count / areaCm2 > MAX_STITCH_DENSITY_PER_CM2) score -= 0.5
  if (m.color_changes > MAX_COLOR_CHANGES) score -= 0.3
  return Math.max(0, score)
}

export function scoreSample(manifest: SampleManifest): QualityResult {
  const fb = manifest.feedback
  const rating = typeof fb.rating === 'number' ? (fb.rating - 1) / 4 : 0.5
  const parts = {
    machine: machineScore(fb.machine_run),
    rating,
    craft: craftScore(manifest.machine),
    first_pass: 1 / (1 + (fb.edit_rounds ?? 0))
  }
  const score = 0.35 * parts.machine + 0.25 * parts.rating + 0.2 * parts.craft + 0.2 * parts.first_pass
  const verdict = score >= 0.7 ? 'curated' : score >= 0.4 ? 'review' : 'rejected'
  return { score: Math.round(score * 1000) / 1000, verdict, parts }
}
