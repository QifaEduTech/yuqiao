import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,copyFileSync,unlinkSync,realpathSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {trainingDataset} from '../shared/training-datasets.mjs';
import {splitJointTrainingPool} from './joint-dataset-split.mjs';
import {collectReusableBackgrounds,validateReusableBackgrounds} from './reusable-backgrounds.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const policy=JSON.parse(readFileSync(new URL('../shared/unified-training.json',import.meta.url),'utf8'));
const fail=(message,status=400)=>Object.assign(Error(message),{status});
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
  const catalog=JSON.parse(readFileSync(resolve(s.root,'shared/sign-motion-catalog.json'),'utf8'));
  for(const entry of catalog.entries){const state=s.read(owner);if([...state.actions,...(state.archivedActions??[])].some(a=>a.signId===entry.id))continue;s.mutate(owner,null,{dictionaryId:entry.id,description:entry.label+'完整动作',hands:2,motion:'dynamic'});}
  return s.publicState(owner);
 }
 prepare(owner){
  const s=this.store,state=s.read(owner),actions=[...state.actions,...(state.archivedActions??[]).filter(a=>a.includeInJointTraining&&!state.actions.some(b=>b.signId===a.signId))];
  const countPositive=a=>new Set(a.samples.filter(x=>x.label===1&&trainingDataset(x.split)==='train').map(x=>x.sourceHash)).size;
  const selected=actions.filter(a=>countPositive(a)>=policy.minTrainingPoolPerClass).sort((a,b)=>a.signId.localeCompare(b.signId));
  const pendingActions=actions.filter(a=>countPositive(a)<policy.minTrainingPoolPerClass).map(a=>({id:a.id,text:a.text,trainingCount:countPositive(a),required:policy.minTrainingPoolPerClass}));
  if(!selected.length)throw fail('还没有准备好的动作：每个动作的训练集至少需要'+policy.minTrainingPoolPerClass+'条本动作视频，请先补充资料。');
  const labels=selected.map(a=>({category:a.signId,text:a.text,signId:a.signId,actionId:a.id})),bySource=new Map(),groupSplits=new Map();
  for(const action of selected){
   const {samples}=s.preflight(owner,action);
   for(const sourceSample of samples){
    const sample={...sourceSample,originalSplit:sourceSample.split,split:trainingDataset(sourceSample.split)};
    const old=bySource.get(sample.sourceHash),label=sample.label===1?labels.findIndex(x=>x.signId===action.signId)+1:0;
    if(old&&(old.split!==sample.split||old.start!==sample.start||old.end!==sample.end||old.label&&label&&old.label!==label))throw fail('同一原视频的用途、范围或动作标签冲突，请先整理。');
    if(sample.realGroupConfirmed){const key=sample.group,split=groupSplits.get(key);if(split&&split!==sample.split)throw fail('同一真实拍摄轮次不能跨训练和检查用途。');groupSplits.set(key,sample.split);}
    if(sample.split==='test'&&(state.seenTraining.includes(sample.sourceHash)||state.seenTests.includes(sample.sourceHash)&&!action.includeInJointTraining))throw fail('部分测试集视频已用于训练或失败调试，请补充新的测试资料。');
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
  const split=splitJointTrainingPool(samples,labels,policy);
  return {state,actions:selected,labels,samples:split.samples,pendingActions,datasetSummary:{...split.summary,reusedBackgrounds:samples.filter(s=>s.reuseOrigin).length,sharedBackgrounds:samples.filter(s=>s.sharedBackground).length,reuseScope:'same_account_and_explicit_shared_grants_training_only'}};
 }
 publish(dir,plan,report){
  const s=this.store,meta=JSON.parse(readFileSync(resolve(dir,'model.json'),'utf8'));
  const bytes=readFileSync(resolve(dir,'weights.npz'));
  if(meta.protocol!=='joint-body178-tcn-v2'||meta.sha256!==hash(bytes)||report.modelSha256!==meta.sha256||JSON.stringify(meta.labels)!==JSON.stringify(plan.labels))throw fail('统一模型输出校验失败，任务未归档。',409);
  // Isolated test servers never change the real project's active descriptor.
  const deployed=resolve(s.data,'unified-models',plan.id);mkdirSync(deployed,{recursive:true});copyFileSync(resolve(dir,'model.json'),resolve(deployed,'model.json'));copyFileSync(resolve(dir,'weights.npz'),resolve(deployed,'weights.npz'));
  const active={id:'joint-'+plan.id,engine:'unified-tcn',version:plan.id,mode:'joint_test_passed',featureProtocol:'hands-and-shoulder-relative-178-v1',modelDirectory:deployed,weightsSha256:meta.sha256,labels:plan.labels,seed:plan.seed};
  const file=resolve(s.data,'unified-models','active.json');writeFileSync(file+'.tmp',JSON.stringify(active));renameSync(file+'.tmp',file);this.onPublished();return active;
 }
 start(owner){
  const s=this.store;if(s.running)throw fail('已有训练正在进行，请等待或停止。',409);
  const {state,actions,labels,samples,datasetSummary,pendingActions=[]}=this.prepare(owner);
  const fingerprint=hash(JSON.stringify({labels:labels.map(l=>l.signId).sort(),samples:samples.map(x=>[x.sourceHash,x.split,x.label,x.start,x.end]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}));
  if((state.seenJointPlans??[]).includes(fingerprint))throw fail('这批资料已经训练过，请补充或修正视频后再开始，不能反复刷测试分数。',409);
  const id=randomUUID(),dir=resolve(s.directory(owner),id);mkdirSync(dir,{recursive:true});
  const plan={id,labels,samples,policy,datasetSummary,seed:Date.now()%2147483647,maxEpochs:policy.maxEpochs,fitSeconds:policy.fitSeconds,actionRevisions:actions.map(a=>[a.id,a.revision])};const path=resolve(dir,'plan.json');writeFileSync(path,JSON.stringify(plan));
  state.jobs.push({id,actionId:null,kind:'unified',status:'running',progress:0,trainingWords:labels.map(x=>x.text),pendingActions,reusedBackgrounds:datasetSummary?.reusedBackgrounds??0,message:'准备统一训练…',createdAt:Date.now(),report:null});state.seenTraining=[...new Set([...state.seenTraining,...samples.filter(x=>x.split!=='test').map(x=>x.sourceHash)])];s.save(owner,state);
  const child=this.spawn(resolve(s.root,'.venv-sign/Scripts/python.exe'),['-B','-u',resolve(s.root,'server/joint_training_job.py'),path,String(process.pid)],{cwd:s.root,windowsHide:true,stdio:['pipe','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  const running={owner,jobId:id,child,cancelled:false,buffer:''};s.running=running;
  const update=patch=>{const next=s.read(owner),job=next.jobs.find(j=>j.id===id);if(!job)return;Object.assign(job,patch);s.save(owner,next);};
  const finish=event=>{
   if(running.cancelled)return;const next=s.read(owner),job=next.jobs.find(j=>j.id===id);if(!job||job.status!=='running')return;
   const report=event.report??null;const passed=passedJointReport(report,labels);if(report)report.passed=passed;
   if(report?.trained)next.seenJointPlans=[...new Set([...(next.seenJointPlans??[]),fingerprint])];
   if(report?.testEvaluated)next.seenTests=[...new Set([...next.seenTests,...samples.filter(x=>x.split==='test').map(x=>x.sourceHash)])];
   Object.assign(job,{status:passed?'complete':event.ok?'needs_data':'failed',progress:100,message:event.message,report});
   if(passed){
    try{for(const [actionId,revision] of plan.actionRevisions){const current=[...next.actions,...(next.archivedActions??[])].find(a=>a.id===actionId);if(!current||current.revision!==revision)throw fail('资料已改变，请重新训练。');s.preflight(owner,current);}validateReusableBackgrounds(s,owner,next,samples,labels);job.activeModel=this.publish(dir,plan,report);next.archivedActions??=[];for(const a of next.actions.filter(a=>labels.some(l=>l.actionId===a.id))){next.archivedActions.push({...a,state:'completed',archivedAt:Date.now(),archiveReason:'passed',includeInJointTraining:true,completedBy:id});}next.actions=next.actions.filter(a=>!labels.some(l=>l.actionId===a.id));job.message='召回率等检查全部达标，任务卡片已移除，视频已归档保留，统一模型已更新。';}
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
