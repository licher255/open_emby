import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, ExportRequest } from '@shared/types'

// 无边框窗口控制
const windowControls = {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onMaximizedChanged: (cb: (maximized: boolean) => void) => {
    const l = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('window:maximized-changed', l)
    return () => { ipcRenderer.removeListener('window:maximized-changed', l) }
  }
}

/** 暴露给渲染进程的类型安全 API: window.openEmby */
const api = {
  envStatus: () => ipcRenderer.invoke(IpcChannels.envStatus),
  comfy: {
    status: () => ipcRenderer.invoke(IpcChannels.comfyStatus),
    submitWorkflow: (wf: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.comfySubmitWorkflow, wf),
    stylize: (imagePath: string, maxColors?: number, denoise?: number) =>
      ipcRenderer.invoke(IpcChannels.comfyStylize, { imagePath, maxColors, denoise }),
    onProgress: (cb: (msg: string) => void) => {
      const l = (_e: unknown, msg: string) => cb(msg)
      ipcRenderer.on(IpcChannels.comfyProgress, l)
      return () => ipcRenderer.removeListener(IpcChannels.comfyProgress, l)
    }
  },
  files: {
    selectImage: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.selectImage),
    readImageDataUrl: (path: string): Promise<string> => ipcRenderer.invoke(IpcChannels.readImageDataUrl, path),
    pathForFile: (f: File): string => webUtils.getPathForFile(f)
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
  },
  window: windowControls
}

export type OpenEmbyApi = typeof api
contextBridge.exposeInMainWorld('openEmby', api)