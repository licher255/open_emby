import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, ExportRequest } from '@shared/types'

/** 暴露给渲染进程的类型安全 API: window.openEmby */
const api = {
  envStatus: () => ipcRenderer.invoke(IpcChannels.envStatus),
  comfy: {
    status: () => ipcRenderer.invoke(IpcChannels.comfyStatus),
    submitWorkflow: (wf: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.comfySubmitWorkflow, wf)
  },
  sidecar: {
    status: () => ipcRenderer.invoke(IpcChannels.sidecarStatus),
    digitizePlan: (imagePath: string, intent: string) =>
      ipcRenderer.invoke(IpcChannels.sidecarDigitizePlan, { imagePath, intent }),
    export: (req: ExportRequest) => ipcRenderer.invoke(IpcChannels.sidecarExport, req)
  },
  models: {
    list: () => ipcRenderer.invoke(IpcChannels.modelList)
  },
  plugins: {
    list: () => ipcRenderer.invoke(IpcChannels.pluginList),
    invoke: (id: string, input: unknown) => ipcRenderer.invoke(IpcChannels.pluginInvoke, id, input)
  },
  flywheel: {
    contribute: (manifest: Record<string, unknown>, files: Record<string, string>) =>
      ipcRenderer.invoke(IpcChannels.flywheelContribute, { manifest, files }),
    stats: () => ipcRenderer.invoke(IpcChannels.flywheelStats),
    curate: () => ipcRenderer.invoke(IpcChannels.flywheelCurate)
  },
  settings: {
    get: () => ipcRenderer.invoke(IpcChannels.settingsGet),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IpcChannels.settingsSet, patch)
  }
}

export type OpenEmbyApi = typeof api
contextBridge.exposeInMainWorld('openEmby', api)
