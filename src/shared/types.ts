// 全项目共享类型

export interface EnvStatus {
  comfyui: { reachable: boolean; url: string }
  sidecar: { running: boolean; url: string }
  dataRoot: string // E:/Project-刺绣机
}

/** 制版方案 —— Agent 产出，用户可交互调整 */
export interface DigitizePlan {
  imagePath: string
  maxColors: number
  palette: string[] // 绣线色 hex 列表（量化后）
  regions: StitchRegion[]
  sizeMm: { width: number; height: number }
  notes: string[] // Agent 的解释性说明
}

export interface StitchRegion {
  id: string
  color: string
  stitchType: 'satin' | 'tatami' | 'run' | 'outline'
  density: number // 针距 mm
  angleDeg: number
}

export interface ExportRequest {
  plan: DigitizePlan
  format: 'dst' | 'pes' | 'jef' | 'exp'
  outDir: string
}

export interface ModelInfo {
  id: string
  kind: 'checkpoint' | 'lora' | 'controlnet' | 'gguf'
  path: string
  source?: string // huggingface repo id
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  type: 'workflow' | 'exporter' | 'tool' | 'agent-skill' | 'theme'
  entry: string
  permissions: Array<'fs' | 'net' | 'comfyui' | 'sidecar'>
  contributes?: {
    menus?: Array<{ id: string; label: string }>
    panels?: Array<{ id: string; title: string }>
  }
}

/** 数据飞轮：授权设置 */
export interface ContributionConsent {
  enabled: boolean
  scope: 'off' | 'local_only' | 'anonymous_training'
  contributorId: string // 本机随机 UUID，匿名、非账号
  grantedAt?: string // ISO8601
}

/** 数据飞轮：样本清单（sample.json） */
export interface SampleManifest {
  sample_id: string
  created_at: string
  contributor_id: string
  app_version: string
  consent: { scope: ContributionConsent['scope']; granted_at: string }
  machine: {
    format: 'dst' | 'pes' | 'jef' | 'exp'
    size_mm: [number, number]
    stitch_count: number
    color_changes: number
  }
  feedback: {
    rating?: number // 1-5，可选
    edit_rounds: number
    machine_run: 'success' | 'failed' | 'unknown'
    failure_reason?: string | null
  }
  phash?: string
  tags: string[]
}

export interface AppSettings {
  contribution: ContributionConsent
  dataRoot: string // 默认 E:/Project-刺绣机
  comfyuiUrl: string
  comfyuiExe: string // D:/comfyui/ComfyUI.exe
  comfyCheckpoint: string // ComfyUI 中的底模文件名
  sidecarUrl: string
}
