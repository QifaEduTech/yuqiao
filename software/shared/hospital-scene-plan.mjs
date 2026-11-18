import scene from './hospital-mutual-aid-scene.json' with {type:'json'};
import windows from './sign-motion-windows.json' with {type:'json'};
import {planMotionText} from './motion-planner.mjs';

export function planHospitalScene(){
 return scene.dialogue.map(line=>{
  const plan=planMotionText(line.signText.replace(/\s+/g,''));
  const preview=plan.status==='single'?{id:plan.entry.id,label:plan.entry.label,version:plan.entry.version,status:'authored_unverified'}:plan.status==='sequence'?plan.preview:null;
  if(!preview)throw Error('场景动作无法完整编排：'+line.signText);
  const ids=preview.kind==='sequence'?preview.steps.map(s=>s.id):[preview.id];
  if(JSON.stringify(ids)!==JSON.stringify(line.motionIds))throw Error('场景动作顺序已变化，请更新场景清单。');
  const duration=preview.kind==='sequence'?preview.duration:windows.entries.find(w=>w.id===preview.id)?.duration;
  if(!duration||duration>30)throw Error('场景单句时长无效。');
  return {...line,preview,duration};
 });
}
export function hospitalScenePlaylist(id){
 if(id!==scene.id)throw Error('未知的医院互助场景。');
 return planHospitalScene().map(line=>line.preview);
}
