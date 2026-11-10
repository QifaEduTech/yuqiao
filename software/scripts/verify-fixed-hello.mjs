import {chromium} from '@playwright/test';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const directory=resolve(root,'.runtime-logs/anny-preview');await mkdir(directory,{recursive:true});
const thanks=JSON.parse(await readFile(resolve(root,'shared/sign-motions/anny/csl.thanks.json'),'utf8'));
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});const requests=[],errors=[];
  await page.route('**/api/**',r=>{requests.push(r.request().url());return r.abort();});page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/anny-review.html?motion=csl.hello&version=user-description-1');await page.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.hello');
  const metrics=await page.evaluate(async thanks=>{
    const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');const {authorThanks}=await import('/web/src/annyAuthoring.ts');
    const {rig}=window.__annyPreview,clip=window.__annyFixedMotion;
    rig.ready();const idle=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));
    applyFixedMotion(rig,clip,.9);
    const indexDirection=rig.tip('R',2).sub(rig.world('finger2-1.R')).normalize();
    const openIndexDistance=rig.tip('R',2).distanceTo(rig.world('wrist.R'));
    const indexMiddlePoint=rig.bones['finger2-2.R'].quaternion.clone(),thumbPoint=rig.bones['finger1-2.R'].quaternion.clone();
    const foldedMiddle=rig.rest['finger3-2.R'].angleTo(rig.bones['finger3-2.R'].quaternion);
    applyFixedMotion(rig,clip,2.4);
    const thumbUp=rig.tip('R',1).sub(rig.world('finger1-2.R')).normalize().y;
    const indexDistanceReduction=openIndexDistance-rig.tip('R',2).distanceTo(rig.world('wrist.R'));
    const indexFoldChange=indexMiddlePoint.angleTo(rig.bones['finger2-2.R'].quaternion),thumbOpenChange=thumbPoint.angleTo(rig.bones['finger1-2.R'].quaternion);
    const rootRotation=rig.rest['finger1-1.R'].angleTo(rig.bones['finger1-1.R'].quaternion),goodThumb=rig.bones['finger1-2.R'].quaternion.clone();
    let leftDrift=0,goodThumbDrift=0;
    for(const frame of clip.frames){applyFixedMotion(rig,clip,frame.t);for(const [k,b] of Object.entries(rig.bones))if(k.endsWith('.L'))leftDrift=Math.max(leftDrift,idle[k].angleTo(b.quaternion));if(frame.t>=2&&frame.t<=3.2)goodThumbDrift=Math.max(goodThumbDrift,goodThumb.angleTo(rig.bones['finger1-2.R'].quaternion));}
    const endError=Math.max(...Object.entries(rig.bones).map(([k,b])=>idle[k].angleTo(b.quaternion)));
    const thanksUnchanged=JSON.stringify(authorThanks(rig))===JSON.stringify(thanks);
    return {id:clip.asset.id,version:clip.asset.version,indexForward:indexDirection.z,foldedMiddle,thumbUp,indexDistanceReduction,indexFoldChange,thumbOpenChange,rootRotation,leftDrift,goodThumbDrift,endError,thanksUnchanged};
  },thanks);
  const seek=async t=>{await page.getByRole('slider',{name:'动作进度'}).evaluate((el,t)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(t));el.dispatchEvent(new Event('input',{bubbles:true}));},t);await page.waitForTimeout(200);};
  await seek(.9);await page.getByRole('button',{name:'全身',exact:true}).click();await page.screenshot({path:resolve(directory,'hello-you-body.png'),fullPage:true});
  await page.getByRole('button',{name:'手指特写',exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:resolve(directory,'hello-you-hand.png')});
  await seek(2.4);await page.screenshot({path:resolve(directory,'hello-good-hand.png')});
  await page.getByRole('button',{name:'复位',exact:true}).click();await page.getByTestId('motion-play').click();await page.waitForTimeout(600);await page.getByRole('button',{name:'暂停动作',exact:true}).click();await page.waitForTimeout(150);
  const paused=Number(await page.getByRole('slider',{name:'动作进度'}).inputValue());await page.waitForTimeout(200);if(Math.abs(Number(await page.getByRole('slider',{name:'动作进度'}).inputValue())-paused)>.02)throw Error('Pause failed');
  await page.getByRole('combobox',{name:'选择固定动作'}).selectOption('csl.thanks');await page.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.thanks');
  await page.getByRole('combobox',{name:'选择固定动作'}).selectOption('csl.hello');await page.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.hello');
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'重置视角',exact:true}).click();await seek(2.4);await page.screenshot({path:resolve(directory,'hello-mobile.png'),fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  const result={...metrics,apiRequests:requests,errors,overflow};console.log(JSON.stringify(result,null,2));await writeFile(resolve(directory,'hello-verification.json'),JSON.stringify(result,null,2));
  if(metrics.indexForward<.95||metrics.foldedMiddle<.8||metrics.thumbUp<.866||metrics.indexDistanceReduction<.035||metrics.indexFoldChange<.7||metrics.thumbOpenChange<.5||metrics.rootRotation>.001||metrics.leftDrift>.001||metrics.goodThumbDrift>.001||metrics.endError>.001||!metrics.thanksUnchanged||requests.length||errors.length||overflow)throw Error('Hello motion verification failed');
}finally{await browser.close();}
