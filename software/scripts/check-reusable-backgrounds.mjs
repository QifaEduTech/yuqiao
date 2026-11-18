import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from '../server/database.mjs';
import {TrainingStore} from '../server/training-store.mjs';
import {collectReusableBackgrounds} from '../server/reusable-backgrounds.mjs';
import {activeEngine} from '../server/recording-catalog.mjs';
// URL decoding is required for the Chinese workspace path.
const {fileURLToPath}=await import('node:url');const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const data=resolve(projectRoot,'data'),db=new DatabaseSync(resolve(data,'app.sqlite'),{readOnly:true});
try{
 const owners=db.prepare('SELECT DISTINCT user_id FROM sign_samples WHERE active=1').all(),rows=[];
 for(const {user_id:owner} of owners){
  const statePath=resolve(data,'training-workbench',createHash('sha256').update(owner).digest('hex'),'state.json');
  const state=existsSync(statePath)?JSON.parse(readFileSync(statePath,'utf8')):{actions:[],archivedActions:[],seenTests:[],seenTraining:[]};
  const store={data,db,source:(account,id)=>TrainingStore.prototype.source.call({data,db},account,id)};
  const result=collectReusableBackgrounds(store,owner,state,activeEngine(projectRoot).labels);
  rows.push({owner,summary:result.summary,samples:result.samples});
 }
 const summary={accounts:rows.length,reused:rows.reduce((n,r)=>n+r.summary.reused,0),legacy:rows.reduce((n,r)=>n+r.summary.legacy,0),workbench:rows.reduce((n,r)=>n+r.summary.workbench,0),scope:'account-separated; source files and labels unchanged'};
 mkdirSync(resolve(data,'maintenance'),{recursive:true});writeFileSync(resolve(data,'maintenance/reusable-backgrounds-2026-11-18.json'),JSON.stringify({date:'2026-11-18',summary,rows},null,2));
 console.log(JSON.stringify(summary));
}finally{db.close();}
