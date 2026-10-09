// 全项目共享类型

export interface EnvStatus {
  engine: { reachable: boolean; url: string } // emby-engine（Rust 生成引擎，ComfyUI 架构）
  sidecar: { running: boolean; url: string }
  dataRoot: string // E:/Project-刺绣机
  version: string // 应用版本（package.json）
}

/** 初稿与后处理结果（data URL） */
export interface ColorBlocksResult {
  colorBlocks: string // data URL
  draft?: string // 原始 AI 初稿 data URL，保留细节供用户继续编辑
}

/** 引擎节点执行进度事件（main -> renderer，借鉴 ComfyUI WS 消息） */
export interface EngineProgressEvent {
  type: 'status' | 'executing' | 'progress' | 'executed' | 'error'
  nodeId?: string | null
  classType?: string
  message?: string
  value?: number
  max?: number
}

/** 制版方案 —— Agent 产出，用户可交互调整 */
export interface DigitizePlan extends ArtworkObjects {
  imagePath: string
  maxColors: number
  palette: string[] // 绣线色 hex 列表（量化后）
  regions: StitchRegion[]
  sizeMm: { width: number; height: number }
  notes: string[] // Agent 的解释性说明
  intent?: string
  fabric?: 'woven' | 'knit'
  sourceHash?: string
}

export interface ArtworkObjects {
  routeTravel?: boolean
  directionField?: { width: number; height: number; cos2: number[]; sin2: number[]; confidence: number[] }
  directionGuides?: Array<{ kind?: 'flow' | 'radial'; xMm: number; yMm: number; angleDeg: number; radiusMm: number }>
  mapWidth: number
  mapHeight: number
  labels: number[]
  palette: string[]
  regions: StitchRegion[]
  widthMm: number
  heightMm: number
}

export interface AgentOptions {
  artStyle?: 'clean' | 'soft'
  stitchBackend?: 'paper' | 'native'
  intent: string
  maxColors: number
  widthMm: number
  fabric: 'woven' | 'knit'
  texture: 'curved' | 'tatami' | 'flow'
}

/** 制版项目 —— 工业软件式工作单元：项目目录内含图稿与产出 */
export interface ProjectInfo {
  coverPath?: string
  id: string
  name: string
  createdAt: string // ISO8601
  imageCount: number
}

/** 项目图片资产的角色 */
export type ProjectImageKind = 'original' | 'stylized' | 'lineart' | 'other'

/** 项目图片资产（manifest 记录角色与来源谱系） */
export interface ProjectImage {
  path: string // 绝对路径
  name: string // 文件名
  kind: ProjectImageKind
  derivedFrom?: string // 来源图片文件名（如色块图源自哪张原图）
  createdAt: string
}

/** 项目版本提交（isomorphic-git log） */
export interface CommitInfo {
  oid: string
  message: string
  time: string // ISO8601
}

/** 项目工作台持久化状态（state.json，被版本库跟踪） */
export interface ProjectState {
  imagePath?: string | null
  stylizedPath?: string | null
  lineArtPath?: string | null
  canvasMm?: { width: number; height: number } | null // 画布物理尺寸（决定针迹行距/补针基准）
  plan?: DigitizePlan | null
  stitches?: StitchResult | null
  stitchPostProcess?: StitchPostProcess
  agentOptions?: AgentOptions
}

export interface StitchPostProcess {
  minStitchMm: number
  maxStitchMm: number
  curveToleranceMm: number
}

export interface StitchRegion {
  id: string
  color: string
  stitchType: 'satin' | 'tatami' | 'run' | 'curved' | 'flow' | 'radial'
  density: number // 针距 mm
  angleDeg: number
  label: number
  colorIndex: number
  underlay: boolean
  enabled: boolean
  areaMm2: number
  xMm: number
  yMm: number
  widthMm: number
  heightMm: number
}

/** 针迹点（emby-core generate_stitches 输出，mm 绝对坐标） */
export interface StitchPoint {
  x: number
  y: number
  flag: 0 | 1 | 2 // 0=stitch 1=jump 2=color_change
  color: number // palette 索引
}

export interface StitchResult {
  method?: { backend: 'paper' | 'native'; paperRegions?: number; detailRegions?: number; paperAreaRatio?: number; recordPath?: string }
  travelRanges?: number[]
  underlayRanges?: number[] // half-open command ranges, kept in export even when preview hides them
  points: StitchPoint[]
  palette: string[]
  widthMm: number
  heightMm: number
  stitchCount: number
  colorChanges: number
  backgroundIndex: number
  quality?: {
    jumpCount: number
    jumpLengthMm?: number
    travelLengthMm?: number
    travelCount?: number
    longJumps: number
    shortStitches: number
    maxLengthMm: number
    denseCells: number
    warnings: string[]
  }
}

export interface ExportRequest {
  points: StitchPoint[]
  palette?: string[] // 用于生产单（色序表）
  name: string // 文件名（DST 内 LA 字段）
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
  type: 'workflow' | 'exporter' | 'tool' | 'agent-skill' | 'theme' | 'model-pack'
  entry: string
  permissions: Array<'fs' | 'net' | 'engine' | 'sidecar'>
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
  engineUrl: string // emby-engine（Rust 生成引擎）
  draftBackend: 'qwen' | 'native'
  comfyUrl: string // Qwen 图生图服务，与 Rust 后处理服务分开
  comfyPythonPath?: string
  comfyMainPath?: string
  paperPythonPath?: string
  paperRepoPath?: string
  sidecarUrl: string
  locale: string // 'en'（原生默认）| 'zh-CN'
}
