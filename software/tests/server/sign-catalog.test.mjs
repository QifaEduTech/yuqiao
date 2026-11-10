import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {signCatalog,validateCatalog,resolveSignText} from '../../shared/sign-catalog.mjs';

test('四词稳定编号与真实模型标签对应，拒绝错位和伪造动作就绪',async()=>{
 const labels=(await readFile('models/sign-word-baseline/dynamic_gesture_label.csv','utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 assert.deepEqual(signCatalog.recognitionModel.labels,labels);
 assert.deepEqual(signCatalog.entries.map(e=>e.recognitionIndex),[0,1,2,4]);
 const bad=structuredClone(signCatalog);bad.entries[3].recognitionIndex=3;
 assert.throws(()=>validateCatalog(bad),/mapping mismatch/);
 const unsupported=structuredClone(signCatalog);unsupported.recognitionModel.features.dimensions=99;
 assert.throws(()=>validateCatalog(unsupported),/adapter/);
 const fake=structuredClone(signCatalog);fake.entries[0].playback.status='ready';
 assert.throws(()=>validateCatalog(fake),/validation required/);
});

test('文字严格匹配四词，未知内容不取部分词冒充整句，缺素材明确返回',()=>{
 assert.equal(resolveSignText(' 你好！ ').entry.id,'csl.hello');
 assert.equal(resolveSignText('谢谢').entry.id,'csl.thanks');
 assert.equal(resolveSignText('你好').status,'asset_missing');
 assert.equal(resolveSignText('没关系').status,'unsupported');
 assert.equal(resolveSignText('你好，请帮忙').status,'unsupported');
});

test('自拟动作可以存在，但必须保持"未校验"，且绝不能变成已就绪',()=>{
 const thanks=()=>signCatalog.entries.find(entry=>entry.id==='csl.thanks').playback;
 assert.equal(thanks().status,'authored_unverified');
 assert.equal(thanks().review,'not_reviewed');
 assert.equal(thanks().verifiedBy,null);
 // 未校验的素材，解析结果不能是 ready——调用方不得据此自动播放
 assert.equal(resolveSignText('谢谢').status,'asset_unverified');

 // 谎称已校验：拒绝
 const reviewed=structuredClone(signCatalog);
 reviewed.entries.find(entry=>entry.id==='csl.thanks').playback.review='reviewed';
 assert.throws(()=>validateCatalog(reviewed),/stay marked unverified/);

 // 写上校验人：拒绝
 const signed=structuredClone(signCatalog);
 signed.entries.find(entry=>entry.id==='csl.thanks').playback.verifiedBy='某专家';
 assert.throws(()=>validateCatalog(signed),/stay marked unverified/);

 // 直接跳成 ready：仍然拒绝，只有真正的校验流程才能解锁
 const ready=structuredClone(signCatalog);
 ready.entries.find(entry=>entry.id==='csl.thanks').playback.status='ready';
 assert.throws(()=>validateCatalog(ready),/validation required/);

 // 自拟状态必须指向真实素材
 const noAsset=structuredClone(signCatalog);
 noAsset.entries.find(entry=>entry.id==='csl.thanks').playback.asset=null;
 assert.throws(()=>validateCatalog(noAsset),/asset path/);
});

test('自拟动作素材本身结构合法，且如实写明未校验与免责声明',async()=>{
 const motion=JSON.parse(await readFile('shared/sign-motions/csl.thanks.json','utf8'));
 assert.equal(motion.status,'authored_unverified');
 assert.ok(motion.authoring.basis.length>0,'必须写明手形依据');
 assert.ok(motion.authoring.source.length>0,'必须写明出处');
 assert.ok(motion.authoring.disclaimer.length>0,'必须有免责声明');
 assert.equal(motion.authoring.verifiedBy,null,'自拟素材不得声称有人校验过');
 assert.ok(Array.isArray(motion.channels)&&motion.channels.length>0);
 for(const channel of motion.channels){
  assert.ok(typeof channel.bone==='string'&&channel.bone);
  assert.ok(['x','y','z'].includes(channel.axis));
  assert.ok(Array.isArray(channel.keys)&&channel.keys.length>0);
  for(const [time,angle] of channel.keys){assert.ok(Number.isFinite(time)&&Number.isFinite(angle));}
 }
});
