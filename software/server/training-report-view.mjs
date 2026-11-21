import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';

export function withTrainingReassessment(job,directory){
 if(!job.report?.trained||!/^[a-f0-9-]{36}$/.test(job.id))return job;
 const file=resolve(directory,job.id,'evaluation-layers.json');if(!existsSync(file))return job;
 try{
  const value=JSON.parse(readFileSync(file,'utf8'));
  if(value.jobId!==job.id||value.modelSha256!==job.report.modelSha256||value.mode!=='diagnostic_replay'||value.evaluationVersion!=='joint-layered-evaluation-v1'||!Array.isArray(value.perClass)||!Array.isArray(value.recordingPerClass))return job;
  // Supplemental interpretation never changes the original pass/deploy decision.
  return {...job,report:{...job.report,reassessment:value}};
 }catch{return job;}
}
