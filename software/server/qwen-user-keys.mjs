import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {protectSecret} from './windows-secret.mjs';
import {loadQwenConfig} from './qwen-tts-config.mjs';

const fail=(message,status=503)=>Object.assign(Error(message),{status});
export class QwenUserKeys{
  constructor(dataDir,{protect=protectSecret,load=loadQwenConfig}={}){this.directory=resolve(dataDir,'secrets/qwen-users');this.protect=protect;this.load=load;this.writing=new Set();}
  path(userId){if(typeof userId!=='string'||!userId)throw fail('请先登录。',401);return resolve(this.directory,createHash('sha256').update(userId).digest('hex')+'.json');}
  async state(userId){try{return JSON.parse(await readFile(this.path(userId),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw fail('音色配置无法读取，请重新保存 API Key。');}}
  async status(userId){const v=await this.state(userId);return {configured:!!v?.encryptedApiKey,disabled:v?.disabled===true,provider:'阿里云百炼',region:'中国内地',model:'qwen3-tts-flash',voice:'Cherry'};}
  async save(userId,apiKey){
    if(typeof apiKey!=='string'||!/^sk-[A-Za-z0-9._-]{12,1020}$/.test(apiKey.trim()))throw fail('请输入有效的百炼中国内地 API Key。',400);
    return this.write(userId,{encryptedApiKey:await this.protect(apiKey.trim()),model:'qwen3-tts-flash',voice:'Cherry'});
  }
  async remove(userId){return this.write(userId,{disabled:true});}
  async write(userId,value){
    const path=this.path(userId);if(this.writing.has(userId))throw fail('配置正在保存，请稍后再试。',409);
    this.writing.add(userId);const temp=path+'.'+randomUUID()+'.tmp';
    try{await mkdir(this.directory,{recursive:true});await writeFile(temp,JSON.stringify(value),{flag:'wx'});await rename(temp,path);return await this.status(userId);}
    finally{this.writing.delete(userId);await unlink(temp).catch(()=>{});}
  }
  async config(root,userId){
    if(!userId)return this.load(root);
    const value=await this.state(userId);
    if(value?.disabled)return null; // Removing a personal key never silently bills the old machine key.
    if(value?.encryptedApiKey)return this.load(root,{path:this.path(userId),ignoreEnvironment:true});
    return this.load(root);
  }
}
