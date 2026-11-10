import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {unlink} from 'node:fs/promises';
import {prepareMysqlFixture} from '../tests/server/mysql-fixture.mjs';
process.env.YUQIAO_TEST_MYSQL='1';
const root=resolve('.runtime-logs/e2e-data');const cleanup=await prepareMysqlFixture(root);
try{
 const code=await new Promise((ok,no)=>{const child=spawn(process.execPath,['scripts/run-local.mjs','test',...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});child.on('error',no);child.on('exit',ok);});process.exitCode=code||0;
}finally{await cleanup();await unlink(resolve(root,'secrets/mysql.json'));}
