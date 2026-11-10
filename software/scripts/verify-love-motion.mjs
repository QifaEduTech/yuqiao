import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
process.env.TEMP=process.env.TMP=resolve('.runtime-logs/tmp');await mkdir('.runtime-logs/love-v2',{recursive:true});
const b=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,args:['--enable-unsafe-swiftshader']});
try{const p=await b.newPage({viewport:{width:1200,height:1000}});await p.goto('http://127.0.0.1:5173/anny-review.html?motion=csl.love&version=user-description-2');await p.waitForFunction(()=>window.__annyFixedMotion?.asset.id==='csl.love');
 const report=await p.evaluate(async()=>{
  const {rig}=window.__annyPreview,clip=window.__annyFixedMotion,{applyFixedMotion,loadFixedMotion}=await import('/web/src/fixedAnnyMotion.ts');
  const values=[];
  for(let i=30;i<=81;i++){const t=i/30;applyFixedMotion(rig,clip,t);const long=rig.world('finger3-1.R').sub(rig.world('wrist.R')).normalize(),across=rig.world('finger2-1.R').sub(rig.world('finger5-1.R'));across.addScaledVector(long,-across.dot(long)).normalize();const normal=across.cross(long).normalize(),center=rig.world('wrist.R').lerp(rig.world('finger3-1.R'),.58),thumb=rig.tip('L',1).sub(rig.world('finger1-2.L')).normalize();
   values.push({t,palm:center.toArray(),normal:normal.toArray(),thumbUp:thumb.y,leftWrist:rig.world('wrist.L').toArray(),thumbRoot:rig.rest['finger1-1.L'].angleTo(rig.bones['finger1-1.L'].quaternion),fingerStraight:Math.min(...[2,3,4,5].map(f=>rig.tip('R',f).sub(rig.world(`finger${f}-1.R`)).normalize().dot(long))),smile:rig.mesh.morphTargetInfluences[rig.mesh.morphTargetDictionary.mouthSmileLeft]});
  }
  const strokeDrop=values[0].palm[1]-values.at(-1).palm[1],reversals=values.slice(1).filter((v,i)=>v.palm[1]>values[i].palm[1]+.0001).length;
  const supportDrift=Math.max(...values.map(v=>Math.hypot(...v.leftWrist.map((n,i)=>n-values[0].leftWrist[i]))));
  applyFixedMotion(rig,clip,4);const endExpression=Math.max(...rig.mesh.morphTargetInfluences);
  const invalid=structuredClone(clip.asset);invalid.frames[30].expressions.mouthSmileLeft=1;let rejects=false;try{loadFixedMotion(rig,invalid);}catch{rejects=true;}
  return {version:clip.asset.version,strokeDrop,reversals,supportDrift,minThumbUp:Math.min(...values.map(v=>v.thumbUp)),maxThumbRoot:Math.max(...values.map(v=>v.thumbRoot)),minStraight:Math.min(...values.map(v=>v.fingerStraight)),palmFacingThumb:Math.min(...values.map(v=>-v.normal[2])),smile:values[0].smile,endExpression,rejectsExcessExpression:rejects,first:values[0],last:values.at(-1)};
 });
 const seek=async t=>{await p.getByRole('slider',{name:'动作进度'}).evaluate((el,t)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(t));el.dispatchEvent(new Event('input',{bubbles:true}));},t);await p.waitForTimeout(100);};
 for(const t of [1,1.85,2.7]){await seek(t);await p.evaluate(()=>{const {camera,controls}=window.__annyPreview;controls.target.set(.04,1.28,.27);camera.position.set(.65,1.5,1.25);controls.update();});await p.locator('.anny-viewport').screenshot({path:`.runtime-logs/love-v2/hands-${t}.png`});}
 await p.getByRole('button',{name:'面部特写',exact:true}).click();await p.locator('.anny-viewport').screenshot({path:'.runtime-logs/love-v2/face.png'});
 await p.getByRole('button',{name:'全身',exact:true}).click();await p.locator('.anny-viewport').screenshot({path:'.runtime-logs/love-v2/body.png'});
 await p.getByRole('combobox',{name:'选择固定动作'}).selectOption('csl.you');await p.waitForFunction(()=>window.__annyFixedMotion.asset.id==='csl.you');await seek(1);
 report.neutralAfterSwitch=await p.evaluate(()=>Math.max(...window.__annyPreview.rig.mesh.morphTargetInfluences));
 console.log(JSON.stringify(report,null,2));await writeFile('docs/assets/love-v2-verification.json',JSON.stringify(report,null,2)+'\n');
 if(report.strokeDrop<.035||report.reversals||report.supportDrift>.001||report.minThumbUp<.99||report.maxThumbRoot>.001||report.minStraight<.99||report.palmFacingThumb<.99||report.smile<=0||report.endExpression||report.neutralAfterSwitch||!report.rejectsExcessExpression)throw Error('Love v2 checks failed');
}finally{await b.close();}
