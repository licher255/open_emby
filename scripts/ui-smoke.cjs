/** UI smoke check using Electron and an isolated bridge (no project files or services).
 * Build first, then: electron scripts/ui-smoke.cjs
 * Screenshots: out/ui-check/; checks light/dark, navigation, zoom, and compact layout.
 */
const { app, BrowserWindow, nativeTheme } = require('electron')
const { mkdirSync, writeFileSync, mkdtempSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()

const output = resolve(__dirname, '../out/ui-check')
const temporary = mkdtempSync(join(tmpdir(), 'emby-ui-'))
app.setPath('userData', temporary)
mkdirSync(output, { recursive: true })
const preload = join(temporary, 'preload.cjs')
writeFileSync(preload, `
const { contextBridge } = require('electron')
const projects = ['植物刺绣 · 春日花园', '极简线条 / 山川', '花卉图稿与绣线配色的长名称布局检查'].map((name, i) => ({ id: String(i), name, imageCount: i + 1, createdAt: '2026-09-28T00:00:00Z' }))
contextBridge.exposeInMainWorld('openEmby', {
  window: { isMaximized: async () => false, onMaximizedChanged: () => () => {}, minimize: () => {}, toggleMaximize: () => {}, close: () => {} },
  settings: { get: async () => ({ locale: 'zh-CN' }), set: async () => {} },
  projects: { list: async () => projects, images: async () => [], history: async () => [], loadState: async () => null, create: async (name) => { const p = { id: String(projects.length), name, imageCount: 0, createdAt: new Date().toISOString() }; projects.push(p); return p } },
  engine: { onProgress: () => () => {} },
  envStatus: async () => ({ dataRoot: 'E:/Embroidery', version: '0.0.1-beta', engine: { reachable: true, url: 'http://127.0.0.1:8189' }, sidecar: { running: true, url: 'http://127.0.0.1:8100' } }),
  models: { list: async () => [] }, plugins: { list: async () => [] }
})
`)

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light'
  const win = new BrowserWindow({ width: 1440, height: 900, frame: false, show: false, webPreferences: { preload, sandbox: false, backgroundThrottling: false, offscreen: true } })
  const errors = []
  win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message) })
  const evaluate = (code) => win.webContents.executeJavaScript(code)
  const settle = () => new Promise((r) => setTimeout(r, 220))
  async function waitFor(selector) {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error('Missing element: ' + selector)
  }
  async function click(selector) { await waitFor(selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await settle() }
  async function shot(name) {
    win.webContents.invalidate()
    await settle()
    writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  async function checkLayout(label) {
    const overflow = await evaluate(`Array.from(document.querySelectorAll('.workspace-frame, .workspace-content, main')).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => e.className || e.tagName)`)
    assert.deepEqual(overflow, [], label + ': horizontal overflow')
    assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, label + ': page overflow')
    console.log('PASS ' + label)
  }
  try {
    await win.loadFile(resolve(__dirname, '../out/renderer/index.html'))
    await waitFor('.nav-project')
    await checkLayout('home 1440 × 900')
    await shot('home-light')
    await click('.nav-project > button')
    await waitFor('.dropzone-slot')
    await checkLayout('import project')
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.nav-step.active')).borderRadius`), '10px')
    await shot('import-light')
    for (let i = 1; i < 5; i++) {
      await click('.nav-step:nth-child(' + (i + 1) + ')')
      await checkLayout('editor step ' + i)
    }
    await click('.nav-step:nth-child(2)')
    await waitFor('.ws-canvas')
    assert.ok(await evaluate(`document.querySelector('.ws-canvas').getBoundingClientRect().height > 400`), 'canvas fills work area')
    await shot('canvas-light')
    await click('.titlebar-nav .tb-btn:nth-child(3)')
    assert.equal(await evaluate(`!!document.querySelector('.project-sidebar')`), false)
    await checkLayout('sidebar collapsed')
    await click('.activity-rail > .rail-button')
    await waitFor('.projects-page')
    await click('.titlebar-nav .tb-btn:nth-child(3)')
    await click('.activity-rail > .rail-button:nth-of-type(3)')
    await waitFor('.settings-page')
    await shot('settings-light')
    win.setSize(1080, 700)
    await settle()
    await checkLayout('settings 1080 × 700')
    await shot('settings-compact')
    await click('.nav-project > button')
    await click('.nav-step:first-child')
    await checkLayout('import 1080 × 700')
    await evaluate(`document.querySelector('.workspace-content').style.zoom = 1.6`)
    await checkLayout('import at 160%')
    await evaluate(`document.querySelector('.workspace-content').style.zoom = 1`)
    await click('.workspace-header .tb-btn')
    await waitFor('.modal input')
    await shot('modal-light')
    await click('.modal-actions .btn-pill')
    await waitFor('.dropzone-slot')
    assert.equal(await evaluate(`document.querySelectorAll('.nav-project').length`), 4, 'new project added')
    await click('.rail-help .rail-button')
    assert.ok(await evaluate(`document.querySelector('.help-pop').getBoundingClientRect().left > 40`), 'help opens beside rail')
    await click('.rail-help .rail-button')
    nativeTheme.themeSource = 'dark'
    await settle()
    assert.equal(await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--selected').trim()`), '#393939')
    await checkLayout('dark compact')
    await shot('import-dark')
    assert.deepEqual(errors, [], 'renderer console errors')
    console.log('PASS navigation, new project, sidebar, all five steps, zoom, dark mode; screenshots: ' + output)
    app.exit(0)
  } catch (error) {
    console.error(error)
    await shot('failure')
    app.exit(1)
  }
})
