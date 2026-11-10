import {prepareMysqlFixture,mysqlTestTrigger} from './mysql-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from '../../server/database.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {createApp} from '../../server/app.mjs';
import {createSampleStore} from '../../server/samples.mjs';
import {prepareTrainingArchive,applyTrainingArchive} from '../../server/training-archive.mjs';

const origin='http://127.0.0.1:5173',video=Buffer.concat([Buffer.from([26,69,223,163]),Buffer.alloc(96,1)]);
const body={revision:0,category:'thanks',detail:'完整谢谢',batch:'batch-1',performer:'person-a',complete:true,startSeconds:0.2,endSeconds:1.8,reviewed:true};
async function fixture(t){
  const parent=resolve('.runtime-logs/sample-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));
  const cleanupMysql=await prepareMysqlFixture(root);
  const server=await createApp({dataDir:root,publicDir:resolve('web/public')});server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await cleanupMysql();await rm(root,{recursive:true,force:true});});
  const req=(path,{cookie,json,raw,method='GET',headers={}}={})=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{Origin:origin,'X-Yuqiao-Request':'1',...(cookie?{Cookie:cookie}:{}),...(json?{'Content-Type':'application/json'}:{}),...headers},body:json?JSON.stringify(json):raw});
  async function register(username){const r=await req('/api/auth/register',{method:'POST',json:{username,password:'test-passphrase-2026'}});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];}
  async function upload(cookie){const r=await req('/api/records/video?text=original&duration=2',{cookie,method:'POST',raw:video,headers:{'Content-Type':'video/webm'}});assert.equal(r.status,201);return(await r.json()).record;}
  return {root,req,register,upload};
}

test('请使用独立33类编号，完整性必填，待检查归档兼容且旧编号不变',async t=>{
  const f=await fixture(t),cookie=await f.register('PleaseSample'),record=await f.upload(cookie);
  const payload={...body,category:'please',detail:'请'};
  assert.equal((await f.req(`/api/records/${record.id}/sample`,{cookie,method:'PUT',json:{...payload,complete:false}})).status,400);
  const response=await f.req(`/api/records/${record.id}/sample`,{cookie,method:'PUT',json:payload});assert.equal(response.status,200);const saved=await response.json();
  assert.equal(saved.sample.sampleNumber,'33.1');assert.equal(saved.sample.trainingReady,false);
  const numbering=(await(await f.req('/api/samples/numbering',{cookie})).json()).nextNumbers;assert.equal(numbering.please,'33.2');assert.equal(numbering.me,'32.1');assert.equal(numbering.thanks,'26.1');
  const plan=prepareTrainingArchive(f.root);assert.equal(plan.entries[0].split,'pending');assert.ok(plan.entries[0].target.startsWith('training/pending/please/'));
  assert.deepEqual(Buffer.from(await(await f.req(`/api/records/${record.id}/media`,{cookie})).arrayBuffer()),video);
});

test('训练归档移动原片不复制，清理两账号非训练录像，保留动作引用且历史仍可播放删除',async t=>{
  const f=await fixture(t),a=await f.register('ArchiveA'),b=await f.register('ArchiveB');
  const train=await f.upload(a),pending=await f.upload(a),unused=await f.upload(a),other=await f.upload(b),reference=await f.upload(a);
  await f.req(`/api/records/${train.id}/sample`,{cookie:a,method:'PUT',json:body});
  await f.req(`/api/records/${pending.id}/sample`,{cookie:a,method:'PUT',json:{...body,category:'help',detail:'帮助'}});
  await mkdir(join(f.root,'sign-motions'),{recursive:true});await writeFile(join(f.root,'sign-motions',reference.id+'.json'),JSON.stringify({source:{recordId:reference.id}}));
  const plan=prepareTrainingArchive(f.root,{includeOtherOwners:true,developmentSamples:['26.1']});assert.equal(plan.summary.deleteVideos,2);assert.equal(plan.summary.referenceVideos,1);
  const result=applyTrainingArchive(plan),manifest=JSON.parse(await readFile(result.manifest,'utf8'));
  assert.deepEqual(manifest.samples.map(x=>x.split).sort(),['pending','train']);assert.equal(manifest.testSamples,0);
  assert.equal((await f.req(`/api/records/${unused.id}/media`,{cookie:a})).status,404);assert.equal((await f.req(`/api/records/${other.id}/media`,{cookie:b})).status,404);
  assert.equal((await f.req(`/api/records/${reference.id}/media`,{cookie:a})).status,200);
  const media=await f.req(`/api/records/${train.id}/media`,{cookie:a});assert.deepEqual(Buffer.from(await media.arrayBuffer()),video);
  assert.equal((await readdir(join(f.root,'media'))).includes(train.id+'.webm'),false);
  await f.req(`/api/records/${train.id}`,{cookie:a,method:'DELETE'});const after=JSON.parse(await readFile(result.manifest,'utf8'));assert.equal(after.samples.some(x=>x.recordId===train.id),false);
});

test('归档计划遇到登记改变拒绝执行，不删除录像',async t=>{
  const f=await fixture(t),a=await f.register('ArchiveChange'),r=await f.upload(a),unused=await f.upload(a);
  await f.req(`/api/records/${r.id}/sample`,{cookie:a,method:'PUT',json:body});
  const plan=prepareTrainingArchive(f.root,{developmentSamples:['26.1']});
  await f.req(`/api/records/${r.id}/sample`,{cookie:a,method:'PUT',json:{...body,revision:1,detail:'updated'}});
  assert.throws(()=>applyTrainingArchive(plan),/records_changed/);assert.equal((await f.req(`/api/records/${unused.id}/media`,{cookie:a})).status,200);
});

test('归档数据库删除失败时回滚移动，不丢训练原片或旧视频',async t=>{
  const f=await fixture(t),a=await f.register('ArchiveRollback'),r=await f.upload(a),unused=await f.upload(a);
  await f.req(`/api/records/${r.id}/sample`,{cookie:a,method:'PUT',json:body});const plan=prepareTrainingArchive(f.root,{developmentSamples:['26.1']});
  const db=new DatabaseSync(join(f.root,'app.sqlite'));if(process.env.YUQIAO_TEST_MYSQL==='1')await mysqlTestTrigger(f.root,'block_cleanup','records','DELETE');else db.exec("CREATE TRIGGER block_cleanup BEFORE DELETE ON records BEGIN SELECT RAISE(ABORT,'test_failure'); END;");db.close();
  assert.throws(()=>applyTrainingArchive(plan),error=>process.env.YUQIAO_TEST_MYSQL==='1'?error.code==='ER_SIGNAL_EXCEPTION':/test_failure/.test(error.message));
  for(const record of [r,unused])assert.deepEqual(await readFile(join(f.root,'media',record.id+'.webm')),video);
});

test('需要31类独立计数与完整性，原片归档为待检查，改类恢复原编号',async t=>{
  const f=await fixture(t),cookie=await f.register('NeedUser'),r=await f.upload(cookie),path=`/api/records/${r.id}/sample`;
  const save=json=>f.req(path,{cookie,method:'PUT',json});
  assert.equal((await save({...body,category:'need',detail:'需要',complete:false})).status,400);
  const result=await(await save({...body,category:'need',detail:'需要'})).json();
  assert.equal(result.sample.sampleNumber,'31.1');assert.equal(result.nextNumbers.help,'30.1');assert.equal(result.sample.trainingReady,false);
  const plan=prepareTrainingArchive(f.root);const entry=plan.entries.find(x=>x.record.id===r.id);
  assert.equal(entry.split,'pending');assert.equal(entry.sampleNumber,'31.1');assert.match(entry.target,/training\/pending\/need\//);
  await save({...body,revision:1,category:'other',detail:'不完整需要',complete:false});
  const restored=await(await save({...body,revision:2,category:'need',detail:'需要'})).json();assert.equal(restored.sample.sampleNumber,'31.1');assert.equal(restored.nextNumbers.need,'31.2');
});

test('我独立32类，完整性校验与pending归档兼容，改类不改其他编号',async t=>{
  const f=await fixture(t),cookie=await f.register('MeUser'),r=await f.upload(cookie),path=`/api/records/${r.id}/sample`,save=json=>f.req(path,{cookie,method:'PUT',json});
  assert.equal((await save({...body,category:'me',detail:'我',complete:false})).status,400);
  const result=await(await save({...body,category:'me',detail:'我'})).json();assert.equal(result.sample.sampleNumber,'32.1');assert.equal(result.sample.trainingReady,false);assert.equal(result.nextNumbers.need,'31.1');
  const planned=prepareTrainingArchive(f.root).entries.find(x=>x.record.id===r.id);assert.equal(planned.split,'pending');assert.match(planned.target,/training\/pending\/me\//);
  await save({...body,revision:1,category:'other',detail:'方向不对',complete:false});const back=await(await save({...body,revision:2,category:'me',detail:'我'})).json();assert.equal(back.sample.sampleNumber,'32.1');assert.equal(back.nextNumbers.me,'32.2');
});

test('帮助独立登记30类，完整性校验，改类恢复编号且不改谢谢计数',async t=>{
  const f=await fixture(t),cookie=await f.register('HelpUser'),r=await f.upload(cookie),path=`/api/records/${r.id}/sample`;
  const save=json=>f.req(path,{cookie,method:'PUT',json});
  assert.equal((await save({...body,category:'help',detail:'帮助',complete:false})).status,400);
  const help=await(await save({...body,category:'help',detail:'帮助'})).json();
  assert.equal(help.sample.category,'help');assert.equal(help.sample.sampleNumber,'30.1');assert.equal(help.nextNumbers.thanks,'26.1');assert.equal(help.sample.trainingReady,false);
  const other=await(await save({...body,revision:1,category:'other',detail:'不完整帮助',complete:false})).json();assert.equal(other.sample.sampleNumber,'28.1');
  const restored=await(await save({...body,revision:2,category:'help',detail:'帮助'})).json();assert.equal(restored.sample.sampleNumber,'30.1');assert.equal(restored.nextNumbers.help,'30.2');
});

test('模型误判复盘必须属于当前账号，原片/登记变化失效，删除录像清理私有复盘',async t=>{
  const f=await fixture(t),cookie=await f.register('ReviewOwner'),other=await f.register('ReviewOther'),record=await f.upload(cookie);
  await f.req(`/api/records/${record.id}/sample`,{cookie,method:'PUT',json:{...body,category:'other',detail:'静止双掌'}});
  const db=new DatabaseSync(join(f.root,'app.sqlite'));const owner=db.prepare('SELECT user_id FROM records WHERE id=?').get(record.id).user_id;db.close();
  const manifest=JSON.parse(await readFile(resolve('models/help-video-tcn/v1/manifest.json'),'utf8'));await mkdir(join(f.root,'model-diagnostics'));
  const file=join(f.root,'model-diagnostics/static-palms-v1.json'),report={recordId:record.id,ownerId:owner,revision:1,sourceSha256:createHash('sha256').update(video).digest('hex'),modelArtifactSha256:manifest.artifactSha256,frames:[{t:0,score:null,tracking:{width:64,height:64,mirrored:true,hands:[]}}]};
  await writeFile(file,JSON.stringify(report));
  assert.equal((await f.req('/api/sign/help-model-review')).status,401);assert.equal((await f.req('/api/sign/help-model-review',{cookie:other})).status,404);
  const response=await f.req('/api/sign/help-model-review',{cookie});assert.equal(response.status,200);const result=await response.json();assert.equal(result.ownerId,undefined);assert.equal(result.sourceSha256,undefined);assert.equal(result.mediaUrl,`/api/records/${record.id}/media`);
  await f.req(`/api/records/${record.id}/sample`,{cookie,method:'PUT',json:{...body,category:'other',detail:'静止双掌',revision:1}});assert.equal((await f.req('/api/sign/help-model-review',{cookie})).status,409);
  await f.req(`/api/records/${record.id}`,{cookie,method:'DELETE'});await assert.rejects(readFile(file),e=>e.code==='ENOENT');
});
test('样本必须人工登记，账号隔离、来源哈希与输入规则均校验',async t=>{
  const f=await fixture(t),a=await f.register('Alice'),b=await f.register('Bob'),r=await f.upload(a),path=`/api/records/${r.id}/sample`;
  assert.equal((await f.req(path)).status,401);assert.equal((await f.req(path,{cookie:b})).status,404);
  const initial=await(await f.req(path,{cookie:a})).json();assert.equal(initial.revision,0);assert.equal(initial.duration,2);assert.equal(initial.sample,null);assert.equal(initial.nextNumbers.thanks,'26.1');assert.match(initial.defaultBatch,/^auto-date-\d{4}-\d{2}-\d{2}$/);
  assert.equal((await f.req(path,{cookie:a,method:'PUT',json:body,headers:{Origin:'https://invalid.example'}})).status,403);
  for(const patch of [{reviewed:false},{category:'hello'},{complete:false},{startSeconds:-1},{endSeconds:3},{endSeconds:0},{batch:123},{performer:''},{detail:''},{trainingReady:true},{sourceSha256:'fake'},{sampleNumber:'26.99'}])assert.equal((await f.req(path,{cookie:a,method:'PUT',json:{...body,...patch}})).status,400);
  const response=await f.req(path,{cookie:a,method:'PUT',json:body});assert.equal(response.status,200);const state=await response.json();
  assert.equal(state.sample.sourceSha256,createHash('sha256').update(video).digest('hex'));assert.equal(state.sample.trainingReady,false);assert.equal(state.sample.featureStatus,'pending');assert.equal(state.sample.purpose,'pilot');assert.equal(state.revision,1);
  assert.equal((await f.req(path,{cookie:b,method:'DELETE',json:{revision:1}})).status,404);
  const records=(await(await f.req('/api/records',{cookie:a})).json()).records;assert.equal(records.length,1);assert.equal(records[0].text,'original');
});
test('撤回保留录像，旧版本不能复活样本，源视频删除级联清理',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),r=await f.upload(cookie),path=`/api/records/${r.id}/sample`;
  const put=json=>f.req(path,{cookie,method:'PUT',json});await put(body);
  assert.equal((await put(body)).status,409);
  let result=await(await f.req(path,{cookie,method:'DELETE',json:{revision:1}})).json();assert.equal(result.revision,2);assert.equal(result.sample,null);
  assert.equal((await f.req(`/api/records/${r.id}/media`,{cookie})).status,200);assert.equal((await put(body)).status,409);
  assert.equal((await put({...body,revision:2,category:'uncertain',complete:false})).status,200);
  result=await(await f.req(path,{cookie})).json();assert.equal(result.sample.excluded,true);assert.equal(result.revision,3);
  await f.req(`/api/records/${r.id}`,{cookie,method:'DELETE'});assert.equal((await f.req(path,{cookie})).status,404);
  const db=new DatabaseSync(join(f.root,'app.sqlite'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sign_samples').get().n,0);db.close();
});
test('登记后源文件改变会拒绝覆盖，注销或原记录删除后不能写入',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),r=await f.upload(cookie),path=`/api/records/${r.id}/sample`;
  await f.req(path,{cookie,method:'PUT',json:body});const file=join(f.root,'media',`${r.id}.webm`),changed=await readFile(file);changed[30]=5;await writeFile(file,changed);
  assert.equal((await f.req(path,{cookie,method:'PUT',json:{...body,revision:1}})).status,409);
  await f.req('/api/auth/logout',{cookie,method:'POST'});assert.equal((await f.req(path,{cookie,method:'PUT',json:{...body,revision:1}})).status,401);
});

test('分类自动递增、并发不重号，编辑撤回不占新号，删除不复用，账号隔离',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),a=await f.upload(cookie),b=await f.upload(cookie);
  const save=(id,data)=>f.req(`/api/records/${id}/sample`,{cookie,method:'PUT',json:data});
  const auto={...body,batch:''};
  const responses=await Promise.all([save(a.id,auto),save(b.id,auto)]);responses.forEach(r=>assert.equal(r.status,200));
  const saved=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(saved.map(s=>s.sample.sampleNumber).sort(),['26.1','26.2']);assert.equal(saved[0].sample.batch,saved[1].sample.batch);assert.equal(saved[0].sample.batchOrigin,'record_date_coarse');
  const edited=await(await save(a.id,{...auto,revision:1,detail:'谢谢修改说明'})).json();assert.equal(edited.sample.sampleNumber,saved[0].sample.sampleNumber);assert.equal(edited.nextNumbers.thanks,'26.3');
  assert.equal((await save(a.id,{...auto,revision:0})).status,409);
  await f.req(`/api/records/${a.id}/sample`,{cookie,method:'DELETE',json:{revision:2}});
  const again=await(await save(a.id,{...auto,revision:3})).json();assert.equal(again.sample.sampleNumber,saved[0].sample.sampleNumber);
  const moved=await(await save(a.id,{...auto,category:'background',revision:4})).json();assert.equal(moved.sample.sampleNumber,'27.1');assert.equal(moved.nextNumbers.thanks,'26.3');
  const restored=await(await save(a.id,{...auto,revision:5})).json();assert.equal(restored.sample.sampleNumber,saved[0].sample.sampleNumber);
  await f.req(`/api/records/${b.id}`,{cookie,method:'DELETE'});const c=await f.upload(cookie);
  assert.equal((await save(c.id,{...auto,reviewed:false})).status,400);
  const third=await(await save(c.id,auto)).json();assert.equal(third.sample.sampleNumber,'26.3');
  for(const [category,expected] of [['other','28.1'],['uncertain','29.1']]){const r=await f.upload(cookie);assert.equal((await(await save(r.id,{...auto,category})).json()).sample.sampleNumber,expected);}
  const bob=await f.register('Bob'),r=await f.upload(bob);const isolated=await(await f.req(`/api/records/${r.id}/sample`,{cookie:bob,method:'PUT',json:auto})).json();assert.equal(isolated.sample.sampleNumber,'26.1');
});

test('旧登记一次性补号，原批次标签版本不变，重复初始化不重复分号',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('owner');
      CREATE TABLE records(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,duration REAL,created_at INTEGER);
      INSERT INTO records VALUES('old-a','owner','video',3,1000),('old-b','owner','video',3,2000);
      CREATE TABLE sign_samples(record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,user_id TEXT,active INTEGER,payload TEXT,source_sha256 TEXT,revision INTEGER,updated_at INTEGER);`);
    const payload=JSON.stringify({...body,batch:'26.8'});
    db.prepare('INSERT INTO sign_samples VALUES(?,?,?,?,?,?,?)').run('old-a','owner',1,payload,'hash-a',5,5000);
    db.prepare('INSERT INTO sign_samples VALUES(?,?,?,?,?,?,?)').run('old-b','owner',1,payload,'hash-b',3,3000);
    let store=createSampleStore(db);assert.equal(store.get('owner','old-a').sample.sampleNumber,'26.1');assert.equal(store.get('owner','old-b').sample.sampleNumber,'26.2');
    store=createSampleStore(db);const result=store.get('owner','old-a');assert.equal(result.sample.batch,'26.8');assert.equal(result.revision,5);assert.equal(result.nextNumbers.thanks,'26.3');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample_numbers').get().n,2);
  }finally{db.close();}
});

test('录像与练习登记一次保存，重试并发不重复建记录，删除后旧请求不能复活',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),saveKey=randomUUID();
  assert.equal((await f.req('/api/samples/numbering')).status,401);
  assert.equal((await(await f.req('/api/samples/numbering',{cookie})).json()).nextNumbers.thanks,'26.1');
  const upload=(sample=body)=>f.req('/api/records/video?text=paired&duration=2',{cookie,method:'POST',raw:video,headers:{'Content-Type':'video/webm','X-Yuqiao-Sample':encodeURIComponent(JSON.stringify(sample)),'X-Yuqiao-Save-Key':saveKey}});
  const responses=await Promise.all([upload(),upload()]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,201]);
  const values=await Promise.all(responses.map(r=>r.json()));assert.equal(values[0].record.id,values[1].record.id);assert.equal(values[0].registration.sample.sampleNumber,'26.1');assert.equal(values[1].registration.sample.detail,body.detail);
  assert.equal((await(await f.req('/api/records',{cookie})).json()).records.length,1);assert.equal((await readdir(join(f.root,'media'))).length,1);
  assert.equal((await upload({...body,detail:'changed'})).status,409);assert.equal((await(await f.req('/api/samples/numbering',{cookie})).json()).nextNumbers.thanks,'26.2');
  await f.req(`/api/records/${values[0].record.id}`,{cookie,method:'DELETE'});assert.equal((await upload()).status,410);assert.equal((await(await f.req('/api/records',{cookie})).json()).records.length,0);
});

test('登记非法或事务失败时不留下录像记录、文件或占用编号',async t=>{
  const f=await fixture(t),cookie=await f.register('Alice'),saveKey=randomUUID();
  const upload=(sample=body)=>f.req('/api/records/video?text=paired&duration=2',{cookie,method:'POST',raw:video,headers:{'Content-Type':'video/webm','X-Yuqiao-Sample':encodeURIComponent(JSON.stringify(sample)),'X-Yuqiao-Save-Key':saveKey}});
  assert.equal((await upload({...body,reviewed:false})).status,400);
  const db=new DatabaseSync(join(f.root,'app.sqlite'));
  try{
    if(process.env.YUQIAO_TEST_MYSQL==='1')await mysqlTestTrigger(f.root,'fail_sample','sign_samples','INSERT');else db.exec("CREATE TRIGGER fail_sample BEFORE INSERT ON sign_samples BEGIN SELECT RAISE(ABORT,'test failure'); END;");
    assert.equal((await upload()).status,500);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM records').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample_numbers').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sample_number_counters').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_save_keys').get().n,0);assert.equal((await readdir(join(f.root,'media'))).length,0);
    if(process.env.YUQIAO_TEST_MYSQL==='1')await mysqlTestTrigger(f.root,'fail_sample','sign_samples','INSERT',true);else db.exec('DROP TRIGGER fail_sample');
    const response=await upload();assert.equal(response.status,201);assert.equal((await response.json()).registration.sample.sampleNumber,'26.1');
  }finally{db.close();}
});
