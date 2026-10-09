import { createRequire } from 'node:module'
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs'
import { join,resolve } from 'node:path'
import assert from 'node:assert/strict'
const require=createRequire(import.meta.url),core=require('../crates/emby-core/emby-core.win32-x64-msvc.node')
const root=resolve(process.argv[2]??'..'),out=join(root,'doc/routing-repro');mkdirSync(out,{recursive:true})
const cat=JSON.parse(readFileSync(join(root,'doc/flow-stitch-tests/plan-hybrid.json'),'utf8'))
function flags(s,key){const f=new Uint8Array(s.points.length);for(let i=0;i<(s[key]?.length??0);i+=2)f.fill(1,s[key][i],s[key][i+1]);return f}
function segments(s,excludeTravel=false){let prev=[0,0];const travel=flags(s,'travelRanges'),a=[];s.points.forEach((p,i)=>{if(p.flag===0&&(!excludeTravel||!travel[i]))a.push([prev[0],prev[1],p.x,p.y,p.color]);if(p.flag!==2)prev=[p.x,p.y]});return a}
function stats(s){let prev=[0,0],jumpCount=0,jumpLength=0,travelLength=0,totalLength=0,longJumps=0,maxLength=0;const travel=flags(s,'travelRanges');s.points.forEach((p,i)=>{if(p.flag===2)return;const d=Math.hypot(p.x-prev[0],p.y-prev[1]);if(p.flag===1){jumpCount++;jumpLength+=d;if(d>5)longJumps++}else{totalLength+=d;maxLength=Math.max(maxLength,d);if(travel[i])travelLength+=d}prev=[p.x,p.y]});return{stitches:s.stitchCount,jumpCount,longJumps,jumpLengthMm:jumpLength,travelLengthMm:travelLength,totalSewnLengthMm:totalLength,maxLengthMm:maxLength}}
function svg(s,overlay=false){let x=0,y=0;const travel=flags(s,'travelRanges'),paths=[];s.points.forEach((p,i)=>{if(p.flag===0)paths.push(`<path d="M${x.toFixed(3)},${y.toFixed(3)}L${p.x.toFixed(3)},${p.y.toFixed(3)}" stroke="${overlay&&travel[i]?'#e33269':s.palette[p.color]}" stroke-width="${overlay&&travel[i]?0.30:0.24}"/>`);if(p.flag!==2){x=p.x;y=p.y}});return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.widthMm} ${s.heightMm}"><rect width="100%" height="100%" fill="#f7f3eb"/><g fill="none" stroke-linecap="round">${paths.join('')}</g></svg>`}
const results=[]
function saveDst(s,path){let x=0,y=0;const records=s.points.map(p=>{if(p.flag===2)return{dxMm:0,dyMm:0,flag:2};const nx=Math.round(p.x*10)/10,ny=Math.round(p.y*10)/10;const r={dxMm:nx-x,dyMm:ny-y,flag:p.flag};x=nx;y=ny;return r});writeFileSync(path,core.dstEncode(records,'cat_routed'))}
for(const mode of ['surface','full']){
  const p=structuredClone(cat);if(mode==='full')for(const r of p.regions)r.underlay=r.areaMm2>10
  const t=performance.now();const before=core.stitchArtwork({...p,routeTravel:false},0.3,3),after=core.stitchArtwork({...p,routeTravel:true},0.3,3)
  const canonical=s=>segments(s,true).map(v=>JSON.stringify(v)).sort()
  assert.deepEqual(canonical(after),canonical(before),'every original surface/underlay segment must remain exactly unchanged (object order may change)')
  const beforeStats=stats(before),afterStats=stats(after);assert(afterStats.maxLengthMm<=3.000001)
  assert(afterStats.jumpCount<beforeStats.jumpCount)
  const travel=flags(after,'travelRanges');let last=[0,0],outside=0
  function label(x,y){if(x<0||y<0||x>=p.widthMm||y>=p.heightMm)return 0;return p.labels[Math.floor(y/p.heightMm*p.mapHeight)*p.mapWidth+Math.floor(x/p.widthMm*p.mapWidth)]}
  for(let i=0;i<after.points.length;i++){const q=after.points[i];if(q.flag===2)continue;if(travel[i]){const expected=label(last[0],last[1]);const n=Math.ceil(Math.hypot(q.x-last[0],q.y-last[1])/0.05);for(let j=0;j<=n;j++){const t=j/Math.max(1,n);if(!expected||label(last[0]+(q.x-last[0])*t,last[1]+(q.y-last[1])*t)!==expected)outside++}}last=[q.x,q.y]}
  assert.equal(outside,0,'internal travel must not cross holes or region boundaries')
  const result={mode,before:beforeStats,after:afterStats,seconds:(performance.now()-t)/1000,originalSegmentsChanged:0,travelOutsideRegion:outside};results.push(result);console.log(JSON.stringify(result))
  for(const [name,s]of[['before',before],['after',after]]){writeFileSync(join(out,`cat-${mode}-${name}.json`),JSON.stringify(s));writeFileSync(join(out,`cat-${mode}-${name}.svg`),svg(s))}
  writeFileSync(join(out,`cat-${mode}-travel.svg`),svg(after,true))
  if (mode==='full') {writeFileSync(join(out,'cat-plan.json'),JSON.stringify({...p,routeTravel:true}));writeFileSync(join(out,'cat-stitches.json'),JSON.stringify(after))}
  saveDst(before,join(out,`cat-${mode}-before.dst`));saveDst(after,join(out,`cat-${mode}-routed.dst`))
}
writeFileSync(join(out,'routing-results.json'),JSON.stringify(results,null,2))
console.log('PASS identical original segments, reduced jumps, bounded needle lengths, no travel outside its region.')
