import {trainingDataset} from './training-datasets.mjs';

// Only flag current samples using their latest applicable quality result.
// Removed records and superseded failures stay in history, not in the todo list.
export function trainingQualityFailures(actions,jobs){
 const result=[];
 for(const action of actions){
  const folders=new Map();
  for(const sample of action.samples){
   const split=trainingDataset(sample.split),number=(folders.get(split)??0)+1;folders.set(split,number);
   let latest=null;
   for(const job of [...jobs].sort((a,b)=>b.createdAt-a.createdAt)){
    if(sample.qualityUpdatedAt&&job.createdAt<sample.qualityUpdatedAt)continue;
    const quality=job.report?.quality?.find(q=>q.recordId===sample.recordId);
    if(!quality)continue;
    if(quality.start!==undefined&&(quality.start!==sample.start||quality.end!==sample.end))continue;
    if(quality.sourceHash&&sample.sourceHash&&quality.sourceHash!==sample.sourceHash)continue;
    latest=quality;break;
   }
   if(latest?.passed===false)result.push({actionId:action.id,text:action.text,recordId:sample.recordId,split,number,reason:latest.reason});
  }
 }
 return result;
}
