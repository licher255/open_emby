// Real renderer, isolated project storage and deterministic service doubles.
const { app, BrowserWindow, nativeTheme } = require('electron')
const fs = require('node:fs'), { join, resolve } = require('node:path'), { tmpdir } = require('node:os'), assert = require('node:assert/strict')
app.disableHardwareAcceleration()
const root = resolve(__dirname, '..'), out = resolve(root, '../doc/four-choice-tests')
fs.mkdirSync(out, { recursive: true })
const temp = fs.mkdtempSync(join(tmpdir(), 'emby-four-'))
app.setPath('userData', temp)
const statePath = join(temp, 'state.json'), callsPath = join(temp, 'calls.json'), preload = join(temp, 'preload.cjs')
fs.writeFileSync(preload, `
const {contextBridge}=require('electron'),fs=require('node:fs'),{join}=require('node:path');
const root=${JSON.stringify(root)},temp=${JSON.stringify(temp)},statePath=${JSON.stringify(statePath)},callsPath=${JSON.stringify(callsPath)};
const photo=join(root,'../doc/prompt-tests/inputs/cat.png');
const fixtures=['q21_long_cat.png','q21_soft_cat.png','q21_nature_cat.png','q21_english_cat.png'];
const data=p=>'data:image/png;base64,'+fs.readFileSync(p).toString('base64');
let calls=fs.existsSync(callsPath)?JSON.parse(fs.readFileSync(callsPath)): {drafts:[],stitches:[]};
const record=()=>fs.writeFileSync(callsPath,JSON.stringify(calls));
const plan=JSON.parse(fs.readFileSync(join(root,'../doc/product-flow-tests/plan.json'))),result=JSON.parse(fs.readFileSync(join(root,'../doc/product-flow-tests/stitches.json')));
contextBridge.exposeInMainWorld('openEmby',{
window:{isMaximized:async()=>false,onMaximizedChanged:()=>()=>{},minimize:()=>{},toggleMaximize:()=>{},close:()=>{}},
settings:{get:async()=>({locale:'zh-CN'}),set:async x=>x},
projects:{list:async()=>[{id:'four',name:'四张图稿试用',imageCount:0,createdAt:'2026-10-24T00:00:00Z'}],images:async()=>[],history:async()=>[],loadState:async()=>fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath)):null,saveState:async(id,s)=>fs.writeFileSync(statePath,JSON.stringify(s)),importImage:async(id,p)=>p,saveImage:async(id,url,stem)=>{const p=join(temp,stem+'-'+require('node:crypto').randomUUID()+'.png');fs.writeFileSync(p,Buffer.from(url.split(',')[1],'base64'));return p}},
files:{selectImage:async()=>photo,readImageDataUrl:async p=>data(p),readImageThumb:async p=>data(p),pathForFile:f=>f.path},
engine:{onProgress:()=>()=>{},generateDraft:async(path,colors,intent,style,seed)=>{calls.drafts.push({path,colors,intent,style,seed});record();await new Promise(r=>setTimeout(r,180));if(calls.drafts.length===2)throw new Error('Test GPU interruption');const index=calls.drafts.findIndex(c=>c.seed===seed)%4,live=join(root,'../doc/four-choice-tests/live','option-'+(index+1)+'.png');return data(fs.existsSync(live)?live:join(root,'../doc/prompt-tests/outputs',fixtures[index]))}},
sidecar:{digitizePlan:async(imagePath,intent,widthMm,maxColors)=>({...plan,imagePath,intent,widthMm,maxColors}),digitizeStitches:async(path,colors,width,post,p,backend)=>{calls.stitches.push({path,backend});record();return result},exportSave:async req=>{calls.exportCount=req.points.length;record();return {ok:true,files:['test.dst']}}},
envStatus:async()=>({dataRoot:temp,version:'0.0.3-beta',engine:{reachable:true,url:''},sidecar:{running:true,url:''}}),models:{list:async()=>[]},plugins:{list:async()=>[]}
})`)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 950, webPreferences: { preload, sandbox: false, offscreen: true, backgroundThrottling: false } })
  const errors = []
  win.webContents.on('console-message', (_, level, message) => { if (level === 3) errors.push(message) })
  const run = code => win.webContents.executeJavaScript(code), delay = ms => new Promise(r => setTimeout(r, ms))
  async function waitFor(code) { for (let i = 0; i < 150; i++) { if (await run(code)) return; await delay(80) } throw new Error('Timed out: ' + code) }
  async function click(selector) { await waitFor(`!!document.querySelector(${JSON.stringify(selector)}) && !document.querySelector(${JSON.stringify(selector)}).disabled`); await run(`document.querySelector(${JSON.stringify(selector)}).click()`); await delay(150) }
  const readState = () => JSON.parse(fs.readFileSync(statePath)), readCalls = () => JSON.parse(fs.readFileSync(callsPath))
  async function screenshot(name) { win.webContents.invalidate(); await delay(200); fs.writeFileSync(join(out, name + '.png'), (await win.webContents.capturePage()).toPNG()) }
  try {
    await win.loadFile(join(root, 'out/renderer/index.html'))
    await click('.nav-project > button'); await click('.studio-upload'); await screenshot('upload')
    await click('.studio-generate'); await waitFor(`!!document.querySelector('.studio-retry')`)
    assert.equal(readCalls().drafts.length, 4)
    assert.equal(new Set(readCalls().drafts.map(c => c.seed)).size, 4)
    assert.equal(readCalls().stitches.length, 0, 'do not digitize before user approval')
    assert.equal(readState().draftRounds[0].candidates.filter(c => c.status === 'ready').length, 3)
    await screenshot('partial-failure')
    await click('.studio-retry'); await waitFor(`document.querySelectorAll('.studio-candidate:not(:disabled)').length === 4`)
    assert.equal(readCalls().drafts.length, 5, 'retry only missing candidate')
    assert.equal(readCalls().drafts[1].seed, readCalls().drafts[4].seed)
    await screenshot('four-options')
    await click('.studio-candidate:nth-child(2)'); await waitFor(`!!document.querySelector('.studio-feedback') && !document.querySelector('.studio-refine-batch').closest('fieldset').disabled`)
    const chosen = readState().stylizedPath
    await click('.studio-feedback-chips button:nth-child(2)'); await screenshot('feedback')
    await click('.studio-refine-batch'); await waitFor(`document.querySelectorAll('.studio-candidate:not(:disabled)').length === 4`)
    assert.equal(readCalls().drafts.length, 9)
    assert(readCalls().drafts.slice(5).every(c => c.path === chosen && c.intent.includes('保留五官')))
    assert.equal(readState().draftRounds.length, 2)
    assert.equal(readState().stylizedPath, chosen, 'new round does not silently replace selected design')
    await click('.studio-candidate:nth-child(1)'); await click('.studio-use-choice'); await waitFor(`!!document.querySelector('.studio-ready')`)
    assert.equal(readCalls().stitches.length, 1)
    assert.equal(readCalls().stitches[0].path, readState().stylizedPath)
    await click('.studio-ready .studio-download'); assert(readCalls().exportCount > 100)
    await click('[data-view="choices"]')
    win.setSize(1080, 750); await screenshot('compact'); assert(await run('document.documentElement.scrollWidth <= innerWidth'))
    nativeTheme.themeSource = 'dark'; await screenshot('dark')
    await win.loadFile(join(root, 'out/renderer/index.html')); await click('.nav-project > button'); await waitFor(`!!document.querySelector('.studio-ready')`)
    assert.equal(readState().draftRounds.length, 2)
    await click('[data-view="choices"]'); await waitFor(`document.querySelectorAll('.studio-candidate img').length === 4`)
    await click('.studio-generate'); await waitFor(`document.querySelectorAll('.studio-candidate:not(:disabled)').length === 4`)
    assert.equal(readState().draftRounds.length, 3)
    assert(readCalls().drafts.slice(9).every(c => c.path === readState().imagePath), 'new round uses original photo')
    assert.equal(readCalls().stitches.length, 1)
    // A persisted in-flight candidate must become retryable on reopen.
    await delay(1000)
    const interrupted = readState(); interrupted.draftRounds[2].candidates[3] = { ...interrupted.draftRounds[2].candidates[3], status: 'generating', path: undefined }
    fs.writeFileSync(statePath, JSON.stringify(interrupted))
    await win.loadFile(join(root, 'out/renderer/index.html')); await click('.nav-project > button'); await click('[data-view="choices"]'); await waitFor(`!!document.querySelector('.studio-retry')`)
    await click('.studio-retry'); await waitFor(`document.querySelectorAll('.studio-candidate:not(:disabled)').length === 4`)
    assert.equal(readCalls().drafts.length, 14)
    assert.deepEqual(errors, [])
    fs.writeFileSync(join(out, 'ui-result.json'), JSON.stringify({ passed: true, draftRequests: 14, stitchRequests: 1, checks: ['4 choices', 'unique seeds', 'partial failure', 'retry only missing', 'feedback uses selected image', 'explicit digitize', 'export', 'restore rounds', 'fresh round uses original', 'interrupted recovery', 'compact', 'dark'], mockedInference: true }, null, 2))
    console.log('PASS four-choice UI, partial retry, feedback, selection, explicit stitches/export, restore, interruption, compact/dark.'); app.exit(0)
  } catch (error) { console.error(error); await screenshot('failure'); app.exit(1) }
})
