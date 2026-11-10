import {parentPort,workerData} from 'node:worker_threads';
import {serialize} from 'node:v8';
import mysql from 'mysql2/promise';
import {loadMysqlConfig} from './mysql-config.mjs';
import {tables} from './mysql-schema.mjs';
let connection,transaction=false,ownSavepoint=false;
const control=new Int32Array(workerData.buffer,0,2),bytes=new Uint8Array(workerData.buffer,8);
function respond(value){let data=serialize(value);if(data.length>bytes.length)data=serialize({error:'MySQL response exceeds local limit',code:'DB_RESPONSE_LIMIT'});bytes.set(data);Atomics.store(control,1,data.length);Atomics.store(control,0,1);Atomics.notify(control,0);}
function sqlForMysql(sql){return sql.replace(/json_extract\(([^,]+),\s*('[^']+')\)/gi,'JSON_UNQUOTE(JSON_EXTRACT($1,$2))').replace(/ON CONFLICT\([^)]+\) DO UPDATE SET/gi,'ON DUPLICATE KEY UPDATE').replace(/excluded\.(\w+)/gi,'VALUES($1)').replace(/INSERT OR IGNORE/gi,'INSERT IGNORE');}
async function exec(sql){
  for(const raw of sql.split(';')){
    const q=raw.trim();if(!q)continue;
    if(/^PRAGMA (journal_mode|foreign_keys|busy_timeout)\s*=/i.test(q))continue;
    if(/^CREATE (TABLE|INDEX) IF NOT EXISTS /i.test(q)){
      // Schema is provisioned separately, never grant runtime DDL rights.
      if(/^CREATE TABLE/i.test(q)&&!tables.includes(q.match(/^CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1]))throw Error('Unknown schema table');
      continue;
    }
    if(/^BEGIN(?: IMMEDIATE)?$/i.test(q)){if(transaction)throw Error('Nested transaction');await connection.query(workerData.readOnly?'START TRANSACTION READ ONLY':'START TRANSACTION');transaction=true;continue;}
    if(/^SAVEPOINT \w+$/i.test(q)){if(!transaction){await connection.beginTransaction();transaction=true;ownSavepoint=true;}await connection.query(q);continue;}
    if(/^RELEASE \w+$/i.test(q)){await connection.query(q.replace(/^RELEASE /i,'RELEASE SAVEPOINT '));if(ownSavepoint){await connection.commit();transaction=false;ownSavepoint=false;}continue;}
    if(/^ROLLBACK TO \w+$/i.test(q)){await connection.query(q);continue;}
    if(/^(COMMIT|ROLLBACK)$/i.test(q)){await connection.query(q);transaction=false;ownSavepoint=false;continue;}
    throw Error('Unsupported schema or transaction operation');
  }
}
async function query(sql,params,mode){
  const info=/^PRAGMA table_info\((\w+)\)$/i.exec(sql);
  if(info){if(!tables.includes(info[1]))throw Error('Unknown table');const [rows]=await connection.query('SHOW COLUMNS FROM `'+info[1]+'`');return rows.map((r,i)=>({cid:i,name:r.Field,type:r.Type,notnull:r.Null==='NO'?1:0,pk:r.Key==='PRI'?1:0}));}
  if(workerData.readOnly&&!/^SELECT\s/i.test(sql))throw Error('Read-only database');
  if(/RETURNING last_number\s*$/i.test(sql)){
    if(!transaction)throw Error('Counter allocation requires transaction');
    await connection.execute('INSERT INTO sample_number_counters(user_id,category,last_number) VALUES(?,?,1) ON DUPLICATE KEY UPDATE last_number=last_number+1',params);
    const [rows]=await connection.execute('SELECT last_number FROM sample_number_counters WHERE user_id=? AND category=?',params);return rows[0];
  }
  const [rows]=await connection.execute(sqlForMysql(sql),params);
  if(mode==='run')return {changes:rows.affectedRows,lastInsertRowid:rows.insertId};
  return mode==='get'?rows[0]:rows;
}
try{
  connection=await mysql.createConnection(await loadMysqlConfig(workerData.configPath));
  for(const table of tables)await connection.query('SELECT 1 FROM `'+table+'` LIMIT 0');
  if(workerData.readOnly)await connection.query('SET SESSION TRANSACTION READ ONLY');
  respond({ok:true});
}catch(error){respond({error:'MySQL connection/schema unavailable',code:error.code||'DB_INIT_FAILED'});}
parentPort.on('message',async request=>{
  try{
    if(request.op==='close'){await connection?.end();respond({ok:true});parentPort.close();return;}
    if(!connection)throw Error('Database unavailable');
    const result=request.op==='exec'?await exec(request.sql):await query(request.sql,request.params,request.op);
    respond({result});
  }catch(error){respond({error:'MySQL database operation failed',code:error.code||'DB_OPERATION_FAILED'});}
});
