import {randomUUID} from 'node:crypto';

const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createPracticeStore(db,{signCatalog,motionCatalog,dictionaryVersion,dictionaryHash,snapshotForResult,additionalEntriesForUser=()=>[]}){
  // Additive migration: existing records and private media are never rewritten.
  db.exec(`CREATE TABLE IF NOT EXISTS practice_attempts (
    id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN ('candidate','uncertain','unsupported','no_hands')),
    candidate_id TEXT, candidate_text TEXT, snapshot TEXT NOT NULL,
    feedback TEXT CHECK(feedback IN ('agree','disagree','uncertain')),
    correction TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS practice_record_time ON practice_attempts(record_id,created_at DESC);`);
  const serialize=row=>({id:row.id,recordId:row.record_id,status:row.status,candidateId:row.candidate_id,candidate:row.candidate_text,snapshot:JSON.parse(row.snapshot),feedback:row.feedback,correction:row.correction,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at});
  function record(userId,recordId){
    const row=db.prepare("SELECT * FROM records WHERE id=? AND user_id=? AND kind='video'").get(recordId,userId);
    if(!row)throw fail(404,'录像不存在、已删除或不属于当前账号。');return row;
  }
  function get(userId,recordId,id){
    record(userId,recordId);
    const row=db.prepare('SELECT * FROM practice_attempts WHERE id=? AND record_id=? AND user_id=?').get(id,recordId,userId);
    if(!row)throw fail(404,'练习记录不存在或已删除。');return serialize(row);
  }
  function create(userId,recordId,result){
    record(userId,recordId);
    const entry=result.status==='candidate'?[...signCatalog.entries,...additionalEntriesForUser(userId)].find(e=>e.text===result.candidate):null;
    if(!['candidate','uncertain','unsupported','no_hands'].includes(result.status)||result.status==='candidate'&&!entry)throw fail(502,'识别结果格式异常，未保存练习结果。');
    const id=randomUUID(),now=Date.now(),model=signCatalog.recognitionModel;
    const identity=snapshotForResult?snapshotForResult(result):{modelId:model.id,modelVersion:model.version,modelSha256:model.sha256,featureId:model.features.id};
    const snapshot={...identity,dictionaryVersion,dictionaryHash,motionVersion:entry?motionCatalog.entries.find(e=>e.id===entry.id)?.version??null:null};
    db.prepare('INSERT INTO practice_attempts (id,record_id,user_id,status,candidate_id,candidate_text,snapshot,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)').run(id,recordId,userId,result.status,entry?.id??null,entry?.text??null,JSON.stringify(snapshot),now,now);
    return get(userId,recordId,id);
  }
  function list(userId,recordId){
    record(userId,recordId);
    const attempts=db.prepare('SELECT * FROM practice_attempts WHERE record_id=? AND user_id=? ORDER BY created_at DESC,id DESC LIMIT 50').all(recordId,userId).map(serialize);
    const total=db.prepare('SELECT COUNT(*) AS count FROM practice_attempts WHERE record_id=? AND user_id=?').get(recordId,userId).count;
    return {attempts,total};
  }
  function feedback(userId,recordId,id,body){
    const original=get(userId,recordId,id);
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['feedback','correction','revision'].includes(k)))throw fail(400,'反馈只能包含选择、纠正词和版本，不能修改原识别结果。');
    if(![null,'agree','disagree','uncertain'].includes(body.feedback)||typeof body.correction!=='string'||body.correction.trim().length>100||!Number.isInteger(body.revision)||body.revision<0)throw fail(400,'反馈格式不正确，纠正词不能超过100字。');
    const correction=body.correction.trim();
    if(body.feedback==='agree'&&!original.candidate)throw fail(400,'本次没有候选词，不能标记为一致。');
    if(body.feedback==='disagree'&&!correction)throw fail(400,'请填写你原本想表达的词。');
    if(body.feedback!=='disagree'&&correction)throw fail(400,'仅“不一致”反馈可填写纠正词。');
    const changed=db.prepare('UPDATE practice_attempts SET feedback=?,correction=?,revision=revision+1,updated_at=? WHERE id=? AND record_id=? AND user_id=? AND revision=?').run(body.feedback,correction,Date.now(),id,recordId,userId,body.revision);
    if(!changed.changes)throw fail(409,'这条反馈已在其他位置更新，请重新载入后再修改。');
    return get(userId,recordId,id);
  }
  return {record,get,create,list,feedback};
}
