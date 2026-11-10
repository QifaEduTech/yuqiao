import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{const p=await browser.newPage();await p.goto('http://127.0.0.1:5173/anny-review.html?motion=csl.love');await p.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.love');
const result=await p.evaluate(async()=>{
 const {rig}=window.__annyPreview,clip=window.__annyFixedMotion,{applyFixedMotion}=await import('/web/src/fixedAnnyMotion.ts'),g=rig.mesh.geometry,index=g.index;
 const right=[],thumb=[];
 for(let i=0;i<g.getAttribute('position').count;i++){let r=0,l=0;for(let set=0;set<3;set++){const joints=g.getAttribute(set?`joints_${set}`:'skinIndex'),weights=g.getAttribute(set?`weights_${set}`:'skinWeight');for(let j=0;j<4;j++){const name=rig.mesh.skeleton.bones[joints.getComponent(i,j)].name,w=weights.getComponent(i,j);if(/^(wrist|finger).*\.R$/.test(name))r+=w;if(/^finger1-.*\.L$/.test(name))l+=w;}}if(r>.5)right.push(i);if(l>.5)thumb.push(i);}
 const rightSet=new Set(right),triangles=[];for(let i=0;i<index.count;i+=3){const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];if(ids.every(id=>rightSet.has(id)))triangles.push(ids);}
 let maxDepth=0,penetrations=0,minimumFrontGap=Infinity,worst=null;
 for(let i=24;i<=96;i++){const t=i/30;applyFixedMotion(rig,clip,t);const points=new Map(right.map(id=>[id,rig.vertex(id)])),grid=new Map(),cell=.012;
  for(const ids of triangles){const tri=ids.map(id=>points.get(id));for(let x=Math.floor(Math.min(...tri.map(v=>v.x))/cell);x<=Math.floor(Math.max(...tri.map(v=>v.x))/cell);x++)for(let y=Math.floor(Math.min(...tri.map(v=>v.y))/cell);y<=Math.floor(Math.max(...tri.map(v=>v.y))/cell);y++){const key=x+','+y;if(!grid.has(key))grid.set(key,[]);grid.get(key).push(tri);}}
  for(const id of thumb){const point=rig.vertex(id),candidates=grid.get(Math.floor(point.x/cell)+','+Math.floor(point.y/cell));if(!candidates)continue;let front=-Infinity,back=Infinity,count=0;
   for(const [a,b,c] of candidates){const den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);if(Math.abs(den)<1e-12)continue;const u=((b.y-c.y)*(point.x-c.x)+(c.x-b.x)*(point.y-c.y))/den,w=((c.y-a.y)*(point.x-c.x)+(a.x-c.x)*(point.y-c.y))/den;if(u<0||w<0||u+w>1)continue;const z=u*a.z+w*b.z+(1-u-w)*c.z;front=Math.max(front,z);back=Math.min(back,z);count++;}
   if(count<2)continue;if(point.z<back)minimumFrontGap=Math.min(minimumFrontGap,back-point.z);
   if(point.z>back+.0005&&point.z<front-.0005){const depth=Math.min(point.z-back,front-point.z);penetrations++;if(depth>maxDepth){maxDepth=depth;worst={t,vertex:id};}}
  }
 }
 return {version:clip.asset.version,samples:73,leftThumbVertices:thumb.length,rightHandTriangles:triangles.length,maxDepth,penetrations,minimumFrontGap,worst,scope:'Left thumb skin vertices versus animated right-hand triangle Z envelope during stroke; not a universal full-body collision solver.'};
});console.log(JSON.stringify(result,null,2));await writeFile('docs/assets/love-contact-verification.json',JSON.stringify(result,null,2)+'\n');if(result.maxDepth>.001)throw Error('Hand contact penetration');
}finally{await browser.close();}
