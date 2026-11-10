import {readFileSync} from 'node:fs';
const prefixes=JSON.parse(readFileSync(new URL('../shared/sample-numbering.json',import.meta.url),'utf8'));
const targets=JSON.parse(readFileSync(new URL('../shared/sign-development-actions.json',import.meta.url),'utf8')).actions;
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createSampleStore(db){
  db.exec(`CREATE TABLE IF NOT EXISTS sign_samples (
    record_id TEXT PRIMARY KEY REFERENCES records(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active INTEGER NOT NULL DEFAULT 0, payload TEXT, source_sha256 TEXT,
    revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sign_samples_owner ON sign_samples(user_id,active);
    CREATE TABLE IF NOT EXISTS sample_number_counters (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL, last_number INTEGER NOT NULL,
      PRIMARY KEY(user_id,category));
    CREATE TABLE IF NOT EXISTS sample_numbers (
      record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      category TEXT NOT NULL, sequence INTEGER NOT NULL,
      PRIMARY KEY(record_id,category), UNIQUE(user_id,category,sequence));`);
  function allocate(userId,id,category){
    const known=db.prepare('SELECT sequence FROM sample_numbers WHERE record_id=? AND user_id=? AND category=?').get(id,userId,category);
    if(known)return known.sequence;
    const next=db.prepare(`INSERT INTO sample_number_counters(user_id,category,last_number) VALUES(?,?,1)
      ON CONFLICT(user_id,category) DO UPDATE SET last_number=last_number+1 RETURNING last_number`).get(userId,category).last_number;
    db.prepare('INSERT INTO sample_numbers(record_id,user_id,category,sequence) VALUES(?,?,?,?)').run(id,userId,category,next);
    return next;
  }
  // Existing labels/batches remain unchanged. Backfill numbers once in recording order.
  db.exec('BEGIN IMMEDIATE');
  try{
    const existing=db.prepare('SELECT s.record_id,s.user_id,s.payload FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.active=1 ORDER BY r.created_at,s.record_id').all();
    for(const row of existing){const category=JSON.parse(row.payload).category;if(Object.hasOwn(prefixes,category))allocate(row.user_id,row.record_id,category);}
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
  const defaultBatch=source=>'auto-date-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(source.created_at));
  function record(userId,id){
    const row=db.prepare("SELECT * FROM records WHERE id=? AND user_id=? AND kind='video'").get(id,userId);
    if(!row)throw fail(404,'录像不存在、已删除或不属于当前账号。');return row;
  }
  function get(userId,id){
    const source=record(userId,id),row=db.prepare('SELECT * FROM sign_samples WHERE record_id=? AND user_id=?').get(id,userId);
    const assignedNumbers={};for(const item of db.prepare('SELECT category,sequence FROM sample_numbers WHERE record_id=? AND user_id=?').all(id,userId))assignedNumbers[item.category]=`${prefixes[item.category]}.${item.sequence}`;
    const nextNumbers=numbering(userId);
    const payload=row?.active?JSON.parse(row.payload):null;
    return {revision:row?.revision??0,duration:source.duration,defaultBatch:defaultBatch(source),assignedNumbers,nextNumbers,sample:payload?{...payload,sampleNumber:assignedNumbers[payload.category],sourceSha256:row.source_sha256,purpose:'pilot',featureStatus:'pending',trainingReady:false,updatedAt:row.updated_at}:null};
  }
  function numbering(userId){
    const nextNumbers={};for(const [category,prefix] of Object.entries(prefixes)){const counter=db.prepare('SELECT last_number FROM sample_number_counters WHERE user_id=? AND category=?').get(userId,category);nextNumbers[category]=`${prefix}.${(counter?.last_number??0)+1}`;}return nextNumbers;
  }
  function validate(body,duration){
    const keys=['revision','category','detail','batch','performer','complete','startSeconds','endSeconds','reviewed'];
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!keys.includes(k))||!Number.isSafeInteger(body.revision)||body.revision<0)throw fail(400,'样本登记格式不正确。');
    if(!Object.hasOwn(prefixes,body.category)||body.reviewed!==true||typeof body.complete!=='boolean')throw fail(400,'请回看原片并确认样本类别与完整性。');
    for(const [key,max] of [['detail',100],['performer',40]])if(typeof body[key]!=='string'||!body[key].trim()||body[key].trim().length>max)throw fail(400,'请填写动作名称／实际内容及使用者代号，且不超过字数限制。');
    if(body.batch!==undefined&&(typeof body.batch!=='string'||body.batch.trim().length>40))throw fail(400,'采集批次格式不正确，不能超过40字。');
    const target=targets.find(a=>a.category===body.category);
    if(target&&!body.complete)throw fail(400,`不完整的${target.text}不能登记为完整目标动作，请选择其他动作或不确定。`);
    if(!Number.isFinite(duration)||duration<=0||!Number.isFinite(body.startSeconds)||!Number.isFinite(body.endSeconds)||body.startSeconds<0||body.endSeconds<=body.startSeconds||body.endSeconds>duration)throw fail(400,'请填写录像时长范围内的有效起止秒数。');
    return {category:body.category,detail:body.detail.trim(),batch:body.batch?.trim()||null,performer:body.performer.trim(),complete:body.complete,startSeconds:body.startSeconds,endSeconds:body.endSeconds,reviewed:true,excluded:body.category==='uncertain',labelSource:'user_review'};
  }
  function commit(userId,id,revision,payload,hash){
    db.exec('SAVEPOINT sample_registration');
    try{
      const source=record(userId,id),current=get(userId,id);
      if(current.revision!==revision)throw fail(409,'样本已在其他位置更新，请重新载入后再修改。');
      if(payload&&current.sample&&current.sample.sourceSha256!==hash)throw fail(409,'源录像已变化，请撤回登记并重新核对。');
      if(payload){
        const batch=payload.batch||current.sample?.batch||defaultBatch(source);
        const batchOrigin=payload.batch&&payload.batch!==current.sample?.batch?'manual':current.sample?.batchOrigin||(current.sample?'legacy_manual':'record_date_coarse');
        payload={...payload,batch,batchOrigin};
        allocate(userId,id,payload.category);
      }
      db.prepare(`INSERT INTO sign_samples(record_id,user_id,active,payload,source_sha256,revision,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(record_id) DO UPDATE SET active=excluded.active,payload=excluded.payload,source_sha256=excluded.source_sha256,revision=excluded.revision,updated_at=excluded.updated_at`).run(id,userId,payload?1:0,payload?JSON.stringify(payload):null,hash,revision+1,Date.now());
      db.exec('RELEASE sample_registration');
    }catch(error){db.exec('ROLLBACK TO sample_registration; RELEASE sample_registration');throw error;}
    return get(userId,id);
  }
  function withdraw(userId,id,body){
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Number.isSafeInteger(body.revision)||body.revision<0)throw fail(400,'请提供当前登记版本。');
    return commit(userId,id,body.revision,null,null);
  }
  return {record,get,validate,commit,withdraw,numbering};
}
