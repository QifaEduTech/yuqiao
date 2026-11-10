import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,readdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {once} from 'node:events';
import {RealtimeSignService,validateLiveJpeg} from '../../server/realtime.mjs';
import {createApp} from '../../server/app.mjs';
import {validLiveResult,validHandTracking,validMeCheck} from '../../shared/realtime-result.mjs';

test('我检查只接受有界标量，停止或750ms过期后不留诊断',()=>{
  const check={bodyVisible:true,chestReferenced:true,frameSupported:false,stableSupported:false,modelScore:.9,hands:[{indexAngle:80,indexAngle2d:92,indexExtended:false,otherFingersFolded:true,towardChest:true,nearBody:true,chestCosine:.81,shoulderCosine:.6,tipDistance:.2}]};
  assert.ok(validMeCheck(check));assert.ok(validMeCheck(null));assert.equal(Boolean(validMeCheck({...check,modelScore:NaN})),false);assert.equal(Boolean(validMeCheck({...check,hands:[{...check.hands[0],indexAngle:181}]})),false);
  const s=new RealtimeSignService(resolve('.'));s.active={lastSeen:Date.now(),lastMeCheck:check};assert.deepEqual(s.status().meCheck,check);s.active.lastSeen=Date.now()-800;assert.equal(s.status().meCheck,null);s.active=null;assert.equal(s.status().meCheck,null);
});

test('骨架协议限定两只手21个有限二维点，保持镜像约定',()=>{
  const valid={width:640,height:360,mirrored:true,hands:[{side:'Left',points:Array.from({length:21},()=>[.2,.6])}]};
  assert.ok(validHandTracking(valid));assert.ok(validHandTracking({...valid,hands:[]}));
  for(const patch of [{mirrored:false},{width:8000},{height:0},{hands:[...valid.hands,...valid.hands,...valid.hands]},{hands:[{side:'Unknown',points:valid.hands[0].points}]},{hands:[{side:'Left',points:[[NaN,0]]}]},{hands:[{side:'Left',points:Array.from({length:21},()=>[Infinity,.2])}]},{hands:[{side:'Left',points:Array.from({length:21},()=>[3,.2])}]}])assert.equal(Boolean(validHandTracking({...valid,...patch})),false);
  const base={status:'waiting',candidate:null,eventState:'waiting',processingMs:1,samples:0,handSamples:0,event:null};
  assert.ok(validLiveResult({...base,handTracking:valid},'谢谢','csl.thanks',60));
  assert.equal(validLiveResult({...base,handTracking:{...valid,mirrored:false}},'谢谢','csl.thanks',60),false);
});

test('实时事件协议验证身份、时间、状态和严格递增编号',()=>{
  const message={type:'frame',seq:1,status:'waiting',candidate:null,eventState:'emitted',processingMs:5,samples:0,handSamples:0,event:{id:1,signId:'csl.thanks',text:'谢谢',startMs:0,endMs:2000}};
  assert.ok(validLiveResult(message,'谢谢','csl.thanks',60));
  for(const patch of [{event:undefined},{eventState:'collecting'},{samples:-1},{handSamples:2},{event:{...message.event,text:'你好'}},{event:{...message.event,endMs:-1}}])assert.equal(Boolean(validLiveResult({...message,...patch},'谢谢','csl.thanks',60)),false);
  const service=new RealtimeSignService(resolve('.'));
  let resolved=0;const session={pending:{seq:1,resolve:()=>resolved++},lastTimestamp:3000,lastEventId:0,lastEventEnd:-1,frames:0};
  service.receive(session,message);assert.equal(resolved,1);assert.equal(session.lastEventId,1);
  session.pending={seq:2,resolve:()=>resolved++};
  assert.throws(()=>service.receive(session,{...message,seq:2}),/event order/);assert.equal(resolved,1);
  assert.throws(()=>service.receive(session,{...message,seq:2,event:{...message.event,id:2,startMs:2001,endMs:4000}}),/event order/);
});

const jpeg=Buffer.from(JSON.parse(readFileSync(new URL('../fixtures/realtime-blank.json',import.meta.url),'utf8')).base64,'base64');
test('自动结果按词语与ID配对校验，不接受范围外词或错配ID',()=>{
  const texts=['谢谢','帮助','需要','我'],ids=['csl.thanks','csl.ref.bmcx.1900','csl.ref.bmcx.1874','csl.me'];
  const base={status:'waiting',candidate:null,eventState:'emitted',event:{id:1,text:'帮助',signId:ids[1],startMs:0,endMs:2000},processingMs:1,samples:0,handSamples:0};
  assert.ok(validLiveResult({...base,event:{...base.event,text:'需要',signId:ids[2]}},texts,ids,140));assert.ok(validLiveResult(base,texts,ids,140));assert.ok(validLiveResult({...base,event:{...base.event,text:'谢谢',signId:ids[0]}},texts,ids,140));
  assert.equal(Boolean(validLiveResult({...base,event:{...base.event,signId:ids[0]}},texts,ids,140)),false);
  assert.equal(Boolean(validLiveResult({...base,status:'candidate',candidate:'你好',event:null,eventState:'collecting'},texts,ids,140)),false);
});
test('帮助试验目标固定，空手不自动输出所选词，其他目标和谢谢结果不得混入',async t=>{
  const service=new RealtimeSignService(resolve('.'));if(!service.status().available){t.skip('本机环境缺失');return;}t.after(()=>service.close());
  await assert.rejects(service.start(undefined,'hello'),e=>e.status===400);
  const ready=await service.start(undefined,'help');assert.equal(ready.target,'help');assert.equal(ready.targetText,'帮助');assert.equal(ready.targetSignId,'csl.ref.bmcx.1900');
  assert.equal(ready.helpEngine,'video-tcn');assert.equal(ready.modelVersion,'v1');
  for(let seq=1;seq<=12;seq++){
    const result=await service.frame(ready.session,jpeg,seq,(seq-1)*100);assert.equal(result.candidate,null);assert.equal(result.event,null);assert.deepEqual(result.handTracking.hands,[]);
  }
  const session={target:'help',pending:{seq:1,resolve:()=>assert.fail('wrong word accepted')},lastTimestamp:3000,lastEventId:0,lastEventEnd:-1,frames:0};
  assert.throws(()=>service.receive(session,{type:'frame',seq:1,status:'candidate',candidate:'谢谢',eventState:'collecting',processingMs:1,samples:30,handSamples:30,event:null}),/Invalid live response/);
});

test('帮助旧规则可显式回退，不静默替代视频模型',async t=>{
  const service=new RealtimeSignService(resolve('.'));t.after(()=>service.close());
  const ready=await service.start(undefined,'help','geometry');assert.equal(ready.helpEngine,'geometry');
  const result=await service.frame(ready.session,jpeg,1,0);assert.equal(result.helpEngine,'geometry');assert.equal(result.modelVersion,null);assert.equal(result.candidate,null);
});
test('实时JPEG尺寸和格式在解码前受限',()=>{
  assert.deepEqual(validateLiveJpeg(jpeg),{width:64,height:64});assert.throws(()=>validateLiveJpeg(Buffer.alloc(30)),e=>e.status===415);assert.throws(()=>validateLiveJpeg(Buffer.alloc(300000)),e=>e.status===415);
  const large=Buffer.from(jpeg),at=large.indexOf(Buffer.from([255,192]));assert.ok(at>=0);large.writeUInt16BE(8000,at+5);assert.throws(()=>validateLiveJpeg(large),e=>e.status===413);
});

test('实际持久进程复用、无手拒识、限流、会话隔离和关闭释放，不写画面文件',async t=>{
  const service=new RealtimeSignService(resolve('.'));if(!service.status().available){t.skip('本机识别环境缺失');return;}t.after(()=>service.close());
  const started=await service.start();const pid=service.active.child.pid;
  assert.equal(started.target,'auto');assert.deepEqual(started.supportedActions.map(x=>x.text),['谢谢','帮助','需要','我']);
  await assert.rejects(service.start(),e=>e.status===429);await assert.rejects(service.frame('wrong',jpeg,1,0),e=>e.status===404);
  const pending=service.frame(started.session,jpeg,1,0);await assert.rejects(service.frame(started.session,jpeg,2,100),e=>e.status===429);
  let result=await pending;assert.equal(result.candidate,null);assert.deepEqual(result.handTracking,{width:64,height:64,mirrored:true,hands:[]});
  for(let i=2;i<=16;i++){result=await service.frame(started.session,jpeg,i,(i-1)*100);assert.equal(result.status,'waiting');assert.equal(result.candidate,null);assert.equal(service.active.child.pid,pid);}
  await assert.rejects(service.frame(started.session,jpeg,16,2000),e=>e.status===409);assert.throws(()=>service.stop('wrong'),e=>e.status===404);assert.equal(service.status().busy,true);
  const child=service.active.child,closed=once(child,'close');service.stop(started.session);await closed;assert.equal(service.status().busy,false);await assert.rejects(service.frame(started.session,jpeg,20,2100),e=>e.status===404);
  assert.deepEqual(await readdir('.runtime-logs/realtime-tmp'),[]);
});

test('实时接口无需账号且不创建记录，写请求仍校验来源和会话',async t=>{
  const parent=resolve('.runtime-logs/realtime-api-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'case-'));let liveToken=null,frames=0;
  const live={status:()=>({available:true}),async start(){liveToken='session-test';return{session:liveToken};},async frame(token,buffer,seq){assert.equal(buffer.length,jpeg.length);if(token!==liveToken)throw Object.assign(Error('wrong'),{status:404});frames++;return{seq,status:'waiting',candidate:null};},stop(token){if(token!==liveToken)throw Object.assign(Error('wrong'),{status:404});liveToken=null;return{ok:true};},close(){}};
  const server=await createApp({dataDir:root,publicDir:resolve('web/public'),realtimeService:live});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));assert.ok(root.startsWith(parent+sep));await rm(root,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}`,headers={Origin:'http://127.0.0.1:5173','X-Yuqiao-Request':'1'};
  assert.equal((await fetch(url+'/api/sign/realtime/sessions',{method:'POST',body:'{}',headers:{'Content-Type':'application/json'}})).status,403);
  assert.equal((await fetch(url+'/api/sign/realtime/sessions',{method:'POST',body:'{}',headers:{...headers,'Content-Type':'application/json'}})).status,201);
  const request={method:'POST',body:jpeg,headers:{...headers,'Content-Type':'image/jpeg','X-Yuqiao-Live-Session':'session-test','X-Yuqiao-Frame-Seq':'1','X-Yuqiao-Capture-Ms':'0'}};
  assert.equal((await fetch(url+'/api/sign/realtime/frames',request)).status,200);assert.equal(frames,1);
  assert.equal((await fetch(url+'/api/sign/realtime/sessions',{method:'DELETE',headers:{...headers,'X-Yuqiao-Live-Session':'session-test'}})).status,200);
  assert.deepEqual(await readdir(join(root,'media')),[]);
});
