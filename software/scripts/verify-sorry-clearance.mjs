import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
const target=process.argv[2]??'csl.sorry';if(!['csl.sorry','csl.i_love_you','csl.love'].includes(target))throw Error('Unsupported clearance target');
try{
 const page=await browser.newPage();await page.goto('http://127.0.0.1:5173/anny-review.html?motion='+target);await page.waitForFunction(id=>window.__annyFixedMotion?.asset.id===id,target);
 const result=await page.evaluate(async target=>{
  const {applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts'),{rig}=window.__annyPreview,clip=window.__annyFixedMotion;
  const g=rig.mesh.geometry,p=g.getAttribute('position'),index=g.index,points=[],body=[],hand=[];
  rig.idle();
  for(let i=0;i<p.count;i++){
   const point=rig.world('head').fromBufferAttribute(p,i).applyMatrix4(rig.mesh.matrixWorld);points.push(point);let arms=0,rightHand=0;
   for(let set=0;set<3;set++){const joints=g.getAttribute(set?`joints_${set}`:'skinIndex'),weights=g.getAttribute(set?`weights_${set}`:'skinWeight');for(let j=0;j<4;j++){const name=rig.mesh.skeleton.bones[joints.getComponent(i,j)].name,w=weights.getComponent(i,j);if(/^(upperarm|lowerarm|wrist|finger)/.test(name))arms+=w;if((target==='csl.sorry'?/^(wrist|finger).*\.R$/:/^(wrist|finger).*\.[LR]$/).test(name))rightHand+=w;}}
   body[i]=arms<.02&&point.y>.97&&Math.abs(point.x)<.23;
   if(rightHand>.5)hand.push(i);
  }
  // Orthographic Z-ray intersections against actual neutral head/torso triangles.
  // These regions are not animated by this clip. No head ellipsoid approximation.
  const cell=.02,grid=new Map();
  for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(!ids.every(n=>body[n]))continue;const tri=ids.map(n=>points[n]);
   const minX=Math.floor(Math.min(...tri.map(v=>v.x))/cell),maxX=Math.floor(Math.max(...tri.map(v=>v.x))/cell),minY=Math.floor(Math.min(...tri.map(v=>v.y))/cell),maxY=Math.floor(Math.max(...tri.map(v=>v.y))/cell);
   for(let x=minX;x<=maxX;x++)for(let y=minY;y<=maxY;y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(tri);}
  }
  let maxDepth=0,penetratingSamples=0,worst=null,minWristAlignment=1,maxElbowAngle=0;
  const sampled=hand.filter((_,i)=>i%2===0);
  const lastFrame=Math.round(clip.asset.duration*60);
  for(let frame=0;frame<=lastFrame;frame++){
   const t=frame/60;applyFixedMotion(rig,clip,t);
   const forearm=rig.world('wrist.R').sub(rig.world('lowerarm01.R')).normalize(),palm=rig.world('finger3-1.R').sub(rig.world('wrist.R')).normalize();
   minWristAlignment=Math.min(minWristAlignment,forearm.dot(palm));
   const upper=rig.world('lowerarm01.R').sub(rig.world('upperarm01.R')).normalize();maxElbowAngle=Math.max(maxElbowAngle,upper.angleTo(forearm)*180/Math.PI);
   for(const id of sampled){const point=rig.vertex(id),triangles=grid.get(Math.floor(point.x/cell)+','+Math.floor(point.y/cell));if(!triangles)continue;
    let front=-Infinity,back=Infinity,count=0;
    for(const [a,b,c] of triangles){const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-12)continue;
     const u=((b.y-c.y)*(point.x-c.x)+(c.x-b.x)*(point.y-c.y))/den,w=((c.y-a.y)*(point.x-c.x)+(a.x-c.x)*(point.y-c.y))/den;
     if(u<0||w<0||u+w>1)continue;const z=u*a.z+w*b.z+(1-u-w)*c.z;front=Math.max(front,z);back=Math.min(back,z);count++;
    }
    if(count>=2&&point.z>back+.001&&point.z<front-.001){const depth=Math.min(front-point.z,point.z-back);penetratingSamples++;if(depth>maxDepth){maxDepth=depth;worst={t,vertex:id,position:point.toArray()};}}
   }
  }
  return {id:target,version:clip.asset.version,framesSampled:lastFrame+1,handVerticesSampled:sampled.length,maxDepth,penetratingSamples,worst,minWristAlignment,maxElbowAngle,scope:(target==='csl.sorry'?'Right hand':'Both hands')+' skin vertices vs static head/torso Z-ray envelope; excludes self-contact and arm surface. 60Hz, every other hand vertex.'};
 },target);
 console.log(JSON.stringify(result,null,2));await writeFile(target==='csl.sorry'?'docs/assets/sorry-clearance-verification.json':target==='csl.love'?'docs/assets/love-clearance-verification.json':'docs/assets/sequence-clearance-verification.json',JSON.stringify(result,null,2)+'\n');
 if(result.maxDepth>.002||result.maxElbowAngle>150)throw Error('Sorry surface or elbow check failed');
}finally{await browser.close();}
