import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {TrainingStore} from '../../server/training-store.mjs';
import {deleteOwnedRecord} from '../../server/record-deletion.mjs';
import {trainingQualityFailures} from '../../shared/training-quality.mjs';

test('质量标记采用最新结果、区分用途，删除和修改范围不沿用旧失败',()=>{
 const sample={recordId:'a',sourceHash:'hash',start:0,end:2,split:'train'};
 const actions=[{id:'word',text:'你',samples:[sample,{...sample,recordId:'b',split:'test'}]}];
 const bad={recordId:'a',passed:false,reason:'无手骨架',start:0,end:2,sourceHash:'hash'};
 const jobs=[{createdAt:1,report:{quality:[bad,{...bad,recordId:'b'}]}}];
 assert.deepEqual(trainingQualityFailures(actions,jobs).map(q=>[q.recordId,q.split,q.number]),[['a','train',1],['b','test',1]]);
 assert.equal(trainingQualityFailures(actions,[...jobs,{createdAt:2,report:{quality:[{...bad,passed:true}]}}]).length,1);
 assert.equal(trainingQualityFailures([{...actions[0],samples:[]}],jobs).length,0);
 assert.equal(trainingQualityFailures([{...actions[0],samples:[{...sample,end:1}]}],jobs).length,0);
 assert.equal(trainingQualityFailures([{...actions[0],samples:[{...sample,qualityUpdatedAt:2}]}],jobs).length,0);
});

test('永久删除只处理本人记录并清除各任务关联，训练中拒绝，历史防泄漏哈希保留',async t=>{
 const parent=resolve('.runtime-logs/delete-quality-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'case-'));
 t.after(()=>{assert.ok(dir.startsWith(parent+sep));rmSync(dir,{recursive:true,force:true});});
 mkdirSync(join(dir,'media'));const video=join(dir,'media','video.webm');writeFileSync(video,'synthetic video');
 const record={id:'record',user_id:'alice',kind:'video',media_file:'video.webm'};let deleted=false;
 const db={prepare:sql=>({get:(id,owner)=>!deleted&&id===record.id&&owner===record.user_id?record:undefined,run:(id,owner)=>{assert.match(sql,/DELETE FROM records/);assert.equal(id,'record');assert.equal(owner,'alice');deleted=true;}})};
 const store=new TrainingStore({dataDir:dir,projectRoot:resolve('.'),db});
 store.read('alice');
 const sample={recordId:'record',sourceHash:'known-hash'},other={recordId:'other',sourceHash:'other-hash'};
 store.save('alice',{revision:0,actions:[{id:'one',revision:1,samples:[sample,other],state:'ready'}],archivedActions:[{id:'archived',revision:2,samples:[sample],archivedAt:1}],jobs:[{id:'old',status:'needs_data',report:{quality:[{recordId:'record',passed:false}]}}],seenTraining:['known-hash'],seenTests:[]});
 const args={db,dataDir:dir,training:store,recordId:'record'};
 await assert.rejects(deleteOwnedRecord({...args,owner:'bob'}),e=>e.status===404);assert.ok(existsSync(video));
 store.running={};await assert.rejects(deleteOwnedRecord({...args,owner:'alice'}),e=>e.status===409);assert.ok(existsSync(video));store.running=null;
 await deleteOwnedRecord({...args,owner:'alice'});assert.equal(existsSync(video),false);assert.equal(deleted,true);
 const state=store.read('alice');assert.deepEqual(state.actions[0].samples,[other]);assert.deepEqual(state.archivedActions[0].samples,[]);assert.equal(state.actions[0].revision,2);assert.equal(state.archivedActions[0].revision,3);assert.deepEqual(state.seenTraining,['known-hash']);assert.ok(state.excludedBackgroundHashes.includes('known-hash'));assert.equal(state.jobs[0].report.quality.length,1);
});

test('删除拒绝逃逸到媒体目录之外',async t=>{
 const parent=resolve('.runtime-logs/delete-quality-tests');mkdirSync(parent,{recursive:true});const dir=mkdtempSync(join(parent,'case-'));t.after(()=>{assert.ok(dir.startsWith(parent+sep));rmSync(dir,{recursive:true,force:true});});
 mkdirSync(join(dir,'media'));writeFileSync(join(dir,'keep.txt'),'keep');
 const db={prepare:()=>({get:()=>({id:'record',kind:'video',media_file:'../keep.txt'})})};
 await assert.rejects(deleteOwnedRecord({db,dataDir:dir,training:{running:null},owner:'alice',recordId:'record'}),e=>e.status===409);assert.ok(existsSync(join(dir,'keep.txt')));
});
