import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import targets from '../shared/training-targets.json' with {type:'json'};

export function plannedTrainingTasks(root){
 const dictionary=JSON.parse(readFileSync(resolve(root,'shared/sign-dictionary.json'),'utf8')).entries;
 const catalog=JSON.parse(readFileSync(resolve(root,'shared/sign-motion-catalog.json'),'utf8')).entries;
 const names=targets.batches.flat();if(names.length!==30||new Set(names).size!==30)throw Error('Expected exactly 30 distinct training targets');
 return names.map((text,index)=>{
  const motion=catalog.find(m=>m.label===text),word=motion&&dictionary.find(w=>w.id===motion.id&&w.text===text);
  if(!word)throw Error('Training target missing dictionary or motion: '+text);
  return {id:randomUUID(),dictionaryId:word.id,signId:word.id,text,description:(word.description||text+'完整动作').slice(0,400),motion:'dynamic',hands:2,revision:1,samples:[],state:'collecting',activeVersion:null,collectionBatch:Math.floor(index/6)+1};
 });
}

// Explicit maintenance operation. Archives task associations, never media files.
// Historical seen hashes/reports are preserved so reset cannot launder old tests.
export function resetPlannedTrainingTasks(store,owner){
 if(store.running)throw Object.assign(Error('训练正在运行，请先停止本轮。'),{status:409});
 const tasks=plannedTrainingTasks(store.root),state=store.read(owner),now=Date.now();
 state.archivedActions??=[];
 for(const action of state.actions)state.archivedActions.push({...action,archivedAt:now,archiveReason:'reset_for_30_targets',includeInJointTraining:false});
 state.actions=tasks;state.trainingResetAt=now;state.collectionPlan=targets.id;
 store.save(owner,state);return store.publicState(owner);
}
