import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateGesture} from './import-dictionary-content.mjs';
const root=resolve(import.meta.dirname,'..');
const sha=value=>createHash('sha256').update(value).digest('hex');

export function mergeFullDictionary(dictionary,terms){
 const next=structuredClone(dictionary),byId=new Map(next.entries.map(e=>[e.id,e])),seen=new Set(),conflicts=[];let added=0,updated=0;
 for(const term of terms){
  if(!/^bmcx\.\d+$/.test(term.sourceId)||seen.has(term.sourceId)||typeof term.term!=='string'||!term.term.trim()||typeof term.description!=='string'||term.description.length>3000||!Array.isArray(term.gestureImages)||(!term.gestureImages.length&&term.imageStatus!=='missing_at_source'&&term.imagePending!==true))throw Error('Invalid full-crawl term');
  seen.add(term.sourceId);term.gestureImages.forEach(validateGesture);
  const url=new URL(term.canonicalUrl),listing=new URL(term.sourceListingUrl);
  if(url.origin!=='https://shouyu.bmcx.com'||url.pathname!==`/${term.sourceId.slice(5)}__shouyud/`||url.search||url.hash||listing.origin!==url.origin||!/^\/[^/]+_\d+__shouyul\/$/.test(listing.pathname))throw Error('Untrusted source URL');
  const id='csl.ref.'+term.sourceId;let entry=byId.get(id);
  if(entry&&(!entry.referenceOnly&&!entry.referenceMaterial||entry.text!==term.term||entry.descriptionSourceHash&&entry.descriptionSourceHash!==sha(entry.description))){conflicts.push(id);continue;}
  if(!entry){entry={id,text:term.term,description:'',components:[]};next.entries.push(entry);byId.set(id,entry);added++;}
  const before=JSON.stringify(entry);
  Object.assign(entry,{description:term.description,source:'便民查询网 · 原站动作解释与手势图',review:'not_reviewed',referenceOnly:false,referenceMaterial:true,sourceMissingImage:term.imageStatus==='missing_at_source',sourceImagePending:term.imagePending===true,sourceMissingDescription:!term.description,descriptionOrigin:term.description?'source_verbatim':'source_missing',descriptionSourceHash:sha(term.description),sourceId:term.sourceId,sourceUrl:term.canonicalUrl,sourceListingUrl:term.sourceListingUrl,sourcePageSha256:term.sourceListingSha256,sourceRetrievedAt:term.retrievedAt,category:term.category,gestureImages:term.gestureImages,rightsStatus:'reuse_unconfirmed',referenceLinks:[{label:'原站词条：'+term.term,url:term.canonicalUrl},{label:'采集所在分类页',url:term.sourceListingUrl}],note:(!term.description?'原站未提供动作解释，待补充。':'')+(term.imageStatus==='missing_at_source'?'原站暂无手势图，未使用占位图冒充动作图。':term.imagePending?'配图正在采集，请稍后刷新。':'')+'图文参考 · 内容待专业核对。图片不代表本词已有动画或识别能力。'});
  if(JSON.stringify(entry)!==before)updated++;
 }
 if(added||updated){next.updated='2026-10-19';next.scope='按词查看手势图、动作解释与来源；可点击图片放大。图文资料均待专业核对，图片不等于动画，收录词条不等于模型能够识别。';}
 return {dictionary:next,added,updated,conflicts};
}

if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.filename)){
 const policy=JSON.parse(await readFile(resolve(root,'shared/dictionary-acquisition.json'),'utf8'));
 if(!policy.downloadImages)throw Error('Image publication disabled by user; do not restore downloaded-image references.');
 const input=JSON.parse(await readFile(resolve(root,'.runtime-logs/dictionary-full/publish-input.json'),'utf8'));
 if(input.schemaVersion!==1||!Array.isArray(input.terms))throw Error('Invalid publication input');
 const path=resolve(root,'shared/sign-dictionary.json'),original=await readFile(path,'utf8');
 const checked=new Set();for(const term of input.terms)for(const image of term.gestureImages){validateGesture(image);if(!checked.has(image.path)){if(sha(await readFile(resolve(root,'web/public',image.path.slice(1))))!==image.sha256)throw Error('Image hash mismatch');checked.add(image.path);}}
 const result=mergeFullDictionary(JSON.parse(original),input.terms);
 if(result.added||result.updated){
  if(await readFile(path,'utf8')!==original)throw Error('Dictionary changed during publication; retry without overwriting');
  await writeFile(path+'.full.tmp',JSON.stringify(result.dictionary,null,2)+'\n');await rename(path+'.full.tmp',path);
 }
 await writeFile(resolve(root,'shared/sign-dictionary-full-source.json'),JSON.stringify({schemaVersion:1,mode:'full_listing_reference',terms:input.terms},null,2)+'\n');
 execFileSync(process.execPath,[resolve(root,'scripts/render-sign-dictionary.mjs')],{cwd:root,windowsHide:true,stdio:'pipe',timeout:90000});
 console.log(JSON.stringify({at:new Date().toISOString(),added:result.added,updated:result.updated,total:result.dictionary.entries.length,illustrated:result.dictionary.entries.filter(e=>e.gestureImages?.length).length,sourceTerms:input.terms.length,conflicts:result.conflicts}));
}
