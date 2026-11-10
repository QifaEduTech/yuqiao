import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
export function mergeSourceIndex(dictionary,index){
 if(index.schemaVersion!==1||index.mode!=='metadata_only'||!Array.isArray(index.entries))throw Error('Unsupported source index');
 const next=structuredClone(dictionary);const ids=new Set(next.entries.map(e=>e.id));const collisions=[];let added=0;
 const seen=new Set();
 for(const item of index.entries){
  if(!/^bmcx\.\d+$/.test(item.sourceId)||seen.has(item.sourceId))throw Error('Duplicate/invalid source ID');seen.add(item.sourceId);
  const url=new URL(item.canonicalUrl);
  if(url.origin!=='https://shouyu.bmcx.com'||url.pathname!==`/${item.sourceId.split('.')[1]}__shouyud/`||url.search||url.hash||typeof item.term!=='string'||!item.term.trim()||item.term.length>30||item.rightsStatus!=='reuse_unconfirmed'||item.contentMode!=='metadata_only'||item.descriptionImported!==false||item.mediaDownloaded!==false)throw Error('Invalid metadata-only entry');
  const id=`csl.ref.${item.sourceId}`;
  if(ids.has(id))continue;
  if(next.entries.some(e=>e.text===item.term&&!e.referenceOnly)){collisions.push({sourceId:item.sourceId,word:item.term,reason:'existing_project_word_kept'});continue;}
  next.entries.push({id,text:item.term,description:'',components:[],source:'便民查询网 · 仅登记词名与来源',review:'not_reviewed',note:'来源索引已核对；动作说明与参考图的复用许可尚未确认，暂不复制。尚无此词数字人动画或识别能力。',referenceOnly:true,category:item.category,sourceId:item.sourceId,sourceUrl:item.canonicalUrl,sourceRetrievedAt:item.retrievedAt,rightsStatus:item.rightsStatus,referenceLinks:[{label:`原站词条：${item.term}`,url:item.canonicalUrl}]});
  ids.add(id);added++;
 }
 if(added){next.updated='2026-10-19';next.scope='包含项目已登记的动作说明，以及外部词典的来源索引。新增来源索引仅供查阅，动作内容待核对；数字人动画与识别范围分别维护。';}
 return {dictionary:next,added,collisions};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const target=resolve(root,'shared/sign-dictionary.json');const dictionary=JSON.parse(await readFile(target,'utf8'));const index=JSON.parse(await readFile(resolve(root,'shared/sign-dictionary-sources.json'),'utf8'));
 const result=mergeSourceIndex(dictionary,index);
 if(result.added){await writeFile(target+'.tmp',JSON.stringify(result.dictionary,null,2)+'\n');await rename(target+'.tmp',target);}
 console.log(JSON.stringify({added:result.added,total:result.dictionary.entries.length,collisions:result.collisions}));
}
