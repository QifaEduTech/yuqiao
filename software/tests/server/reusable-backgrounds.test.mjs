import test from 'node:test';
import assert from 'node:assert/strict';
import {collectReusableBackgrounds,validateReusableBackgrounds} from '../../server/reusable-backgrounds.mjs';
import {JointTraining} from '../../server/joint-training.mjs';
import {resolve} from 'node:path';
import engine from '../../shared/recognition-engine.json' with {type:'json'};
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,sep} from 'node:path';
import {createHash} from 'node:crypto';

function fixture(){
 const records=new Map(),rows=[];
 const state={actions:[],archivedActions:[],seenTraining:[],seenTests:[]};
 const add=(id,patch={},owner='alice')=>{const payload={category:'background',detail:'静止背景',reviewed:true,complete:true,startSeconds:0,endSeconds:2,batch:'auto-date-old',...patch};const row={record_id:id,user_id:owner,payload:JSON.stringify(payload),revision:1,active:1,source_sha256:'hash-'+id};rows.push(row);records.set(id,{id,owner,path:'/fixture/'+id,duration:3,sha256:row.source_sha256});return row;};
 const store={root:resolve('.'),data:resolve('.runtime-logs/nonexistent-background-test'),db:{prepare(sql){return {all(owner){assert.match(sql,/user_id=\?/);return rows.filter(r=>r.user_id===owner&&r.active);},get(id,owner){return rows.find(r=>r.record_id===id&&r.user_id===owner);}};}},source(owner,id){const r=records.get(id);if(!r||r.owner!==owner)throw Error('wrong owner');return r;},read(){return structuredClone(state);},preflight(owner,a){return {samples:a.samples.map(s=>({...s,path:'/fixture/'+s.recordId}))};}};
 return {store,state,rows,records,add};
}
test('仅复用同账号明确旧反例，去重，排除测试/正例/不确定和损坏来源',()=>{
 const f=fixture();f.add('good');f.add('other',{category:'other',detail:'挥动其他动作'});f.add('foreign',{},'bob');f.add('uncertain',{category:'uncertain'});f.add('unfinished',{complete:false});f.add('known',{category:'other',detail:'我'});f.add('bad');f.records.get('bad').sha256='changed';f.add('test');f.add('positive');
 f.state.actions=[{id:'a',samples:[{recordId:'test',sourceHash:'hash-test',split:'test',label:0},{recordId:'positive',sourceHash:'hash-positive',split:'train',label:1}]}];
 const before=structuredClone(f.state),result=collectReusableBackgrounds(f.store,'alice',f.state,engine.labels);
 assert.deepEqual(result.samples.map(s=>s.recordId),['good','other']);assert.ok(result.samples.every(s=>s.label===0&&s.split==='train'));assert.deepEqual(f.state,before);assert.equal(result.summary.legacy,2);
 validateReusableBackgrounds(f.store,'alice',f.state,result.samples);f.rows[0].revision++;assert.throws(()=>validateReusableBackgrounds(f.store,'alice',f.state,result.samples),/已改变/);
});
test('复用未选中任务的训练反例，但尊重手动移除的任务和真实正类',()=>{
 const f=fixture();for(const id of ['negative','discarded','positive'])f.records.set(id,{id,owner:'alice',path:'/fixture/'+id,duration:3,sha256:'hash-'+id});
 const sample=id=>({recordId:id,sourceHash:'hash-'+id,label:0,split:'train',start:0,end:2,legacyRevision:0,group:'自动第1轮'});
 f.state.actions=[{id:'n',revision:1,samples:[sample('negative'),sample('positive')]},{id:'p',samples:[{...sample('positive'),label:1}]}];f.state.archivedActions=[{id:'discard',includeInJointTraining:false,samples:[sample('discarded')]}];
 const result=collectReusableBackgrounds(f.store,'alice',f.state,engine.labels);assert.deepEqual(result.samples.map(s=>s.recordId),['negative']);validateReusableBackgrounds(f.store,'alice',f.state,result.samples);f.state.actions[0].revision++;assert.throws(()=>validateReusableBackgrounds(f.store,'alice',f.state,result.samples),/反例关联已改变/);
});
test('手动移出的旧背景及手动归档卡片不会被后台重新加回',()=>{
 const f=fixture();f.add('removed');f.add('archived');f.add('keep');f.state.excludedBackgroundHashes=['hash-removed'];f.state.archivedActions=[{id:'old',includeInJointTraining:false,samples:[{recordId:'archived',sourceHash:'hash-archived',label:0,split:'train'}]}];
 const result=collectReusableBackgrounds(f.store,'alice',f.state,engine.labels);assert.deepEqual(result.samples.map(s=>s.recordId),['keep']);
});
test('统一训练在用户只录本动作时自动加入共享旧背景，测试用途不变',()=>{
 const f=fixture();for(let i=0;i<20;i++)f.add('bg-'+i);
 f.state.actions=engine.labels.map((l,k)=>({id:'action-'+k,...l,revision:1,samples:['train','test'].flatMap(split=>Array.from({length:20},(_,i)=>({recordId:k+'-'+split+'-'+i,sourceHash:k+'-'+split+'-'+i,label:1,split,start:0,end:2,group:'自动轮次',realGroupConfirmed:false})))}));
 const joint=new JointTraining(f.store);const plan=joint.prepare('alice');assert.equal(plan.datasetSummary.reusedBackgrounds,20);assert.equal(plan.samples.filter(s=>s.reuseOrigin).length,20);assert.ok(plan.samples.filter(s=>s.reuseOrigin).every(s=>s.split!=='test'));assert.equal(plan.samples.filter(s=>s.split==='test').length,80);assert.equal(plan.labels.length,4);
});
test('新模型可从一个新动作开始，空四词卡和不足量任务不阻塞且不被算入完成',()=>{
 const f=fixture();for(let i=0;i<20;i++)f.add('bg-'+i);
 const positives=Array.from({length:20},(_,i)=>({recordId:'good-'+i,sourceHash:'good-'+i,label:1,split:'train',start:0,end:2,group:'自动轮次',realGroupConfirmed:false}));
 f.state.actions=[{id:'good',signId:'csl.good',text:'好',revision:1,samples:positives},...engine.labels.map((l,i)=>({id:'old-'+i,...l,revision:1,samples:[]})),{id:'new',signId:'csl.you',text:'你',revision:1,samples:[{...positives[0],recordId:'you',sourceHash:'you'}]}];
 const plan=new JointTraining(f.store).prepare('alice');assert.deepEqual(plan.labels.map(l=>l.text),['好']);assert.equal(plan.pendingActions.length,5);assert.equal(plan.datasetSummary.reusedBackgrounds,20);assert.equal(f.state.actions.length,6);
});
test('只复用显式授权的跨账号背景，撤销授权或源账号移除后停止复用',async t=>{
 const f=fixture(),parent=resolve('.runtime-logs/shared-background-tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'case-'));f.store.data=dir;t.after(async()=>{assert.ok(dir.startsWith(parent+sep));await rm(dir,{recursive:true,force:true});});
 f.add('approved',{},'bob');f.add('not-granted',{},'bob');const source=collectReusableBackgrounds(f.store,'bob',{actions:[]},engine.labels,{includeShared:false}).samples.find(s=>s.recordId==='approved');
 const grant={schemaVersion:1,id:'grant-test',consumerScope:'local_project_training_only',entries:[{...source,sourceOwnerId:'bob'}]};const file=join(dir,'shared-training-backgrounds.json');await writeFile(file,JSON.stringify(grant));
 const result=collectReusableBackgrounds(f.store,'alice',f.state,engine.labels);assert.deepEqual(result.samples.map(s=>s.recordId),['approved']);assert.equal(result.summary.shared,1);assert.equal(f.records.get('approved').owner,'bob');validateReusableBackgrounds(f.store,'alice',f.state,result.samples,engine.labels);
 await writeFile(file,JSON.stringify({...grant,entries:[]}));assert.throws(()=>validateReusableBackgrounds(f.store,'alice',f.state,result.samples,engine.labels),/授权已改变/);
 await writeFile(file,JSON.stringify(grant));const stateDir=join(dir,'training-workbench',createHash('sha256').update('bob').digest('hex'));await mkdir(stateDir,{recursive:true});await writeFile(join(stateDir,'state.json'),JSON.stringify({actions:[],excludedBackgroundHashes:['hash-approved']}));
 assert.equal(collectReusableBackgrounds(f.store,'alice',f.state,engine.labels).samples.length,0);assert.throws(()=>validateReusableBackgrounds(f.store,'alice',f.state,result.samples,engine.labels),/被移除/);
});
