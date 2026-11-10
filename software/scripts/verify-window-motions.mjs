import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import scene from '../shared/service-window-scene.json' with {type:'json'};
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const out=resolve('.runtime-logs/window-motions');await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1200,height:1000}}),results=[];
 await page.goto('http://127.0.0.1:5173/anny-review.html');await page.waitForFunction(()=>window.__annyPreview&&window.__annyFixedMotion);
 const targets=process.argv.includes('--sequences')?[...scene.dialogue.filter(d=>d.motionIds.length>1),{text:'谢谢，再见'}]:scene.motions;
 for(const motion of targets){
  if(!motion.text){await page.getByLabel('选择固定动作').selectOption(motion.id);await page.waitForFunction(id=>window.__annyFixedMotion?.asset.id===id,motion.id);}
  const metrics=await page.evaluate(async phrase=>{
   const {rig}=window.__annyPreview,{applyFixedMotion,loadFixedMotion}=await import('/web/src/fixedAnnyMotion.ts'),THREE=await import('/node_modules/.vite/deps/three.js');
   let clip=window.__annyFixedMotion;
   if(phrase){const {planMotionText}=await import('/shared/motion-planner.mjs'),{fetchFixedPreview}=await import('/web/src/fixedMotionLibrary.ts');clip=loadFixedMotion(rig,await fetchFixedPreview(planMotionText(phrase).preview,new AbortController().signal));}
   rig.idle();const idle=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));
   const localPositions=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.position.clone()]));
   const g=rig.mesh.geometry,idx=g.index,body=[],points=[],samples=[];let restError=0,leftDrift=0,positionDrift=0,maxStep=0;
   const hand=[];
   for(let i=0;i<g.getAttribute('position').count;i++){
    const base=new THREE.Vector3().fromBufferAttribute(g.getAttribute('position'),i),point=base.clone().applyMatrix4(rig.mesh.matrixWorld);points.push(point);
    let arms=0,hands=0;const influences=[];
    for(let set=0;set<3;set++){const joints=g.getAttribute(set?`joints_${set}`:'skinIndex'),weights=g.getAttribute(set?`weights_${set}`:'skinWeight');for(let j=0;j<4;j++){const boneIndex=joints.getComponent(i,j),name=rig.mesh.skeleton.bones[boneIndex].name,w=weights.getComponent(i,j);if(/^(upperarm|lowerarm|wrist|finger)/.test(name))arms+=w;if(/^(wrist|finger)/.test(name))hands+=w;if(w)influences.push([boneIndex,w]);}}
    body[i]=arms<.02&&point.y>.97&&Math.abs(point.x)<.23;
    if(hands>.5&&i%3===0)hand.push({id:i,base:base.applyMatrix4(rig.mesh.bindMatrix),influences});
   }
   const grid=new Map(),cell=.02;
   for(let i=0;i<idx.count;i+=3){const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];if(!ids.every(id=>body[id]))continue;const tri=ids.map(id=>points[id]);for(let x=Math.floor(Math.min(...tri.map(p=>p.x))/cell);x<=Math.floor(Math.max(...tri.map(p=>p.x))/cell);x++)for(let y=Math.floor(Math.min(...tri.map(p=>p.y))/cell);y<=Math.floor(Math.max(...tri.map(p=>p.y))/cell);y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(tri);}}
   let maxDepth=0,penetrations=0,worst=null,previous=null;
   for(const frame of clip.frames){
    applyFixedMotion(rig,clip,frame.t);rig.mesh.skeleton.update();
    const matrices=rig.mesh.skeleton.bones.map((_,i)=>new THREE.Matrix4().fromArray(rig.mesh.skeleton.boneMatrices,i*16));
    for(const [k,b] of Object.entries(rig.bones)){
     if(frame.t===0||frame.t===clip.asset.duration)restError=Math.max(restError,idle[k].angleTo(b.quaternion));
     if(k.endsWith('.L'))leftDrift=Math.max(leftDrift,idle[k].angleTo(b.quaternion));
     positionDrift=Math.max(positionDrift,localPositions[k].distanceTo(b.position));
     if(previous?.[k])maxStep=Math.max(maxStep,previous[k].angleTo(b.quaternion));
    }
    previous=Object.fromEntries(Object.entries(rig.bones).map(([k,b])=>[k,b.quaternion.clone()]));
    for(const vertex of hand){
     const point=new THREE.Vector3();for(const [bone,w] of vertex.influences)point.addScaledVector(vertex.base.clone().applyMatrix4(matrices[bone]),w);
     point.applyMatrix4(rig.mesh.bindMatrixInverse).applyMatrix4(rig.mesh.matrixWorld);
     const tris=grid.get(Math.floor(point.x/cell)+','+Math.floor(point.y/cell));if(!tris)continue;let front=-Infinity,back=Infinity,count=0;
     for(const [a,b,c] of tris){const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-12)continue;const u=((b.y-c.y)*(point.x-c.x)+(c.x-b.x)*(point.y-c.y))/den,w=((c.y-a.y)*(point.x-c.x)+(a.x-c.x)*(point.y-c.y))/den;if(u<0||w<0||u+w>1)continue;const z=u*a.z+w*b.z+(1-u-w)*c.z;front=Math.max(front,z);back=Math.min(back,z);count++;}
     if(count>=2&&point.z>back+.001&&point.z<front-.001){penetrations++;const depth=Math.min(front-point.z,point.z-back);if(depth>maxDepth){maxDepth=depth;worst={t:frame.t,vertex:vertex.id,point:point.toArray()};}}
    }
    samples.push({t:frame.t,right:rig.world('wrist.R').toArray(),left:rig.world('wrist.L').toArray()});
   }
   return {id:clip.asset.id,version:clip.asset.version,frames:clip.frames.length,restError,leftDrift,positionDrift,maxStep,maxDepth,penetrations,worst,jaw:rig.world('jaw').toArray(),head:rig.world('head').toArray(),sampledHandVertices:hand.length,samples,scope:'30Hz, every third hand vertex against static head/torso Z envelope; excludes arms, inter-hand contact and clothing.'};
  },motion.text??null);
  results.push(metrics);
  if(motion.text){console.log(JSON.stringify({phrase:motion.text,...metrics,samples:undefined}));continue;}
  const seek=async t=>{await page.getByLabel('动作进度',{exact:true}).evaluate((el,t)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(t));el.dispatchEvent(new Event('input',{bubbles:true}));},t);await page.waitForTimeout(150);};
  const times=motion.label==='需要'?[.8,2.1]:motion.label==='请'?[2.1]:[1.2];
  for(const time of times){
   await seek(time);await page.getByRole('button',{name:'全身',exact:true}).click();await page.screenshot({path:resolve(out,`${motion.id}-${time}-body.png`)});
   for(const [name,offset] of [['front',[.05,.1,.8]],['side',[-.7,.08,.4]]]){
    await page.evaluate(offset=>{const {rig,camera,controls}=window.__annyPreview,center=rig.world('wrist.R').lerp(rig.tip('R',3),.5);if(['csl.ref.bmcx.1900','csl.ref.bmcx.1932'].includes(window.__annyFixedMotion.asset.id))center.lerp(rig.world('wrist.L'),.45);controls.target.copy(center);camera.position.copy(center).add(center.clone().set(...offset));controls.update();},offset);
    await page.waitForTimeout(100);await page.locator('canvas').first().screenshot({path:resolve(out,`${motion.id}-${time}-${name}.png`)});
   }
  }
  console.log(JSON.stringify({...metrics,samples:undefined}));
 }
 await writeFile(resolve(out,process.argv.includes('--sequences')?'sequence-metrics.json':'metrics.json'),JSON.stringify(results,null,2));
 if(results.some(m=>m.restError>.001||m.positionDrift>1e-8||m.maxStep>.5||m.maxDepth>.002||(['csl.ref.bmcx.1874','csl.ref.bmcx.1938'].includes(m.id)&&m.leftDrift>.001)))throw Error('Window motion invariant/clearance failed; inspect saved screenshots.');
}finally{await browser.close();}
