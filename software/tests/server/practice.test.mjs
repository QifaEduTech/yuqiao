import {prepareMysqlFixture} from './mysql-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from '../../server/database.mjs';
import {randomUUID} from 'node:crypto';
import {createApp} from '../../server/app.mjs';

const origin='http://127.0.0.1:5173';
const video=Buffer.concat([Buffer.from([26,69,223,163]),Buffer.alloc(96,1)]);
async function fixture(t){
  const parent=resolve('.runtime-logs/practice-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));
  const state={result:{status:'candidate',candidate:'谢谢'},calls:0,run:null};
  const service={status:()=>({available:true}),close(){},async recognize(){state.calls++;return state.run?state.run():state.result;}};
  const cleanupMysql=await prepareMysqlFixture(root);
  let server,base;
  async function open(){server=await createApp({dataDir:root,publicDir:resolve('web/public'),origins:[origin],signService:service});server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;}
  async function close(){server.closeAllConnections();await new Promise(r=>server.close(r));}
  await open();t.after(async()=>{await close();assert.ok(root.startsWith(parent+sep));await cleanupMysql();await rm(root,{recursive:true,force:true});});
  const req=(path,{cookie,json,raw,method='GET',headers={},signal}={})=>fetch(base+path,{method,signal,headers:{Origin:origin,'X-Yuqiao-Request':'1',...(cookie?{Cookie:cookie}:{}),...(json?{'Content-Type':'application/json'}:{}),...headers},body:json?JSON.stringify(json):raw});
  async function register(name){const r=await req('/api/auth/register',{method:'POST',json:{username:name,password:'test-passphrase-2026'}});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];}
  async function upload(cookie){const r=await req('/api/records/video?text=original-note&duration=2',{method:'POST',cookie,raw:video,headers:{'Content-Type':'video/webm'}});assert.equal(r.status,201);return(await r.json()).record;}
  const infer=(cookie,id,raw=video)=>req('/api/sign/experiments',{cookie,method:'POST',raw,headers:{'Content-Type':'video/webm','X-Yuqiao-Record-Id':id}});
  return {req,register,upload,infer,state,root,restart:async()=>{await close();await open();}};
}

test('练习识别必须属于当前账号且字节匹配源录像，结果由后台生成',async t=>{
  const f=await fixture(t),alice=await f.register('Alice'),bob=await f.register('Bob'),r=await f.upload(alice);
  assert.equal((await f.infer(undefined,r.id)).status,401);assert.equal((await f.infer(bob,r.id)).status,404);
  const changed=Buffer.from(video);changed[30]=5;assert.equal((await f.infer(alice,r.id,changed)).status,409);assert.equal(f.state.calls,0);
  const response=await f.infer(alice,r.id);assert.equal(response.status,200);const {attempt}=await response.json();assert.equal(attempt.candidate,'谢谢');assert.equal(attempt.candidateId,'csl.thanks');assert.equal(attempt.feedback,null);assert.ok(attempt.snapshot.modelSha256);assert.ok(attempt.snapshot.featureId);assert.ok(attempt.snapshot.motionVersion);
  assert.equal((await f.req(`/api/records/${r.id}/practice`,{cookie:bob})).status,404);assert.equal((await f.req(`/api/records/${r.id}/practice/${attempt.id}`,{cookie:bob})).status,404);
  const path=`/api/records/${r.id}/practice/${attempt.id}/feedback`;
  assert.equal((await f.req(path,{cookie:bob,method:'PUT',json:{feedback:'agree',correction:'',revision:0}})).status,404);
  assert.equal((await f.req(path,{cookie:alice,method:'PUT',json:{feedback:'agree',correction:'',revision:0,candidate:'谢谢'}})).status,400);
  assert.equal((await f.req(path,{cookie:alice,method:'PUT',headers:{Origin:'https://other.example'},json:{feedback:'agree',correction:'',revision:0}})).status,403);
});

test('已接入动作按视频推理，未训练的请仍拦截；登记不会制造候选',async t=>{
  const f=await fixture(t),cookie=await f.register('ScopeTest');
  for(const category of ['help','need','me','please']){
    const r=await f.upload(cookie);
    assert.equal((await f.req(`/api/records/${r.id}/sample`,{cookie,method:'PUT',json:{revision:0,category,detail:'人工说明不是推理结果',batch:'',performer:'test',complete:true,startSeconds:0,endSeconds:2,reviewed:true}})).status,200);
    const changed=Buffer.from(video);changed[30]=5;assert.equal((await f.infer(cookie,r.id,changed)).status,409);
    const response=await f.infer(cookie,r.id);assert.equal(response.status,200);const result=await response.json();
    if(category==='please'){assert.equal(result.status,'unsupported');assert.equal(result.candidate,null);assert.equal(result.reason,'recording_action_not_connected');assert.equal(result.attempt,undefined);assert.equal(result.actionText,'请');}
    else {assert.equal(result.candidate,'谢谢','必须使用推理结果，不能复制人工类别');assert.equal(result.attempt.candidate,'谢谢');assert.equal(result.attempt.snapshot.pipelineId,'realtime-four-words-recording-v1');}
  }
  assert.equal(f.state.calls,3);
});

test('反馈与原候选分开持久化、并发版本保护、重新识别保留旧结果、删除录像级联清理',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),r=await f.upload(cookie);const {attempt}=await(await f.infer(cookie,r.id)).json();
  const path=`/api/records/${r.id}/practice/${attempt.id}/feedback`;
  let response=await f.req(path,{cookie,method:'PUT',json:{feedback:'disagree',correction:'谢谢',revision:0}});assert.equal(response.status,200);let saved=(await response.json()).attempt;assert.equal(saved.candidate,'谢谢');assert.equal(saved.correction,'谢谢');assert.equal(saved.revision,1);
  assert.equal((await f.req(path,{cookie,method:'PUT',json:{feedback:'agree',correction:'',revision:0}})).status,409);
  await f.restart();let list=await(await f.req(`/api/records/${r.id}/practice`,{cookie})).json();assert.equal(list.attempts[0].feedback,'disagree');assert.equal(list.attempts[0].candidate,'谢谢');assert.equal((await(await f.req('/api/records',{cookie})).json()).records[0].text,'original-note');
  f.state.result={status:'candidate',candidate:'谢谢'};const second=(await(await f.infer(cookie,r.id)).json()).attempt;assert.notEqual(second.id,attempt.id);assert.equal(second.feedback,null);
  response=await f.req(path,{cookie,method:'PUT',json:{feedback:null,correction:'',revision:1}});saved=(await response.json()).attempt;assert.equal(saved.feedback,null);assert.equal(saved.candidate,'谢谢');
  list=await(await f.req(`/api/records/${r.id}/practice`,{cookie})).json();assert.equal(list.total,2);
  assert.equal((await f.req(`/api/records/${r.id}`,{cookie,method:'DELETE'})).status,200);assert.equal((await f.req(`/api/records/${r.id}/practice`,{cookie})).status,404);
  const db=new DatabaseSync(join(f.root,'app.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM practice_attempts').get().n,0);db.close();
});

test('无候选不能评为一致，不一致必须提供有限长度的纠正词',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),r=await f.upload(cookie);f.state.result={status:'no_hands',candidate:null};const {attempt}=await(await f.infer(cookie,r.id)).json();const path=`/api/records/${r.id}/practice/${attempt.id}/feedback`;
  for(const body of [{feedback:'agree',correction:'',revision:0},{feedback:'disagree',correction:' ',revision:0},{feedback:'disagree',correction:'字'.repeat(101),revision:0},{feedback:'uncertain',correction:'你好',revision:0},{feedback:'perfect',correction:'',revision:0}])assert.equal((await f.req(path,{cookie,method:'PUT',json:body})).status,400);
  assert.equal((await f.req(path,{cookie,method:'PUT',json:{feedback:'uncertain',correction:'',revision:0}})).status,200);
  f.state.result={status:'candidate',candidate:'未开放的词'};assert.equal((await f.infer(cookie,r.id)).status,502);assert.equal((await(await f.req(`/api/records/${r.id}/practice`,{cookie})).json()).total,1);
});

test('识别过程中删除源录像或注销，不得保存迟到的练习结果',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice');let started,release;
  const wait=()=>new Promise(resolve=>{started=resolve;});
  f.state.run=async()=>{started();await new Promise(r=>{release=r;});return {status:'candidate',candidate:'谢谢'};};
  let r=await f.upload(cookie),ready=wait(),pending=f.infer(cookie,r.id);await ready;await f.req(`/api/records/${r.id}`,{cookie,method:'DELETE'});release();assert.equal((await pending).status,404);
  r=await f.upload(cookie);ready=wait();pending=f.infer(cookie,r.id);await ready;await f.req('/api/auth/logout',{cookie,method:'POST'});release();assert.equal((await pending).status,401);
  const db=new DatabaseSync(join(f.root,'app.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM practice_attempts').get().n,0);db.close();
});

test('帮助需要我保存对应模型版本，旧你好历史快照不被改写',async t=>{
 const f=await fixture(t),cookie=await f.register('Snapshots'),record=await f.upload(cookie),db=new DatabaseSync(join(f.root,'app.sqlite'));
 const userId=db.prepare('SELECT user_id FROM records WHERE id=?').get(record.id).user_id,id=randomUUID(),old={modelId:'legacy-model',modelVersion:'legacy-v1',modelSha256:'a'.repeat(64),featureId:'legacy-feature',dictionaryVersion:'old',dictionaryHash:'b'.repeat(64),motionVersion:null};
 db.prepare('INSERT INTO practice_attempts(id,record_id,user_id,status,candidate_id,candidate_text,snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,record.id,userId,'candidate','csl.hello','你好',JSON.stringify(old),1,1);db.close();
 for(const [word,model,feature] of [['帮助','help-video-tcn-development-v1','153'],['需要','need-directional-tcn-development-v1','171'],['我','me-body-video-tcn-development-v1','178']]){f.state.result={status:'candidate',candidate:word};const response=await f.infer(cookie,record.id);assert.equal(response.status,200);const {attempt}=await response.json();assert.equal(attempt.snapshot.modelId,model);assert.match(attempt.snapshot.featureId,new RegExp(feature));assert.equal(attempt.snapshot.pipelineModels.length,4);}
 const history=await(await f.req(`/api/records/${record.id}/practice`,{cookie})).json();const original=history.attempts.find(a=>a.id===id);assert.equal(original.candidate,'你好');assert.deepEqual(original.snapshot,old);
});

test('推理期间登记改变，不把旧结果保存到新登记版本',async t=>{
 const f=await fixture(t),cookie=await f.register('Concurrent'),record=await f.upload(cookie);let started,release;const ready=new Promise(r=>{started=r;});
 f.state.run=async()=>{started();await new Promise(r=>{release=r;});return {status:'candidate',candidate:'谢谢'};};
 const pending=f.infer(cookie,record.id);await ready;assert.equal((await f.req(`/api/records/${record.id}/sample`,{cookie,method:'PUT',json:{revision:0,category:'help',detail:'帮助',batch:'round',performer:'test',complete:true,startSeconds:0,endSeconds:2,reviewed:true}})).status,200);release();assert.equal((await pending).status,409);assert.equal((await(await f.req(`/api/records/${record.id}/practice`,{cookie})).json()).total,0);
});
