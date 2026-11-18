function delay(ms:number,signal:AbortSignal){return new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,ms);signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();});}
/** Same-account SSE with reconnect and cancellation. No pairing identity required. */
export async function readDisplayStream(signal:AbortSignal,onEvent:(event:string,data:unknown)=>void,onStatus:(status:'connecting'|'ready'|'offline')=>void){
 while(!signal.aborted){
  onStatus('connecting');
  try{
   const response=await fetch('/api/display/stream',{credentials:'same-origin',cache:'no-store',signal});
   if(response.status===401){onEvent('session-expired',{});return;}
   if(!response.ok||!response.body)throw Error('stream unavailable');onStatus('ready');
   const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
   try{while(!signal.aborted){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true}).replace(/\r\n/g,'\n');if(buffer.length>65536)throw Error('stream too large');let end;
    while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const lines=block.split('\n'),event=lines.find(l=>l.startsWith('event:'))?.slice(6).trim(),data=lines.filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(event&&data){try{onEvent(event,JSON.parse(data));}catch{/* Malformed event ignored. */}}}
   }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }catch{if(signal.aborted)return;}
  if(!signal.aborted){onStatus('offline');await delay(2500,signal);}
 }
}
