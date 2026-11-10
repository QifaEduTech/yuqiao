import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configureLocalMysql,validateLocalConnection} from '../../scripts/configure-local-mysql.mjs';
const config={host:'127.0.0.1',port:3306,user:'test_user',password:'synthetic-only',database:'yuqiao'};
test('reject nonlocal database configuration',()=>{
  for(const patch of [{host:'remote.example'},{database:'production'},{port:0},{user:''},{password:''}])assert.throws(()=>validateLocalConnection({...config,...patch}));
});
test('checks schema read-only, stores ciphertext only and refuses overwrite',async()=>{
  const root=await mkdtemp(join(tmpdir(),'yq-config-'));let queries=[],closed=0;
  try{
    const deps={root,connect:async()=>({query:async sql=>queries.push(sql),end:async()=>closed++}),protect:async value=>{assert.equal(value,config.password);return 'synthetic-dpapi';}};
    const result=await configureLocalMysql(config,deps);assert.equal(result.checkedTables,10);assert.equal(closed,1);
    assert.ok(queries.every(sql=>/^SELECT 1 FROM `\w+` LIMIT 0$/.test(sql)));
    const saved=await readFile(join(root,'data/secrets/mysql.json'),'utf8');assert.ok(!saved.includes(config.password));assert.equal(JSON.parse(saved).encryptedPassword,'synthetic-dpapi');
    await assert.rejects(configureLocalMysql(config,deps),/Existing/);assert.equal(queries.length,10);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('missing schema closes connection without saving credentials',async()=>{
  const root=await mkdtemp(join(tmpdir(),'yq-config-'));let closed=false;
  try{
    await assert.rejects(configureLocalMysql(config,{root,connect:async()=>({query:async()=>{throw Error('missing table');},end:async()=>{closed=true;}}),protect:async()=>{throw Error('must not encrypt');}}));
    assert.ok(closed);await assert.rejects(access(join(root,'data/secrets/mysql.json')));
  }finally{await rm(root,{recursive:true,force:true});}
});
