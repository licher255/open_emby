// 主进程 <-> 渲染进程 IPC 通道常量（唯一来源）
export const IpcChannels = {
  // 环境状态
  envStatus: 'env:status',
  // emby-engine（Rust 生成引擎，ComfyUI 兼容 API）
  engineStatus: 'engine:status',
  engineSubmitWorkflow: 'engine:submit-workflow',
  engineStylize: 'engine:stylize', // 平涂色块化（制版风格化第一步，原生节点）
  engineProgress: 'engine:progress', // main -> renderer push（结构化节点事件）
  // 文件
  selectImage: 'dialog:select-image',
  readImageDataUrl: 'fs:read-image-data-url',
  // 项目库
  projectList: 'projects:list',
  projectCreate: 'projects:create',
  projectImages: 'projects:images',
  projectImportImage: 'projects:import-image',
  projectSaveImage: 'projects:save-image',
  projectLoadState: 'projects:load-state',
  projectSaveState: 'projects:save-state',
  projectHistory: 'projects:history',
  projectRestore: 'projects:restore',
  // Sidecar (制版核心 / Agent)
  sidecarStatus: 'sidecar:status',
  sidecarDigitizePlan: 'sidecar:digitize-plan',
  sidecarDigitizeStitches: 'sidecar:digitize-stitches',
  sidecarExport: 'sidecar:export',
  // 模型管理
  modelList: 'models:list',
  modelDownload: 'models:download',
  modelFinetuneStart: 'models:finetune-start',
  // 插件
  pluginList: 'plugins:list',
  pluginInvoke: 'plugins:invoke',
  // 数据飞轮
  flywheelContribute: 'flywheel:contribute',
  flywheelStats: 'flywheel:stats',
  flywheelCurate: 'flywheel:curate',
  // 设置
  settingsGet: 'settings:get',
  settingsSet: 'settings:set'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
