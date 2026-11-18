import {createHash} from 'node:crypto';
import {resolveInputPreview} from '../shared/sign-preview.mjs';
const fail=(status,message)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);

/** Same-account live display channel. No device registration, code or binding. */
export class DisplayChannel{
 constructor({now=Date.now}={}){this.now=now;this.clients=new Map();this.commands=new Map();}
 emit(client,event,data){if(client.res.destroyed||client.res.writableEnded)return false;try{if(client.res.writableLength>65536){client.res.destroy();return false;}client.res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');return true;}catch{return false;}}
 disconnect(client,event){if(event)this.emit(client,event,{});clearInterval(client.timer);const clients=this.clients.get(client.owner);clients?.delete(client);if(!clients?.size)this.clients.delete(client.owner);client.res.end();}
 online(owner){const result=[];for(const c of [...(this.clients.get(owner)||[])]){let authorized=false;try{authorized=c.authorized();}catch{}if(!authorized||c.res.destroyed||c.res.writableEnded)this.disconnect(c,'session-expired');else result.push(c);}return result;}
 status(owner){return {connected:this.online(owner).length};}
 connect(owner,res,authorized,sessionKey){
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  const client={owner,res,authorized,sessionKey,timer:null},clients=this.clients.get(owner)||new Set();clients.add(client);this.clients.set(owner,clients);this.emit(client,'state',{connected:true});
  client.timer=setInterval(()=>{if(this.online(owner).includes(client))this.emit(client,'state',{connected:true});},15000);client.timer.unref?.();
  const close=()=>{clearInterval(client.timer);const current=this.clients.get(owner);current?.delete(client);if(!current?.size)this.clients.delete(owner);};res.on('close',close);res.on('error',close);
 }
 revokeSession(key){for(const clients of [...this.clients.values()])for(const c of [...clients])if(c.sessionKey===key)this.disconnect(c,'session-expired');}
 canonical(body,catalog){
  const hasControl=Object.hasOwn(body,'control'),hasPreview=Object.hasOwn(body,'preview');
  if(Object.hasOwn(body,'sceneId')||Object.hasOwn(body,'playlist')||Number(hasControl)+Number(hasPreview)!==1)throw fail(400,'请提供一个动作或播放控制。');
  if(hasControl){if(!['play','pause','replay'].includes(body.control))throw fail(400,'动作控制无效。');return {control:body.control};}
  const p=body.preview;if(p===null)return {preview:null};
  if(!p||typeof p!=='object'||p.status!=='authored_unverified')throw fail(400,'动作指令无效。');
  const steps=p.kind==='sequence'?p.steps:[p];if(!Array.isArray(steps)||!steps.length||steps.length>10)throw fail(400,'动作数量无效。');
  const entries=steps.map(step=>catalog.entries.find(e=>e.id===step?.id&&e.version===step?.version));if(entries.some(e=>!e))throw fail(400,'动作或版本不存在。');
  const canonical=resolveInputPreview(entries.map(e=>e.label).join('')).preview;
  if(!canonical||canonical.kind==='sequence'&&canonical.duration>30)throw fail(400,'动作资源不可用或时长过长。');
  return {preview:canonical};
 }
 command(owner,body,catalog){
  if(!uuid(body?.commandId))throw fail(400,'指令编号无效，请刷新正常端。');
  for(const [id,c] of this.commands)if(c.expiresAt<=this.now())this.commands.delete(id);
  const payload=this.canonical(body,catalog),key=owner+':'+body.commandId,fingerprint=hash(JSON.stringify(payload)),previous=this.commands.get(key);
  if(previous){if(previous.fingerprint!==fingerprint)throw fail(409,'同一指令编号不能用于不同内容。');return {...previous.result,duplicate:true};}
  const result={commandId:body.commandId,delivered:0,duplicate:false};
  for(const client of this.online(owner))if(this.emit(client,'command',{...payload,commandId:body.commandId,sentAt:this.now()}))result.delivered++;
  this.commands.set(key,{fingerprint,result,expiresAt:this.now()+300000});while(this.commands.size>2048)this.commands.delete(this.commands.keys().next().value);
  return result;
 }
 close(){for(const clients of [...this.clients.values()])for(const c of [...clients])this.disconnect(c);this.commands.clear();}
}
