// 主进程 <-> 渲染进程 IPC 通道常量（唯一来源）
export const IpcChannels = {
  // 环境状态
  envStatus: 'env:status',
  // emby-engine（Rust 生成引擎，ComfyUI 兼容 API）
  engineStatus: 'engine:status',
  engineSubmitWorkflow: 'engine:submit-workflow',
  engineGenerateColorBlocks: 'engine:generate-color-blocks',
  engineGenerateDraft: 'engine:generate-draft',
  engineRepairRegion: 'engine:repair-region',
  engineGenerateLineArt: 'engine:generate-line-art',
  engineProgress: 'engine:progress', // main -> renderer push（结构化节点事件）
  // 文件
  selectImage: 'dialog:select-image',
  selectDirectory: 'dialog:select-directory',
  readImageDataUrl: 'fs:read-image-data-url',
  readImageThumb: 'fs:read-image-thumb',
  // 项目库
  projectList: 'projects:list',
  projectCreate: 'projects:create',
  projectImages: 'projects:images',
  projectArchiveImage: 'projects:archive-image',
  projectRenameImage: 'projects:rename-image',
  projectImportImage: 'projects:import-image',
  projectSaveImage: 'projects:save-image',
  projectLoadState: 'projects:load-state',
  projectSaveState: 'projects:save-state',
  projectHistory: 'projects:history',
  projectRestore: 'projects:restore',
  projectCanvasAdjust: 'projects:canvas-adjust',
  // Sidecar (制版核心 / Agent)
  sidecarStatus: 'sidecar:status',
  sidecarDigitizePlan: 'sidecar:digitize-plan',
  sidecarDigitizeStitches: 'sidecar:digitize-stitches',
  sidecarExport: 'sidecar:export',
  sidecarExportSave: 'sidecar:export-save',
  // 模型与 AI 网关（全部转发到 Rust emby-engine）
  modelList: 'models:list',
  modelInstall: 'models:install',
  modelInstallStatus: 'models:install-status',
  modelCancelInstall: 'models:cancel-install',
  modelRemove: 'models:remove',
  modelImport: 'models:import',
  modelImportLocal: 'models:import-local',
  modelPickFiles: 'models:pick-files',
  runtimeDevices: 'runtime:devices',
  runtimeServers: 'runtime:servers',
  runtimeStart: 'runtime:start',
  runtimeStop: 'runtime:stop',
  aiStatus: 'ai:status',
  aiProviderSave: 'ai:provider-save',
  aiProviderDelete: 'ai:provider-delete',
  aiProviderTest: 'ai:provider-test',
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
