import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import config from '../../shared/realtime-sign.json';
import {validLiveResult} from '../../shared/realtime-result.mjs';
import type {HandTracking} from './RealtimeSkeleton';
import targets from '../../shared/realtime-targets.json';

type WordEvent={id:number;signId:string;text:string;startMs:number;endMs:number};
export type MeCheck={bodyVisible:boolean;chestReferenced?:boolean;frameSupported:boolean;stableSupported:boolean;modelScore:number|null;hands:{indexAngle:number|null;indexAngle2d?:number|null;indexExtended:boolean;indexPointing?:boolean;recedingIndex?:boolean;indexDepthFraction?:number|null;otherFingersFolded:boolean;towardChest?:boolean;nearBody:boolean;chestCosine?:number|null;shoulderCosine?:number|null;tipDistance?:number|null}[]};
type Result={meCheck?:MeCheck|null;seq:number;status:'waiting'|'observing'|'candidate'|'uncertain';candidate:string|null;reason:string;processingMs:number;samples:number;handSamples:number;frames:number;event:WordEvent|null;eventState:string;handTracking?:HandTracking;helpScore?:number|null;helpEngine?:string;modelVersion?:string|null;motionSupported?:boolean|null;motionGuard?:string|null};
export function useRealtimeSign(){
  const video=useRef<HTMLVideoElement>(null),streamRef=useRef<MediaStream|null>(null),session=useRef<string|null>(null),controller=useRef<AbortController|null>(null),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),canvas=useRef<HTMLCanvasElement|null>(null),starting=useRef(false);
  const [phase,setPhase]=useState<'idle'|'permission'|'warming'|'running'|'error'>('idle'),[stream,setStream]=useState<MediaStream|null>(null),[result,setResult]=useState<Result|null>(null),[message,setMessage]=useState(''),[metrics,setMetrics]=useState({frames:0,fps:0,latencyMs:0});
  const [events,setEvents]=useState<WordEvent[]>([]);
  const stop=useCallback((text='已停止摄像头，实时画面未保存。')=>{
    generation.current++;starting.current=false;controller.current?.abort();controller.current=null;if(timer.current)clearTimeout(timer.current);timer.current=null;
    streamRef.current?.getTracks().forEach(t=>t.stop());streamRef.current=null;setStream(null);if(video.current)video.current.srcObject=null;
    if(canvas.current){canvas.current.width=0;canvas.current.height=0;}canvas.current=null;
    const token=session.current;session.current=null;if(token)void api('/api/sign/realtime/sessions',{method:'DELETE',headers:{'X-Yuqiao-Live-Session':token},keepalive:true}).catch(()=>{});
    setResult(null);setEvents([]);setPhase('idle');setMessage(text);setMetrics({frames:0,fps:0,latencyMs:0});
  },[]);
  useEffect(()=>{if(video.current){video.current.srcObject=stream;if(stream)void video.current.play().catch(()=>{});}},[stream]);
  useEffect(()=>{const hide=()=>{if(document.hidden)stop('页面已切到后台，摄像头已停止。');};const leave=()=>stop('');document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);stop('');};},[stop]);
  async function start(){
    if(starting.current||session.current)return;
    stop('');starting.current=true;const epoch=generation.current;const current=new AbortController();controller.current=current;setPhase('permission');
    let startupTimer:ReturnType<typeof setTimeout>|undefined;
    const active=()=>epoch===generation.current&&!current.signal.aborted;
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw Error('当前页面无法访问摄像头，请使用本机地址或HTTPS。');
      const camera=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});
      if(!active()){camera.getTracks().forEach(t=>t.stop());return;}
      streamRef.current=camera;setStream(camera);setPhase('warming');
      camera.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(active())stop('摄像头已断开，请重新开启。');}));
      startupTimer=setTimeout(()=>{if(active()){stop('服务准备超时，请重试。');setPhase('error');}},config.startupTimeoutMs+5000);
      let expected=Object.values(targets).map(x=>({text:x.text,signId:x.signId}));
      const ready=await api<{session:string;protocol:number;frameIntervalMs:number;maxImageEdge:number;target?:string;targetText?:string;targetSignId?:string;helpEngine?:string;modelVersion?:string|null;supportedActions?:{text:string;signId:string}[]}>('/api/sign/realtime/sessions',{method:'POST',body:JSON.stringify({target:'auto'}),signal:current.signal});
      if(!active()){void api('/api/sign/realtime/sessions',{method:'DELETE',headers:{'X-Yuqiao-Live-Session':ready.session},keepalive:true}).catch(()=>{});return;}
      session.current=ready.session;

      if(ready.protocol!==config.protocol)throw Error('实时服务版本已变化，请刷新页面。');
      if(ready.target!=='auto'||ready.helpEngine!=='video-tcn'||!Array.isArray(ready.supportedActions)||ready.supportedActions.length<expected.length||expected.some(action=>!ready.supportedActions!.some(x=>x.text===action.text&&x.signId===action.signId)))throw Error('自动识别版本不匹配，请刷新页面。');
      expected=ready.supportedActions!;
      clearTimeout(startupTimer);starting.current=false;setPhase('running');setMessage('');canvas.current=document.createElement('canvas');
      const started=performance.now();let seq=0,waitingSince=started,lastEventId=0,lastEventEnd=-1;
      const loop=async()=>{
        if(!active())return;const began=performance.now();
        try{
          const el=video.current,surface=canvas.current;if(!el||!surface)return;
          if(el.readyState<2||!el.videoWidth){if(began-waitingSince>5000)throw Error('摄像头画面暂不可读，请重新开启。');timer.current=setTimeout(()=>void loop(),100);return;}
          waitingSince=began;
          const scale=Math.min(1,config.maxImageEdge/Math.max(el.videoWidth,el.videoHeight));surface.width=Math.round(el.videoWidth*scale);surface.height=Math.round(el.videoHeight*scale);
          const context=surface.getContext('2d');if(!context)throw Error('浏览器无法读取摄像头画面。');context.drawImage(el,0,0,surface.width,surface.height);
          const blob=await new Promise<Blob|null>(resolve=>surface.toBlob(resolve,'image/jpeg',.72));if(!active())return;if(!blob)throw Error('读取画面失败，请重试。');
          const captureMs=began-started,frameSeq=++seq;
          const timeout=setTimeout(()=>{if(active()){stop('实时处理响应超时，请重新开启。');setPhase('error');}},config.frameTimeoutMs+3000);
          let next:Result;
          try{next=await api<Result>('/api/sign/realtime/frames',{method:'POST',headers:{'Content-Type':'image/jpeg','X-Yuqiao-Live-Session':ready.session,'X-Yuqiao-Frame-Seq':String(frameSeq),'X-Yuqiao-Capture-Ms':captureMs.toFixed(2)},body:blob,signal:current.signal});}finally{clearTimeout(timeout);}
          if(!active())return;
          if(next.helpEngine!==undefined&&next.helpEngine!=='video-tcn')throw Error('自动识别结果版本不匹配，请重新开启。');
          if(next.seq!==frameSeq||!validLiveResult(next,expected.map(x=>x.text),expected.map(x=>x.signId),config.maxSamples))throw Error('实时结果不匹配，请重新开启。');
          if(next.event){
            const word=next.event;
            if(word.id!==lastEventId+1||word.startMs<=lastEventEnd||word.endMs>Math.round(captureMs))throw Error('实时结果不匹配，请重新开启。');
            lastEventId=word.id;lastEventEnd=word.endMs;
            setEvents(previous=>[...previous,word].slice(-config.events.maxDisplayedEvents));
          }
          setResult(next);setMetrics({frames:seq,fps:Number((seq/Math.max(.1,(performance.now()-started)/1000)).toFixed(1)),latencyMs:Math.round(performance.now()-began)});
          // Only schedule the next fresh capture after the current response. No frame queue.
          timer.current=setTimeout(()=>void loop(),Math.max(0,config.frameIntervalMs-(performance.now()-began)));
        }catch(error){if(active()){stop(error instanceof Error?error.message:'实时连接中断，请重新开启。');setPhase('error');}}
      };
      void loop();
    }catch(error){if(active()){const name=error instanceof DOMException?error.name:'';stop(name==='NotAllowedError'?'摄像头权限未获允许，请在地址栏检查权限。':name==='NotFoundError'?'没有找到摄像头，请检查设备。':error instanceof Error?error.message:'无法开启实时处理。');setPhase('error');}}
    finally{clearTimeout(startupTimer);if(epoch===generation.current)starting.current=false;}
  }
  return {video,stream,phase,result,message,metrics,events,start,stop};
}
