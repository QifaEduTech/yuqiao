import {useCallback,useEffect,useRef,useState} from 'react';
import {publicAsset} from './assetUrl';
import type {HandTracking} from './RealtimeSkeleton';
import realtimeConfig from '../../shared/realtime-sign.json';
type WordEvent={id:number;text:string;signId:string;startMs:number;endMs:number};
type Recognition={candidate:string|null;event:WordEvent|null;eventState:string;reason:string};
type Result={seq:number;handTracking:HandTracking;shoulders:[number,number][];processingMs:number;recognition?:Recognition;featureSummary?:{dimensions:number[];samples:number;handPresent:boolean;bodyReference:boolean;directionHistory:boolean}};
const words:Record<string,string>={'谢谢':'csl.thanks','帮助':'csl.ref.bmcx.1900','需要':'csl.ref.bmcx.1874','我':'csl.me'};
const validRecognition=(r:Recognition)=>r&&(r.candidate===null||Object.hasOwn(words,r.candidate))&&typeof r.reason==='string'&&['collecting','ready_to_finish','reset_required','ending','waiting','emitted'].includes(r.eventState)&&(r.event===null||(r.event&&Object.hasOwn(words,r.event.text)&&words[r.event.text]===r.event.signId));
const point=(p:unknown)=>Array.isArray(p)&&p.length===2&&p.every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=-1&&v<=2);
function validFrame(data:Result){const t=data.handTracking;return !!t&&t.mirrored===true&&Number.isInteger(t.width)&&Number.isInteger(t.height)&&t.width>=16&&t.height>=16&&t.width<=640&&t.height<=640&&Array.isArray(t.hands)&&t.hands.length<=2&&t.hands.every(h=>['Left','Right'].includes(h.side)&&Array.isArray(h.points)&&h.points.length===21&&h.points.every(point))&&Array.isArray(data.shoulders)&&[0,2].includes(data.shoulders.length)&&data.shoulders.every(point);}
export function useLocalTracking(){
 const video=useRef<HTMLVideoElement|null>(null),worker=useRef<Worker|null>(null),stream=useRef<MediaStream|null>(null),canvas=useRef<HTMLCanvasElement|null>(null),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|null>(null),deadline=useRef<ReturnType<typeof setTimeout>|null>(null),busy=useRef(false);
 const [phase,setPhase]=useState<'idle'|'permission'|'loading'|'running'|'error'>('idle'),[message,setMessage]=useState(''),[result,setResult]=useState<Result|null>(null),[metrics,setMetrics]=useState({frames:0,fps:0,latency:0});
 const [events,setEvents]=useState<WordEvent[]>([]);
 const stop=useCallback((notice='摄像头已关闭，画面未保存。')=>{
  generation.current++;busy.current=false;if(timer.current)clearTimeout(timer.current);if(deadline.current)clearTimeout(deadline.current);timer.current=deadline.current=null;
  worker.current?.terminate();worker.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;
  if(video.current){video.current.pause();video.current.srcObject=null;}if(canvas.current){canvas.current.width=0;canvas.current.height=0;canvas.current=null;}
  setPhase('idle');setResult(null);setEvents([]);setMetrics({frames:0,fps:0,latency:0});setMessage(notice);
 },[]);
 useEffect(()=>{const hide=()=>{if(document.hidden)stop('页面切到后台，摄像头已关闭。');};const leave=()=>stop('');document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',leave);return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',leave);stop('');};},[stop]);
 async function start(){
  if(busy.current)return;stop('');busy.current=true;const epoch=generation.current;const active=()=>epoch===generation.current;
  function fail(text:string){if(active()){stop(text);setPhase('error');}}
  try{
   if(!navigator.mediaDevices?.getUserMedia)throw Error('当前环境无法访问摄像头，请使用本机浏览器或支持摄像头的HBuilderX运行环境。');
   if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap)throw Error('当前WebView暂不支持本地骨架处理，请升级系统WebView后再试。');
   setPhase('permission');setMessage('等待摄像头授权…');const camera=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'user'},audio:false});
   if(!active()){camera.getTracks().forEach(t=>t.stop());return;}
   stream.current=camera;camera.getTracks().forEach(t=>t.addEventListener('ended',()=>{if(active())stop('摄像头已断开。');}));
   if(!video.current)throw Error('摄像头显示区域尚未就绪。');video.current.srcObject=camera;await video.current.play();if(!active())return;
   setPhase('loading');setMessage('正在加载本地手部与身体模型…');
   const task=new Worker(publicAsset('local-vision/worker.js'));worker.current=task;canvas.current=document.createElement('canvas');let seq=0,expected=0,captureAt=0,lastEventId=0,lastEventEnd=-1,lastVideoTime=-1;const completedTimes:number[]=[];
   deadline.current=setTimeout(()=>fail('本地骨骼模型加载超时，请重试。'),45000);
   const loop=async()=>{
    if(!active())return;const el=video.current,frame=canvas.current;if(!el||!frame||el.readyState<2||el.currentTime===lastVideoTime){timer.current=setTimeout(()=>void loop(),10);return;}lastVideoTime=el.currentTime;
    try{
     const scale=Math.min(1,640/Math.max(el.videoWidth,el.videoHeight));frame.width=Math.max(16,Math.round(el.videoWidth*scale));frame.height=Math.max(16,Math.round(el.videoHeight*scale));const ctx=frame.getContext('2d');if(!ctx)throw Error('无法读取摄像头画面。');
     // Mirror once for both detectors; the video element is mirrored only for display.
     ctx.setTransform(-1,0,0,1,frame.width,0);ctx.drawImage(el,0,0,frame.width,frame.height);ctx.setTransform(1,0,0,1,0,0);
     const bitmap=await createImageBitmap(frame);if(!active()){bitmap.close();return;}captureAt=performance.now();expected=++seq;
     deadline.current=setTimeout(()=>fail('本地处理响应超时，摄像头已关闭，请重新开启。'),15000);task.postMessage({type:'frame',seq:expected,timestamp:captureAt,image:bitmap},[bitmap]);
    }catch(e){fail(e instanceof Error?e.message:'本地画面处理失败。');}
   };
   task.onerror=()=>fail('本地骨架运行库加载失败，请检查资源包和WebView版本。');
   task.onmessage=({data})=>{
    if(!active())return;
    if(data.type==='error'){fail(data.code==='local_tracker_start_failed'?'本地骨骼模型未能加载，请检查资源包后重试。':'本地骨骼处理失败，请重新开启。');return;}
    if(data.type==='ready'){if(deadline.current)clearTimeout(deadline.current);setPhase('running');setMessage('请先让双手与肩部入镜，等骨架稳定后再做动作。当前为本地四词试用，不上传画面。');void loop();return;}
    if(data.type!=='frame'||data.seq!==expected||!Number.isFinite(data.processingMs)||data.processingMs<0||!validFrame(data)){fail('本地结果顺序或格式异常，请重新开启。');return;}
    if(data.recognition!==undefined){if(!validRecognition(data.recognition)){fail('本地动作结果格式异常，已停止试用。');return;}const event=data.recognition.event;if(event){if(event.id!==lastEventId+1||!Number.isSafeInteger(event.startMs)||!Number.isSafeInteger(event.endMs)||event.startMs<=lastEventEnd||event.endMs<=event.startMs||event.endMs>Math.round(captureAt)){fail('本地动作事件顺序异常，已停止试用。');return;}lastEventId=event.id;lastEventEnd=event.endMs;setEvents(old=>[...old,event].slice(-30));}}
    if(deadline.current)clearTimeout(deadline.current);deadline.current=null;
    const now=performance.now(),latency=Math.round(now-captureAt);completedTimes.push(now);if(completedTimes.length>20)completedTimes.shift();const fps=completedTimes.length>1?(completedTimes.length-1)/Math.max(.001,(now-completedTimes[0])/1000):0;setResult(data);setMetrics({frames:seq,fps:Number(fps.toFixed(1)),latency});
    // No queue: schedule only after this frame has completed, and capture a fresh frame.
    timer.current=setTimeout(()=>void loop(),Math.max(0,realtimeConfig.frameIntervalMs-latency));
   };
   task.postMessage({type:'init'});
  }catch(e){if(active()){const name=e instanceof DOMException?e.name:'';fail(name==='NotAllowedError'?'未获得摄像头权限，请允许后重试。':name==='NotFoundError'?'没有找到可用摄像头。':e instanceof Error?e.message:'无法开启本地骨架检查。');}}
 }
 return {video,phase,message,result,metrics,events,start,stop};
}
