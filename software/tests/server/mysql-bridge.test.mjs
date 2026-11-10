import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from '../../server/database.mjs';
import {prepareMysqlFixture} from './mysql-fixture.mjs';
test('MySQL跨语言读取一致，拒绝只读写入；配置丢失不得重建SQLite',{skip:process.env.YUQIAO_TEST_MYSQL!=='1'},async()=>{
 const parent=resolve('.runtime-logs/mysql-tests');await mkdir(parent,{recursive:true});const root=await mkdtemp(join(parent,'bridge-'));const cleanup=await prepareMysqlFixture(root);
 const db=new DatabaseSync(join(root,'app.sqlite'));
 try{
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?)').run('test-user','test_username','中文用户😀','salt','hash',123456);
  const readonly=new DatabaseSync(join(root,'app.sqlite'),{readOnly:true});try{assert.throws(()=>readonly.prepare('DELETE FROM users').run());assert.equal(readonly.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);}finally{readonly.close();}
  const result=await new Promise((ok,no)=>{
   const child=spawn(resolve('.venv-sign/Scripts/python.exe'),['-B','-c',"import sys,json;from pathlib import Path;sys.path.insert(0,'server');from project_database import connect;db=connect(Path(sys.argv[1]).as_uri()+'?mode=ro',uri=True);print(json.dumps(dict(db.execute('SELECT * FROM users WHERE id=?',('test-user',)).fetchone()),ensure_ascii=True));db.close()",join(root,'app.sqlite')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='';child.stdout.on('data',b=>out+=b);child.on('error',no);child.on('close',code=>code?no(Error('Python bridge failed')):ok(JSON.parse(out)));
  });assert.equal(result.display_name,'中文用户😀');assert.equal(result.created_at,123456);
  await writeFile(join(root,'mysql-active.json'),'{}');await rename(join(root,'secrets/mysql.json'),join(root,'secrets/mysql.disabled.json'));
  assert.throws(()=>new DatabaseSync(join(root,'app.sqlite')),/refusing to recreate SQLite/);
 }finally{db.close();await cleanup();await rm(root,{recursive:true,force:true});}
});
