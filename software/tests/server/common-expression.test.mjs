import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {resolveExpression} from '../../shared/sign-expression.mjs';
import {validateLanguagePlan} from '../../server/local-language.mjs';
import {createApp} from '../../server/app.mjs';

test('医院常见说法完整映射，保留原话与对象/否定/询问位置',()=>{
 const cases=[['我想挂号',['我','需要','挂号']],['请帮帮我',['请','帮助','我']],['我想看医生',['我','需要','医生']],['我发烧了',['我','发烧']],['我这里疼',['我','这里','痛']],['我没过敏',['我','没有','过敏']],['我没有过敏',['我','没有','过敏']],['挂号在哪里？',['挂号','哪里']],['门诊在哪儿',['门诊','哪里']],['你好，我想挂号，谢谢你。',['你好','我','需要','挂号','谢谢','你']]];
 for(const [text,labels] of cases){const result=resolveExpression(text);assert.ok(result.preview,text);assert.equal(result.expression.originalText,text);assert.deepEqual(result.expression.steps.map(s=>s.label),labels,text);}
});
test('只替换完整分句，不省略未知身份、时间、数量和未支持疑问语气',()=>{
 for(const text of ['我不想挂号','我想挂号明天','请帮帮我办证','我第一次来，需要挂号','给我两片药','给我20片药','我想看医生小王','有药吗？','哪里痛？有药？','谢谢？']){
  const result=resolveExpression(text);assert.equal(result.preview,null,text);assert.ok(result.missing.length,text);
 }
 assert.deepEqual(resolveExpression('我需要轮椅').missing,['轮椅']);
});
test('模型不能用已有ID掩盖缺词，已覆盖否定不被旧正则误拦',()=>{
 const plan=(source,actions)=>({units:[{source,actions,missing:[],note:'完整表达。'}]});
 const me='csl.me',need='csl.ref.bmcx.1874',no='csl.ref.bmcx.3758',allergy='csl.ref.bmcx.4040';
 const missing=validateLanguagePlan('我需要轮椅',plan('我需要轮椅',[me,need]));assert.equal(missing.preview,null);assert.ok(missing.missing.includes('轮椅'));
 assert.ok(validateLanguagePlan('我没有过敏',plan('我没有过敏',[me,no,allergy])).preview);
 assert.throws(()=>validateLanguagePlan('我没有过敏',plan('我没有过敏',[me,allergy])),/不完整/);
});
test('播放API直接处理确定说法，未覆盖内容返回具体缺项，长度限制明确',async t=>{
 const parent=resolve('.runtime-logs/common-expression-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));let calls=0;
 const languageService={resolve:async()=>{calls++;return {status:'unsupported',preview:null,reason:'unknown_content',missing:['轮椅'],expression:null,engine:{provider:'test'}};},close(){}};
 const server=await createApp({dataDir:root,publicDir:resolve('web/public'),languageService,origins:['http://127.0.0.1:5183']});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});
 const request=async text=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/sign/resolve',{method:'POST',headers:{Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1','Content-Type':'application/json'},body:JSON.stringify({text,mode:'playback'})});assert.equal(r.status,200);return r.json();};
 assert.ok((await request('我想挂号')).preview);assert.ok((await request('请帮帮我')).preview);assert.ok((await request('我没有过敏')).preview);assert.equal(calls,0);
 for(const text of ['我想请医生帮忙','请志愿者帮我挂号','请问门诊在哪里？']){
  const result=await request(text);
  assert.equal(result.preview?.id,resolveExpression(text).preview.id);
  assert.equal(Object.hasOwn(result,'expression'),false);
 }
 assert.equal(calls,0);
 const missing=await request('我需要轮椅');assert.equal(missing.preview,null);assert.deepEqual(missing.missing,['轮椅']);assert.equal(calls,1);
 assert.equal((await request('你'.repeat(11))).reason,'too_many_actions');assert.equal((await request('对不起'.repeat(8))).reason,'too_long');assert.equal((await request('有药吗？')).reason,'unsupported_question');assert.equal(calls,1);
});
