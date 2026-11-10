import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import scene from '../shared/service-window-scene.json' with {type:'json'};
import {upsertMotionRecord} from './motion-record-document.mjs';
const read=p=>JSON.parse(readFileSync(p,'utf8')),save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const dictionary=read('shared/sign-dictionary.json'),catalog=read('shared/sign-motion-catalog.json'),windows=read('shared/sign-motion-windows.json');
const upsert=(list,value)=>{const i=list.findIndex(e=>e.id===value.id);if(i<0)list.push(value);else list[i]=value;};
for(const motion of scene.motions){
 const asset=read(`shared/sign-motions/anny/${motion.id}.json`),entry=dictionary.entries.find(e=>e.id===motion.id);
 if(!entry||entry.text!==motion.label||asset.id!==motion.id||asset.label!==motion.label||asset.duration!==motion.duration||asset.version!=='source-reference-1'||asset.status!=='authored_unverified')throw Error('Window motion registration mismatch');
 entry.referenceMaterial=false;entry.referenceOnly=false;entry.note='已按原站解释与图解制作固定动作试播，未通过专业手语校验；具体手位、幅度、节奏为模型编排参数，不在四词识别范围。';
 entry.motionAuthoring={version:asset.version,sourceReviewedAt:'2026-10-19',record:`docs/动作制作记录.md#motion-${motion.id}`,recognitionExpanded:false};
 if(motion.id==='csl.ref.bmcx.1874'){
  entry.note+=' 第二段补全“要求”手势（一）：一手平伸、掌心向上、从前向后微拉；胸前微点暂编排两次。';
  if(!entry.referenceLinks.some(l=>l.url==='https://shouyu.bmcx.com/1873__shouyud/'))entry.referenceLinks.push({label:'第二段参照：要求（仅手势一）',url:'https://shouyu.bmcx.com/1873__shouyud/'});
 }
 upsert(catalog.entries,{id:motion.id,label:motion.label,reviewRequired:true,asset:`anny/${motion.id}.json`,version:asset.version});
 upsert(windows.entries,{id:motion.id,version:asset.version,activeFrom:motion.activeFrom,activeTo:motion.activeTo,duration:motion.duration});
 const record=`# 固定动作：${motion.label}\n\n- 稳定ID：${motion.id}，沿用原词典条目，不重复建词。\n- 版本：${asset.version}；状态：authored_unverified / not_reviewed；无专业校验人。\n- 原解释：${entry.description}\n- 本次完整编排依据：${asset.authoring.basis}\n- 来源：${motion.source}${motion.id.endsWith('1874')?'；https://shouyu.bmcx.com/1873__shouyud/':''}\n- 表现：${asset.description}\n- 总时长：${motion.duration}秒；连播主体：${motion.activeFrom}–${motion.activeTo}秒。\n- 生成器：web/src/annyDictionaryAuthoring.ts；生成命令：node scripts/build-fixed-motion.mjs ${motion.id}\n- 手位、幅度、节奏和接触间距是Anny编排参数，表情中性；语义与表现需真人核对。\n- 本轮只制作播放素材，不改变四词模型或实时识别；原站配图只按需浏览，不恢复图片列或批量下载。\n- 检查：scripts/verify-window-motions.mjs；技术检查不是标准动作验收。\n`;
 const documentPath='docs/动作制作记录.md';
 writeFileSync(documentPath,upsertMotionRecord(readFileSync(documentPath,'utf8'),motion.id,record));
}
dictionary.updated='2026-10-19';writeFileSync('shared/sign-dictionary.json',JSON.stringify(dictionary)+'\n');save('shared/sign-motion-catalog.json',catalog);save('shared/sign-motion-windows.json',windows);
console.log(JSON.stringify({registered:scene.motions.map(m=>m.label),dictionaryCount:dictionary.entries.length}));
