import mysql from 'mysql2/promise';
import {DatabaseSync,backup} from 'node:sqlite';
import {writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {loadMysqlConfig} from '../server/mysql-config.mjs';
import {initializeSchema,tables} from '../server/mysql-schema.mjs';
const root=resolve('data'),reportPath=resolve(root,'maintenance/mysql-migration.json');
const digest=rows=>createHash('sha256').update(JSON.stringify(rows.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).digest('hex');
export async function encryptSecret(value){return await new Promise((ok,no)=>{
  const child=spawn('pwsh',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; $v=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; [Console]::Out.Write((ConvertFrom-SecureString $v)); $v.Dispose()"],{windowsHide:true,stdio:['pipe','pipe','ignore']});let output='';const timer=setTimeout(()=>{child.kill();no(Error('Secret encryption timeout'));},5000);
  child.stdout.on('data',s=>output+=s);child.stdin.on('error',()=>{});child.on('error',()=>{clearTimeout(timer);no(Error('Secret encryption failed'));});child.on('close',code=>{clearTimeout(timer);code?no(Error('Secret encryption failed')):ok(output.trim());});child.stdin.end(value);
});}
async function main(){
 const mode=process.argv[2];if(!['--prepare','--verify'].includes(mode))throw Error('Use --prepare or --verify; never delete the source in this tool.');
 const config=await loadMysqlConfig(resolve(root,'secrets/mysql-admin.json'));
 const connection=await mysql.createConnection({...config,database:undefined});
 const source=new DatabaseSync(resolve(root,'app.sqlite'),{readOnly:true});
 try{
  source.exec('BEGIN');const actual=source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name).sort();
  if(JSON.stringify(actual)!==JSON.stringify([...tables].sort()))throw Error('Unexpected source tables; migration refused');
  const snapshots=Object.fromEntries(tables.map(t=>[t,source.prepare('SELECT * FROM '+t).all()]));
  if(mode==='--prepare'){
   const [existing]=await connection.execute('SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME=?',['yuqiao']);if(existing.length)throw Error('yuqiao already exists; refusing overwrite');
   await mkdir(resolve(root,'maintenance'),{recursive:true});
   const backupPath=resolve(root,'maintenance/pre-mysql.sqlite');if(existsSync(backupPath))throw Error('Migration backup already exists');
   await backup(source,backupPath);
   await connection.query('CREATE DATABASE `yuqiao` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin');await connection.changeUser({database:'yuqiao'});await initializeSchema(connection);
   await connection.beginTransaction();
   try{for(const table of tables)for(const row of snapshots[table]){const columns=Object.keys(row);await connection.execute('INSERT INTO `'+table+'` ('+columns.map(c=>'`'+c+'`').join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')',Object.values(row));}await connection.commit();}catch(e){await connection.rollback();throw e;}
   const user='yuqiao_app_'+randomBytes(4).toString('hex'),password=randomBytes(32).toString('base64url');
   await connection.query('CREATE USER ?@? IDENTIFIED BY ?',[user,'127.0.0.1',password]);await connection.query('GRANT SELECT,INSERT,UPDATE,DELETE ON `yuqiao`.* TO ?@?',[user,'127.0.0.1']);
   await writeFile(resolve(root,'secrets/mysql.pending.json'),JSON.stringify({host:'127.0.0.1',port:config.port,user,database:'yuqiao',encryptedPassword:await encryptSecret(password)},null,2));
  }else await connection.changeUser({database:'yuqiao'});
  const result=[];
  for(const table of tables){const [rows]=await connection.query('SELECT * FROM `'+table+'`');const hash=digest(snapshots[table]);result.push({table,sourceCount:snapshots[table].length,targetCount:rows.length,sourceHash:hash,targetHash:digest(rows),match:hash===digest(rows)});}
  if(result.some(r=>!r.match))throw Error('Migration content mismatch; source must be retained');
  const report={schemaVersion:1,verifiedAt:new Date().toISOString(),database:'yuqiao',tables:result,matching:true,sourceRemoved:false,mediaMoved:false};await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({matching:true,tables:result.map(({table,sourceCount})=>({table,rows:sourceCount})),totalRows:result.reduce((n,r)=>n+r.sourceCount,0)}));
 }finally{source.close();await connection.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
