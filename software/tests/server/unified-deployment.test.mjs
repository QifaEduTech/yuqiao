import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {SignService} from '../../server/sign.mjs';
import {recordingBundle} from '../../server/recording-catalog.mjs';
import {createApp} from '../../server/app.mjs';

test('实际录像解码和统一推理使用同一模型快照，空白录像拒识',async t=>{
 const parent=resolve('.runtime-logs/unified-deploy-tests');await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'video-'));const service=new SignService(resolve('.'));t.after(async()=>{service.close();assert.ok(dir.startsWith(parent+sep));await rm(dir,{recursive:true,force:true});});
 service.tempRoot=()=>join(dir,'service-tmp');
 const path=join(dir,'blank.mp4');
 await promisify(execFile)(service.python(),['-c',"import cv2,numpy as np,sys; w=cv2.VideoWriter(sys.argv[1],cv2.VideoWriter_fourcc(*'mp4v'),30,(64,64)); assert w.isOpened(); [w.write(np.zeros((64,64,3),np.uint8)) for _ in range(45)]; w.release()",path],{windowsHide:true});
 const result=await service.recognize(await readFile(path),'video/mp4');assert.equal(result.status,'no_hands');assert.equal(result.engine,'unified-tcn');assert.equal(result.pipeline_id,'unified-body178-recording-v1');assert.equal(result.modelSnapshot.pipelineModels.length,1);assert.equal(result.modelSnapshot.modelSha256,recordingBundle(resolve('.')).models[0].modelSha256);
});

test('训练页保留资料入口，统一模式禁止旧逐词训练和启用',async t=>{
 const parent=resolve('.runtime-logs/unified-deploy-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'api-'));const origin='http://127.0.0.1:5183';
 const server=await createApp({dataDir:root,publicDir:resolve('web/public'),origins:[origin]});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+server.address().port,headers={Origin:origin,'X-Yuqiao-Request':'1','Content-Type':'application/json'};
 const register=await fetch(base+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({username:'unified_test',password:'unified-test-password-2026'})});assert.equal(register.status,201);headers.Cookie=register.headers.get('set-cookie').split(';')[0];
 const state=await(await fetch(base+'/api/training/state',{headers})).json();assert.equal(state.runtimeMode,'unified-tcn');assert.ok(Array.isArray(state.actions));
 assert.equal(state.limits.maxActions,64);
 const dictionary=await(await fetch(base+'/api/training/dictionary?q='+encodeURIComponent('谢谢'),{headers})).json();assert.ok(dictionary.entries.some(e=>e.id==='csl.thanks'));
 const create=await fetch(base+'/api/training/actions',{method:'POST',headers,body:JSON.stringify({dictionaryId:'csl.thanks',description:'重新采集统一模型资料',hands:1,motion:'dynamic'})});assert.equal(create.status,201);
 const duplicate=await fetch(base+'/api/training/actions',{method:'POST',headers,body:JSON.stringify({dictionaryId:'csl.thanks',description:'重复',hands:1,motion:'dynamic'})});assert.equal(duplicate.status,400);
 const id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
 for(const [suffix,data] of [['jobs',{kind:'train'}],['activate',{version:'old-version'}]]){const r=await fetch(base+'/api/training/actions/'+id+'/'+suffix,{method:'POST',headers,body:JSON.stringify(data)});assert.equal(r.status,409);}
 const catalog=await(await fetch(base+'/api/sign/catalog')).json();assert.deepEqual(catalog.entries.map(x=>x.text),['谢谢','帮助','需要','我']);
});
