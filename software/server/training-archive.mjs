// Explicit local maintenance only. Never invoked by saving or recognising a video.
import {DatabaseSync} from './database.mjs';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync,statSync,lstatSync,realpathSync,renameSync,unlinkSync} from 'node:fs';
import {resolve,relative,sep,extname,basename} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function directoryIn(root,path){
  const target=inside(root,path);let current=root;
  for(const part of relative(root,target).split(sep)){
    current=resolve(current,part);
    if(existsSync(current)){if(lstatSync(current).isSymbolicLink()||!realpathSync(current).startsWith(root+sep))throw Error('linked_directory_rejected');}
    else mkdirSync(current);
  }
  return target;
}
function inside(root,path){const full=resolve(root,path);if(full===root||!full.startsWith(root+sep))throw Error('path_outside_data_root');return full;}
function fileIn(root,path){const full=inside(root,path);if(lstatSync(full).isSymbolicLink()||!realpathSync(full).startsWith(realpathSync(root)+sep))throw Error('linked_path_rejected');return full;}
function rows(db){return db.prepare(`SELECT r.id,r.user_id,r.media_file,r.byte_length,r.created_at,s.active,s.payload,s.revision,s.source_sha256,n.sequence FROM records r LEFT JOIN sign_samples s ON s.record_id=r.id LEFT JOIN sample_numbers n ON n.record_id=s.record_id AND n.category=json_extract(s.payload,'$.category') WHERE r.kind='video' ORDER BY r.id`).all();}
function motionReferences(root){
  const directory=resolve(root,'sign-motions'),ids=new Set();
  if(existsSync(directory))for(const entry of readdirSync(directory)){
    if(!entry.endsWith('.json'))continue;ids.add(basename(entry,'.json'));
    const value=JSON.parse(readFileSync(fileIn(root,'sign-motions/'+entry),'utf8'));if(value.source?.recordId)ids.add(value.source.recordId);
  }
  return [...ids].sort();
}
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function prepareTrainingArchive(root,{includeOtherOwners=false,developmentSamples=[]}={}){
  root=realpathSync(resolve(root));const media=realpathSync(resolve(root,'media'));if(!media.startsWith(root+sep))throw Error('external_media_root');const db=new DatabaseSync(resolve(root,'app.sqlite'),{readOnly:true});
  try{
    const records=rows(db),owner=db.prepare('SELECT user_id FROM sign_samples WHERE active=1 ORDER BY updated_at DESC LIMIT 1').get()?.user_id;
    if(!owner)throw Error('no_training_owner');
    const refs=motionReferences(root),known=new Set(developmentSamples),prefix=JSON.parse(readFileSync(new URL('../shared/sample-numbering.json',import.meta.url),'utf8'));
    const entries=records.map(record=>{
      if(!/^[a-f0-9-]{36}$/.test(record.id))throw Error('invalid_record_id');
      const source=fileIn(media,record.media_file),bytes=statSync(source).size,hash=sha(source);
      if(bytes!==record.byte_length)throw Error('source_size_changed');
      if(record.active){
        const payload=JSON.parse(record.payload),category=payload.category;
        if(!prefix[category]||!record.sequence||hash!==record.source_sha256)throw Error('invalid_registered_source');
        const sampleNumber=`${prefix[category]}.${record.sequence}`;
        const seen=record.user_id===owner&&known.has(sampleNumber)&&category!=='uncertain';
        const split=seen?'train':'pending';
        const target=`training/${split}/${category}/${record.id}${extname(record.media_file)}`;
        inside(media,target);
        return {action:record.media_file.replaceAll('\\','/')===target?'keep_training':'move_training',record,bytes,hash,target,category,sampleNumber,split,usage:seen?'development_seen':'unassigned_needs_quality_and_group_review'};
      }
      return {action:refs.includes(record.id)?'keep_motion_reference':record.user_id===owner||includeOtherOwners?'delete_unused':'keep_other_owner',record,bytes,hash};
    });
    return {schemaVersion:1,id:randomUUID(),createdAt:new Date().toISOString(),root,recordsDigest:digest(records),references:refs,includeOtherOwners,entries,summary:{training:entries.filter(e=>e.record.active).length,deleteVideos:entries.filter(e=>e.action==='delete_unused').length,deleteBytes:entries.filter(e=>e.action==='delete_unused').reduce((n,e)=>n+e.bytes,0),referenceVideos:entries.filter(e=>e.action==='keep_motion_reference').length,test:0}};
  }finally{db.close();}
}
export function applyTrainingArchive(plan){
  const root=realpathSync(resolve(plan.root)),media=realpathSync(resolve(root,'media'));
  if(!media.startsWith(root+sep))throw Error('external_media_root');
  if(root!==plan.root||!/^[a-f0-9-]{36}$/.test(plan.id))throw Error('invalid_plan');
  const db=new DatabaseSync(resolve(root,'app.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const journalPath=inside(root,`maintenance/training-archive-${plan.id}.json`),staging=inside(root,`maintenance/training-archive-${plan.id}-staging`);
  if(existsSync(journalPath))throw Error('plan_already_attempted_inspect_journal');
  const moves=[];let committed=false;const journal={id:plan.id,createdAt:plan.createdAt,summary:plan.summary,status:'prepared',moves,deleted:[]};
  directoryIn(root,'maintenance');
  db.exec('BEGIN IMMEDIATE');
  try{
    if(digest(rows(db))!==plan.recordsDigest||digest(motionReferences(root))!==digest(plan.references))throw Error('records_changed_prepare_again');
    for(const entry of plan.entries){const source=fileIn(media,entry.record.media_file);if(statSync(source).size!==entry.bytes||sha(source)!==entry.hash)throw Error('source_changed');}
    writeFileSync(journalPath,JSON.stringify(journal,null,2),{flag:'wx'});
    for(const entry of plan.entries){
      if(!['move_training','delete_unused'].includes(entry.action))continue;
      const source=fileIn(media,entry.record.media_file);
      const target=entry.action==='move_training'?inside(media,entry.target):inside(root,`maintenance/training-archive-${plan.id}-staging/${entry.record.id}${extname(entry.record.media_file)}`);
      if(existsSync(target))throw Error('destination_exists');
      directoryIn(root,relative(root,resolve(target,'..')));
      // Record intent before rename, enabling recovery after a process crash.
      const item={source:relative(root,source),target:relative(root,target),hash:entry.hash,action:entry.action,done:false};moves.push(item);writeFileSync(journalPath,JSON.stringify(journal,null,2));
      renameSync(source,target);item.done=true;writeFileSync(journalPath,JSON.stringify(journal,null,2));
      if(entry.action==='move_training')db.prepare('UPDATE records SET media_file=? WHERE id=? AND user_id=?').run(entry.target,entry.record.id,entry.record.user_id);
      else db.prepare('DELETE FROM records WHERE id=? AND user_id=?').run(entry.record.id,entry.record.user_id);
    }
    db.exec('COMMIT');committed=true;journal.status='database_committed';writeFileSync(journalPath,JSON.stringify(journal,null,2));
    const training=directoryIn(media,'training');for(const split of ['train','test','pending'])directoryIn(training,split);
    const samples=plan.entries.filter(e=>e.record.active).map(e=>({recordId:e.record.id,ownerId:e.record.user_id,createdAt:e.record.created_at,sampleNumber:e.sampleNumber,category:e.category,split:e.split,usage:e.usage,sourceSha256:e.hash,revision:e.record.revision,bytes:e.bytes,path:relative(training,resolve(media,e.target)).replaceAll('\\','/'),label:JSON.parse(e.record.payload)}));
    const manifest={schemaVersion:1,createdAt:new Date().toISOString(),splitPolicy:'previously_debugged_samples_are_train_development_never_new_test',testIndependent:true,testSamples:0,samples};
    writeFileSync(resolve(training,'manifest.json'),JSON.stringify(manifest,null,2));
    for(const split of ['train','test','pending'])writeFileSync(resolve(training,split,'index.json'),JSON.stringify({split,samples:samples.filter(x=>x.split===split),note:split==='test'?'Empty until genuinely unseen capture groups are explicitly assigned.':'Source videos are not duplicated; database paths point here.'},null,2));
    for(const item of moves.filter(m=>m.action==='delete_unused')){
      const target=fileIn(root,item.target);if(!target.startsWith(staging+sep)||sha(target)!==item.hash)throw Error('staged_source_changed');
      unlinkSync(target);journal.deleted.push(item.target);writeFileSync(journalPath,JSON.stringify(journal,null,2));
    }
    for(const sample of samples)if(sha(fileIn(media,'training/'+sample.path))!==sample.sourceSha256)throw Error('archive_verification_failed');
    journal.status='complete';writeFileSync(journalPath,JSON.stringify(journal,null,2));return {summary:plan.summary,manifest:resolve(training,'manifest.json'),journal:journalPath};
  }catch(error){
    if(!committed){
      db.exec('ROLLBACK');for(const item of moves.toReversed())if(item.done){const from=fileIn(root,item.target),to=inside(root,item.source);if(existsSync(to))throw Error('rollback_destination_exists');renameSync(from,to);}
      journal.status='rolled_back';if(existsSync(journalPath))writeFileSync(journalPath,JSON.stringify(journal,null,2));
    }
    throw error;
  }finally{db.close();}
}

export function removeArchivedRecord(root,recordId){
  root=realpathSync(resolve(root));const manifestPath=resolve(root,'media/training/manifest.json');
  if(!existsSync(manifestPath))return;
  fileIn(root,'media/training/manifest.json');const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(!manifest.samples.some(sample=>sample.recordId===recordId))return;
  manifest.samples=manifest.samples.filter(sample=>sample.recordId!==recordId);manifest.testSamples=manifest.samples.filter(sample=>sample.split==='test').length;
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
  for(const split of ['train','test','pending']){
    const path=fileIn(root,`media/training/${split}/index.json`);const index=JSON.parse(readFileSync(path,'utf8'));
    index.samples=index.samples.filter(sample=>sample.recordId!==recordId);writeFileSync(path,JSON.stringify(index,null,2));
  }
}
