import mysql from 'mysql2/promise';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {loadMysqlConfig} from '../../server/mysql-config.mjs';
import {initializeSchema} from '../../server/mysql-schema.mjs';
export async function mysqlTestTrigger(root,name,table,event,drop=false){
 if(!resolve(root).startsWith(resolve('.runtime-logs')+sep)||!['block_cleanup','fail_sample'].includes(name)||!['records','sign_samples'].includes(table)||!['DELETE','INSERT'].includes(event))throw Error('Invalid test trigger');
 const config=await loadMysqlConfig(resolve(root,'secrets/mysql.json'));if(!/^yuqiao_test_[a-f0-9]{16}$/.test(config.database))throw Error('Not a test schema');
 const c=await mysql.createConnection(config);try{await c.query(drop?'DROP TRIGGER '+name:`CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='test_failure'`);}finally{await c.end();}
}
export async function prepareMysqlFixture(root){
 if(process.env.YUQIAO_TEST_MYSQL!=='1')return async()=>{};
 if(!resolve(root).startsWith(resolve('.runtime-logs')+sep))throw Error('Tests must use isolated runtime directory');
 const admin=await loadMysqlConfig(resolve('data/secrets/mysql-admin.json')),database='yuqiao_test_'+randomBytes(8).toString('hex');
 const connection=await mysql.createConnection({...admin,database:undefined});
 try{
  await connection.query('CREATE DATABASE `'+database+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin');await connection.changeUser({database});await initializeSchema(connection);
  const {readFile}=await import('node:fs/promises');const raw=JSON.parse((await readFile('data/secrets/mysql-admin.json','utf8')).replace(/^\uFEFF/,''));
  await mkdir(resolve(root,'secrets'),{recursive:true});await writeFile(resolve(root,'secrets/mysql.json'),JSON.stringify({...raw,database}));
 }finally{await connection.end();}
 return async()=>{const c=await mysql.createConnection({...admin,database:undefined});try{if(!/^yuqiao_test_[a-f0-9]{16}$/.test(database))throw Error('Bad test database');await c.query('DROP DATABASE `'+database+'`');}finally{await c.end();}};
}
