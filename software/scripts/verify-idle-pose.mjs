import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const directory=resolve(root,'.runtime-logs/anny-preview');await mkdir(directory,{recursive:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>!!window.__annyFixedMotion);
  const report=await page.evaluate(async()=>{
    const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');
    const {rig}=window.__annyPreview,clip=window.__annyFixedMotion,g=rig.mesh.geometry;
    const groups={L:{hand:[],leg:[]},R:{hand:[],leg:[]}};
    for(let i=0;i<g.getAttribute('position').count;i++){
      const weights={L:{hand:0,leg:0},R:{hand:0,leg:0}};
      for(let set=0;set<3;set++){
        const joints=g.getAttribute(set?`joints_${set}`:'skinIndex'),w=g.getAttribute(set?`weights_${set}`:'skinWeight');
        for(let j=0;j<4;j++){
          const name=rig.mesh.skeleton.bones[joints.getComponent(i,j)].name;
          const side=name.endsWith('.L')?'L':name.endsWith('.R')?'R':null;if(!side)continue;
          const kind=/^(wrist|finger|metacarpal)/.test(name)?'hand':/^(upperleg|lowerleg|pelvis)/.test(name)?'leg':null;
          if(kind)weights[side][kind]+=w.getComponent(i,j);
        }
      }
      for(const side of ['L','R'])for(const kind of ['hand','leg'])if(weights[side][kind]>.5)groups[side][kind].push(i);
    }
    function measure(){
      return ['L','R'].map(side=>{
        const shoulder=rig.world(`upperarm01.${side}`),elbow=rig.world(`lowerarm01.${side}`),wrist=rig.world(`wrist.${side}`);
        const hand=groups[side].hand.map(i=>rig.vertex(i)),minY=Math.min(...hand.map(v=>v.y)),maxY=Math.max(...hand.map(v=>v.y));
        const legs=groups[side].leg.map(i=>rig.vertex(i)).filter(v=>v.y>=minY&&v.y<=maxY);
        if(!legs.length)throw Error('No leg surface samples at hand height');
        const gap=Math.min(...hand.map(v=>Math.abs(v.x)))-Math.max(...legs.map(v=>Math.abs(v.x)));
        return {side,shoulder:shoulder.toArray(),elbow:elbow.toArray(),wrist:wrist.toArray(),handLegGap:gap};
      });
    }
    rig.ready();const idle=measure();applyFixedMotion(rig,clip,0);const start=measure();applyFixedMotion(rig,clip,clip.asset.duration);const end=measure();
    rig.ready();return {idle,start,end,version:clip.asset.version};
  });
  await page.screenshot({path:resolve(directory,'idle-spaced-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'重置视角',exact:true}).click();
  await page.screenshot({path:resolve(directory,'idle-spaced-mobile.png'),fullPage:true});
  await page.goto('http://127.0.0.1:5173/');await page.waitForSelector('[data-model="anny-makehuman"][data-ready="true"]');
  await page.screenshot({path:resolve(directory,'idle-home-mobile.png'),fullPage:true});
  report.errors=errors;console.log(JSON.stringify(report,null,2));await writeFile(resolve(directory,'idle-spaced-verification.json'),JSON.stringify(report,null,2));
  for(const stage of ['idle','start','end'])for(const arm of report[stage]){
    if(arm.handLegGap<.04||arm.wrist[1]>=arm.elbow[1]-.1||arm.elbow[1]>=arm.shoulder[1]-.1)throw Error(`${stage} arms-down/leg-clearance check failed`);
  }
  if(errors.length)throw Error('Page errors');
}finally{await browser.close();}
