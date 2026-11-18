import {createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const allowed=(p,labels)=>p?.reviewed===true&&p.complete===true&&!p.excluded&&['background','other'].includes(p.category)&&!labels.some(l=>l.text===p.detail?.trim());
export function backgroundOwnerState(store,owner){
 const file=resolve(store.data,'training-workbench',createHash('sha256').update(owner).digest('hex'),'state.json');
 return existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{actions:[],archivedActions:[],seenTraining:[],seenTests:[]};
}
const grants=store=>{const file=resolve(store.data,'shared-training-backgrounds.json');if(!existsSync(file))return null;const v=JSON.parse(readFileSync(file,'utf8'));if(v.schemaVersion!==1||v.consumerScope!=='local_project_training_only'||!Array.isArray(v.entries))throw Error('共享背景授权清单格式无效。');return v;};
const sameSource=(a,b)=>a.recordId===b.recordId&&a.sourceHash===b.sourceHash&&a.start===b.start&&a.end===b.end&&a.legacyRevision===b.legacyRevision&&a.reuseOrigin===b.reuseOrigin&&a.registrationDigest===b.registrationDigest&&a.reuseActionId===b.reuseActionId&&a.reuseActionRevision===b.reuseActionRevision;

/** Same-owner, explicitly labelled development negatives only. Never infer a
 * negative label from a filename, a model result, or missing annotations. */
export function collectReusableBackgrounds(store,owner,state,labels,{includeShared=true}={}){
 const all=[...state.actions,...(state.archivedActions??[])],samples=all.flatMap(a=>a.samples);
 const protectedHashes=new Set(samples.filter(s=>s.split==='test'||s.label===1).map(s=>s.sourceHash));
 const protectedRecords=new Set(samples.filter(s=>s.split==='test'||s.label===1).map(s=>s.recordId));
 for(const h of state.excludedBackgroundHashes??[])protectedHashes.add(h);
 for(const action of state.archivedActions??[])if(!action.includeInJointTraining)for(const s of action.samples){protectedHashes.add(s.sourceHash);protectedRecords.add(s.recordId);}
 const byHash=new Map(),skipped={protected:0,unqualified:0,invalid:0,duplicate:0};
 const add=sample=>{if(protectedHashes.has(sample.sourceHash)||protectedRecords.has(sample.recordId)){skipped.protected++;return;}if(byHash.has(sample.sourceHash)){skipped.duplicate++;return;}byHash.set(sample.sourceHash,sample);};
 const rows=store.db.prepare('SELECT record_id,payload,source_sha256,revision FROM sign_samples WHERE user_id=? AND active=1').all(owner);
 for(const row of rows){
  let p;try{p=JSON.parse(row.payload);}catch{skipped.invalid++;continue;}
  if(!allowed(p,labels)){skipped.unqualified++;continue;}
  if(protectedRecords.has(row.record_id)||protectedHashes.has(row.source_sha256)){skipped.protected++;continue;}
  try{
   const source=store.source(owner,row.record_id);
   if(source.sha256!==row.source_sha256||!Number.isFinite(p.startSeconds)||!Number.isFinite(p.endSeconds)||p.startSeconds<0||p.endSeconds-p.startSeconds<.5||p.endSeconds>source.duration+.02)throw Error('changed');
   const real=/^capture:\d{8}:\d{6}:[a-f0-9]{6}$/.test(p.batch??'');
   add({recordId:row.record_id,sourceHash:source.sha256,path:source.path,start:p.startSeconds,end:p.endSeconds,label:0,split:'train',originalSplit:'legacy_development',group:real?p.batch:'legacy-source-'+source.sha256,realGroupConfirmed:real,groupSource:real?'user_confirmed':'legacy_unverified',legacyRevision:row.revision,reuseOrigin:'legacy_background',registrationDigest:digest(p)});
  }catch{skipped.invalid++;}
 }
 const eligibleActions=[...state.actions,...(state.archivedActions??[]).filter(a=>a.includeInJointTraining)];
 for(const action of eligibleActions)for(const sample of action.samples){
  if(sample.label!==0||!['train','validation'].includes(sample.split))continue;
  if(protectedRecords.has(sample.recordId)||protectedHashes.has(sample.sourceHash)){skipped.protected++;continue;}
  try{
   const source=store.source(owner,sample.recordId),registration=store.db.prepare('SELECT active,payload,revision FROM sign_samples WHERE record_id=? AND user_id=?').get(sample.recordId,owner);
   if(source.sha256!==sample.sourceHash||(registration?.revision??0)!==(sample.legacyRevision??0)||sample.start<0||sample.end-sample.start<.5||sample.end>source.duration+.02)throw Error('changed');
   // A relative negative must not override a registered known/uncertain action.
   if(registration?.active&&!allowed(JSON.parse(registration.payload),labels)){skipped.unqualified++;continue;}
   add({...sample,path:source.path,label:0,split:'train',originalSplit:sample.split,reuseOrigin:'workbench_negative',reuseActionId:action.id,reuseActionRevision:action.revision,legacyRevision:registration?.revision??0});
  }catch{skipped.invalid++;}
 }
 if(includeShared){
  const grant=grants(store);
  if(grant){
   for(const sourceOwner of new Set(grant.entries.map(e=>e.sourceOwnerId))){
    if(sourceOwner===owner)continue;
    if(typeof sourceOwner!=='string'||!sourceOwner){skipped.invalid++;continue;}
    const sourceState=backgroundOwnerState(store,sourceOwner);
    const verified=collectReusableBackgrounds(store,sourceOwner,sourceState,labels,{includeShared:false}).samples;
    for(const entry of grant.entries.filter(e=>e.sourceOwnerId===sourceOwner)){
     const source=verified.find(s=>sameSource(s,entry));
     if(!source){skipped.invalid++;continue;}
     add({...source,sourceOwnerId:sourceOwner,sharedBackground:true,sharedGrantId:grant.id});
    }
   }
  }
 }
 return {samples:[...byHash.values()],summary:{reused:byHash.size,legacy:[...byHash.values()].filter(s=>s.reuseOrigin==='legacy_background').length,workbench:[...byHash.values()].filter(s=>s.reuseOrigin==='workbench_negative').length,shared:[...byHash.values()].filter(s=>s.sharedBackground).length,skipped,scope:'same_account_and_explicit_shared_grants_training_only'}};
}

export function validateReusableBackgrounds(store,owner,state,samples,labels=[]){
 const verifiedShared=new Map();
 for(const sample of samples.filter(s=>s.reuseOrigin)){
  const sourceOwner=sample.sharedBackground?sample.sourceOwnerId:owner;
  let sourceState=state;
  if(sample.sharedBackground){const grant=grants(store);if(!grant||sample.sharedGrantId!==grant.id||!grant.entries.some(e=>e.sourceOwnerId===sourceOwner&&sameSource(e,sample)))throw Error('共享背景授权已改变，未发布本轮模型。');sourceState=backgroundOwnerState(store,sourceOwner);if(!verifiedShared.has(sourceOwner))verifiedShared.set(sourceOwner,collectReusableBackgrounds(store,sourceOwner,sourceState,labels,{includeShared:false}).samples);if(!verifiedShared.get(sourceOwner).some(s=>sameSource(s,sample)))throw Error('共享背景被移除或改作其他用途，未发布本轮模型。');}
  const source=store.source(sourceOwner,sample.recordId),row=store.db.prepare('SELECT active,payload,revision FROM sign_samples WHERE record_id=? AND user_id=?').get(sample.recordId,sourceOwner);
  if(source.sha256!==sample.sourceHash||(row?.revision??0)!==sample.legacyRevision)throw Error('复用的背景资料已改变，请重新检查后训练。');
  if(sample.reuseOrigin==='legacy_background'&&(!row?.active||digest(JSON.parse(row.payload))!==sample.registrationDigest))throw Error('旧背景登记已改变，未发布本轮模型。');
  if(sample.reuseOrigin==='workbench_negative'){
   const action=[...sourceState.actions,...(sourceState.archivedActions??[]).filter(a=>a.includeInJointTraining)].find(a=>a.id===sample.reuseActionId);
   if(!action||action.revision!==sample.reuseActionRevision||!action.samples.some(s=>s.recordId===sample.recordId&&s.sourceHash===sample.sourceHash&&s.label===0&&s.start===sample.start&&s.end===sample.end))throw Error('反例关联已改变，未发布本轮模型。');
  }
 }
}
