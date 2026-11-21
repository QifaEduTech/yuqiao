import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,copyFileSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {trainingDataset} from '../shared/training-datasets.mjs';
import {splitJointTrainingPool} from './joint-dataset-split.mjs';
import {collectReusableBackgrounds,validateReusableBackgrounds,registeredNegativeOverlaps} from './reusable-backgrounds.mjs';
import {plannedTrainingTasks} from './training-targets.mjs';
import {activeEngine} from './recording-catalog.mjs';
import {iterationDecision,iterationOwnerKey,iterationReference} from './joint-iteration.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const policy=JSON.parse(readFileSync(new URL('../shared/unified-training.json',import.meta.url),'utf8'));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
export const jointPlanFingerprint=(labels,samples,excludedTests=[])=>hash(JSON.stringify({labels:labels.map(l=>l.signId).sort(),samples:[...samples,...excludedTests].map(x=>[x.sourceHash,x.split,x.label,x.start,x.end]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}));
export function passedJointReport(report,labels){
 if(!report?.trained||!report.testEvaluated||!Array.isArray(report.perClass)||report.perClass.length!==labels.length)return false;
 return labels.every(label=>{const rows=report.perClass.filter(x=>x.signId===label.signId);if(rows.length!==1)return false;const c=rows[0].counts;if(!c||['tp','fn','fp','tn'].some(k=>!Number.isSafeInteger(c[k])||c[k]<0))return false;return c.tp+c.fn>=policy.minTestPositive&&c.fp+c.tn>=policy.minTestNegative&&c.tp/(c.tp+c.fn)>=policy.recallTarget&&c.tp/Math.max(1,c.tp+c.fp)>=policy.precisionTarget&&c.fp/(c.fp+c.tn)<=policy.maxFalsePositiveRate;});
}

export class JointTraining{
 constructor(store,{onPublished=()=>{},spawnImpl=spawn}={}){this.store=store;this.onPublished=onPublished;this.spawn=spawnImpl;}
 archive(owner,id,reason='manual'){
  const s=this.store;if(s.running)throw fail('请先停止正在进行的训练。',409);
  const state=s.read(owner),action=s.action(state,id);
  state.archivedActions??=[];state.archivedActions.push({...action,archivedAt:Date.now(),archiveReason:reason,includeInJointTraining:reason==='passed'});state.actions=state.actions.filter(a=>a.id!==id);s.save(owner,state);return s.publicState(owner);
 }
 restore(owner,id){
  const s=this.store;if(s.running)throw fail('请等待当前训练结束。',409);
  const state=s.read(owner),action=(state.archivedActions??[]).find(a=>a.id===id);if(!action)throw fail('归档任务不存在。',404);
  if(state.actions.some(a=>a.signId===action.signId))throw fail('已经有同词任务，请使用当前任务。');
  if(state.actions.length>=64)throw fail('当前任务数量已达上限。');
  state.actions.push({...action,state:'collecting'});state.archivedActions=state.archivedActions.filter(a=>a.id!==id);s.save(owner,state);return s.publicState(owner);
 }
 bootstrap(owner){
  const s=this.store;if(s.running)throw fail('请先等待训练结束。',409);
  const tasks=plannedTrainingTasks(s.root),state=s.read(owner),occupied=new Set([...state.actions,...(state.archivedActions??[])].map(a=>a.signId)),missing=tasks.filter(a=>!occupied.has(a.signId));
  if(state.actions.length+missing.length>policy.maxActions)throw fail('当前任务数量已达上限，请先整理任务。');
  if(missing.length){state.actions.push(...missing);s.save(owner,state);}
  return s.publicState(owner);
 }
 prepare(owner){
  const s=this.store,state=s.read(owner),actions=[...state.actions,...(state.archivedActions??[]).filter(a=>a.includeInJointTraining&&!state.actions.some(b=>b.signId===a.signId))];
  const countPositive=a=>new Set(a.samples.filter(x=>x.label===1&&trainingDataset(x.split)==='train').map(x=>x.sourceHash)).size;
  const splitMinimum=policy.minInternalTrain+policy.minInternalValidation;
  const excluded=new Set(state.excludedModelSignIds??[]);
  const eligibleActions=actions.filter(a=>!excluded.has(a.signId));
  const selected=eligibleActions.filter(a=>countPositive(a)>=splitMinimum).sort((a,b)=>a.signId.localeCompare(b.signId));
  const pendingActions=eligibleActions.filter(a=>countPositive(a)<splitMinimum).map(a=>({id:a.id,text:a.text,trainingCount:countPositive(a),required:splitMinimum,reason:'需要不同来源的视频分开用于训练和内部检查'}));
  if(!selected.length)throw fail('还没有可训练的动作：资料需要能分开用于训练和内部检查，请添加不同来源的本动作视频。');
  const labels=selected.map(a=>({category:a.signId,text:a.text,signId:a.signId,actionId:a.id})),bySource=new Map(),groupSplits=new Map();
  for(const action of selected){
   const {samples}=s.preflight(owner,action);
   for(const sourceSample of samples){
    if(registeredNegativeOverlaps(s,owner,sourceSample,labels))continue;
    // Imported copies retain the source capture group so their shared old
    // backgrounds cannot land on the opposite side of the internal holdout.
    const group=sourceSample.realGroupConfirmed&&sourceSample.importedFrom?sourceSample.group.replace(/^legacy:[a-f0-9]{8}:(capture:)/,'$1'):sourceSample.group;
    const sample={...sourceSample,group,originalSplit:sourceSample.split,split:trainingDataset(sourceSample.split)};
    const old=bySource.get(sample.sourceHash),label=sample.label===1?labels.findIndex(x=>x.signId===action.signId)+1:0;
    if(old&&(old.split!==sample.split||old.start!==sample.start||old.end!==sample.end||old.label&&label&&old.label!==label))throw fail('同一原视频的用途、范围或动作标签冲突，请先整理。');
    if(sample.realGroupConfirmed){const key=sample.group,split=groupSplits.get(key);if(split&&split!==sample.split)throw fail('同一真实拍摄轮次不能跨训练和检查用途。');groupSplits.set(key,sample.split);}
    if(sample.split==='test'&&state.seenTraining.includes(sample.sourceHash))throw fail('部分测试集视频已用于训练，请补充新的测试资料。');
    if(!old||label)bySource.set(sample.sourceHash,{...sample,label,retainedRegression:!!action.includeInJointTraining});
   }
  }
  const reuse=collectReusableBackgrounds(s,owner,state,labels);
  for(const sample of reuse.samples){
   if(bySource.has(sample.sourceHash))continue;
   if(sample.realGroupConfirmed&&groupSplits.get(sample.group)==='test')continue;
   bySource.set(sample.sourceHash,sample);
  }
  const samples=[...bySource.values()];
  if(samples.length>policy.maxJobSamples)throw fail('本轮视频超过'+policy.maxJobSamples+'条，请分批整理。');
  const alreadyTested=s=>s.split==='test'&&state.seenTests.includes(s.sourceHash)&&!s.retainedRegression;
  const excludedTests=samples.filter(alreadyTested).map(({path,...s})=>s);
  const split=splitJointTrainingPool(samples.filter(s=>!alreadyTested(s)),labels,policy);
  return {state,actions:selected,labels,samples:split.samples,pendingActions,excludedTests,datasetSummary:{...split.summary,excludedUsedTests:excludedTests.length,reusedBackgrounds:samples.filter(s=>s.reuseOrigin).length,sharedBackgrounds:samples.filter(s=>s.sharedBackground).length,reuseScope:'same_account_and_explicit_shared_grants_training_only'}};
 }
 publish(dir,plan,report,owner,mode='joint_test_passed'){
  const s=this.store,meta=JSON.parse(readFileSync(resolve(dir,'model.json'),'utf8'));
  const bytes=readFileSync(resolve(dir,'weights.npz'));
  if(!['joint-body178-tcn-v2','joint-body178-tcn-v3'].includes(meta.protocol)||meta.sha256!==hash(bytes)||report.modelSha256!==meta.sha256||JSON.stringify(meta.labels)!==JSON.stringify(plan.labels))throw fail('统一模型输出校验失败，任务未归档。',409);
  // Isolated test servers never change the real project's active descriptor.
  const deployed=resolve(s.data,'unified-models',plan.id);mkdirSync(deployed,{recursive:true});copyFileSync(resolve(dir,'model.json'),resolve(deployed,'model.json'));copyFileSync(resolve(dir,'weights.npz'),resolve(deployed,'weights.npz'));
  const fitSources=JSON.stringify([...new Set(plan.samples.filter(x=>x.split==='train').map(x=>x.sourceHash))]);
  writeFileSync(resolve(deployed,'fit-sources.json'),fitSources);
  const active={id:'joint-'+plan.id,engine:'unified-tcn',version:plan.id,mode,featureProtocol:'hands-and-shoulder-relative-178-v1',modelDirectory:deployed,weightsSha256:meta.sha256,labels:plan.labels,seed:plan.seed,iterationOwnerKey:iterationOwnerKey(owner),fitSourcesSha256:hash(fitSources)};
  const file=resolve(s.data,'unified-models','active.json');writeFileSync(file+'.tmp',JSON.stringify(active));renameSync(file+'.tmp',file);this.onPublished();return active;
 }
 start(owner){
  const s=this.store;if(s.running)throw fail('已有训练正在进行，请等待或停止。',409);
  const {state,actions,labels,samples,datasetSummary,pendingActions=[],excludedTests=[]}=this.prepare(owner);
  const fingerprint=jointPlanFingerprint(labels,samples,excludedTests);
  if((state.seenJointPlans??[]).includes(fingerprint))throw fail('这批资料已经训练过，请补充或修正视频后再开始，不能反复刷测试分数。',409);
  const reference=iterationReference(s,owner,labels,samples);
  const id=randomUUID(),dir=resolve(s.directory(owner),id);mkdirSync(dir,{recursive:true});
  const plan={id,labels,samples,policy,datasetSummary,iterationReference:reference,seed:Date.now()%2147483647,maxEpochs:policy.maxEpochs,fitSeconds:policy.fitSeconds,actionRevisions:actions.map(a=>[a.id,a.revision])};const path=resolve(dir,'plan.json');writeFileSync(path,JSON.stringify(plan));
  state.jobs.push({id,actionId:null,kind:'unified',status:'running',progress:0,trainingWords:labels.map(x=>x.text),pendingActions,excludedUsedTests:excludedTests.length,reusedBackgrounds:datasetSummary?.reusedBackgrounds??0,message:'准备统一训练…',createdAt:Date.now(),report:null});state.seenTraining=[...new Set([...state.seenTraining,...samples.filter(x=>x.split!=='test').map(x=>x.sourceHash)])];s.save(owner,state);
  const child=this.spawn(resolve(s.root,'.venv-sign/Scripts/python.exe'),['-B','-u',resolve(s.root,'server/joint_training_job.py'),path,String(process.pid)],{cwd:s.root,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  const running={owner,jobId:id,child,cancelled:false,buffer:''};s.running=running;
  const update=patch=>{const next=s.read(owner),job=next.jobs.find(j=>j.id===id);if(!job)return;Object.assign(job,patch);s.save(owner,next);};
  const finish=event=>{
   if(running.cancelled)return;const next=s.read(owner),job=next.jobs.find(j=>j.id===id);if(!job||job.status!=='running')return;
   const report=event.report??null;const passed=passedJointReport(report,labels);if(report)report.passed=passed;
   if(report?.trained)next.seenJointPlans=[...new Set([...(next.seenJointPlans??[]),fingerprint])];
   if(report?.testEvaluated)next.seenTests=[...new Set([...next.seenTests,...samples.filter(x=>x.split==='test').map(x=>x.sourceHash)])];
   Object.assign(job,{status:passed?'complete':event.ok?'needs_data':'failed',progress:100,message:event.message,report});
   const decision=reference&&!reference.unavailable&&report?.trained
    ? iterationDecision(report.iterationComparison,labels,reference.referenceHash,report.modelSha256) : null;
   const promote=reference?Boolean(decision?.improved):passed;
   if(reference&&report?.trained){
    job.iteration=decision;
    job.message=reference.unavailable??(!decision?'内部对照资料不足，继续使用当前模型。':decision.improved?'新版整体表现更好。':'新版整体表现未超过当前模型，继续使用当前版本。');
   }
   if(passed||promote){
    try{
     for(const [actionId,revision] of plan.actionRevisions){const current=[...next.actions,...(next.archivedActions??[])].find(a=>a.id===actionId);if(!current||current.revision!==revision)throw fail('资料已改变，请重新训练。');s.preflight(owner,current);}
     validateReusableBackgrounds(s,owner,next,samples,labels);
     const active=activeEngine(s.root,s.data);
     if(promote){
      if(reference ? active.weightsSha256!==reference.referenceHash||active.version!==reference.referenceVersion : active.iterationOwnerKey)throw fail('当前模型已改变，请重新比较。');
      job.activeModel=this.publish(dir,plan,report,owner,passed?'joint_test_passed':'joint_iteration_improved');
      job.message=passed?'统一模型已更新。':`已切换新版，内部自动出词宏 F1 从 ${(decision.previous*100).toFixed(1)}% 升至 ${(decision.current*100).toFixed(1)}%。任务保留，继续收集与测试。`;
     }
     if(passed){
      next.archivedActions??=[];
      for(const a of next.actions.filter(a=>labels.some(l=>l.actionId===a.id))){next.archivedActions.push({...a,state:'completed',archivedAt:Date.now(),archiveReason:'passed',includeInJointTraining:true,completedBy:id});}
      next.actions=next.actions.filter(a=>!labels.some(l=>l.actionId===a.id));
      job.message+=' 独立测试达标，任务和视频已归档。';
     }
    }
    catch(e){job.status='failed';job.message=String(e.message);job.report.passed=false;}
   }
   s.save(owner,next);
  };
  const timer=setTimeout(()=>{running.cancelled=true;child.kill();update({status:'needs_data',message:'本轮达到30分钟上限，任务和视频保留，请检查资料后继续。'});},1800000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{running.buffer+=chunk;if(running.buffer.length>4*1024*1024){running.cancelled=true;child.kill();return;}let n;while((n=running.buffer.indexOf('\n'))>=0){const line=running.buffer.slice(0,n);running.buffer=running.buffer.slice(n+1);try{const e=JSON.parse(line);if(e.type==='progress'&&!running.cancelled)update({progress:e.progress,message:String(e.message).slice(0,300)});else if(e.type==='result')finish(e);}catch{}}});
  child.on('error',()=>update({status:'failed',message:'训练进程无法启动，资料已保留。'}));child.on('close',()=>{clearTimeout(timer);const state=s.read(owner),job=state.jobs.find(j=>j.id===id);if(job?.status==='running')update({status:running.cancelled?'cancelled':'failed',message:'本轮训练停止，任务和视频保留。'});try{unlinkSync(resolve(dir,'fit-features.json'));}catch{}if(s.running===running)s.running=null;});
  return {jobId:id};
 }
}
