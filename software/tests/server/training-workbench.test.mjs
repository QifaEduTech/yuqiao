import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../../server/app.mjs';
import {TrainingStore,qualifiedTrainingReport} from '../../server/training-store.mjs';
import {DatabaseSync} from '../../server/database.mjs';
import {createHash} from 'node:crypto';
test('启用标准复算真实计数，不信任通过标记或小样本高分',()=>{
 const r={trained:true,testEvaluated:true,counts:{tp:19,fn:1,fp:1,tn:19},regression:['谢谢','帮助','需要','我'].map(word=>({word,passed:true}))};assert.equal(qualifiedTrainingReport(r),true);
 assert.equal(qualifiedTrainingReport({...r,counts:{tp:3,fn:0,fp:0,tn:3},passed:true}),false);
 assert.equal(qualifiedTrainingReport({...r,counts:{tp:20,fn:0,fp:2,tn:18}}),false);
 assert.equal(qualifiedTrainingReport({...r,regression:r.regression.slice(1)}),false);
 assert.equal(qualifiedTrainingReport(r,['谢谢','帮助','需要','我','另一个已启用动作']),false);
});
async function fixture(t){const parent=resolve('.runtime-logs/training-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));const origin='http://127.0.0.1:5173';const server=await createApp({dataDir:root,publicDir:resolve('web/public'),origins:[origin]});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+server.address().port;const request=(path,cookie='',body)=>fetch(base+path,{method:body?'POST':'GET',headers:{Origin:origin,'X-Yuqiao-Request':'1','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});async function register(name){const r=await request('/api/auth/register','',{username:name,password:'test-passphrase-2026'});return {cookie:r.headers.get('set-cookie').split(';')[0],user:(await r.json()).user};}return {root,request,register};}
test('训练任务按账号隔离，拒绝未登录/缺数据训练/未达标启用',async t=>{
 const {request,register}=await fixture(t);assert.equal((await request('/api/training/state')).status,401);const a=await register('trainer_a'),b=await register('trainer_b');
 let r=await request('/api/training/actions',a.cookie,{dictionaryId:'csl.ref.bmcx.1932',description:'双手向旁移',hands:2,motion:'dynamic'});assert.equal(r.status,201);const id=(await r.json()).actions[0].id;
 assert.equal((await request('/api/training/actions',a.cookie,{text:'随意填写',description:'未在词典选择',hands:2,motion:'dynamic'})).status,400);
 const words=await(await request('/api/training/dictionary?q='+encodeURIComponent('请'),a.cookie)).json();assert.ok(!words.entries.some(w=>w.id==='csl.ref.bmcx.1932'));assert.ok(words.entries.length<=10);
 assert.equal((await (await request('/api/training/state',b.cookie)).json()).actions.length,0);
 assert.equal((await request('/api/training/actions/'+id,b.cookie,{operation:'reopen'})).status,404);
 assert.equal((await request('/api/training/actions/'+id+'/jobs',a.cookie,{kind:'train'})).status,400);
 assert.equal((await request('/api/training/actions/'+id+'/activate',a.cookie,{version:'not-a-model'})).status,400);
 assert.equal((await request('/api/training/actions',a.cookie,{dictionaryId:'csl.thanks',description:'不覆盖内置模型',hands:1,motion:'dynamic'})).status,400);
});
test('范围标注不改原登记，限制跨组泄漏、旧资料测试与源哈希重复',async t=>{
 const {root,request,register}=await fixture(t),a=await register('sample_trainer');const created=await(await request('/api/training/actions',a.cookie,{dictionaryId:'csl.ref.bmcx.1932',description:'自然完整移动',hands:1,motion:'dynamic'})).json(),id=created.actions[0].id;
 const db=new DatabaseSync(join(root,'app.sqlite'));t.after(()=>{try{db.close();}catch{}});
 async function record(key,content){await writeFile(join(root,'media',key+'.webm'),content);db.prepare('INSERT INTO records(id,user_id,kind,text,media_file,mime,byte_length,duration,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(key,a.user.id,'video','测试录像',key+'.webm','video/webm',content.length,2,Date.now());}
 await record('r1','first');await record('r2','second');await record('r3','first');
 const body={operation:'sample',recordId:'r1',start:0,end:2,label:1,split:'train',group:'真实第一轮',reviewed:true,realGroupConfirmed:true};
 assert.equal((await request('/api/training/actions/'+id,a.cookie,body)).status,200);
 assert.equal(db.prepare('SELECT count(*) AS n FROM sign_samples').get().n,0);
 assert.equal((await request('/api/training/actions/'+id,a.cookie,{...body,recordId:'r2',split:'test'})).status,400);
 assert.equal((await request('/api/training/actions/'+id,a.cookie,{...body,end:3})).status,400);
 assert.equal((await request('/api/training/actions/'+id,a.cookie,{...body,recordId:'r3'})).status,200);
 const store=new TrainingStore({dataDir:root,projectRoot:resolve('.'),db});assert.throws(()=>store.preflight(a.user.id,store.read(a.user.id).actions[0]),/重复/);
 db.close();
});
