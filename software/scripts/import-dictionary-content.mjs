import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const digest=text=>createHash('sha256').update(text).digest('hex');
export function validateGesture(image){
 if(!image||!/^\/dictionary-images\/[a-z0-9.-]+\.(png|webp|jpg)$/.test(image.path)||!/^[a-f0-9]{64}$/.test(image.sha256)||typeof image.alt!=='string'||!Number.isInteger(image.width)||!Number.isInteger(image.height)||image.width<=0||image.height<=0||image.width*image.height>20000000)throw Error('Invalid gesture image');
 const url=new URL(image.sourceUrl);
 if(url.origin!=='https://d.bmcx.com'||!/^\/shouyu\/_file\/[a-f0-9]\/[a-f0-9]{8,64}\.png$/.test(url.pathname)||url.search||url.hash)throw Error('Invalid gesture source');
}
export function mergeIllustrated(dictionary,content){
 if(content.schemaVersion!==1||content.mode!=='user_requested_illustrated_reference'||!Array.isArray(content.entries))throw Error('Invalid content package');
 const next=structuredClone(dictionary),conflicts=[],seen=new Set();let added=0,updated=0;
 for(const item of content.entries){
  if(!/^csl\.[a-z0-9_.-]+$/.test(item.dictionaryId)||seen.has(item.dictionaryId)||typeof item.term!=='string'||!item.term.trim()||typeof item.description!=='string'||item.description.length<5||item.description.length>1500||item.review!=='not_reviewed'||item.rightsStatus!=='reuse_unconfirmed'||!Array.isArray(item.gestureImages)||!item.gestureImages.length)throw Error('Invalid illustrated reference');
  seen.add(item.dictionaryId);item.gestureImages.forEach(validateGesture);
  let entry=next.entries.find(e=>e.id===item.dictionaryId);
  if(item.descriptionOrigin==='existing_project_definition'){
   if(!entry||entry.text!==item.term||entry.description!==item.description)throw Error('Existing definition mismatch');
   if(JSON.stringify(entry.gestureImages)!==JSON.stringify(item.gestureImages)){entry.gestureImages=item.gestureImages;updated++;}continue;
  }
  if(item.descriptionSha256!==digest(item.description))throw Error('Description hash mismatch');
  if(item.descriptionOrigin==='source_verbatim'){
   if(!entry||entry.sourceId!==item.dictionaryId.slice('csl.ref.'.length)||entry.sourceUrl!==item.sourceUrl||entry.text!==item.term)throw Error('Source identity mismatch');
   if(!entry.referenceOnly&&!entry.referenceMaterial)throw Error('Cannot overwrite a project definition');
   if(entry.referenceMaterial&&entry.descriptionSourceHash&&entry.descriptionSourceHash!==digest(entry.description)){conflicts.push(item.dictionaryId);continue;}
   if(entry.sourceListingUrl&&!item.sourceListingUrl)continue; // Do not downgrade newer full-crawl provenance to the old pilot snapshot.
  }else if(item.descriptionOrigin==='user_provided'){
   if(item.dictionaryId!=='csl.yes'||item.term!=='是')throw Error('Unexpected new user-provided word');
   if(!entry){if(next.entries.some(e=>e.text===item.term))throw Error('Existing same-word entry needs explicit reconciliation');entry={id:item.dictionaryId,text:item.term,description:'',components:[],review:'not_reviewed',source:'用户提供动作解释及手势图',category:'常用表达',referenceUrl:item.sourceUrl};next.entries.push(entry);added++;}
  }else throw Error('Unsupported description provenance');
  const before=JSON.stringify(entry);
  Object.assign(entry,{description:item.description,referenceOnly:false,referenceMaterial:true,descriptionOrigin:item.descriptionOrigin,descriptionSourceHash:item.descriptionSha256,gestureImages:item.gestureImages,rightsStatus:item.rightsStatus,review:'not_reviewed',note:'图文参考 · 内容待专业核对。手势图不能代替完整动态示范；本词尚无数字人动画或识别能力。'});
  if(item.descriptionOrigin==='source_verbatim')entry.source='便民查询网 · 原站动作解释与手势图';
  if(before!==JSON.stringify(entry))updated++;
 }
 if(added||updated){next.updated='2026-10-19';next.scope='按词查看手势图、动作解释与来源；可点击图片放大。图文资料均待专业核对，图片不等于动画，收录词条不等于模型能够识别。';}
 return {dictionary:next,added,updated,conflicts};
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const policy=JSON.parse(await readFile(resolve(root,'shared/dictionary-acquisition.json'),'utf8'));
 if(!policy.downloadImages)throw Error('Local image import disabled by user.');
 const path=resolve(root,'shared/sign-dictionary.json');const dictionary=JSON.parse(await readFile(path,'utf8'));const content=JSON.parse(await readFile(resolve(root,'shared/sign-dictionary-content.json'),'utf8'));
 for(const item of content.entries)for(const image of item.gestureImages){validateGesture(image);const bytes=await readFile(resolve(root,'web/public',image.path.slice(1)));if(digest(bytes)!==image.sha256)throw Error('Image file hash mismatch: '+image.path);}
 const result=mergeIllustrated(dictionary,content);
 if(result.added||result.updated){await writeFile(path+'.tmp',JSON.stringify(result.dictionary,null,2)+'\n');await rename(path+'.tmp',path);}
 console.log(JSON.stringify({added:result.added,updated:result.updated,total:result.dictionary.entries.length,illustrated:result.dictionary.entries.filter(e=>e.gestureImages?.length).length,conflicts:result.conflicts}));
}
