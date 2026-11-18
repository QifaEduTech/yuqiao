import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {JointTraining,passedJointReport} from '../../server/joint-training.mjs';
const labels=[{signId:'csl.me',text:'我',actionId:'one',category:'csl.me'}];
const report=(tp=20)=>({trained:true,testEvaluated:true,perClass:[{...labels[0],counts:{tp,fn:20-tp,fp:0,tn:20}}]});

test('每类召回至少90%且足量，不能信任passed标记或只看平均值',()=>{
 assert.equal(passedJointReport(report(18),labels),true);assert.equal(passedJointReport(report(17),labels),false);
 assert.equal(passedJointReport({...report(),perClass:[{...labels[0],counts:{tp:1,fn:0,fp:0,tn:1}}]},labels),false);
 assert.equal(passedJointReport({...report(),perClass:[{...labels[0],counts:{tp:20,fn:0,fp:2,tn:18}}]},labels),false);
 assert.equal(passedJointReport({...report(),testEvaluated:false},labels),false);
 assert.equal(passedJointReport({...report(),perClass:[]},labels),false);
});

async function fixture(t){
 const parent=resolve('.runtime-logs/joint-tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'case-'));await mkdir(join(dir,'owner'));
 let state={revision:0,actions:[{id:'one',signId:'csl.me',text:'我',revision:1,samples:[]}],archivedActions:[],jobs:[],seenTraining:[],seenTests:[]};
 const store={data:dir,root:resolve('.'),running:null,read:()=>structuredClone(state),save:(_owner,value)=>{state=structuredClone(value);},action:(s,id)=>{const a=s.actions.find(a=>a.id===id);if(!a)throw Error('missing');return a;},publicState:()=>structuredClone(state),directory:()=>join(dir,'owner'),preflight:()=>({samples:[],counts:{}})};
 let child;
 const joint=new JointTraining(store,{spawnImpl:()=>{child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.kill=()=>child.emit('close');return child;}});
 joint.prepare=()=>({state:store.read(),actions:state.actions,labels,samples:[{sourceHash:'test-hash',split:'test'}]});
 t.after(async()=>{child?.emit('close');assert.ok(dir.startsWith(parent+sep));await rm(dir,{recursive:true,force:true});});
 return {dir,store,joint,state:()=>state,send:async(job,passed)=>{
  const out=join(dir,'owner',job);const bytes=Buffer.from('synthetic exported artifact for lifecycle test, not inference');const sha=createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(out,'weights.npz'),bytes);await writeFile(join(out,'model.json'),JSON.stringify({protocol:'joint-body178-tcn-v2',sha256:sha,labels}));
  child.stdout.emit('data',JSON.stringify({type:'result',ok:true,message:'checked',report:{...report(passed?18:17),modelSha256:sha,passed:true}})+'\n');child.emit('close');
 }};
}
test('未达90%保留卡片，报告不得自行宣布通过或发布',async t=>{
 const f=await fixture(t),{jobId}=f.joint.start('owner');await f.send(jobId,false);
 assert.equal(f.state().actions.length,1);assert.equal(f.state().archivedActions.length,0);assert.equal(f.state().jobs[0].status,'needs_data');assert.equal(f.state().jobs[0].report.passed,false);assert.equal(existsSync(join(f.dir,'unified-models','active.json')),false);
 assert.throws(()=>f.joint.start('owner'),e=>e.status===409);
});
test('达标移除卡片并保留资料和模型，手动移除可恢复',async t=>{
 const f=await fixture(t);const video=join(f.dir,'original.webm');await writeFile(video,'original footage');
 const {jobId}=f.joint.start('owner');await f.send(jobId,true);
 assert.equal(f.state().actions.length,0);assert.equal(f.state().archivedActions.length,1);assert.equal(f.state().archivedActions[0].includeInJointTraining,true);assert.equal(await readFile(video,'utf8'),'original footage');
 assert.equal(f.state().jobs[0].status,'complete');assert.equal(existsSync(join(f.dir,'unified-models','active.json')),true);
 f.joint.restore('owner','one');assert.equal(f.state().actions.length,1);f.joint.archive('owner','one');assert.equal(f.state().archivedActions[0].includeInJointTraining,false);assert.equal(await readFile(video,'utf8'),'original footage');
});
test('运行中不能删除任务；资料变化导致发布/自动移除被拒绝',async t=>{
 const f=await fixture(t),{jobId}=f.joint.start('owner');assert.throws(()=>f.joint.archive('owner','one'),e=>e.status===409);
 const s=f.store.read();s.actions[0].revision++;f.store.save('owner',s);await f.send(jobId,true);assert.equal(f.state().actions.length,1);assert.equal(f.state().jobs[0].status,'failed');assert.equal(existsSync(join(f.dir,'unified-models','active.json')),false);
});
test('资料不够时提示本动作训练集数量，不再要求补齐旧四词',async t=>{
 const f=await fixture(t),s=f.store.read();s.actions[0].samples=[{label:1}];f.store.save('owner',s);
 assert.throws(()=>JointTraining.prototype.prepare.call(f.joint,'owner'),e=>e.message.includes('训练集至少需要20条')&&!e.message.includes('遗忘')&&!e.message.includes('帮助'));
});
