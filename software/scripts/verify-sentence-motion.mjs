import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');await mkdir('.runtime-logs/sentence-motion',{recursive:true});
const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{const p=await b.newPage({viewport:{width:1200,height:1000}});await p.goto('http://127.0.0.1:5173/anny-review.html');await p.waitForFunction(()=>window.__annyPreview);
 const reports=[];
 for(const [number,text] of ['你好，我爱你','你好，谢谢，再见'].entries()){
  const report=await p.evaluate(async text=>{
   const {planMotionText}=await import('/shared/motion-planner.mjs'),{fetchFixedPreview}=await import('/web/src/fixedMotionLibrary.ts'),{loadFixedMotion,applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');
   const plan=planMotionText(text);if(plan.status!=='sequence')throw Error('Expected sequence');const {rig}=window.__annyPreview,asset=await fetchFixedPreview(plan.preview,new AbortController().signal),clip=loadFixedMotion(rig,asset);window.__sentenceClip=clip;
   rig.idle();const idle=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));let maxStep=0,previous,minWristHeight=Infinity,maxElbowAngle=0;
   for(const frame of clip.frames){applyFixedMotion(rig,clip,frame.t);if(previous)for(const k of Object.keys(frame.rotations))maxStep=Math.max(maxStep,previous[k].angleTo(frame.rotations[k]));previous=frame.rotations;
    if(frame.t>=.8&&frame.t<=asset.duration-.8)minWristHeight=Math.min(minWristHeight,rig.world('wrist.R').y);
    maxElbowAngle=Math.max(maxElbowAngle,rig.world('lowerarm01.R').sub(rig.world('upperarm01.R')).angleTo(rig.world('wrist.R').sub(rig.world('lowerarm01.R')))*180/Math.PI);
   }
   return {text,duration:asset.duration,sequence:asset.sequence,maxStepDegrees:maxStep*180/Math.PI,minWristHeight,maxElbowAngle,endError:Math.max(...Object.entries(rig.bones).map(([k,b])=>idle[k].angleTo(b.quaternion)))};
  },text);reports.push(report);
  for(let i=1;i<report.sequence.length;i++){
   const time=(report.sequence[i-1].end+report.sequence[i].start)/2;
   await p.evaluate(async time=>{const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');const {rig,camera,controls}=window.__annyPreview;applyFixedMotion(rig,window.__sentenceClip,time);controls.target.set(0,1.2,.2);camera.position.set(.65,1.45,1.85);controls.update();},time);await p.waitForTimeout(80);await p.locator('.anny-viewport').screenshot({path:`.runtime-logs/sentence-motion/${number}-transition-${i}.png`});
  }
  if(report.maxStepDegrees>18||report.maxElbowAngle>150||report.minWristHeight<1.05||report.endError>.001)throw Error('Sentence transition geometry failed');
 }
 console.log(JSON.stringify(reports,null,2));await writeFile('docs/assets/sentence-motion-verification.json',JSON.stringify(reports,null,2)+'\n');
}finally{await b.close();}
