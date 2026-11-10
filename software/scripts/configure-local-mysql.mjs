import {mkdir,readFile,writeFile,unlink,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import mysql from 'mysql2/promise';
import {protectSecret} from '../server/windows-secret.mjs';
import {tables} from '../server/mysql-schema.mjs';

export function validateLocalConnection(value){
  if(!value || value.host!=='127.0.0.1' || value.database!=='yuqiao' ||
     !Number.isInteger(value.port) || value.port<1 || value.port>65535 ||
     typeof value.user!=='string' || !value.user.trim() || value.user.length>128 ||
     typeof value.password!=='string' || !value.password || value.password.length>4096)
    throw Error('Use local MySQL, database yuqiao, a valid port and your own credentials.');
  return {host:value.host,port:value.port,user:value.user.trim(),password:value.password,database:value.database};
}

export async function configureLocalMysql(input,{root,connect=mysql.createConnection,protect=protectSecret}){
  const settings=validateLocalConnection(input);
  const directory=resolve(root,'data/secrets'),file=resolve(directory,'mysql.json');
  try{await access(file);throw Error('Existing MySQL configuration retained; no overwrite performed.');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  // Configuration checks only: never creates tables, changes rows or grants permissions.
  const connection=await connect({...settings,connectTimeout:5000,multipleStatements:false});
  try{for(const table of tables)await connection.query(`SELECT 1 FROM \`${table}\` LIMIT 0`);}
  finally{await connection.end();}
  const encryptedPassword=await protect(settings.password);
  await mkdir(directory,{recursive:true});
  await writeFile(file,JSON.stringify({host:settings.host,port:settings.port,user:settings.user,database:settings.database,encryptedPassword},null,2),{flag:'wx'});
  try{await writeFile(resolve(root,'data/mysql-active.json'),JSON.stringify({engine:'mysql',database:'yuqiao',configuredAt:new Date().toISOString()}),{flag:'wx'});}
  catch(e){if(e.code!=='EEXIST'){await unlink(file);throw e;}}
  return {database:'yuqiao',checkedTables:tables.length,credentialStorage:'Windows DPAPI',dataChanged:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.platform!=='win32')throw Error('This configuration entry requires Windows DPAPI.');
    let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>16384)throw Error('Configuration input too large.');}
    const result=await configureLocalMysql(JSON.parse(input.replace(/^\uFEFF/,'')),{root:fileURLToPath(new URL('../',import.meta.url))});
    console.log(JSON.stringify(result));
  }catch(error){
    // Database errors can embed connection details; never print their full message.
    console.error('MySQL configuration not saved. Check local service, your credentials, the 10-table schema, and existing configuration. No database data was changed.');
    process.exitCode=1;
  }
}
