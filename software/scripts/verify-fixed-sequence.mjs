import {chromium} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const output=resolve('.runtime-logs/sequence');await mkdir(output,{recursive:true});
const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const p=await b.newPage({viewport:{width:1200,height:1000}});const errors=[],api=[];p.on('pageerror',e=>errors.push(e.message));await p.route('**/api/**',r=>{api.push(r.request().url());return r.abort();});
 const asset=JSON.parse(await readFile('shared/sign-motions/anny/csl.i_love_you.json','utf8'));
 await p.goto('http://127.0.0.1:5173/anny-review.html?motion=csl.i_love_you&version='+asset.version);await p.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.i_love_you');
 const report=await p.evaluate(async()=>{
  const {rig}=window.__annyPreview,clip=window.__annyFixedMotion,{applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');rig.idle();const idle=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));
  let maxStep=0,minWristHeight=Infinity,maxElbowAngle=0,previous;
  for(const frame of clip.frames){applyFixedMotion(rig,clip,frame.t);if(previous)for(const k of Object.keys(frame.rotations))maxStep=Math.max(maxStep,previous[k].angleTo(frame.rotations[k]));previous=frame.rotations;
   if(frame.t>=.7&&frame.t<=6.8)minWristHeight=Math.min(minWristHeight,rig.world('wrist.R').y);
   const upper=rig.world('lowerarm01.R').sub(rig.world('upperarm01.R')),lower=rig.world('wrist.R').sub(rig.world('lowerarm01.R'));maxElbowAngle=Math.max(maxElbowAngle,upper.angleTo(lower)*180/Math.PI);
  }
  const endError=Math.max(...Object.entries(rig.bones).map(([k,b])=>idle[k].angleTo(b.quaternion)));
  return {id:clip.asset.id,version:clip.asset.version,duration:clip.asset.duration,sequence:clip.asset.sequence,maxStepDegrees:maxStep*180/Math.PI,minWristHeight,maxElbowAngle,endError};
 });
 const seek=async t=>{await p.getByRole('slider',{name:'动作进度'}).evaluate((el,t)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(t));el.dispatchEvent(new Event('input',{bubbles:true}));},t);await p.waitForTimeout(120);};
 for(const [name,t] of [['me',1],['me-love',1.9],['love',3.2],['love-you',4.95],['you',6]]){
  await seek(t);await p.evaluate(()=>{const {camera,controls}=window.__annyPreview;controls.target.set(0,1.2,.2);camera.position.set(.65,1.45,1.85);controls.update();});await p.locator('.anny-viewport').screenshot({path:resolve(output,name+'.png')});
 }
 await seek(1.5);await p.getByTestId('motion-play').click();await p.waitForTimeout(900);await p.getByRole('button',{name:'暂停动作',exact:true}).click();await p.waitForTimeout(150);
 const paused=Number(await p.getByRole('slider',{name:'动作进度'}).inputValue());await p.waitForTimeout(150);if(Math.abs(Number(await p.getByRole('slider',{name:'动作进度'}).inputValue())-paused)>.02||paused<=2.2)throw Error('Continuous playback or pause failed');
 await p.getByRole('combobox',{name:'动作播放速度'}).selectOption('1.5');await p.getByRole('button',{name:'重播动作',exact:true}).click();await p.waitForTimeout(250);if(Number(await p.getByRole('slider',{name:'动作进度'}).inputValue())>1)throw Error('Replay did not reset');await p.getByRole('button',{name:'暂停动作',exact:true}).click();
 await seek(7.5);await p.getByTestId('motion-play').click();await p.waitForTimeout(450);if(await p.getByRole('button',{name:'暂停动作',exact:true}).isEnabled())throw Error('Did not stop at sequence end');
 await p.setViewportSize({width:390,height:844});await p.getByRole('button',{name:'重置视角',exact:true}).click();await p.screenshot({path:resolve(output,'mobile.png'),fullPage:true});
 report.errors=errors;report.apiRequests=api;report.mobileOverflow=await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 console.log(JSON.stringify(report,null,2));await writeFile('docs/assets/sequence-verification.json',JSON.stringify(report,null,2)+'\n');
 if(report.maxStepDegrees>18||report.minWristHeight<1.05||report.endError>.001||errors.length||api.length||report.mobileOverflow)throw Error('Sequence motion check failed');
}finally{await b.close();}
