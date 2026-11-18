import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter,once} from 'node:events';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DisplayChannel} from '../../server/display-channel.mjs';
import {createApp} from '../../server/app.mjs';
import {resolveInputPreview} from '../../shared/sign-preview.mjs';
import catalog from '../../shared/sign-motion-catalog.json' with {type:'json'};

class Stream extends EventEmitter{
 constructor(){super();this.output='';this.writableLength=0;this.writableEnded=false;this.destroyed=false;}
 writeHead(){}write(value){this.output+=value;return true;}end(){this.writableEnded=true;this.emit('close');}destroy(){this.destroyed=true;this.end();}
 events(name){return this.output.split('\n\n').filter(b=>b.startsWith('event: '+name+'\n')).map(b=>JSON.parse(b.split('\ndata: ')[1]));}
}
test('同账号直接同步所有显示端，跨账号隔离且重复指令只执行一次',t=>{
 const channel=new DisplayChannel();t.after(()=>channel.close());const a=new Stream(),a2=new Stream(),b=new Stream();
 channel.connect('alice',a,()=>true,'a');channel.connect('alice',a2,()=>true,'a2');channel.connect('bob',b,()=>true,'b');
 const body={commandId:randomUUID(),preview:{...resolveInputPreview('谢谢').preview,label:'私密原话',originalText:'私密原话'}};
 assert.equal(channel.command('alice',body,catalog).delivered,2);assert.equal(channel.command('alice',body,catalog).duplicate,true);assert.equal(a.events('command').length,1);assert.equal(a2.events('command').length,1);assert.equal(b.events('command').length,0);assert.equal(a.events('command')[0].preview.label,'谢谢');assert.ok(!a.output.includes('私密原话'));
 assert.throws(()=>channel.command('alice',{...body,preview:null},catalog),e=>e.status===409);
 for(const control of ['pause','play','replay'])assert.equal(channel.command('alice',{commandId:randomUUID(),control},catalog).delivered,2);
 assert.equal(channel.command('alice',{commandId:randomUUID(),preview:resolveInputPreview('我需要帮助').preview},catalog).delivered,2);
});
test('离线不排队，重连不补播；退出只关闭对应会话',t=>{
 const channel=new DisplayChannel();t.after(()=>channel.close());const body={commandId:randomUUID(),preview:resolveInputPreview('谢谢').preview};
 assert.equal(channel.command('alice',body,catalog).delivered,0);const a=new Stream(),b=new Stream();channel.connect('alice',a,()=>true,'one');channel.connect('alice',b,()=>true,'two');assert.equal(a.events('command').length,0);
 assert.equal(channel.command('alice',body,catalog).delivered,0);assert.equal(a.events('command').length,0);channel.revokeSession('one');assert.equal(a.writableEnded,true);assert.equal(b.writableEnded,false);assert.equal(channel.status('alice').connected,1);
});
test('会话失效停止投递，非法动作与无编号请求拒绝',t=>{
 const channel=new DisplayChannel();t.after(()=>channel.close());let valid=true;const a=new Stream();channel.connect('alice',a,()=>valid,'one');valid=false;
 assert.equal(channel.command('alice',{commandId:randomUUID(),control:'play'},catalog).delivered,0);assert.equal(a.events('session-expired').length,1);
 assert.throws(()=>channel.command('alice',{preview:null},catalog),e=>e.status===400);assert.throws(()=>channel.command('alice',{commandId:randomUUID(),control:'unknown'},catalog),e=>e.status===400);
});

test('场景连播已取消，旧场景与播放列表请求拒绝，普通动作照常下发',t=>{
 const channel=new DisplayChannel();t.after(()=>channel.close());const stream=new Stream();channel.connect('alice',stream,()=>true,'one');
 const body={commandId:randomUUID(),sceneId:'hospital-mutual-aid-1',originalText:'不应转发的私有原话'};
 assert.throws(()=>channel.command('alice',body,catalog),e=>e.status===400);
 assert.throws(()=>channel.command('alice',{commandId:randomUUID(),playlist:[resolveInputPreview('谢谢').preview]},catalog),e=>e.status===400);
 assert.throws(()=>channel.command('alice',{commandId:randomUUID(),sceneId:'unknown'},catalog),e=>e.status===400);
 assert.throws(()=>channel.command('alice',{commandId:randomUUID(),sceneId:body.sceneId,preview:null},catalog),e=>e.status===400);
 assert.equal(stream.events('command').length,0);
 assert.equal(channel.command('alice',{commandId:randomUUID(),preview:resolveInputPreview('我需要挂号').preview},catalog).delivered,1);
 assert.equal(stream.events('command')[0].playlist,undefined);
});
test('旧配对配置不再读取，配对接口已移除，流仍受登录与来源保护',async t=>{
 const parent=resolve('.runtime-logs/display-channel-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-')),origin='http://127.0.0.1:5183';
 await writeFile(join(root,'display-pairing.json'),'old-unused-config');
 const server=await createApp({dataDir:root,publicDir:resolve('web/public'),origins:[origin]});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});
 const req=(path,{cookie='',body,method=body?'POST':'GET',foreign=false}={})=>fetch(base+path,{method,headers:{Origin:foreign?'https://other.example':origin,'X-Yuqiao-Request':'1','Content-Type':'application/json',Cookie:cookie},...(body?{body:JSON.stringify(body)}:{})});
 assert.equal((await req('/api/display/stream')).status,401);
 const registered=await req('/api/auth/register',{body:{username:'channel_user',password:'isolated-channel-test-2026'}}),cookie=registered.headers.get('set-cookie').split(';')[0];
 for(const path of ['/register','/pair','/code'])assert.equal((await req('/api/display'+path,{cookie,body:{}})).status,404);assert.equal((await req('/api/display/binding',{cookie,method:'DELETE'})).status,404);
 const stream=await req('/api/display/stream',{cookie}),reader=stream.body.getReader();await reader.read();assert.equal((await(await req('/api/display/state',{cookie})).json()).connected,1);
 assert.equal((await req('/api/display/command',{cookie,foreign:true,body:{commandId:randomUUID(),control:'play'}})).status,403);
 await req('/api/auth/logout',{cookie,body:{}});let rest='';while(true){const chunk=await reader.read();if(chunk.done)break;rest+=new TextDecoder().decode(chunk.value);}assert.match(rest,/session-expired/);reader.releaseLock();assert.equal(await readFile(join(root,'display-pairing.json'),'utf8'),'old-unused-config');
});
