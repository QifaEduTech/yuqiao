// Reuse a previously authorized, private development selection. Never train or mutate it.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {SignService} from '../server/sign.mjs';
const plan=JSON.parse(await readFile('data/maintenance/android-replay-plan.json','utf8')),service=new SignService(resolve('.')),rows=[];
try{
 for(const [i,item] of plan.items.entries()){
  const file=resolve(item.file);if(!file.startsWith(resolve('data/media')+sep))throw Error('Outside media');const data=await readFile(file);if(createHash('sha256').update(data).digest('hex')!==item.sourceSha256)throw Error('Source changed');
  try{const result=await service.recognize(data,extname(file)==='.mp4'?'video/mp4':'video/webm');rows.push({recordId:item.id,sourceSha256:item.sourceSha256,expected:item.expected,status:result.status,candidate:result.candidate,reason:result.reason,pipelineSha256:result.pipeline_sha256,modelSnapshot:result.modelSnapshot,completedEvents:result.completed_event_count,endBoundary:result.end_boundary_observed});console.log(JSON.stringify({completed:i+1,total:plan.items.length,action:item.expected,status:result.status,candidate:result.candidate}));}
  catch(e){rows.push({recordId:item.id,expected:item.expected,status:'failed',error:e.message});console.log(JSON.stringify({completed:i+1,status:'failed'}));}
 }
 await writeFile('data/maintenance/recording-live-unification-replay.json',JSON.stringify({purpose:'existing development samples, full original videos, not independent accuracy',labelsUsedForInference:false,originalsChanged:false,rows},null,2));
 await writeFile('docs/assets/recording-live-unification-check.json',JSON.stringify({verifiedOn:'2026-10-26',scope:'Existing development subset; entire source video, no annotation-based crop and no synthetic end frames',total:rows.length,failed:rows.filter(r=>r.status==='failed').length,targets:rows.filter(r=>r.expected).map(r=>({action:r.expected,status:r.status,candidate:r.candidate,reason:r.reason,endBoundary:r.endBoundary})),negativeClips:rows.filter(r=>!r.expected).length,negativeCandidateClips:rows.filter(r=>!r.expected&&r.candidate).length,labelsUsedForInference:false,originalsChanged:false,independentAccuracy:null},null,2));
}finally{service.close();}
