import test from 'node:test';
import assert from 'node:assert/strict';
import {TtsService,audioUrl,QWEN_ENDPOINT} from '../../server/tts.mjs';
import {VoiceService} from '../../server/voice.mjs';
const config={apiKey:'test-only-secret',model:'qwen3-tts-flash',voice:'Cherry'};
const url='http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav';
const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
const json=()=>Response.json({output:{audio:{url}}});
function service(fetchImpl,options={}){return new TtsService('.', {configLoader:async()=>config,fetchImpl,...options});}
test('千问请求与旧前端契约兼容，状态不含密钥，下载不转发Authorization',async()=>{
  const calls=[];const s=service(async(u,o)=>{calls.push([u,o]);return calls.length===1?json():new Response(wav);});
  const status=await s.status();assert.equal(status.local,false);assert.equal(status.available,true);assert.ok(!JSON.stringify(status).includes(config.apiKey));
  const r=await s.synthesize({text:' 谢谢 ',confirmed:true,revision:2});
  assert.equal(r.text,'谢谢');assert.equal(r.revision,2);assert.equal(r.mime,'audio/wav');assert.equal(Buffer.from(r.audio,'base64').length,48);
  assert.equal(calls[0][0],QWEN_ENDPOINT);assert.equal(calls[0][1].headers.Authorization,'Bearer '+config.apiKey);
  assert.deepEqual(JSON.parse(calls[0][1].body),{model:config.model,input:{text:'谢谢',voice:'Cherry',language_type:'Chinese'}});
  assert.equal(calls[1][0],url.replace('http:','https:'));assert.equal(calls[1][1].headers,undefined);assert.equal(calls[1][1].redirect,'error');
});
test('只接受官方北京结果桶，不允许地址伪装',()=>{
  for(const u of ['file:///x','https://127.0.0.1/x','https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.com/x','https://user@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/x','https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com:123/x',undefined])assert.throws(()=>audioUrl(u));
});
test('未确认、超长或无效版本不发请求',async()=>{
  const s=service(()=>{throw Error('must not fetch');});
  for(const body of [{text:'谢谢',revision:0},{text:'a'.repeat(501),confirmed:true,revision:0},{text:'谢谢',confirmed:true,revision:-1}])await assert.rejects(s.synthesize(body),e=>e.status===400);
});
test('并发拒绝；取消后不返回迟到语音，busy恢复',async()=>{
  let release;const s=service(()=>new Promise(r=>{release=r;}));const controller=new AbortController();
  const pending=s.synthesize({text:'谢谢',confirmed:true,revision:0},controller.signal);await new Promise(r=>setImmediate(r));
  await assert.rejects(s.synthesize({text:'帮助',confirmed:true,revision:1}),e=>e.status===429);
  controller.abort();release(json());await assert.rejects(pending,e=>e.status===499);assert.equal(s.busy,false);
});
test('错误脱敏、限流、非法音频和过大音频均拒绝',async()=>{
  for(const status of [401,403,429,500]){const s=service(async()=>new Response(config.apiKey,{status}));await assert.rejects(s.synthesize({text:'谢谢',confirmed:true,revision:0}),e=>!e.message.includes(config.apiKey)&&e.status===(status===429?429:503));}
  for(const response of [new Response('invalid'),new Response(wav,{headers:{'content-length':String(11*1024*1024)}})]){let n=0;const s=service(async()=>++n===1?json():response);await assert.rejects(s.synthesize({text:'谢谢',confirmed:true,revision:0}));}
});
test('超时和关闭会终止上游请求',async()=>{
  const fetchImpl=async(u,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
  const s=service(fetchImpl,{timeoutMs:10});await assert.rejects(s.synthesize({text:'谢谢',confirmed:true,revision:0}),e=>e.status===504);
  const p=s.synthesize({text:'谢谢',confirmed:true,revision:0});s.close();await assert.rejects(p,e=>e.status===499);
});
test('本地音色停用，不加载旧权重',async()=>{const s=new VoiceService();assert.equal(s.installed(),false);assert.equal(s.status().retired,true);await assert.rejects(s.synthesize({}),e=>e.status===410);});
