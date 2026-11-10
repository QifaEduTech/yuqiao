import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {SignService} from './sign.mjs';
import {validLiveResult} from '../shared/realtime-result.mjs';

export const liveConfig=JSON.parse(readFileSync(new URL('../shared/realtime-sign.json',import.meta.url),'utf8'));
export const liveTargets=JSON.parse(readFileSync(new URL('../shared/realtime-targets.json',import.meta.url),'utf8'));
const helpRuntime=JSON.parse(readFileSync(new URL('../shared/help-runtime.json',import.meta.url),'utf8'));
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function validateLiveJpeg(buffer){
  if(buffer.length<4||buffer.length>liveConfig.maxJpegBytes||buffer[0]!==255||buffer[1]!==216)throw fail(415,'实时画面格式或大小无效。');
  let i=2;
  while(i+3<buffer.length){
    if(buffer[i++]!==255)throw fail(415,'实时画面格式无效。');
    while(buffer[i]===255)i++;
    const marker=buffer[i++];if(marker===217||marker===218)break;
    if(marker===1||marker>=208&&marker<=215)continue;
    if(i+2>buffer.length)break;const length=buffer.readUInt16BE(i);
    if(length<2||i+length>buffer.length)break;
    if([192,193,194].includes(marker)){
      if(length<8)break;const height=buffer.readUInt16BE(i+3),width=buffer.readUInt16BE(i+5);
      if(Math.min(width,height)<16||Math.max(width,height)>liveConfig.maxImageEdge)throw fail(413,'实时画面尺寸过大。');return {width,height};
    }
    i+=length;
  }
  throw fail(415,'无法读取实时画面尺寸。');
}

export class RealtimeSignService{
  constructor(root){this.root=root;this.runtime=new SignService(root);this.active=null;}
  status(){return {available:this.runtime.installed(),busy:!!this.active,protocol:liveConfig.protocol,labels:Object.values(liveTargets).map(x=>x.text),experimental:true,recording:false,meCheck:this.active&&Date.now()-this.active.lastSeen<750?this.active.lastMeCheck??null:null};}
  owned(token){if(typeof token!=='string'||!this.active||this.active.token!==token)throw fail(404,'实时会话已结束，请重新开启。');return this.active;}
  async start(signal,target='auto',helpEngine=helpRuntime.defaultEngine,{models=[],ownerId=null}={}){
    if(!['auto','thanks','help'].includes(target))throw fail(400,'不支持这个实时试验动作。');
    if(target==='auto'&&helpEngine!=='video-tcn')throw fail(400,'自动识别使用当前已接入的模型。');
    if(!helpRuntime.engines.includes(helpEngine))throw fail(400,'不支持这个帮助版本。');
    if(this.active)throw fail(429,'另一个窗口正在使用实时识别，请先停止。');
    if(!this.runtime.installed())throw fail(503,'本机识别环境尚未就绪。');
    if(signal?.aborted)throw fail(499,'开启已取消。');
    const session={ownerId,models,actions:[...Object.values(liveTargets),...models],target,helpEngine:target==='help'||target==='auto'?helpEngine:null,token:randomBytes(32).toString('base64url'),child:null,pending:null,buffer:'',ready:false,lastSeq:0,lastTimestamp:-1,lastSeen:Date.now(),frames:0,lastEventId:0,lastEventEnd:-1};this.active=session;
    const directory=resolve(this.root,'.runtime-logs/realtime-tmp');
    try{
      await mkdir(directory,{recursive:true});
      if(signal?.aborted||this.active!==session)throw fail(499,'开启已取消。');
      const child=spawn(this.runtime.python(),['-B','-u',resolve(this.root,'server/realtime_worker.py'),'--target',target,'--help-engine',helpEngine,'--trained-models',JSON.stringify(models)],{cwd:this.root,env:this.runtime.workerEnvironment(directory),windowsHide:true,stdio:['pipe','pipe','ignore']});session.child=child;
      session.readyPromise=new Promise((resolveReady,reject)=>{session.resolveReady=resolveReady;session.rejectReady=reject;});
      child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
        if(this.active!==session)return;session.buffer+=chunk;
        if(session.buffer.length>65536)return this.end(session,fail(503,'实时进程返回异常。'));
        let index;while((index=session.buffer.indexOf('\n'))>=0){const line=session.buffer.slice(0,index);session.buffer=session.buffer.slice(index+1);try{this.receive(session,JSON.parse(line));}catch{this.end(session,fail(503,'实时进程返回异常。'));break;}}
      });
      child.on('error',()=>this.end(session,fail(503,'实时进程未能启动。')));child.stdin.on('error',()=>this.end(session,fail(503,'实时连接已中断。')));child.on('close',()=>this.end(session,fail(503,'实时进程已退出，请重新开启。')));
      const cancel=()=>this.end(session,fail(499,'开启已取消。'));signal?.addEventListener('abort',cancel,{once:true});
      const timeout=setTimeout(()=>this.end(session,fail(504,'实时服务准备超时，请重试。')),liveConfig.startupTimeoutMs);
      try{await session.readyPromise;if(signal?.aborted||this.active!==session)throw fail(499,'开启已取消。');}
      finally{clearTimeout(timeout);signal?.removeEventListener('abort',cancel);}
      session.idle=setInterval(()=>{if(Date.now()-session.lastSeen>liveConfig.sessionIdleMs)this.end(session,fail(408,'实时会话因闲置已结束。'));},2000);session.idle.unref();
      return {session:session.token,target,helpEngine:session.helpEngine,modelVersion:session.helpEngine==='video-tcn'?'v1':null,targetText:liveTargets[target]?.text??null,targetSignId:liveTargets[target]?.signId??null,supportedActions:session.actions.map(x=>({text:x.text,signId:x.signId})),protocol:liveConfig.protocol,frameIntervalMs:liveConfig.frameIntervalMs,maxImageEdge:liveConfig.maxImageEdge};
    }catch(error){this.end(session,error);throw error;}
  }
  receive(session,message){
    if(message.type==='error')return this.end(session,fail(503,'实时处理失败，请停止后重新开启。'));
    if(message.type==='ready'&&!session.ready){if(message.protocol!==liveConfig.protocol||message.target!==session.target||message.helpEngine!==session.helpEngine)throw Error('Protocol mismatch');session.ready=true;session.lastSeen=Date.now();session.resolveReady();return;}
    const pending=session.pending;
    const target=session.target==='auto'?{text:(session.actions??Object.values(liveTargets)).map(x=>x.text),signId:(session.actions??Object.values(liveTargets)).map(x=>x.signId)}:liveTargets[session.target??'thanks'];
    if((session.target==='help'||session.target==='auto')&&message.helpEngine!==session.helpEngine)throw Error('Invalid live response: help engine');
    if(message.type!=='frame'||!pending||message.seq!==pending.seq||!validLiveResult(message,target.text,target.signId,liveConfig.maxSamples))throw Error('Invalid live response');
    if(message.event){
      if(message.event.id!==session.lastEventId+1||message.event.startMs<=session.lastEventEnd||message.event.endMs>Math.round(session.lastTimestamp))throw Error('Invalid event order');
      session.lastEventId=message.event.id;session.lastEventEnd=message.event.endMs;
    }
    session.lastMeCheck=message.meCheck??null;session.pending=null;session.frames++;session.lastSeen=Date.now();pending.resolve({...message,frames:session.frames,experimental:true});
  }
  async frame(token,buffer,seq,timestampMs,signal){
    const session=this.owned(token);
    if(!session.ready)throw fail(409,'实时服务尚未准备好。');
    if(session.pending)throw fail(429,'上一帧尚未处理完成，请等待。');
    if(!Number.isSafeInteger(seq)||seq<=session.lastSeq||!Number.isFinite(timestampMs)||timestampMs<=session.lastTimestamp||timestampMs<0||timestampMs>86400000)throw fail(409,'画面时间顺序异常，请重新开启。');
    validateLiveJpeg(buffer);if(signal?.aborted)throw fail(499,'画面处理已取消。');
    session.lastSeq=seq;session.lastTimestamp=timestampMs;session.lastSeen=Date.now();
    let timeout;const abort=()=>this.end(session,fail(499,'画面处理已取消。'));
    try{return await new Promise((resolveFrame,reject)=>{
      session.pending={seq,resolve:resolveFrame,reject};signal?.addEventListener('abort',abort,{once:true});
      timeout=setTimeout(()=>this.end(session,fail(504,'实时处理超时，请重新开启。')),liveConfig.frameTimeoutMs);
      session.child.stdin.write(JSON.stringify({seq,timestampMs,jpeg:buffer.toString('base64')})+'\n');
    });}finally{clearTimeout(timeout);signal?.removeEventListener('abort',abort);}
  }
  end(session,error=fail(499,'实时会话已停止。')){
    if(this.active!==session)return;
    this.active=null;clearInterval(session.idle);session.buffer='';
    if(!session.ready)session.rejectReady?.(error);
    session.pending?.reject(error);session.pending=null;session.child?.kill();
  }
  stop(token){const session=this.owned(token);this.end(session);return {ok:true};}
  close(){if(this.active)this.end(this.active);}
}
