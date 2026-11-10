import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../server/app.mjs';
import { SignService, validateSignVideo } from '../../server/sign.mjs';
import { recordSignDiagnostics } from '../../server/sign-diagnostics.mjs';

test('诊断只保留最近20次数字与原因码，不保存录像、关键点或识别词', async t => {
  const parent = resolve('.runtime-logs/sign-tests'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'diagnostics-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  let id;
  for (let i=0;i<22;i++) id=await recordSignDiagnostics(dir,{status:'uncertain',score:.985,hand_frames:i,candidate:'private-word',landmarks:[123],video:'private-video',checks:[{code:'coverage',passed:false,detail:'private-detail'}]});
  const raw=await readFile(join(dir,'recent.json'),'utf8');
  const records=JSON.parse(raw);
  assert.equal(records.length,20); assert.equal(records[0].hand_frames,2);
  assert.equal(records.at(-1).id,id); assert.deepEqual(records.at(-1).checks,[{code:'coverage',passed:false}]);
  assert.doesNotMatch(raw,/private-|landmarks|candidate/);
});

test('动作视频拒绝伪造、超限和错误类型', () => {
  assert.throws(() => validateSignVideo(Buffer.alloc(100), 'video/mp4'), /无效/);
  assert.throws(() => validateSignVideo(Buffer.alloc(100), 'image/png'), /WebM/);
  assert.throws(() => validateSignVideo(Buffer.alloc(33 * 1024 * 1024), 'video/webm'), /32 MB/);
});

test('动作接口来源校验、错误传播与视频正文', async t => {
  const parent = resolve('.runtime-logs/sign-tests'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'api-'));
  let called = 0;
  const server = await createApp({ dataDir: dir, publicDir: resolve('web/public'), origins: ['http://127.0.0.1:5183'], signService: {
    status: () => ({ available: true, experimental: true }), close() {},
    async recognize(buffer, mime) { called++; assert.equal(buffer.length, 40); assert.equal(mime, 'video/webm'); throw Object.assign(new Error('测试拒识'), { status: 422 }); },
  }});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(dir, {recursive: true, force: true}); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = {Origin:'http://127.0.0.1:5183','X-Yuqiao-Request':'1','Content-Type':'video/webm'};
  assert.equal((await fetch(base+'/api/sign/status')).status, 200);
  assert.equal((await fetch(base+'/api/sign/experiments',{method:'POST',body:Buffer.alloc(40)})).status,403);
  const response=await fetch(base+'/api/sign/experiments',{method:'POST',headers,body:Buffer.alloc(40)});
  assert.equal(response.status,422); assert.equal((await response.json()).error,'测试拒识'); assert.equal(called,1);
  const retired=await fetch(base+'/api/sign/sequences',{method:'POST',headers,body:Buffer.alloc(40)});
  assert.equal(retired.status,410);assert.match((await retired.json()).error,/已停用/);assert.equal(called,1,'Retired route must not invoke inference');
});

test('真实算法损坏视频、并发、取消后清理临时文件', async t => {
  const service = new SignService(resolve('.'));
  if (!service.installed()) { t.skip('动作环境尚未验证'); return; }
  t.after(()=>service.close());
  const corrupted=Buffer.alloc(100); corrupted.write('ftyp',4);
  const pending=service.recognize(corrupted,'video/mp4');
  await assert.rejects(service.recognize(corrupted,'video/mp4'),e=>e.status===429);
  await assert.rejects(pending,e=>e.status===422);
  const controller=new AbortController();
  const cancelled=service.recognize(corrupted,'video/mp4',controller.signal);
  for (let n=0; n<100 && !service.child; n++) await new Promise(r=>setTimeout(r,5));
  assert.ok(service.child, 'Cancel a running child, not just a pending file write');
  controller.abort();
  await assert.rejects(cancelled,e=>e.status===499);
  assert.deepEqual(await readdir('.runtime-logs/sign-tmp'),[]);
});
