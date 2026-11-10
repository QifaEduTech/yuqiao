import {readFile} from 'node:fs/promises';
import {spawnPowerShell} from './powershell.mjs';
import {fileURLToPath} from 'node:url';
const secretReader=fileURLToPath(new URL('./read-tts-secret.ps1',import.meta.url));
export async function loadMysqlConfig(path){
  const config=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
  if(config.host!=='127.0.0.1'||!Number.isInteger(config.port)||!/^yuqiao(?:_test_[a-f0-9]+)?$/.test(config.database)||typeof config.user!=='string')throw Error('Invalid local MySQL configuration');
  const password=await new Promise((resolve,reject)=>{
    const child=spawnPowerShell(['-NoProfile','-NonInteractive','-File',secretReader],{windowsHide:true,stdio:['pipe','pipe','ignore']});let out='';
    const timer=setTimeout(()=>{child.kill();reject(Error('MySQL secret timeout'));},5000);
    child.stdout.on('data',chunk=>{out+=chunk;if(out.length>8192)child.kill();});child.stdin.on('error',()=>{});
    child.on('error',()=>{clearTimeout(timer);reject(Error('MySQL secret unavailable'));});
    child.on('close',code=>{clearTimeout(timer);code?reject(Error('MySQL secret unavailable')):resolve(out.trim());});child.stdin.end(config.encryptedPassword);
  });
  return {host:config.host,port:config.port,user:config.user,password,database:config.database,charset:'utf8mb4_bin',decimalNumbers:true,supportBigNumbers:true,bigNumberStrings:false,connectTimeout:5000,multipleStatements:false};
}
