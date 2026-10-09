import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const require=createRequire(import.meta.url)
const core=require('../crates/emby-core/emby-core.win32-x64-msvc.node')
const root=resolve(process.argv[2]??'..');const out=join(root,'doc/flow-stitch-tests');mkdirSync(out,{recursive:true})
const input=join(root,'doc/backend-draft-tests/cat-draft.png')
const objects=core.analyzeArtwork(input,8,100)
const base={...objects,imagePath:input,maxColors:8,sizeMm:{width:100,height:objects.heightMm},sourceHash:createHash('sha256').update(readFileSync(input)).digest('hex'),notes:['方向场对照：10 条人工毛流引导与 2 个手工标注的虹膜圆心；并非自动毛发识别。']}
const guides=[
  [35,18,65,12],[55,20,85,13],[66,36,80,10],[58,57,85,10],
  [20,38,25,12],[22,59,12,13],[37,71,0,11],[73,67,-20,11],[83,48,-40,11],[84,22,-55,12]
].map(([xMm,yMm,angleDeg,radiusMm])=>({xMm,yMm,angleDeg,radiusMm}))
function svg(s){let x=0,y=0;const lines=[];for(const p of s.points){if(p.flag===0)lines.push(`<path d="M${x.toFixed(3)} ${y.toFixed(3)}L${p.x.toFixed(3)} ${p.y.toFixed(3)}" stroke="${s.palette[p.color]}"/>`);if(p.flag!==2){x=p.x;y=p.y}}
return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="#f7f3eb"/><g stroke-width="0.25" stroke-linecap="round" fill="none">${lines.join('')}</g></svg>`}
const results=[]
for(const mode of ['previous','auto','guided','radial','hybrid']){
  const plan=structuredClone(base)
  plan.routeTravel=false // Keep this direction-only benchmark independent of later routing changes.
  for(const r of plan.regions){r.underlay=false;if(mode!=='previous'){r.stitchType=mode==='radial'?'radial':'flow';r.angleDeg=0}}
  if(mode==='guided'||mode==='hybrid')plan.directionGuides=guides
  if(mode==='hybrid')plan.directionGuides=[...guides,{kind:'radial',xMm:40.2,yMm:44.4,angleDeg:0,radiusMm:7.2},{kind:'radial',xMm:72.4,yMm:47.8,angleDeg:0,radiusMm:5.4}]
  const s=core.stitchArtwork(plan,0.3,3)
  assert(s.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)))
  let x=0,y=0,max=0,jumps=0;for(const p of s.points){if(p.flag===0)max=Math.max(max,Math.hypot(p.x-x,p.y-y));if(p.flag===1)jumps++;if(p.flag!==2){x=p.x;y=p.y}}
  assert(max<=3.00001)
  writeFileSync(join(out,`cat-${mode}.svg`),svg(s))
  writeFileSync(join(out,`cat-${mode}.json`),JSON.stringify(s))
  writeFileSync(join(out,`plan-${mode}.json`),JSON.stringify(plan))
  results.push({mode,stitches:s.stitchCount,jumps,maxLength:max});console.log(results.at(-1))
  let px=0,py=0;const records=s.points.map(p=>{if(p.flag===2)return{dxMm:0,dyMm:0,flag:2};const x=Math.round(p.x*10)/10,y=Math.round(p.y*10)/10;const rec={dxMm:x-px,dyMm:y-py,flag:p.flag};px=x;py=y;return rec})
  writeFileSync(join(out,`cat-${mode}.dst`),core.dstEncode(records,`cat_${mode}`))
  if(mode==='hybrid'){
    writeFileSync(join(out,'cat-plan.json'),JSON.stringify(plan));writeFileSync(join(out,'cat-stitches.json'),JSON.stringify(s))
    const repeated=core.stitchArtwork(JSON.parse(JSON.stringify(plan)),0.3,3);assert.deepEqual(s.points,repeated.points,'restored field and guides must produce the same stitches')
    const bad=structuredClone(plan);bad.directionField.cos2.pop();assert.throws(()=>core.stitchArtwork(bad,0.3,3),/direction field/)
  }
}
writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2))
writeFileSync(join(out,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>毛流方向对照</title><style>body{font:16px/1.65 system-ui;margin:24px;background:#f5f4ef;color:#263c30}main{max-width:1350px;margin:auto}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}img{width:100%;display:block}figure{margin:0;background:white;padding:14px;border-radius:12px}h1{font-size:28px}h2{font-size:20px}section{background:white;padding:20px;margin:22px 0;border-radius:12px}a{color:#176744}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ddd;text-align:left}@media(max-width:700px){.grid{grid-template-columns:1fr}body{margin:12px}}</style><main><h1>毛流 + 圆弧法线：新的实际针迹对照</h1><p>相同猫图、相同色块、100 mm、8 色、0.45 mm 行距。所有对照关闭底针，先比较面针方向；这些线条来自实际针位坐标。旧算法最大针长 3 mm，新流线每约 1.8 mm 落针，因而针数不可视作纯方向因素。</p><div class="grid">${['previous','hybrid'].map((m,i)=>`<figure><h2>${['上一版：每色块一个主方向','本轮：人工毛流引导 + 虹膜共同圆心法线'][i]}</h2><img src="cat-${m}.svg" alt="${m}实际针迹"><a href="cat-${m}.json">针迹 JSON</a> · <a href="cat-${m}.dst">面针实验 DST</a></figure>`).join('')}</div><section><h2>哪些是自动的，哪些是人工的？</h2><p>自动：从图稿估计局部结构方向，跨色块平滑，并沿方向场生成有间距的流线。人工：本轮标注了 10 条毛发方向和 2 个虹膜圆心。引导坐标完整保存于 <a href="plan-hybrid.json">方案 JSON</a>，没有训练神经网络或自动识别五官。</p><p>自动方案仍会顺着色环绕眼睛走；将全图色块一律设成放射状会产生不自然的“星芒”。毛发和圆形结构需要分别处理。即使有引导，眼周衔接、碎线和跳针仍未解决，不能判为生产合格。</p><p>软件入口：重新分析图稿 → “连续毛流” → 选择“拖画毛流方向”顺毛拖线，或“拖画圆弧法线”从圆心拖至边缘 → 重新生成针迹。方向场和引导会保存进项目。底针现在可单独显示，导出仍保留启用的底针。</p></section><div class="grid">${['auto','guided','radial'].map((m,i)=>`<figure><h2>${['全自动图像方向场','只有人工毛流引导','全部色块使用各自椭圆法线（不推荐）'][i]}</h2><img src="cat-${m}.svg" alt="${m}对照"></figure>`).join('')}</div><section><h2>约束与代价</h2><table><tr><th>方案</th><th>针数</th><th>跳针次数</th><th>最大针长 mm</th></tr>${results.map(r=>`<tr><td>${r.mode}</td><td>${r.stitches}</td><td>${r.jumps}</td><td>${r.maxLength.toFixed(3)}</td></tr>`).join('')}</table><p>流线之间没有直接缝出斜向连接，避免破坏毛流，但跳针增加了；还需要在底针层规划隐藏走线，或按机器能力剪线。当前图只是面针方向实验，尚未试绣。</p><h2>神经网络适合补在哪里？</h2><p>本轮说明：给定较好的方向引导，几何算法可以生成连贯针迹；困难在于自动判断真正毛流、五官和弧线中心。下一步可让模型预测局部方向、置信度和语义区域，再由现有程序处理间距、边界、针长与机器命令。当前图片数据集缺少方向和区域标注，需要先补这些训练目标。</p><p>算法参考：<a href="https://www.mia.uni-saarland.de/weickert/Papers/habil.pdf">结构张量与一致性方向</a> · <a href="https://inkstitch.org/docs/stitches/guided-fill/">Ink/Stitch 引导填针</a>。这不是现成 Ink/Stitch 算法的移植。</p></section></main></html>`)
