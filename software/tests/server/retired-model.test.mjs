import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../../server/app.mjs';

test('已删除模型不能调用，旧接口返回退役状态',async t=>{
 const parent=resolve('.runtime-logs/retired-api-tests');await mkdir(parent,{recursive:true});
 const dir=await mkdtemp(join(parent,'test-'));
 const server=await createApp({dataDir:dir,publicDir:resolve('web/public')});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});});
 const base=`http://127.0.0.1:${server.address().port}`;
 const status=await(await fetch(base+'/api/continuous/status')).json();
 assert.equal(status.available,false);assert.equal(status.retired,true);
 const response=await fetch(base+'/api/continuous/experiments',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','X-Yuqiao-Request':'1','Content-Type':'video/webm'},body:Buffer.alloc(40)});
 assert.equal(response.status,410);assert.match((await response.json()).error,/已删除/);
});
