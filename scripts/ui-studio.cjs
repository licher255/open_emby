// Consumer flow test with the actual generated artwork/paper result as deterministic service responses.
const {app,BrowserWindow,nativeTheme}=require('electron')
const fs=require('node:fs'),{join,resolve}=require('node:path'),{tmpdir}=require('node:os'),assert=require('node:assert/strict')
app.disableHardwareAcceleration()
const root=resolve(__dirname,'..'),out=resolve(root,'../doc/product-flow-tests'),temp=fs.mkdtempSync(join(tmpdir(),'emby-studio-'))
app.setPath('userData',temp)
const preload=join(temp,'preload.cjs'),statePath=join(temp,'state.json'),callsPath=join(temp,'calls.json')
fs.writeFileSync(preload,`
const {contextBridge}=require('electron'),fs=require('node:fs'),{join}=require('node:path');
const out=${JSON.stringify(out)},statePath=${JSON.stringify(statePath)},callsPath=${JSON.stringify(callsPath)};
const photo=${JSON.stringify(resolve(root,'../doc/prompt-tests/inputs/cat.png'))};
const plan=JSON.parse(fs.readFileSync(join(out,'plan.json'),'utf8')),result=JSON.parse(fs.readFileSync(join(out,'stitches.json'),'utf8'));
let state=null,calls={},n=0;const data=p=>'data:image/png;base64,'+fs.readFileSync(p).toString('base64');const record=()=>fs.writeFileSync(callsPath,JSON.stringify(calls));
contextBridge.exposeInMainWorld('openEmby',{
window:{isMaximized:async()=>false,onMaximizedChanged:()=>()=>{},minimize:()=>{},toggleMaximize:()=>{},close:()=>{}},
settings:{get:async()=>({locale:'zh-CN',draftBackend:'qwen',comfyUrl:'http://127.0.0.1:8188'}),set:async x=>x},
projects:{list:async()=>[{id:'studio',name:'我的小猫',imageCount:0,createdAt:'2026-10-03T00:00:00Z'}],images:async()=>[],history:async()=>[],loadState:async()=>fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):null,saveState:async(id,s)=>{state=s;fs.writeFileSync(statePath,JSON.stringify(s))},importImage:async(id,path)=>path,saveImage:async(id,source,stem)=>{const path=join(${JSON.stringify(temp)},stem+'-'+(++n)+'.png');fs.writeFileSync(path,Buffer.from(source.split(',')[1],'base64'));return path}},
files:{selectImage:async()=>photo,readImageDataUrl:async p=>data(p),readImageThumb:async p=>data(p),pathForFile:f=>f.path},
engine:{onProgress:()=>()=>{},generateDraft:async(path,colors,intent,style)=>{calls.draft={path,colors,intent,style};record();await new Promise(r=>setTimeout(r,300));return data(join(out,'artwork.png'))}},
sidecar:{digitizePlan:async(imagePath,intent,widthMm,maxColors)=>({...plan,imagePath,intent,widthMm,maxColors}),digitizeStitches:async(path,colors,width,post,p,backend)=>{calls.stitches={backend};record();await new Promise(r=>setTimeout(r,300));return result},exportSave:async req=>{calls.export={count:req.points.length};record();return{ok:true,files:[join(out,'product_flow.dst')]}}},
envStatus:async()=>({dataRoot:'E:/Embroidery',version:'0.0.2-beta',engine:{reachable:true,url:'http://127.0.0.1:8189'},sidecar:{running:true,url:'http://127.0.0.1:8100'}}),models:{list:async()=>[]},plugins:{list:async()=>[]}
})`)
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1440,height:950,webPreferences:{preload,sandbox:false,offscreen:true,backgroundThrottling:false}})
  const errors=[];win.webContents.on('console-message',(_,level,msg)=>{if(level===3){errors.push(msg);console.error(msg)}})
  const run=code=>win.webContents.executeJavaScript(code),delay=ms=>new Promise(r=>setTimeout(r,ms))
  async function wait(selector){for(let i=0;i<100;i++){if(await run(`!!document.querySelector(${JSON.stringify(selector)})`))return;await delay(60)}throw new Error('Missing '+selector)}
  async function click(selector){await wait(selector);await run(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(180)}
  async function shot(name){win.webContents.invalidate();await delay(150);fs.writeFileSync(join(out,name+'.png'),(await win.webContents.capturePage()).toPNG())}
  try {
    await win.loadFile(join(root,'out/renderer/index.html'));await click('.nav-project > button');await wait('.studio-upload');await shot('studio-upload')
    assert.equal(await run(`document.querySelectorAll('.nav-step').length`),0,'expert steps hidden by default')
    await click('.studio-upload');await wait('.studio-tabs');await click('.studio-style button:nth-child(2)');await shot('studio-photo')
    await click('.studio-generate');await wait('.studio-ready');await delay(900)
    const calls=JSON.parse(fs.readFileSync(callsPath));assert.equal(calls.draft.style,'soft');assert.equal(calls.stitches.backend,'paper')
    await shot('studio-result')
    await click('.studio-tabs button:nth-child(2)');await shot('studio-artwork')
    await click('.studio-download');assert(JSON.parse(fs.readFileSync(callsPath)).export.count>100)
    await click('.studio-ready .studio-secondary');await wait('.object-canvas');assert(await run(`document.querySelectorAll('.nav-step').length>0`));await click('.studio-back');await wait('.studio')
    win.setSize(1080,750);await delay(200);await shot('studio-compact');assert(await run('document.documentElement.scrollWidth<=innerWidth'),'no horizontal overflow')
    nativeTheme.themeSource='dark';await delay(200);await shot('studio-dark')
    await win.reload();await click('.nav-project > button');await wait('.studio-ready');assert.equal(await run(`document.querySelectorAll('.nav-step').length`),0)
    assert.deepEqual(errors,[]);console.log('PASS upload → soft artwork → paper result → export, default simple mode, expert return, restore, compact and dark UI.');app.exit(0)
  }catch(error){console.error(error);await shot('studio-failure');app.exit(1)}
})
