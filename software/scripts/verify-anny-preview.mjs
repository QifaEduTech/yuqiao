import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const probe=process.argv.includes('--probe');
const mobile=process.argv.includes('--mobile');
const root=resolve(import.meta.dirname,'..');
process.env.TEMP=process.env.TMP=resolve(root,'.runtime-logs/tmp');
const directory=resolve(root,'.runtime-logs/anny-preview');await mkdir(directory,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1440,height:1100}});
  await page.route('**/api/sign/motion-references',route=>route.fulfill({json:{references:[]}}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto('http://127.0.0.1:5173/anny-review.html');
  try { await page.waitForFunction(()=>!!window.__annyPreview,{timeout:30000}); }
  catch(error) { console.log(JSON.stringify({errors,status:await page.locator('[role="status"]').allTextContents()})); await page.screenshot({path:resolve(directory,'load-error.png')}); throw error; }
  await page.waitForTimeout(800);
  await page.screenshot({path:resolve(directory,mobile?'mobile.png':'body.png'),fullPage:true});
  const result=await page.evaluate(({probe})=>{
    const {rig,renderer,camera}=window.__annyPreview;
    const measure=(side,index,override)=>{
      rig.ready();
      // Thumb opposition must be measured against the curled index, as it is
      // actually shown in the simultaneous closing loop, not an open finger.
      if(index===1)for(let other=2;other<=5;other++)rig.finger(side,other,1);
      const initial=rig.tip(side,index),wrist=rig.world(`wrist.${side}`);
      const target=index===1?rig.world(`finger2-2.${side}`):wrist;
      const a=rig.world(`finger2-1.${side}`).sub(wrist),b=rig.world(`finger5-1.${side}`).sub(wrist);
      const normal=a.clone().cross(b).normalize();
      if(normal.dot(rig.tip(side,1).sub(wrist))<0)normal.negate();
      rig.finger(side,index,1,override);const end=rig.tip(side,index);
      return {side,index,axis:override?.axis??rig.config.fingers[side][index].axis,sign:override?.sign??rig.config.fingers[side][index].sign,
        targetReduction:initial.distanceTo(target)-end.distanceTo(target),palmProjection:end.clone().sub(initial).dot(normal),movement:initial.distanceTo(end)};
    };
    const fingers=[],candidates=[];
    for(const side of ['L','R'])for(let index=1;index<=5;index++){
      fingers.push(measure(side,index));
      if(probe){for(const axis of ['x','y','z'])for(const sign of [-1,1])candidates.push(measure(side,index,{...rig.config.fingers[side][index],axis,sign}));}
    }
    rig.ready();const positions=Object.fromEntries(['wrist.L','wrist.R','lowerarm01.L','lowerarm01.R','head'].map(name=>[name,rig.world(name).toArray()]));
    const hands=['L','R'].map(side=>{const projected=rig.world(`wrist.${side}`).project(camera);return {side,inFrame:Math.abs(projected.x)<.9&&Math.abs(projected.y)<.9};});
    let maxWeightError=0,restError=0;rig.reset();
    const geometry=rig.mesh.geometry;
    for(let i=0;i<geometry.getAttribute('position').count;i++){
      let sum=0;for(let s=0;s<3;s++){const attr=geometry.getAttribute(s?`weights_${s}`:'skinWeight');for(let j=0;j<4;j++)sum+=attr.getComponent(i,j);}
      maxWeightError=Math.max(maxWeightError,Math.abs(1-sum));
      if(i%151===0){const expected=rig.world('root').clone().fromBufferAttribute(geometry.getAttribute('position'),i).applyMatrix4(rig.mesh.matrixWorld);restError=Math.max(restError,expected.distanceTo(rig.vertex(i)));}
    }
    const base=[];for(let i=0;i<geometry.getAttribute('position').count;i+=41)base.push([i,rig.vertex(i)]);
    rig.expression('jawOpen',1);const faceMovement=Math.max(...base.map(([i,v])=>v.distanceTo(rig.vertex(i))));
    rig.reset();rig.bones.jaw.rotateX(.22);const jawBoneMovement=Math.max(...base.map(([i,v])=>v.distanceTo(rig.vertex(i))));
    rig.ready();
    return {bones:Object.keys(rig.bones).length,morphs:rig.mesh.morphTargetInfluences.length,maxWeightError,restError,faceMovement,jawBoneMovement,fingers,candidates,positions,hands,
      triangles:renderer.info.render.triangles,programs:renderer.info.programs?.map(p=>({runnable:p.diagnostics?.runnable})),overflow:document.documentElement.scrollWidth>innerWidth};
  },{probe});
  await page.getByRole('button',{name:'手指特写',exact:true}).click();
  await page.waitForTimeout(300);
  await page.screenshot({path:resolve(directory,mobile?'mobile-hands.png':'hands-open.png')});
  await page.getByRole('button',{name:'手指开合',exact:true}).click();
  const cycleStart=await page.evaluate(()=>window.__annyPreview.rig.tip('L',3).toArray());
  await page.waitForTimeout(650);
  const cycleEnd=await page.evaluate(()=>window.__annyPreview.rig.tip('L',3).toArray());
  result.loopMovement=Math.hypot(...cycleStart.map((v,i)=>v-cycleEnd[i]));
  await page.getByRole('button',{name:'复位',exact:true}).click();
  await page.evaluate(()=>window.__annyPreview.rig.fingers(1));await page.waitForTimeout(200);
  await page.screenshot({path:resolve(directory,mobile?'mobile-closed.png':'hands-closed.png')});
  await page.getByRole('button',{name:'复位',exact:true}).click();
  await page.getByRole('button',{name:'面部特写',exact:true}).click();
  await page.evaluate(()=>window.__annyPreview.rig.expression('jawOpen',.6));await page.waitForTimeout(200);
  await page.screenshot({path:resolve(directory,mobile?'mobile-face.png':'face.png')});
  result.faceView=await page.evaluate(()=>{const {rig,camera}=window.__annyPreview;return {camera:camera.position.toArray(),head:rig.world('head').toArray(),projected:rig.world('head').project(camera).toArray()};});
  result.errors=errors;
  await writeFile(resolve(directory,probe?'probe.json':mobile?'mobile-verification.json':'verification.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,candidates:probe?'See probe.json':undefined},null,2));
  const badArm=['L','R'].some(side=>result.positions[`wrist.${side}`][1]>=result.positions[`lowerarm01.${side}`][1]-.1);
  const asymmetric=result.fingers.slice(0,5).some((f,i)=>Math.abs(f.targetReduction-result.fingers[i+5].targetReduction)>1e-5);
  if(!probe&&(errors.length||result.overflow||result.bones!==163||result.morphs!==52||result.maxWeightError>1e-5||result.restError>1e-5||result.faceMovement<.005||result.jawBoneMovement<.005||result.loopMovement<.001||badArm||asymmetric||result.hands.some(h=>!h.inFrame)||result.fingers.some(f=>f.targetReduction<.002||f.movement<.005||f.palmProjection<(f.index===1?-.005:0))))throw Error('Anny preview verification failed');
} finally {await browser.close();}
