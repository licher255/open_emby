import { app, BrowserWindow, shell, ipcMain } from 'electron'
import { join } from 'path'
import { registerIpc, bootServices } from './ipc'
import { stopSidecar } from './services/sidecar'

const isDev = !!process.env.ELECTRON_RENDERER_URL

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'open_emby — AI 刺绣制版',
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
  ipcMain.handle('window:close', () => win.close())
  ipcMain.handle('window:is-maximized', () => win.isMaximized())
  win.on('maximize', () => win.webContents.send('window:maximized-changed', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized-changed', false))

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL!)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  registerIpc()
  bootServices((line) => console.log('[sidecar]', line))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 任何退出路径（关窗 / Cmd+Q / 任务栏退出）都先杀 sidecar 进程树
app.on('before-quit', () => stopSidecar())
app.on('window-all-closed', () => {
  stopSidecar()
  app.quit() // 全平台一致：关窗即退出全部进程（不做 macOS 驻留）
})
