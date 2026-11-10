import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const mobile=process.argv.includes('--mobile');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const directory=resolve(root,'.runtime-logs/anny-preview');await mkdir(directory,{recursive:true});
try{
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1100}});
  const apiRequests=[],errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.route('**/api/**',route=>{apiRequests.push(route.request().url());return route.abort();});
  await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>!!window.__annyFixedMotion);
  const checks=await page.evaluate(async()=>{
    const {applyFixedMotion,loadFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');
    const {rig}=window.__annyPreview;const clip=window.__annyFixedMotion;
    applyFixedMotion(rig,clip,.75);const open=rig.bones['finger1-2.R'].quaternion.clone();
    const openTip=rig.tip('R',1),thumbBase=rig.world('finger1-2.R');
    const upDot=openTip.clone().sub(thumbBase).normalize().y;
    const rootRotation=rig.rest['finger1-1.R'].angleTo(rig.bones['finger1-1.R'].quaternion);
    const index=rig.world('finger2-2.R');const openDistance=openTip.distanceTo(index);
    const fixedFinger=rig.bones['finger2-2.R'].quaternion.clone();
    let pulses=0,inPulse=false,minStraight=1,maxFingerDrift=0;
    for(let i=18;i<=99;i++){
      applyFixedMotion(rig,clip,i/30);const angle=open.angleTo(rig.bones['finger1-2.R'].quaternion);
      if(angle>.35&&!inPulse)pulses++;inPulse=angle>.35;
      const shoulder=rig.world('upperarm01.R'),elbow=rig.world('lowerarm01.R'),wrist=rig.world('wrist.R');
      minStraight=Math.min(minStraight,elbow.clone().sub(shoulder).normalize().dot(wrist.clone().sub(elbow).normalize()));
      maxFingerDrift=Math.max(maxFingerDrift,fixedFinger.angleTo(rig.bones['finger2-2.R'].quaternion));
    }
    applyFixedMotion(rig,clip,1.15);const thumbApproach=openDistance-rig.tip('R',1).distanceTo(rig.world('finger2-2.R'));
    let rejectsReady=false;try{loadFixedMotion(rig,{...clip.asset,status:'ready',verifiedBy:'fake'});}catch{rejectsReady=true;}
    rig.ready();
    return {pulses,minStraight,upDot,rootRotation,maxFingerDrift,thumbApproach,rejectsReady,duration:clip.asset.duration,frames:clip.frames.length,videoElements:document.querySelectorAll('video').length,overflow:document.documentElement.scrollWidth>innerWidth};
  });
  await page.getByTestId('motion-play').click();await page.waitForTimeout(650);await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.waitForTimeout(150);
  const paused=Number(await page.getByRole('slider',{name:'动作进度'}).inputValue());await page.waitForTimeout(200);
  if(Math.abs(Number(await page.getByRole('slider',{name:'动作进度'}).inputValue())-paused)>.02)throw Error('Pause failed');
  const seek=async t=>{
    await page.getByRole('slider',{name:'动作进度'}).evaluate((element,time)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,String(time));element.dispatchEvent(new Event('input',{bubbles:true}));},t);await page.waitForTimeout(200);
  };
  await seek(.75);await page.getByRole('button',{name:'全身',exact:true}).click();await page.waitForTimeout(150);
  await page.screenshot({path:resolve(directory,mobile?'fixed-mobile.png':'fixed-body.png'),fullPage:true});
  await page.getByRole('button',{name:'手指特写',exact:true}).click();await page.waitForTimeout(200);
  await page.screenshot({path:resolve(directory,mobile?'fixed-mobile-open.png':'fixed-thumb-open.png')});
  await seek(1.15);await page.screenshot({path:resolve(directory,mobile?'fixed-mobile-bent.png':'fixed-thumb-bent.png')});
  await page.getByRole('button',{name:'复位',exact:true}).click();await page.getByRole('combobox',{name:'动作播放速度'}).selectOption('0.5');
  await page.getByTestId('motion-play').click();await page.waitForTimeout(600);await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.waitForTimeout(150);
  checks.halfSpeedTime=Number(await page.getByRole('slider',{name:'动作进度'}).inputValue());
  await seek(3.95);await page.getByRole('combobox',{name:'动作播放速度'}).selectOption('1');await page.getByTestId('motion-play').click();await page.waitForTimeout(250);
  checks.stoppedAtEnd=await page.getByRole('button',{name:'暂停动作',exact:true}).isDisabled();
  const result={...checks,anonymous:true,apiRequests,errors};console.log(JSON.stringify(result,null,2));
  await writeFile(resolve(directory,mobile?'fixed-mobile-verification.json':'fixed-verification.json'),JSON.stringify(result,null,2));
  // A natural thumbs-up can lean by up to 30 degrees. Forcing every segment
  // exactly vertical was the cause of the stretched first web space.
  if(apiRequests.length||errors.length||checks.pulses!==3||checks.minStraight<.999||checks.upDot<.866||checks.rootRotation>.001||checks.maxFingerDrift>.0001||checks.thumbApproach<.005||!checks.rejectsReady||checks.videoElements||checks.overflow||checks.halfSpeedTime<.15||checks.halfSpeedTime>.5||!checks.stoppedAtEnd)throw Error('Fixed motion validation failed');
}finally{await browser.close();}
