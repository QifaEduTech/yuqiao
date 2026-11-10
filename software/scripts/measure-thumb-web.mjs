import {chromium} from '@playwright/test';
import {resolve} from 'node:path';
import {writeFile} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'..');process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>!!window.__annyFixedMotion);
  const report=await page.evaluate(async()=>{
    const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');const {rig}=window.__annyPreview,clip=window.__annyFixedMotion;
    const geometry=rig.mesh.geometry,rootIndex=rig.mesh.skeleton.bones.findIndex(b=>b.name==='finger1-1.R');
    const selected=new Set();
    for(let i=0;i<geometry.getAttribute('position').count;i++){
      let thumbWeight=0;
      for(let s=0;s<3;s++){const joints=geometry.getAttribute(s?`joints_${s}`:'skinIndex'),weights=geometry.getAttribute(s?`weights_${s}`:'skinWeight');for(let j=0;j<4;j++)if(joints.getComponent(i,j)===rootIndex)thumbWeight+=weights.getComponent(i,j);}
      if(thumbWeight>.05&&thumbWeight<.95)selected.add(i);
    }
    const edges=new Map();for(let i=0;i<geometry.index.count;i+=3){const tri=[0,1,2].map(j=>geometry.index.getX(i+j));for(let j=0;j<3;j++){const a=tri[j],b=tri[(j+1)%3];if(selected.has(a)&&selected.has(b))edges.set([a,b].sort((x,y)=>x-y).join('-'),[a,b]);}}
    rig.ready();const before=new Map([...selected].map(i=>[i,rig.vertex(i)]));
    applyFixedMotion(rig,clip,.75);const after=new Map([...selected].map(i=>[i,rig.vertex(i)]));
    const ratios=[];for(const [a,b] of edges.values()){const length=before.get(a).distanceTo(before.get(b));if(length>.0015)ratios.push(after.get(a).distanceTo(after.get(b))/length);}ratios.sort((a,b)=>a-b);
    return {vertices:selected.size,edges:ratios.length,maxEdgeStretch:ratios.at(-1),p95EdgeStretch:ratios[Math.floor(ratios.length*.95)],thumbRootRotation:rig.rest['finger1-1.R'].angleTo(rig.bones['finger1-1.R'].quaternion),version:clip.asset.version};
  });
  console.log(JSON.stringify(report,null,2));await writeFile(resolve(root,`.runtime-logs/anny-preview/thumb-web-${report.version}.json`),JSON.stringify(report,null,2));
  if(report.thumbRootRotation>.001||report.maxEdgeStretch>1.8||report.p95EdgeStretch>1.25)throw Error('Thumb web-space stretch regression');
}finally{await browser.close();}
