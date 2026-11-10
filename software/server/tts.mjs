import {loadQwenConfig} from './qwen-tts-config.mjs';
const fail=(message,status=503)=>Object.assign(new Error(message),{status});
export const QWEN_ENDPOINT='https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
const MAX_AUDIO=10*1024*1024;
export function audioUrl(value){
  let url;try{url=new URL(value);}catch{throw fail('千问未返回有效音频地址。');}
  // Upgrade only the official Beijing result bucket; never forward API credentials.
  if(!['http:','https:'].includes(url.protocol)||url.hostname!=='dashscope-result-bj.oss-cn-beijing.aliyuncs.com'||url.port||url.username||url.password)throw fail('千问音频来源未通过检查。');
  url.protocol='https:';return url.href;
}
async function bounded(response,limit){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw fail('语音响应过大，请缩短文字。',413);}
  const reader=response.body?.getReader();if(!reader)throw fail('千问返回了空响应。');
  let size=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw fail('语音响应过大，请缩短文字。',413);}chunks.push(value);}}finally{reader.releaseLock();}
  return Buffer.concat(chunks,size);
}
export class TtsService {
  constructor(root,{fetchImpl=globalThis.fetch,configLoader=loadQwenConfig,timeoutMs=30000}={}){this.root=root;this.fetch=fetchImpl;this.load=configLoader;this.timeoutMs=timeoutMs;this.busy=false;this.active=null;}
  async config(userId){
    if(process.env.YUQIAO_DISABLE_CLOUD_TTS==='1')return null;
    try{return await this.load(this.root,userId);}catch{throw fail('千问密钥配置无法读取，请在账号设置中重新配置。');}
  }
  async status(userId){
    const base={provider:'dashscope',region:'cn-beijing',local:false,busy:this.busy};
    try{const c=await this.config(userId);return {...base,available:!!c,voice:c?`千问 · ${c.voice}`:'',model:c?.model,reason:c?undefined:'请登录后在账号设置中填写千问 API Key。',note:'播报文字发送至阿里云百炼；本项目不保存合成音频。'};}
    catch(e){return {...base,available:false,reason:e.message};}
  }
  async synthesize({text,confirmed,revision},signal,userId){
    if(confirmed!==true)throw fail('请先核对并确认播报文字。',400);
    if(typeof text!=='string'||!text.trim()||text.length>500||!Number.isSafeInteger(revision)||revision<0)throw fail('请提供不超过 500 字的已确认文字及有效版本。',400);
    if(signal?.aborted)throw fail('语音生成已取消。',499);
    if(this.busy)throw fail('另一段语音正在生成，请稍后重试。',429);
    this.busy=true;this.activeUser=userId;const started=Date.now(),controller=new AbortController();this.active=controller;
    const combined=AbortSignal.any([controller.signal,...(signal?[signal]:[])]);
    let timedOut=false;const timer=setTimeout(()=>{timedOut=true;controller.abort();},this.timeoutMs);
    try{
      const config=await this.config(userId);if(!config)throw fail('请登录后在账号设置中填写千问 API Key。');combined.throwIfAborted();
      const response=await this.fetch(QWEN_ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:config.model,input:{text:text.trim(),voice:config.voice,language_type:'Chinese'}}),signal:combined,redirect:'error'});
      if(!response.ok){await response.body?.cancel();throw fail(response.status===429?'千问请求频繁或额度不足，请稍后重试。':[401,403].includes(response.status)?'千问密钥或模型权限不可用，请检查百炼配置。':'千问语音服务暂不可用，请稍后重试。',response.status===429?429:503);}
      let result;try{result=JSON.parse((await bounded(response,64*1024)).toString('utf8'));}catch(e){if(e.status)throw e;throw fail('千问返回了无效语音结果。');}
      if(result.code)throw fail('千问未能生成语音，请检查模型及服务额度。');
      const url=audioUrl(result.output?.audio?.url);combined.throwIfAborted();
      const audio=await this.fetch(url,{signal:combined,redirect:'error'});
      if(!audio.ok){await audio.body?.cancel();throw fail('千问音频读取失败，请重试。');}
      const bytes=await bounded(audio,MAX_AUDIO);combined.throwIfAborted();
      if(bytes.length<44||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw fail('千问音频格式无效，文字已保留。');
      return {audio:bytes.toString('base64'),mime:'audio/wav',voice:`千问 · ${config.voice}`,text:text.trim(),revision,processing_ms:Date.now()-started,voice_version:`dashscope:${config.model}:${config.voice}`};
    }catch(e){
      if(combined.aborted)throw fail(timedOut?'千问语音生成超时，请重试。':'语音生成已取消。',timedOut?504:499);
      if(e.status)throw e;
      throw fail('无法连接千问语音服务，请检查网络后重试。');
    }finally{clearTimeout(timer);this.busy=false;this.active=null;this.activeUser=undefined;}
  }
  cancelUser(userId){if(this.activeUser===userId)this.active?.abort();}
  close(){this.active?.abort();}
}
