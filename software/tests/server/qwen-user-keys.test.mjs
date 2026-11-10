import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {QwenUserKeys} from '../../server/qwen-user-keys.mjs';
import {TtsService} from '../../server/tts.mjs';
import {createApp} from '../../server/app.mjs';
import {allowedSharePath,sharePaths} from '../../scripts/prepare-windows-share.mjs';
const key='sk-test-only-no-real-credentials-12345';
async function directory(t,beforeCleanup=async()=>{}){const parent=resolve('.runtime-logs/key-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));t.after(async()=>{await beforeCleanup();assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});return root;}
test('DPAPI round trip, replacement, deletion, account isolation and no environment override',async t=>{
  const root=await directory(t),store=new QwenUserKeys(root);
  assert.equal((await store.status('a')).configured,false);
  await store.save('a',key);assert.equal((await store.status('a')).configured,true);
  assert.ok(!(await readFile(store.path('a'),'utf8')).includes(key));
  assert.equal((await store.config(resolve('.'),'a')).apiKey,key);
  assert.equal((await store.status('b')).configured,false);
  const old=process.env.DASHSCOPE_API_KEY;process.env.DASHSCOPE_API_KEY='must-not-override-personal-key';
  try{assert.equal((await store.config(resolve('.'),'a')).apiKey,key);}finally{if(old===undefined)delete process.env.DASHSCOPE_API_KEY;else process.env.DASHSCOPE_API_KEY=old;}
  const newKey=key+'2';await store.save('a',newKey);assert.equal((await store.config(resolve('.'),'a')).apiKey,newKey);
  await assert.rejects(store.save('a','not-a-key'),e=>e.status===400);
  assert.equal((await store.config(resolve('.'),'a')).apiKey,newKey);
  await store.remove('a');assert.equal(await store.config(resolve('.'),'a'),null);
  assert.ok(!(await readFile(store.path('a'),'utf8')).includes('encryptedApiKey'));
});
test('key API requires login and same-origin; each request uses authenticated account only',async t=>{
  let server;
  const root=await directory(t,async()=>{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}}),keys=new QwenUserKeys(root),origin='http://127.0.0.1:5173';
  const calls=[];const tts={status:async id=>({available:!!id}),synthesize:async(body,signal,id)=>{calls.push(id);return {text:body.text};},close(){},cancelUser(){}};
  server=await createApp({dataDir:root,publicDir:resolve('web/public'),ttsService:tts,qwenKeyStore:keys,origins:[origin]});server.listen(0,'127.0.0.1');await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port;
  const request=(path,method='GET',cookie='',body,source=origin)=>fetch(base+path,{method,headers:{origin:source,'X-Yuqiao-Request':'1','Content-Type':'application/json',cookie},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/profile/tts-key')).status,401);
  const register=async name=>{const r=await request('/api/auth/register','POST','',{username:name,password:'test-password-2026'});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];};
  const a=await register('key_user_a'),b=await register('key_user_b');
  assert.equal((await request('/api/profile/tts-key','PUT',a,{apiKey:key},'https://evil.invalid')).status,403);
  const saved=await request('/api/profile/tts-key','PUT',a,{apiKey:key});assert.equal(saved.status,200);assert.ok(!(await saved.text()).includes(key));
  assert.equal((await (await request('/api/profile/tts-key','GET',b)).json()).configured,false);
  await request('/api/tts/synthesize','POST',a,{text:'谢谢',confirmed:true,revision:1,userId:'spoof'});
  const who=await (await request('/api/auth/me','GET',a)).json();assert.equal(calls[0],who.user.id);
  assert.equal((await request('/api/profile/tts-key','DELETE',b)).status,200);
  assert.equal((await (await request('/api/profile/tts-key','GET',a)).json()).configured,true);
});
test('TTS resolves the supplied authenticated user, not a global key',async()=>{
  const ids=[];const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);let authorization;
  const tts=new TtsService('.',{configLoader:async(root,id)=>{ids.push(id);return {apiKey:key,voice:'Cherry',model:'qwen3-tts-flash'};},fetchImpl:async(url,options)=>{if(options.headers){authorization=options.headers.Authorization;return Response.json({output:{audio:{url:'https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav'}}});}return new Response(wav);}});
  await tts.synthesize({text:'谢谢',confirmed:true,revision:1},undefined,'account-a');assert.deepEqual(ids,['account-a']);assert.equal(authorization,'Bearer '+key);
});
test('share allowlist excludes private state, environments and credentials',()=>{
  for(const path of ['data/media/a.webm','data/secrets/mysql.json','.env','web/.env.local','.venv/pyvenv.cfg','.runtime-logs/x','web/dist/x','models/x/a.log'])assert.equal(allowedSharePath(path),false,path);
  for(const path of sharePaths)assert.equal(allowedSharePath(path),true,path);
  assert.equal(sharePaths.includes('data'),false);assert.equal(sharePaths.includes('models/ollama'),false);
});
