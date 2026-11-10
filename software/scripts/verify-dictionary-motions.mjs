import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const out=resolve(root,'.runtime-logs/dictionary-motions');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}}),errors=[],api=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/**',route=>{api.push(route.request().url());return route.abort();});
 await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>window.__annyFixedMotion);
 const result={};
 for(const [id,time] of [['goodbye',1.2],['sorry',.95],['me',1.2],['love',1.3],['you',1.2]]){
  await page.getByRole('combobox',{name:'选择固定动作'}).selectOption('csl.'+id);await page.waitForFunction(id=>window.__annyFixedMotion.asset.id==='csl.'+id,id);
  const metrics=await page.evaluate(async()=>{
   const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts'),{rig}=window.__annyPreview,clip=window.__annyFixedMotion;
   rig.idle();const idle=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));
   let startError=0,endError=0,leftDrift=0,thumbRoot=0;const samples=[];
   for(const frame of clip.frames){
    applyFixedMotion(rig,clip,frame.t);
    if(frame.t===0)startError=Math.max(...Object.entries(rig.bones).map(([k,b])=>idle[k].angleTo(b.quaternion)));
    if(frame.t===clip.asset.duration)endError=Math.max(...Object.entries(rig.bones).map(([k,b])=>idle[k].angleTo(b.quaternion)));
    for(const [k,b] of Object.entries(rig.bones))if(k.endsWith('.L'))leftDrift=Math.max(leftDrift,idle[k].angleTo(b.quaternion));
    thumbRoot=Math.max(thumbRoot,rig.rest['finger1-1.R'].angleTo(rig.bones['finger1-1.R'].quaternion));
    samples.push({t:frame.t,wrist:rig.world('wrist.R').toArray(),index:rig.tip('R',2).toArray(),pinky:rig.tip('R',5).toArray(),leftThumb:rig.tip('L',1).toArray()});
   }
   const sample=t=>{applyFixedMotion(rig,clip,t);return {indexDirection:rig.tip('R',2).sub(rig.world('finger2-1.R')).normalize().toArray(),pinkyDirection:rig.tip('R',5).sub(rig.world('finger5-1.R')).normalize().toArray(),index:rig.tip('R',2).toArray(),pinky:rig.tip('R',5).toArray(),indexFold:rig.rest['finger2-2.R'].angleTo(rig.bones['finger2-2.R'].quaternion),thumbDistance:rig.tip('R',2).distanceTo(rig.world('finger1-2.L').lerp(rig.tip('L',1),.6))};};
   const first=sample(1),second=sample(2.35);applyFixedMotion(rig,clip,1);
   const wrist=rig.world('wrist.R'),forearm=wrist.clone().sub(rig.world('lowerarm01.R')).normalize(),palmLong=rig.world('finger3-1.R').sub(wrist).normalize();
   const across=rig.world('finger2-1.R').sub(rig.world('finger5-1.R'));across.addScaledVector(palmLong,-across.dot(palmLong)).normalize();
   const normal=across.clone().cross(palmLong).normalize(),down=palmLong.clone().set(0,-1,0).addScaledVector(palmLong,palmLong.y).normalize();
   const salute={straightWristDot:forearm.dot(palmLong),palmTiltDegrees:normal.angleTo(down)*180/Math.PI,palmDown:normal.y,palmOut:normal.z,middleTip:rig.tip('R',3).toArray(),head:rig.world('head').toArray()};
   return {id:clip.asset.id,version:clip.asset.version,duration:clip.asset.duration,frames:clip.frames.length,startError,endError,leftDrift,thumbRoot,first,second,salute,samples};
  });
  result[id]=metrics;
  if(metrics.startError>.001||metrics.endError>.001||(id!=='love'&&metrics.leftDrift>.001))throw Error('Idle/left-arm invariant failed: '+id);
  const seek=async t=>{await page.getByRole('slider',{name:'动作进度'}).evaluate((el,t)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(t));el.dispatchEvent(new Event('input',{bubbles:true}));},t);await page.waitForTimeout(100);};
  await seek(time);await page.getByRole('button',{name:'全身',exact:true}).click();await page.screenshot({path:resolve(out,`${id}-body.png`)});
  const close=async t=>{await seek(t);await page.evaluate(async()=>{const {rig,camera,controls}=window.__annyPreview;const center=rig.world('wrist.R').lerp(rig.tip('R',2),.6);controls.target.copy(center);camera.position.copy(center).add(center.clone().set(.38,.18,.8));controls.update();});await page.waitForTimeout(100);};
  await close(time);await page.screenshot({path:resolve(out,`${id}-hand.png`)});
  if(id==='sorry'){await close(2.35);await page.screenshot({path:resolve(out,'sorry-chest.png')});}
  await page.getByTestId('motion-play').click();await page.waitForTimeout(250);await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.waitForTimeout(150);const paused=await page.getByRole('slider',{name:'动作进度'}).inputValue();await page.waitForTimeout(100);if(await page.getByRole('slider',{name:'动作进度'}).inputValue()!==paused)throw Error('Pause failed');
 }
 const peaks=(samples,value,start,end)=>samples.filter((s,i)=>i&&i<samples.length-1&&s.t>start&&s.t<end&&value(s)>value(samples[i-1])+1e-6&&value(s)>=value(samples[i+1])).length;
 result.goodbye.cycles=peaks(result.goodbye.samples,s=>s.index[0],.9,2.9);
 result.sorry.taps=peaks(result.sorry.samples,s=>-s.pinky[2],2,4.2);
 const loveStroke=result.love.samples.filter(s=>s.t>=1&&s.t<=2.7);
 result.love.downwardDistance=loveStroke[0].wrist[1]-loveStroke.at(-1).wrist[1];
 result.love.upwardSteps=loveStroke.slice(1).filter((s,i)=>s.wrist[1]>loveStroke[i].wrist[1]+.0001).length;
 if(result.sorry.salute.straightWristDot<.999||Math.abs(result.sorry.salute.palmTiltDegrees-20)>.1||result.sorry.salute.palmDown>=0||result.sorry.salute.palmOut<=0||result.sorry.salute.middleTip[0]>=-.045||Math.abs(result.sorry.salute.middleTip[1]-result.sorry.salute.head[1]-.065)>.035)throw Error('Salute wrist/palm/temple checks failed');
 // Sorry v3 points diagonally inward towards the chest, avoiding a >90° wrist fold.
 if(result.goodbye.cycles!==2||result.sorry.taps!==3||result.love.downwardDistance<.035||result.love.upwardSteps||result.me.first.indexDirection[2]>-.95||result.you.first.indexDirection[2]<.95||result.sorry.second.pinkyDirection[2]>-.55||result.sorry.second.pinkyDirection[0]<.7||result.sorry.second.indexFold<.8)throw Error('Action geometry or count check failed: '+JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,{samples,...m}])=>[k,m]))));
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'重置视角',exact:true}).click();await page.screenshot({path:resolve(out,'mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 const report={date:'2026-10-15',actions:Object.fromEntries(Object.entries(result).map(([k,{samples,...m}])=>[k,m])),apiRequests:api,errors,mobileOverflow:overflow};
 await writeFile(resolve(root,'docs/assets/dictionary-motions-verification.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 if(api.length||errors.length||overflow)throw Error('Browser checks failed');
}finally{await browser.close();}



