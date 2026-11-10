import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnPowerShell} from './powershell.mjs';

export async function loadQwenConfig(root,{path=resolve(root,'data/secrets/qwen-tts.json'),ignoreEnvironment=false}={}){
  let value={};
  try{value=JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code!=='ENOENT')throw Error('千问本机配置无法读取，请重新配置。');}
  let apiKey=ignoreEnvironment?undefined:process.env.DASHSCOPE_API_KEY;
  if(!apiKey&&value.encryptedApiKey){
    if(process.platform!=='win32')throw Error('当前密钥由Windows账户保护，请在本机重新配置。');
    apiKey=await new Promise((ok,no)=>{
      const child=spawnPowerShell(['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve(root,'server/read-tts-secret.ps1')],{windowsHide:true,stdio:['pipe','pipe','ignore']});let output='';
      const timer=setTimeout(()=>{child.kill();no(Error('密钥读取超时。'));},5000);
      child.stdout.on('data',v=>{output+=v;if(output.length>8192){child.kill();no(Error('密钥配置无效。'));}});child.on('error',()=>{clearTimeout(timer);no(Error('无法解密本机密钥。'));});child.stdin.on('error',()=>{});
      child.on('close',code=>{clearTimeout(timer);code?no(Error('无法解密本机密钥，请使用配置时的Windows账户。')):ok(output.trim());});child.stdin.end(value.encryptedApiKey);
    });
  }
  if(!apiKey)return null;
  return {apiKey,model:value.model||'qwen3-tts-flash',voice:value.voice||'Cherry'};
}
