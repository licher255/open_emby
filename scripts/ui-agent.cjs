// Real object plan + native stitch generation behind an isolated project bridge.
const { app, BrowserWindow, nativeTheme } = require('electron')
const { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { tmpdir } = require('node:os')
const assert = require('node:assert/strict')
app.disableHardwareAcceleration()
const root = resolve(__dirname, '..')
const output = process.env.EMBY_UI_FIXTURES || resolve(root, '../doc/agent-stitch-tests')
const temporary = mkdtempSync(join(tmpdir(), 'emby-agent-ui-'))
app.setPath('userData', temporary)
mkdirSync(output, { recursive: true })
const fixture = join(output, 'cat-plan.json')
const plan = JSON.parse(readFileSync(fixture, 'utf8'))
const statePath = join(temporary, 'state.json')
writeFileSync(statePath, JSON.stringify({ imagePath: plan.imagePath, stylizedPath: plan.imagePath, plan, stitches: JSON.parse(readFileSync(join(output, 'cat-stitches.json'), 'utf8')) }))
const preload = join(temporary, 'preload.cjs')
writeFileSync(preload, `
const {contextBridge}=require('electron');const fs=require('node:fs');
const core=require(${JSON.stringify(join(root, 'crates/emby-core/emby-core.win32-x64-msvc.node'))});
const statePath=${JSON.stringify(statePath)};
const read=()=>JSON.parse(fs.readFileSync(statePath,'utf8'));
const template=JSON.parse(fs.readFileSync(${JSON.stringify(fixture)},'utf8'));
const imageData='data:image/png;base64,'+fs.readFileSync(template.imagePath).toString('base64');
let imageNumber=0;
contextBridge.exposeInMainWorld('openEmby',{
window:{isMaximized:async()=>false,onMaximizedChanged:()=>()=>{},minimize:()=>{},toggleMaximize:()=>{},close:()=>{}},
settings:{get:async()=>({locale:'zh-CN',draftBackend:'qwen',comfyUrl:'http://127.0.0.1:8188'}),set:async v=>v},
projects:{list:async()=>[{id:'agent-test',name:'宠物 · 区域制版测试',imageCount:1,createdAt:new Date().toISOString()}],images:async()=>[],history:async()=>[],loadState:async()=>read(),saveState:async(id,state)=>fs.writeFileSync(statePath,JSON.stringify(state)),saveImage:async(id,data,stem)=>{const path=require('node:path').join(${JSON.stringify(temporary)},stem+'-'+(++imageNumber)+'.png');fs.writeFileSync(path,Buffer.from(data.split(',')[1],'base64'));return path;}},
files:{readImageDataUrl:async path=>'data:image/png;base64,'+fs.readFileSync(path).toString('base64')},
engine:{onProgress:()=>()=>{},generateDraft:async()=>imageData,generateColorBlocks:async()=>({colorBlocks:imageData,draft:imageData}),repairRegion:async()=>imageData},
sidecar:{digitizePlan:async(imagePath,intent,widthMm,maxColors,fabric,texture)=>{const objects=core.analyzeArtwork(imagePath,maxColors,widthMm);return {...template,...objects,imagePath,intent,fabric,sizeMm:{width:objects.widthMm,height:objects.heightMm},sourceHash:require('node:crypto').createHash('sha256').update(fs.readFileSync(imagePath)).digest('hex')};},digitizeStitches:async(src,colors,width,post,plan)=>core.stitchArtwork(plan,post.minStitchMm,post.maxStitchMm)},
envStatus:async()=>({dataRoot:'E:/Embroidery',version:'0.0.1',engine:{reachable:true,url:'http://127.0.0.1:8189'},sidecar:{running:true,url:'http://127.0.0.1:8100'}}),
models:{list:async()=>[]},plugins:{list:async()=>[]}
})`)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 1100, webPreferences: { preload, sandbox: false, offscreen: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (_, level, msg) => { if (level === 3) { errors.push(msg); console.error(msg) } })
  const evaluate = code => win.webContents.executeJavaScript(code)
  const delay = ms => new Promise(r => setTimeout(r, ms))
  async function wait(selector) { for (let i = 0; i < 120; i++) { if (await evaluate(`!!document.querySelector(${JSON.stringify(selector)})`)) return; await delay(50) } throw new Error('Missing ' + selector) }
  async function click(selector) { await wait(selector); await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(150) }
  async function shot(name) { win.webContents.invalidate(); await delay(150); writeFileSync(join(output, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
  try {
    await win.loadFile(join(root, 'out/renderer/index.html')); await click('.nav-project > button')
    await wait('.studio'); await evaluate(`(document.querySelector('.studio-advanced') || document.querySelector('.studio-ready .studio-secondary')).click()`)
    await wait('.agent-panel'); await evaluate(`document.querySelectorAll('.nav-step')[2].click()`); await wait('.object-canvas')
    await click('.object-list button'); await wait('.object-controls input[type=range]')
    await evaluate(`const el=document.querySelector('.object-controls input[type=range]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'65');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));`)
    await delay(1100)
    assert(JSON.parse(readFileSync(statePath)).plan.regions.some(r => r.angleDeg === 65), 'region angle persisted')
    await shot('plan-desktop')
    if (plan.directionField) {
      const guideCount = JSON.parse(readFileSync(statePath)).plan.directionGuides?.length ?? 0
      await wait('select[aria-label="方向引导工具"]')
      await evaluate(`(()=>{const el=document.querySelector('select[aria-label="方向引导工具"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'flow');el.dispatchEvent(new Event('change',{bubbles:true}));})()`)
      await delay(250)
      const rect = await evaluate(`(()=>{const r=document.querySelector('.object-canvas').getBoundingClientRect();return {x:r.left+r.width*.45,y:r.top+r.height*.3}})()`)
      win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(rect.x),y:Math.round(rect.y),button:'left',clickCount:1})
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.x+20),y:Math.round(rect.y+40)})
      win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(rect.x+20),y:Math.round(rect.y+40),button:'left',clickCount:1})
      await delay(1100)
      assert.equal(JSON.parse(readFileSync(statePath)).plan.directionGuides.length, guideCount+1, 'drag guide persisted')
      await shot('direction-guides')
    }
    await click('.step-panel > .editor-actions .btn-outline'); await wait('.stitch-canvas'); await delay(1000)
    const state = JSON.parse(readFileSync(statePath))
    assert(state.stitches.stitchCount > 100); assert(state.plan.regions.some(r => r.angleDeg === 65))
    await shot('stitches-desktop')
    if (state.stitches.travelRanges?.length) {
      const originalCanvas = await evaluate(`document.querySelector('.stitch-canvas').toDataURL()`)
      await click('.view-tabs label:nth-of-type(2) input')
      assert.notEqual(await evaluate(`document.querySelector('.stitch-canvas').toDataURL()`), originalCanvas, 'travel highlight must be visible')
      assert.deepEqual(JSON.parse(readFileSync(statePath)).stitches.points, state.stitches.points, 'highlight must not change machine commands')
      await shot('travel-highlight')
    }
    await evaluate(`document.querySelectorAll('.nav-step')[2].click()`); await wait('.object-canvas')
    win.setSize(1080, 800); await delay(200); await shot('plan-compact')
    assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no page overflow')
    nativeTheme.themeSource = 'dark'; await delay(200); await shot('plan-dark')
    await win.reload(); await wait('.nav-project > button'); await click('.nav-project > button')
    await wait('.studio'); await evaluate(`(document.querySelector('.studio-advanced') || document.querySelector('.studio-ready .studio-secondary')).click()`)
    await evaluate(`document.querySelectorAll('.nav-step')[2].click()`); await wait('.object-canvas'); await click('.object-list button')
    assert.equal(await evaluate(`document.querySelector('.object-controls input[type=range]').value`), '65', 'edited plan restored')
    // Regional edit is a proposal; discarding must not replace the current artwork.
    const sourceBeforeRepair = JSON.parse(readFileSync(statePath)).stylizedPath
    await evaluate(`const el=document.querySelector('.object-controls textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'简化此区域');el.dispatchEvent(new Event('input',{bubbles:true}));`)
    await click('.object-controls fieldset .btn-outline'); await wait('.repair-preview')
    assert.equal(JSON.parse(readFileSync(statePath)).stylizedPath, sourceBeforeRepair)
    await click('.repair-preview .btn-outline')
    assert.equal(await evaluate(`!!document.querySelector('.repair-preview')`), false)
    // Exercise the guided frontend orchestration using a known AI image and real native geometry.
    await evaluate(`document.querySelectorAll('.nav-step')[0].click()`); await wait('.agent-panel[open]')
    await click('.agent-controls .btn-pill'); await wait('.stitch-canvas'); await delay(1100)
    const automatic = JSON.parse(readFileSync(statePath))
    assert(automatic.stylizedPath !== plan.imagePath && automatic.plan.imagePath === automatic.stylizedPath)
    assert(automatic.stitches.stitchCount > 100)
    assert.equal(automatic.agentOptions.widthMm, 100)
    assert.deepEqual(errors, [])
    console.log('PASS object selection, angle edit, persistence/reopen, native preview, repair proposal/discard, guided frontend pipeline, compact/dark layouts.')
    app.exit(0)
  } catch (error) { console.error(error); await shot('ui-failure'); app.exit(1) }
})
