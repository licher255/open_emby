/** 制版专家 Agent —— 工具调用循环（编排层 TS；图像分析走 Rust）。
 *  MVP 为规则式决策；后续接入本地 GGUF 小模型做开放式意图理解。 */
import { loadCore, type AnalysisResult } from '../native.js'

export interface DigitizePlanResult {
  imagePath: string
  maxColors: number
  palette: string[]
  regions: unknown[]
  sizeMm: { width: number; height: number }
  notes: string[]
}

export function plan(imagePath: string, intent: string, maxColors: number, widthMm: number): DigitizePlanResult {
  const a: AnalysisResult = loadCore().analyzeImage(imagePath, maxColors, widthMm)
  const notes = [
    `量化到 ${a.palette.length} 色（上限 ${maxColors}）`,
    '默认针法策略: 大面积→tatami, 细长区→satin, 轮廓→run'
  ]
  if (intent) notes.push(`用户意图: ${intent}（LLM 理解模块待接入）`)
  return {
    imagePath,
    maxColors,
    palette: a.palette,
    regions: a.regions,
    sizeMm: { width: a.widthMm, height: a.heightMm },
    notes
  }
}
