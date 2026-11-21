import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {plannedTrainingTasks,resetPlannedTrainingTasks} from '../../server/training-targets.mjs';
import {JointTraining} from '../../server/joint-training.mjs';

test('30词准确来自原四词加26词计划，不把34个数字人资源全部加进训练',()=>{
 const rows=plannedTrainingTasks(resolve('.'));assert.equal(rows.length,30);assert.equal(new Set(rows.map(a=>a.signId)).size,30);assert.equal(new Set(rows.map(a=>a.id)).size,30);assert.ok(rows.every(a=>a.samples.length===0));
 for(const text of ['谢谢','帮助','需要','我','你','医生','身份证','再见'])assert.ok(rows.some(a=>a.text===text));
 for(const text of ['你好','对不起','爱','我爱你'])assert.equal(rows.some(a=>a.text===text),false);
 for(let batch=1;batch<=5;batch++)assert.equal(rows.filter(a=>a.collectionBatch===batch).length,6);
});
test('清空卡片保留旧关联与历史，30张新卡为空；重复补齐不重复建卡',()=>{
 let state={revision:1,actions:[{id:'old-you',text:'你',signId:'csl.you',samples:[{recordId:'video',sourceHash:'hash',label:1,split:'test'}]}],archivedActions:[],jobs:[{id:'old-job',createdAt:1}],seenTraining:['train-hash'],seenTests:['hash']};let saves=0;
 const store={root:resolve('.'),running:null,read:()=>structuredClone(state),save:(_owner,next)=>{saves++;state=next;},publicState:()=>structuredClone(state)};
 resetPlannedTrainingTasks(store,'owner');assert.equal(state.actions.length,30);assert.ok(state.actions.every(a=>a.samples.length===0));assert.equal(state.archivedActions[0].includeInJointTraining,false);assert.equal(state.archivedActions[0].samples[0].recordId,'video');assert.deepEqual(state.seenTests,['hash']);assert.deepEqual(state.seenTraining,['train-hash']);assert.equal(state.jobs.length,1);assert.ok(state.trainingResetAt>1);
 new JointTraining(store).bootstrap('owner');assert.equal(saves,1);assert.equal(state.actions.length,30);
 store.running={};assert.throws(()=>resetPlannedTrainingTasks(store,'owner'),e=>e.status===409);assert.equal(saves,1);
});
test('补齐仅创建缺少的计划动作，不恢复用户手动归档任务或启动训练',()=>{
 let state={actions:[],archivedActions:[{id:'old',signId:'csl.you',text:'你',samples:[]}],jobs:[]};const store={root:resolve('.'),running:null,read:()=>structuredClone(state),save:(_owner,next)=>{state=next;},publicState:()=>structuredClone(state)};
 new JointTraining(store).bootstrap('owner');assert.equal(state.actions.length,29);assert.equal(state.actions.some(a=>a.text==='你'),false);assert.deepEqual(state.jobs,[]);
});
