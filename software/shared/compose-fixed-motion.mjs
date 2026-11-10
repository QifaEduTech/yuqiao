import {Quaternion} from 'three';
import expressionConfig from './anny-expressions.json' with {type:'json'};

// Shared animation composition. Runtime plans must have full vocabulary
// coverage; this joins motions, not arbitrary Chinese sign-language grammar.
export function composeFixedMotion(definition,sources){
  if(!/^csl\.[a-z0-9_.-]+$/.test(definition.id)||!definition.label||!definition.version||!Array.isArray(definition.steps)||definition.steps.length<2)throw Error('Invalid sequence definition');
  let keys;const clips=[],expressionNames=new Set();let time=0;
  for(const [i,step] of definition.steps.entries()){
    const asset=sources.get(step.id);
    if(!asset||asset.id!==step.id||asset.version!==step.version||asset.kind!=='fixed-anny-motion'||asset.rig!=='anny-makehuman'||asset.status!=='authored_unverified'||asset.review!=='not_reviewed'||asset.verifiedBy!==null)throw Error('Missing, stale or ineligible source: '+step.id);
    if(!Number.isFinite(step.from)||!Number.isFinite(step.to)||!Number.isFinite(step.transition)||step.from<0||step.to>asset.duration||step.to<=step.from||step.transition<0||(i===0?step.transition!==0:step.transition<.2))throw Error('Invalid source range/transition');
    const current=Object.keys(asset.frames[0].rotations).sort();keys??=current;
    if(current.join('|')!==keys.join('|'))throw Error('Incompatible source channels');
    let last=-1;
    for(const frame of asset.frames){
      if(!Number.isFinite(frame.t)||frame.t<=last||frame.t>asset.duration)throw Error('Invalid source frame time');last=frame.t;
      if(Object.keys(frame.rotations).length!==keys.length||keys.some(k=>!Array.isArray(frame.rotations[k])||frame.rotations[k].length!==4||frame.rotations[k].some(v=>!Number.isFinite(v))||Math.abs(Math.hypot(...frame.rotations[k])-1)>.001))throw Error('Invalid source rotations');
      const expressions=frame.expressions??{};
      if(typeof expressions!=='object'||Array.isArray(expressions))throw Error('Invalid source expressions');
      for(const [name,value] of Object.entries(expressions)){if(!Number.isFinite(value)||value<0||!Number.isFinite(expressionConfig.channels[name])||value>expressionConfig.channels[name])throw Error('Invalid source expressions');expressionNames.add(name);}
    }
    if(asset.frames[0].t!==0||last!==asset.duration)throw Error('Incomplete source duration');
    const start=time+step.transition,end=start+step.to-step.from;
    clips.push({step,asset,transitionStart:time,start,end});time=end;
  }
  const duration=Number(time.toFixed(6));if(duration>30)throw Error('Sequence exceeds 30 seconds');
  const mix=(a,b,t)=>({rotations:Object.fromEntries(keys.map(k=>[k,new Quaternion().fromArray(a.rotations[k]).normalize().slerp(new Quaternion().fromArray(b.rotations[k]).normalize(),t).toArray().map(v=>Number(v.toFixed(8))||0)])),...(expressionNames.size?{expressions:Object.fromEntries([...expressionNames].map(name=>{const from=a.expressions?.[name]??0,to=b.expressions?.[name]??0;return [name,Number((from+(to-from)*t).toFixed(6))];}))}:{})});
  const sample=(asset,t)=>{let i=0;while(i+1<asset.frames.length&&asset.frames[i+1].t<=t)i++;const a=asset.frames[i],b=asset.frames[Math.min(i+1,asset.frames.length-1)];return mix(a,b,b.t>a.t?(t-a.t)/(b.t-a.t):0);};
  const at=t=>{
    for(let i=0;i<clips.length;i++){
      const c=clips[i];
      if(i>0&&t<c.start){const previous=clips[i-1],u=(t-c.transitionStart)/c.step.transition;return mix(sample(previous.asset,previous.step.to),sample(c.asset,c.step.from),u*u*(3-2*u));}
      if(t<=c.end)return sample(c.asset,c.step.from+Math.min(t-c.start,c.step.to-c.step.from));
    }
    const last=clips.at(-1);return sample(last.asset,last.step.to);
  };
  const frames=Array.from({length:Math.ceil(duration*30)+1},(_,i)=>{const t=Number(Math.min(i/30,duration).toFixed(6));return {t,...at(t)};});
  return {schemaVersion:1,kind:'fixed-anny-motion',id:definition.id,label:definition.label,rig:'anny-makehuman',version:definition.version,status:'authored_unverified',review:'not_reviewed',verifiedBy:null,duration,
    description:`连续完成“${clips.map(c=>c.asset.label).join(' → ')}”，词间自然衔接，只在整段结束后回到自然站姿。`,
    authoring:{basis:definition.basis,source:'复用固定动作库的指定版本，裁去词间回落／重新抬手段，加入平滑过渡。过渡时长由助手暂定，整段仍待内容核对；不代表任意中文逐字翻译。'},
    sequence:clips.map(c=>({id:c.asset.id,label:c.asset.label,version:c.asset.version,start:Number(c.start.toFixed(6)),end:Number(c.end.toFixed(6)),sourceFrom:c.step.from,sourceTo:c.step.to})),frames};
}


