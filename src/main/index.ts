import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { registerIpc, bootServices, shutdownServices } from './ipc'

const isDev = !!process.env.ELECTRON_RENDERER_URL
const iconPath = app.isPackaged
  ? join(process.resourcesPath, 'icon-window.png')
  : join(__dirname, '../../build/icon-window.png')
let quitting = false

if (process.platform === 'win32') app.setAppUserModelId('com.openemby.app')

function quitCleanly(): void {
  if (quitting) return
  quitting = true
  shutdownServices()
  app.quit()
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: false,
    title: 'open_emby — AI 刺绣制版',
    icon: iconPath,
    backgroundColor: '#e6eaf0',
    frame: false, // 无边框：自绘标题栏（renderer/Titlebar.tsx）
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 无边框窗口控制（供自绘标题栏按钮调用）
  ipcMain.handle('window:minimize', () => win.minimize())
  ipcMain.handle('window:toggle-maximize', () => {
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })
  ipcMain.handle('window:close', () => quitCleanly())
  ipcMain.handle('window:is-maximized', () => win.isMaximized())
  win.on('maximize', () => win.webContents.send('window:maximized-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false))
  win.on('close', (event) => {
    if (quitting) return
    event.preventDefault()
    quitCleanly()
  })
  win.once('ready-to-show', () => {
    win.show()
    setTimeout(() => {
      if (!quitting) bootServices((line) => console.log('[sidecar]', line))
    }, 150)
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 任何退出路径（关窗 / Cmd+Q / 任务栏退出）都先杀 sidecar / engine 进程树
app.on('before-quit', () => {
  quitting = true
  shutdownServices()
})
app.on('window-all-closed', quitCleanly)
