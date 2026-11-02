import { app, ipcMain, dialog, BrowserWindow, nativeImage } from 'electron'
import { randomUUID, randomInt } from 'crypto'
import { readFileSync, existsSync, statSync } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { IpcChannels } from '@shared/ipc'
import type { AppSettings, DigitizePlan, EngineProgressEvent, ExportRequest, ProjectImageKind, StitchResult } from '@shared/types'
import { getSettings, setSettings } from '../services/settings'
import { generateDraft } from '../services/draft'
import { engineStatus, generateColorBlocks, generateLineArt, startEngine, stopEngine, submitWorkflow } from '../services/engine'
import { sidecarStatus, sidecarCall, startSidecar, stopSidecar } from '../services/sidecar'
import { aiGatewayStatus, cancelModelInstall, deleteProvider, importLocalModel, importModelUrl, listModelState, modelInstallStatus, removeModel, saveProvider, startModelInstall, testProvider } from '../services/models'
import { runtimeDevices, runtimeServers, startServer, stopServer } from '../services/runtime'
import { listPlugins, invokePlugin } from '../services/pluginHost'
import { archiveProjectImage, createProject, importImage, listProjectImages, listProjects, loadProjectState, projectHistory, renameProjectImage, restoreProject, saveImageDataUrl, saveProjectState } from '../services/projects'
import { canvasAdjust } from '../services/projects'

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
  ipcMain.handle(IpcChannels.engineGenerateDraft, async (e, args: { imagePath: string; maxColors: number; intent: string; style?: 'clean' | 'soft'; seed?: number; requestId?: string; retry?: boolean }) => {
    const s = getSettings()
    if (!e.sender.isDestroyed()) e.sender.send(IpcChannels.engineProgress, { type: 'status', message: '正在生成绣稿…' })
    const result = await generateDraft(args.imagePath, { engineUrl: s.engineUrl, maxColors: args.maxColors, intent: args.intent, style: args.style, seed: args.seed ?? randomInt(0, 0x100000000), requestId: args.requestId, retry: args.retry })
    return `data:image/png;base64,${readFileSync(result.rawPath).toString('base64')}`
  })
  ipcMain.handle(IpcChannels.engineRepairRegion, async (_e, args: { plan: DigitizePlan; label: number; intent: string }) => {
    const r = args.plan.regions.find(r => r.label === args.label)
    if (!r || !args.intent?.trim() || args.intent.length > 1000) throw new Error('请选择区域并填写 1–1000 字修改要求')
    const settings = getSettings()
    const edited = await generateDraft(args.plan.imagePath, {
      engineUrl: settings.engineUrl, maxColors: args.plan.maxColors,
      intent: `保持现有构图和位置。只修改位于画面横向 ${Math.round(r.xMm / args.plan.widthMm * 100)}%、纵向 ${Math.round(r.yMm / args.plan.heightMm * 100)}% 起的 ${r.color} 色区域。${args.intent}`
    })
    const destination = edited.path.replace(/stylize\.png$/, 'region-edit.png')
    await sidecarCall('/digitize/repair-region', { ...args, edited: edited.path, destination })
    return `data:image/png;base64,${readFileSync(destination).toString('base64')}`
  })
  ipcMain.handle(IpcChannels.engineSubmitWorkflow, (_e, wf: Record<string, unknown>) => submitWorkflow(wf))

  const withEngineProgress = (e: Electron.IpcMainInvokeEvent) => {
    const win = e.sender
    return (ev: EngineProgressEvent) => { if (!win.isDestroyed()) win.send(IpcChannels.engineProgress, ev) }
  }
  ipcMain.handle(IpcChannels.engineGenerateColorBlocks, (e, args: { imagePath: string; lineArtPath?: string | null; maxColors?: number; intent?: string }) => {
    return generateColorBlocks(args.imagePath, { lineArtPath: args.lineArtPath, maxColors: args.maxColors, intent: args.intent }, withEngineProgress(e))
  })
  ipcMain.handle(IpcChannels.engineGenerateLineArt, (e, args: { colorBlocksPath: string }) => {
    return generateLineArt(args.colorBlocksPath, withEngineProgress(e))
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

  // 目录选择对话框（数据根目录设置）
  ipcMain.handle(IpcChannels.selectDirectory, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const r = await dialog.showOpenDialog(win!, {
      title: '选择数据根目录',
      properties: ['openDirectory', 'createDirectory']
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

  // 缩略图（JPEG data URL，带 mtime 缓存）：列表/缩略图场景避免全尺寸解码
  const thumbCache = new Map<string, string>()
  ipcMain.handle(IpcChannels.readImageThumb, (_e, path: string, maxDim = 320) => {
    const key = `${path}:${statSync(path).mtimeMs}:${maxDim}`
    const hit = thumbCache.get(key)
    if (hit) return hit
    const img = nativeImage.createFromPath(path)
    if (img.isEmpty()) throw new Error(`无法解码图片: ${path}`)
    const { width, height } = img.getSize()
    const scale = maxDim / Math.max(width, height)
    const thumb = scale < 1
      ? img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' })
      : img
    const url = `data:image/jpeg;base64,${thumb.toJPEG(85).toString('base64')}`
    if (thumbCache.size >= 200) thumbCache.delete(thumbCache.keys().next().value!) // ponytail: FIFO 驱逐，项目图片量级足够
    thumbCache.set(key, url)
    return url
  })

  ipcMain.handle(IpcChannels.sidecarStatus, () => sidecarStatus())
  ipcMain.handle(IpcChannels.sidecarDigitizePlan, (_e, args: { imagePath: string; intent: string; widthMm?: number }) =>
    sidecarCall<DigitizePlan>('/digitize/plan', args))
  ipcMain.handle(IpcChannels.sidecarDigitizeStitches, (_e, args: {
    imagePath: string
    maxColors?: number
    widthMm?: number
    minStitchMm?: number
    maxStitchMm?: number
    curveToleranceMm?: number
  }) =>
    sidecarCall<StitchResult>('/digitize/stitches', args))
  ipcMain.handle(IpcChannels.sidecarExport, (_e, req: ExportRequest) =>
    sidecarCall<{ ok: boolean; files: string[] }>('/export', req))
  ipcMain.handle(IpcChannels.sidecarExportSave, async (e, req: Omit<ExportRequest, 'outDir'>) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showSaveDialog(win!, { title: '保存刺绣文件', defaultPath: `${req.name}.dst`, filters: [{ name: 'Tajima embroidery', extensions: ['dst'] }] })
    if (result.canceled || !result.filePath) return null
    return sidecarCall<{ ok: boolean; files: string[] }>('/export', { ...req, name: basename(result.filePath, extname(result.filePath)), outDir: dirname(result.filePath) })
  })

  ipcMain.handle(IpcChannels.modelList, () => listModelState())
  ipcMain.handle(IpcChannels.modelInstall, (_e, id: string) => startModelInstall(id))
  ipcMain.handle(IpcChannels.modelInstallStatus, (_e, job: string) => modelInstallStatus(job))
  ipcMain.handle(IpcChannels.modelCancelInstall, (_e, job: string) => cancelModelInstall(job))
  ipcMain.handle(IpcChannels.modelRemove, (_e, id: string) => removeModel(id))
  ipcMain.handle(IpcChannels.modelImport, (_e, body: { url: string; id?: string; name?: string; family?: string }) => importModelUrl(body))
  ipcMain.handle(IpcChannels.modelImportLocal, (_e, body: { files: string[]; id?: string; name?: string; family?: string }) => importLocalModel(body))
  ipcMain.handle(IpcChannels.modelPickFiles, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Select model files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Model files', extensions: ['safetensors', 'gguf', 'ckpt', 'pt', 'bin'] }]
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle(IpcChannels.aiStatus, () => aiGatewayStatus())
  ipcMain.handle(IpcChannels.aiProviderSave, (_e, provider: import('@shared/types').AiProvider) => saveProvider(provider))
  ipcMain.handle(IpcChannels.aiProviderDelete, (_e, id: string) => deleteProvider(id))
  ipcMain.handle(IpcChannels.aiProviderTest, (_e, id: string) => testProvider(id))
  ipcMain.handle(IpcChannels.runtimeDevices, () => runtimeDevices())
  ipcMain.handle(IpcChannels.runtimeServers, () => runtimeServers())
  ipcMain.handle(IpcChannels.runtimeStart, (_e, modelId: string) => startServer(modelId))
  ipcMain.handle(IpcChannels.runtimeStop, (_e, modelId: string) => stopServer(modelId))

  // ---------- 项目库 ----------
  ipcMain.handle(IpcChannels.projectList, () => listProjects())
  ipcMain.handle(IpcChannels.projectCreate, (_e, name: string) => createProject(name))
  ipcMain.handle(IpcChannels.projectImages, (_e, id: string) => listProjectImages(id))
  ipcMain.handle(IpcChannels.projectArchiveImage, (_e, args: { projectId: string; imagePath: string }) =>
    archiveProjectImage(args.projectId, args.imagePath))
  ipcMain.handle(IpcChannels.projectRenameImage, (_e, args: { projectId: string; imagePath: string; name: string }) =>
    renameProjectImage(args.projectId, args.imagePath, args.name))
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
  ipcMain.handle(IpcChannels.projectCanvasAdjust, (_e, args: { projectId: string; imagePath: string; widthMm: number; heightMm: number; mode: string }) =>
    canvasAdjust(args.projectId, args.imagePath, args.widthMm, args.heightMm, args.mode))

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
