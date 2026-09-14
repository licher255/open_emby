// 主进程 <-> 渲染进程 IPC 通道常量（唯一来源）
export const IpcChannels = {
  // 环境状态
  envStatus: 'env:status',
  // ComfyUI
  comfyStatus: 'comfyui:status',
  comfySubmitWorkflow: 'comfyui:submit-workflow',
  comfyProgress: 'comfyui:progress', // main -> renderer push
  // Sidecar (制版核心 / Agent)
  sidecarStatus: 'sidecar:status',
  sidecarDigitizePlan: 'sidecar:digitize-plan',
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
