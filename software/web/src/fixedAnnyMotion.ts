import * as THREE from 'three';
import type {AnnyRig} from './annyRig';
import expressionConfig from '../../shared/anny-expressions.json';

export interface FixedMotionAsset {
  schemaVersion:1;kind:'fixed-anny-motion';id:string;label:string;rig:'anny-makehuman';version:string;
  status:'authored_unverified';review:'not_reviewed';verifiedBy:null;duration:number;
  description:string;authoring:{basis:string;source:string};
  sequence?:{id:string;label:string;version:string;start:number;end:number;sourceFrom:number;sourceTo:number}[];
  frames:{t:number;rotations:Record<string,number[]>;expressions?:Record<string,number>}[];
}
export interface FixedMotion {asset:FixedMotionAsset;frames:{t:number;rotations:Record<string,THREE.Quaternion>;expressions:Record<string,number>}[];activeSpan:[number,number]}
export function loadFixedMotion(rig:AnnyRig,asset:FixedMotionAsset):FixedMotion {
  if(asset?.schemaVersion!==1||asset.kind!=='fixed-anny-motion'||asset.rig!=='anny-makehuman'||asset.status!=='authored_unverified'||asset.review!=='not_reviewed'||asset.verifiedBy!==null)throw new Error('固定动作格式或校验状态不合法。');
  if(!Number.isFinite(asset.duration)||asset.duration<=0||asset.duration>30||!Array.isArray(asset.frames)||asset.frames.length<2||asset.frames.length>1800)throw new Error('固定动作时间不合法。');
  if(asset.sequence){
    let previous=0;
    if(!Array.isArray(asset.sequence)||asset.sequence.length<2||asset.sequence.length>20)throw new Error('连续动作顺序不合法。');
    for(const step of asset.sequence){
      if(!step.id||!step.label||!step.version||!Number.isFinite(step.start)||!Number.isFinite(step.end)||step.start<previous||step.end<=step.start||step.end>asset.duration)throw new Error('连续动作区间不合法。');
      previous=step.end;
    }
  }
  const keys=Object.keys(asset.frames[0].rotations);let last=-1;
  if(!keys.length||keys.some(key=>!rig.bones[key]))throw new Error('动作与当前骨架不匹配。');
  const frames=asset.frames.map(frame=>{
    if(!Number.isFinite(frame.t)||frame.t<=last||frame.t>asset.duration||Object.keys(frame.rotations).length!==keys.length)throw new Error('固定动作关键帧不完整。');last=frame.t;
    const rotations=Object.fromEntries(keys.map(key=>{
      const values=frame.rotations[key];
      if(!Array.isArray(values)||values.length!==4||values.some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...values)-1)>.001)throw new Error('动作旋转数据不合法。');
      return [key,new THREE.Quaternion().fromArray(values).normalize()];
    }));
    const expressions=frame.expressions??{};
    if(typeof expressions!=='object'||Array.isArray(expressions))throw new Error('动作表情数据不合法。');
    for(const [name,value] of Object.entries(expressions)){
      const maximum=(expressionConfig.channels as Record<string,number>)[name];
      if(!Number.isFinite(value)||value<0||!Number.isFinite(maximum)||value>maximum||rig.mesh.morphTargetDictionary?.[name]===undefined)throw new Error('动作表情超出已核验通道或幅度。');
    }
    return {t:frame.t,rotations,expressions};
  });
  if(frames[0].t!==0||Math.abs(last-asset.duration)>1e-4)throw new Error('固定动作起止时间不完整。');
  return {asset,frames,activeSpan:[0,asset.duration]};
}
export function applyFixedMotion(rig:AnnyRig,motion:FixedMotion,time:number){
  const frames=motion.frames;let i=0;
  while(i+1<frames.length&&frames[i+1].t<=time)i++;
  const a=frames[i],b=frames[Math.min(i+1,frames.length-1)];
  const blend=b.t>a.t?THREE.MathUtils.clamp((time-a.t)/(b.t-a.t),0,1):0;
  for(const key of Object.keys(a.rotations))rig.bones[key].quaternion.copy(a.rotations[key]).slerp(b.rotations[key],blend);
  // Older neutral clips must also clear expressions left by a preceding action.
  rig.mesh.morphTargetInfluences?.fill(0);
  for(const name of new Set([...Object.keys(a.expressions),...Object.keys(b.expressions)]))rig.expression(name,THREE.MathUtils.lerp(a.expressions[name]??0,b.expressions[name]??0,blend));
  rig.scene.updateMatrixWorld(true);
}
