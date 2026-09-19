import { app, ipcMain, dialog, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { basename, extname, join } from 'path'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, DigitizePlan, EngineProgressEvent, ExportRequest, ProjectImageKind, StitchResult } from '@shared/types'
import { getSettings, setSettings } from '../services/settings'
import { engineStatus, startEngine, stopEngine, submitWorkflow, stylizeImage } from '../services/engine'
import { sidecarStatus, sidecarCall, startSidecar, stopSidecar } from '../services/sidecar'
import { listModels } from '../services/modelManager'
import { listPlugins, invokePlugin } from '../services/pluginHost'
import { createProject, importImage, listProjectImages, listProjects, loadProjectState, projectHistory, restoreProject, saveImageDataUrl, saveProjectState } from '../services/projects'

// dev: 仓库内 plugins/；打包后: resources/plugins
const PLUGINS_DIR = app.isPackaged
  ? join(process.resourcesPath, 'plugins')
  : join(__dirname, '../../plugins')

export function registerIpc(): void {
  ipcMain.handle(IpcChannels.envStatus, async () => ({
    engine: await engineStatus(),
    sidecar: await sidecarStatus(),
    dataRoot: getSettings().dataRoot,
    version: app.getVersion()
  }))

  ipcMain.handle(IpcChannels.engineStatus, () => engineStatus())
  ipcMain.handle(IpcChannels.engineSubmitWorkflow, (_e, wf: Record<string, unknown>) => submitWorkflow(wf))

  // 风格化（制版第一步：平涂色块化），节点级进度推送 engineProgress
  ipcMain.handle(IpcChannels.engineStylize, async (e, args: { imagePath: string; maxColors?: number }) => {
    const win = e.sender
    const send = (ev: EngineProgressEvent) => { if (!win.isDestroyed()) win.send(IpcChannels.engineProgress, ev) }
    return stylizeImage(args.imagePath, { maxColors: args.maxColors }, send)
  })

  // 图片选择对话框（任意常见格式）
  ipcMain.handle(IpcChannels.selectImage, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, {
      title: '选择图稿图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'tif', 'tiff', 'avif'] }]
    })
    if (r.canceled || r.filePaths.length === 0) return null
    return r.filePaths[0]
  })

  // 本地图片 -> data URL（绕过 renderer CSP 对 file:// 的限制）
  ipcMain.handle(IpcChannels.readImageDataUrl, (_e, path: string) => {
    const buf = readFileSync(path)
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.avif': 'image/avif', '.tif': 'image/tiff', '.tiff': 'image/tiff' }[extname(path).toLowerCase()] ?? 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  ipcMain.handle(IpcChannels.sidecarStatus, () => sidecarStatus())
  ipcMain.handle(IpcChannels.sidecarDigitizePlan, (_e, args: { imagePath: string; intent: string }) =>
    sidecarCall<DigitizePlan>('/digitize/plan', args))
  ipcMain.handle(IpcChannels.sidecarDigitizeStitches, (_e, args: { imagePath: string; maxColors?: number; widthMm?: number }) =>
    sidecarCall<StitchResult>('/digitize/stitches', args))
  ipcMain.handle(IpcChannels.sidecarExport, (_e, req: ExportRequest) =>
    sidecarCall<{ ok: boolean; files: string[] }>('/export', req))

  ipcMain.handle(IpcChannels.modelList, () => listModels())

  // ---------- 项目库 ----------
  ipcMain.handle(IpcChannels.projectList, () => listProjects())
  ipcMain.handle(IpcChannels.projectCreate, (_e, name: string) => createProject(name))
  ipcMain.handle(IpcChannels.projectImages, (_e, id: string) => listProjectImages(id))
  ipcMain.handle(IpcChannels.projectImportImage, (_e, args: { projectId: string; srcPath: string }) =>
    importImage(args.projectId, args.srcPath))
  ipcMain.handle(IpcChannels.projectSaveImage, (_e, args: { projectId: string; dataUrl: string; stem: string; kind?: ProjectImageKind; derivedFrom?: string }) =>
    saveImageDataUrl(args.projectId, args.dataUrl, args.stem, args.kind ?? 'stylized', args.derivedFrom))
  ipcMain.handle(IpcChannels.projectLoadState, (_e, id: string) => loadProjectState(id))
  ipcMain.handle(IpcChannels.projectSaveState, (_e, args: { projectId: string; state: Record<string, unknown>; message: string }) =>
    saveProjectState(args.projectId, args.state, args.message))
  ipcMain.handle(IpcChannels.projectHistory, (_e, id: string) => projectHistory(id))
  ipcMain.handle(IpcChannels.projectRestore, (_e, args: { projectId: string; oid: string }) =>
    restoreProject(args.projectId, args.oid))

  ipcMain.handle(IpcChannels.pluginList, () => listPlugins(PLUGINS_DIR).map((p) => p.manifest))
  ipcMain.handle(IpcChannels.pluginInvoke, (_e, id: string, input: unknown) => {
    const p = listPlugins(PLUGINS_DIR).find((x) => x.manifest.id === id)
    if (!p) throw new Error(`插件不存在: ${id}`)
    return invokePlugin(p.dir, p.manifest, input)
  })

  // ---------- 数据飞轮 ----------
  ipcMain.handle(IpcChannels.flywheelContribute, async (_e, args: {
    manifest: Record<string, unknown>
    files: Record<string, string> // 字段名 -> 本机文件路径
  }) => {
    const s = getSettings()
    if (!s.contribution.enabled || s.contribution.scope === 'off') {
      return { ok: false, reason: 'consent off' }
    }
    const manifest = {
      ...args.manifest,
      contributor_id: s.contribution.contributorId,
      consent: { scope: s.contribution.scope, granted_at: s.contribution.grantedAt }
    }
    const fd = new FormData()
    fd.append('manifest', JSON.stringify(manifest))
    for (const [field, p] of Object.entries(args.files)) {
      if (existsSync(p)) {
        fd.append(field, new Blob([readFileSync(p)]), basename(p))
      }
    }
    const res = await fetch(`${s.sidecarUrl}/flywheel/contribute`, { method: 'POST', body: fd })
    if (!res.ok) throw new Error(`flywheel contribute failed: ${res.status}`)
    return res.json()
  })
  ipcMain.handle(IpcChannels.flywheelStats, async () => {
    const res = await fetch(`${getSettings().sidecarUrl}/training/stats`)
    return res.json()
  })
  ipcMain.handle(IpcChannels.flywheelCurate, async () => {
    const res = await fetch(`${getSettings().sidecarUrl}/flywheel/curate`, { method: 'POST' })
    return res.json()
  })

  ipcMain.handle(IpcChannels.settingsGet, () => getSettings())
  ipcMain.handle(IpcChannels.settingsSet, (_e, patch: Partial<AppSettings>) => {
    // 首次开启数据贡献授权时，生成匿名贡献者 ID 并记录授权时间
    if (patch.contribution?.enabled && !getSettings().contribution.contributorId) {
      patch.contribution = {
        ...patch.contribution,
        contributorId: randomUUID(),
        grantedAt: new Date().toISOString()
      }
    }
    return setSettings(patch)
  })
}

export function bootServices(onLog: (line: string) => void): void {
  startSidecar(onLog)
  startEngine(onLog)
}

export function shutdownServices(): void {
  stopSidecar()
  stopEngine()
}
