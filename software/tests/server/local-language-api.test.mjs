import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../../server/app.mjs';
import {validateLanguagePlan} from '../../server/local-language.mjs';

test('表达接口确实委托模型服务、离线返回503、旧精确接口不依赖模型',async t=>{
 const parent=resolve('.runtime-logs/server-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'language-'));
 let calls=0,offline=false;
 const languageService={async resolve(text){calls++;if(offline){const e=new Error('本机模型不可用');e.status=503;throw e;}return validateLanguagePlan(text,{units:[{source:text,actions:['csl.thanks','csl.you'],missing:[],note:'按含义表达感谢。'}]});},close(){}};
 const server=await createApp({dataDir:root,publicDir:resolve('web/public'),languageService});server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});
 const request=body=>fetch(`http://127.0.0.1:${server.address().port}/api/sign/resolve`,{method:'POST',headers:{Origin:'http://127.0.0.1:5173','X-Yuqiao-Request':'1','Content-Type':'application/json'},body:JSON.stringify(body)});
 const r=await request({text:'多谢你了',mode:'expression'});assert.equal(r.status,200);assert.equal((await r.json()).expression.provider,'ollama');assert.equal(calls,1);
 const playback=await(await request({text:'多谢你了',mode:'playback'})).json();assert.ok(playback.preview);assert.equal(playback.expression,undefined);assert.equal(playback.engine,undefined);assert.equal(playback.missing,undefined);assert.equal(calls,2);
 offline=true;assert.equal((await request({text:'谢谢',mode:'expression'})).status,503);
 const exact=await request({text:'谢谢'});assert.equal(exact.status,200);assert.equal((await exact.json()).preview.id,'csl.thanks');assert.equal(calls,3);
});
