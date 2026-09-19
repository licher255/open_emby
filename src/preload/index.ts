import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, EngineProgressEvent, ExportRequest } from '@shared/types'

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
  engine: {
    status: () => ipcRenderer.invoke(IpcChannels.engineStatus),
    submitWorkflow: (wf: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.engineSubmitWorkflow, wf),
    stylize: (imagePath: string, maxColors?: number) =>
      ipcRenderer.invoke(IpcChannels.engineStylize, { imagePath, maxColors }),
    onProgress: (cb: (ev: EngineProgressEvent) => void) => {
      const l = (_e: unknown, ev: EngineProgressEvent) => cb(ev)
      ipcRenderer.on(IpcChannels.engineProgress, l)
      return () => ipcRenderer.removeListener(IpcChannels.engineProgress, l)
    }
  },
  files: {
    selectImage: (): Promise<string | null> => ipcRenderer.invoke(IpcChannels.selectImage),
    readImageDataUrl: (path: string): Promise<string> => ipcRenderer.invoke(IpcChannels.readImageDataUrl, path),
    pathForFile: (f: File): string => webUtils.getPathForFile(f)
  },
  projects: {
    list: () => ipcRenderer.invoke(IpcChannels.projectList),
    create: (name: string) => ipcRenderer.invoke(IpcChannels.projectCreate, name),
    images: (projectId: string): Promise<import('@shared/types').ProjectImage[]> =>
      ipcRenderer.invoke(IpcChannels.projectImages, projectId),
    importImage: (projectId: string, srcPath: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.projectImportImage, { projectId, srcPath }),
    saveImage: (projectId: string, dataUrl: string, stem: string, kind?: string, derivedFrom?: string): Promise<string> =>
      ipcRenderer.invoke(IpcChannels.projectSaveImage, { projectId, dataUrl, stem, kind, derivedFrom })
    ,
    loadState: (projectId: string): Promise<import('@shared/types').ProjectState | null> =>
      ipcRenderer.invoke(IpcChannels.projectLoadState, projectId),
    saveState: (projectId: string, state: import('@shared/types').ProjectState, message: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.projectSaveState, { projectId, state, message }),
    history: (projectId: string): Promise<import('@shared/types').CommitInfo[]> =>
      ipcRenderer.invoke(IpcChannels.projectHistory, projectId),
    restore: (projectId: string, oid: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.projectRestore, { projectId, oid })
  },
  sidecar: {
    status: () => ipcRenderer.invoke(IpcChannels.sidecarStatus),
    digitizePlan: (imagePath: string, intent: string) =>
      ipcRenderer.invoke(IpcChannels.sidecarDigitizePlan, { imagePath, intent }),
    digitizeStitches: (imagePath: string, maxColors?: number, widthMm?: number): Promise<import('@shared/types').StitchResult> =>
      ipcRenderer.invoke(IpcChannels.sidecarDigitizeStitches, { imagePath, maxColors, widthMm }),
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
