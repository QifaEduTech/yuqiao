import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthGate} from './AuthGate';
import {api} from './api';
import {readDisplayStream} from './displayStream';
import type {MotionPreview} from './fixedMotionLibrary';
import type {AvatarHandle} from './Avatar';
import './styles.css';
import './avatar-display.css';
const Avatar=lazy(()=>import('./Avatar'));

function DisplayScreen(){
 const [preview,setPreview]=useState<MotionPreview|null>(null),[requestId,setRequestId]=useState(0),[autoPlay,setAutoPlay]=useState(true);
 const [status,setStatus]=useState('connecting'),[error,setError]=useState(''),[commandCount,setCommandCount]=useState(0);
 const avatar=useRef<AvatarHandle|null>(null),seenKey=useRef(''),seen=useRef(new Set<string>());
 const clear=()=>{avatar.current?.cancelMotion();setPreview(null);setRequestId(n=>n+1);setAutoPlay(false);};
 useEffect(()=>{
  const controller=new AbortController();let alive=true;
  const authChanged=()=>window.dispatchEvent(new Event('yuqiao-auth-changed'));
  const event=(kind:string,data:unknown)=>{
   if(!alive)return;
   if(kind==='session-expired'){clear();controller.abort();authChanged();return;}
   if(!data||typeof data!=='object')return;
   if(kind!=='command')return;
   const command=data as {commandId?:string;preview?:MotionPreview|null;control?:'play'|'pause'|'replay'};
   if(!command.commandId||seen.current.has(command.commandId))return;
   seen.current.add(command.commandId);while(seen.current.size>256)seen.current.delete(seen.current.values().next().value!);
   try{sessionStorage.setItem(seenKey.current,JSON.stringify([...seen.current]));}catch{}
   setCommandCount(n=>n+1);
   if(command.control==='pause'){setAutoPlay(false);avatar.current?.pause();}
   else if(command.control==='play'){setAutoPlay(true);avatar.current?.play();}
   else if(command.control==='replay'){setAutoPlay(true);setRequestId(n=>n+1);}
   else if(Object.hasOwn(command,'preview')){avatar.current?.cancelMotion();setAutoPlay(true);setPreview(command.preview??null);setRequestId(n=>n+1);}
  };
  void (async()=>{
   const result=await api<{user:{id:string}|null}>('/api/auth/me');if(!alive)return;if(!result.user){authChanged();return;}
   seenKey.current='yuqiao-display-seen-account:'+result.user.id;
   try{const saved=JSON.parse(sessionStorage.getItem(seenKey.current)||'[]');seen.current=new Set(Array.isArray(saved)?saved.filter(x=>typeof x==='string').slice(-256):[]);}catch{seen.current=new Set();}
   await readDisplayStream(controller.signal,event,next=>{if(!alive)return;setStatus(next);if(next!=='ready')clear();});
  })().catch(e=>{if(alive){setError(e.message);setStatus('offline');}});
  return()=>{alive=false;controller.abort();};
 },[]);
 return <div className="display-page" data-command-count={commandCount}>
  <div className="display-stage" aria-label="数字人显示"><Suspense fallback={<div className="display-loading" role="status">正在载入数字人…</div>}><Avatar ref={avatar} preview={preview} autoPlay={autoPlay} bare requestId={requestId}/></Suspense></div>
  {status!=='ready'&&<p className="display-status is-offline" role="status">{error|| (status==='connecting'?'正在连接…':'连接已断开，正在重连…')}</p>}
  {error&&status==='ready'&&<p className="display-status is-offline" role="alert">{error}</p>}
 </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="avatar"><DisplayScreen/></AuthGate></React.StrictMode>);
