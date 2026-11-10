import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'.runtime-logs/yes-motion-v2');
process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5173/anny-review.html?motion=csl.yes&version=user-description-2');
 await page.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.yes',null,{timeout:60000});
 const metrics=await page.evaluate(async()=>{
  const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts'),{rig}=window.__annyPreview,clip=window.__annyFixedMotion;
  rig.idle();const idle=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));
  const positions=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.position.clone()]));
  let restError=0,leftDrift=0,positionDrift=0;const samples=[];
  for(const frame of clip.frames){
   applyFixedMotion(rig,clip,frame.t);
   for(const [k,b] of Object.entries(rig.bones)){
    if(frame.t===0||frame.t===clip.asset.duration)restError=Math.max(restError,idle[k].angleTo(b.quaternion));
    if(k.endsWith('.L'))leftDrift=Math.max(leftDrift,idle[k].angleTo(b.quaternion));
    positionDrift=Math.max(positionDrift,positions[k].distanceTo(b.position));
   }
   samples.push({t:frame.t,index:rig.tip('R',2).toArray(),middle:rig.tip('R',3).toArray()});
  }
  applyFixedMotion(rig,clip,1);
  const fingers=Object.fromEntries([1,2,3,4,5].map(i=>[i,{base:rig.world(`finger${i}-1.R`).toArray(),joint:rig.world(`finger${i}-2.R`).toArray(),tip:rig.tip('R',i).toArray()}]));
  const direction=rig.tip('R',2).sub(rig.world('finger2-1.R')).normalize().toArray();
  const down=samples.find(s=>s.t===1.2).index[1]-samples.find(s=>s.t===1.5).index[1];
  return {version:clip.asset.version,frames:clip.frames.length,restError,leftDrift,positionDrift,down,direction,fingers,samples};
 });
 if(metrics.restError>.001||metrics.leftDrift>.001||metrics.positionDrift>1e-9||metrics.down<.03||metrics.direction[1]<.2||metrics.direction[2]<.5)throw Error('Pose invariant failed: '+JSON.stringify(metrics));
 const seek=async t=>{await page.getByLabel('动作进度',{exact:true}).evaluate((el,t)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(t));el.dispatchEvent(new Event('input',{bubbles:true}));},t);await page.waitForTimeout(150);};
 await seek(1);
 await page.screenshot({path:resolve(out,'body.png')});
 for(const [name,t,offset] of [['hand-side',1,[-.48,.08,.12]],['hand-palm',1,[.48,.08,.12]],['hand-front',1,[.05,.05,.50]],['hand-dip',1.6,[-.48,.08,.12]]]){
  await seek(t);
  await page.evaluate(offset=>{const {rig,camera,controls}=window.__annyPreview,center=rig.world('wrist.R').lerp(rig.tip('R',2),.58);controls.target.copy(center);camera.position.copy(center).add(center.clone().set(...offset));controls.update();},offset);
  await page.waitForTimeout(200);await page.locator('canvas').first().screenshot({path:resolve(out,name+'.png')});
 }
 await page.getByTestId('motion-play').click();await page.waitForTimeout(300);await page.getByRole('button',{name:'暂停动作',exact:true}).click();
 await page.waitForTimeout(150); // The progress label is refreshed at 10 Hz.
 const paused=await page.getByLabel('动作进度',{exact:true}).inputValue();await page.waitForTimeout(250);
 if(await page.getByLabel('动作进度',{exact:true}).inputValue()!==paused)throw Error('Pause did not hold');
 await page.getByRole('button',{name:'重播动作',exact:true}).click();await page.waitForTimeout(200);
 if(Number(await page.getByLabel('动作进度',{exact:true}).inputValue())>1)throw Error('Replay did not restart');
 if(errors.length)throw Error(errors.join('\n'));
 await writeFile(resolve(out,'metrics.json'),JSON.stringify(metrics,null,2));
 console.log(JSON.stringify({...metrics,samples:undefined,fingers:metrics.fingers},null,2));
}finally{await browser.close();}
