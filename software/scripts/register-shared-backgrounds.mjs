// Explicit user-authorized registration of the already audited corpus only.
// No media copying, ownership changes, API access grants, or training.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from '../server/database.mjs';
import {TrainingStore} from '../server/training-store.mjs';
import {collectReusableBackgrounds,backgroundOwnerState} from '../server/reusable-backgrounds.mjs';
import {activeEngine} from '../server/recording-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),data=resolve(root,'data'),file=resolve(data,'shared-training-backgrounds.json');
if(existsSync(file))throw Error('Shared grant already exists; review it rather than overwrite.');
const audit=JSON.parse(readFileSync(resolve(data,'maintenance/reusable-backgrounds-2026-11-18.json'),'utf8')),db=new DatabaseSync(resolve(data,'app.sqlite'),{readOnly:true});
try{
 const store={data,db,source:(owner,id)=>TrainingStore.prototype.source.call({data,db},owner,id)},entries=[];
 for(const row of audit.rows){
  const fresh=collectReusableBackgrounds(store,row.owner,backgroundOwnerState(store,row.owner),activeEngine(root).labels,{includeShared:false}).samples;
  for(const prior of row.samples){
   const current=fresh.find(s=>s.recordId===prior.recordId&&s.sourceHash===prior.sourceHash&&s.start===prior.start&&s.end===prior.end&&s.legacyRevision===prior.legacyRevision);
   if(!current)throw Error('Audited source changed; shared grant not created.');
   const {path,...metadata}=current;entries.push({...metadata,sourceOwnerId:row.owner});
  }
 }
 const grant={schemaVersion:1,id:randomUUID(),authorizedOn:'2026-11-18',consumerScope:'local_project_training_only',basis:'User explicitly requested reuse of this existing background/negative corpus after reporting the account-scope blocker.',entries};
 writeFileSync(file,JSON.stringify(grant,null,2),{flag:'wx'});console.log(JSON.stringify({sharedGrantCreated:true,sources:entries.length,mediaOwnershipChanged:false,mediaAccessUnchanged:true}));
}finally{db.close();}
