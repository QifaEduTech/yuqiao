import {readFileSync,existsSync,realpathSync} from 'node:fs';
import {resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
const json=url=>JSON.parse(readFileSync(url,'utf8').replace(/^\uFEFF/,''));
export const recordingConfig=json(new URL('../shared/recording-recognition.json',import.meta.url));
export const recognitionEngine=json(new URL('../shared/recognition-engine.json',import.meta.url));
export function activeEngine(root,dataDir=resolve(root,'data')){
 const path=resolve(dataDir,'unified-models','active.json');if(!existsSync(path))return recognitionEngine;
 const value=json(path),base=realpathSync(resolve(dataDir,'unified-models')),dir=realpathSync(value.modelDirectory);
 if(!dir.startsWith(base+sep)||value.engine!=='unified-tcn'||!Array.isArray(value.labels)||!value.labels.length||value.labels.length>64||!/^[a-f0-9]{64}$/.test(value.weightsSha256))throw Error('Invalid active unified model');
 return value;
}
const targets=json(new URL('../shared/realtime-targets.json',import.meta.url));
export const recordingEntries=Object.entries(targets).map(([category,value])=>({category,id:value.signId,text:value.text}));
if(JSON.stringify(Object.keys(targets).sort())!==JSON.stringify(recognitionEngine.labels.map(e=>e.category).sort()))throw Error('Unified label registry differs');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function recordingBundle(root,dataDir=resolve(root,'data')){
 const engine=activeEngine(root,dataDir),directory=engine.modelDirectory,model={manifest:relative(root,resolve(root,directory,'model.json')).replaceAll('\\','/'),weights:relative(root,resolve(root,directory,'weights.npz')).replaceAll('\\','/')};
 const paths=[...new Set(['shared/recording-recognition.json',...recordingConfig.sources,model.manifest,model.weights])].sort();
 const fingerprints=paths.map(path=>[path,hash(readFileSync(resolve(root,path)))]),hashes=new Map(fingerprints);
 const meta=json(resolve(root,model.manifest));
 if(meta.sha256!==engine.weightsSha256||hashes.get(model.weights)!==meta.sha256||!['unified-body178-tcn-v1','joint-body178-tcn-v2','joint-body178-tcn-v3'].includes(meta.protocol))throw Error('Unified model checksum or protocol mismatch');
 const models=[{modelId:engine.id,modelVersion:engine.version,modelSha256:meta.sha256,featureId:engine.featureProtocol,labels:engine.labels.map(e=>e.text)}];
 return {id:recordingConfig.id,sha256:hash(JSON.stringify(fingerprints)),models};
}
export function recordingSnapshot(bundle,candidate){
 const model=bundle.models.find(m=>m.labels.includes(candidate))??bundle.models[0];
 return {modelId:model?.modelId??bundle.id,modelVersion:model?.modelVersion??'v1',modelSha256:model?.modelSha256??bundle.sha256,featureId:model?.featureId??'realtime-mixed-126-153-171-178-v1',pipelineId:bundle.id,pipelineSha256:bundle.sha256,pipelineModels:bundle.models};
}
export function validateRecordingResult(result,extra=[]){
 if(!['candidate','uncertain','no_hands','unsupported'].includes(result.status))throw Error('Invalid recording status');
 if(result.status==='candidate'){if(![...recordingEntries,...extra.map(x=>({id:x.signId,text:x.text}))].some(e=>e.text===result.candidate&&e.id===result.sign_id))throw Error('Recording candidate outside realtime scope');}
 else if(result.candidate!==null)throw Error('Uncertain result must not guess');
 if(result.pipeline_id!==recordingConfig.id||!/^[a-f0-9]{64}$/.test(result.pipeline_sha256)||!Number.isFinite(result.duration_seconds)||result.duration_seconds<.5||result.duration_seconds>recordingConfig.maxSeconds+.25)throw Error('Invalid recording metadata');
 if(!Number.isInteger(result.sampled_frames)||result.sampled_frames<1||result.sampled_frames>recordingConfig.maxDecodedFrames||!Number.isInteger(result.hand_frames)||result.hand_frames<0||result.hand_frames>result.sampled_frames)throw Error('Invalid recording counts');
 for(const key of ['observed_word_count','completed_event_count','conflict_frames'])if(!Number.isInteger(result[key])||result[key]<0||result[key]>result.sampled_frames)throw Error('Invalid evidence counts');
 if(result.observed_word_count>recordingEntries.length+extra.length||typeof result.candidate_after_completion!=='boolean'||typeof result.end_boundary_observed!=='boolean'||typeof result.low_frame_rate!=='boolean')throw Error('Invalid evidence flags');
 if(result.status==='no_hands'&&result.hand_frames!==0||result.status==='candidate'&&result.hand_frames===0)throw Error('Invalid hand coverage');
 if(result.status==='candidate'&&(result.observed_word_count!==1||result.conflict_frames!==0||result.completed_event_count>1||result.candidate_after_completion))throw Error('Ambiguous recording must not return a word');
 return result;
}
