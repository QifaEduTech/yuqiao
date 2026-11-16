import React,{lazy,Suspense,useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AuthGate} from './AuthGate';
import {api} from './api';
import type {MotionPreview} from './fixedMotionLibrary';
import type {AvatarHandle} from './Avatar';
import './styles.css';
import './avatar-display.css';

// 数字人依赖较大；登录卡片不需要等它，进入显示页后再加载。
const Avatar=lazy(()=>import('./Avatar'));

/** 端2：只显示数字人；动作来自正常端通过 /api/display/command 下发的指令。 */
function DisplayScreen(){
  const [preview,setPreview]=useState<MotionPreview|null>(null);
  const [requestId,setRequestId]=useState(0);
  const [status,setStatus]=useState<'connecting'|'ready'|'offline'>('connecting');
  const source=useRef<EventSource|null>(null);
  const avatar=useRef<AvatarHandle|null>(null);
  useEffect(()=>{
    const stream=new EventSource('/api/display/stream');
    source.current=stream;
    stream.onopen=()=>setStatus('ready');
    stream.addEventListener('command',event=>{
      try{
        const data=JSON.parse((event as MessageEvent).data) as {preview?:MotionPreview|null;control?:'play'|'pause'|'replay'};
        if(data.control){
          if(data.control==='play')avatar.current?.play();
          else if(data.control==='pause')avatar.current?.pause();
          else avatar.current?.replay();
          return;
        }
        setPreview(data.preview??null);
        setRequestId(value=>value+1);
      }catch{ /* Ignore malformed commands rather than play the wrong motion. */ }
    });
    stream.onerror=()=>{
      setStatus('offline');
      // EventSource reconnects on its own; only a lost session needs the gate.
      void api<{user:unknown}>('/api/auth/me').catch(()=>window.dispatchEvent(new Event('yuqiao-auth-changed')));
    };
    return()=>{stream.close();source.current=null;};
  },[]);
  return <div className="display-page">
    <div className="display-stage" aria-label="数字人显示">
      <Suspense fallback={<div className="display-loading" role="status">正在载入数字人…</div>}>
        <Avatar ref={avatar} preview={preview} autoPlay bare requestId={requestId} />
      </Suspense>
    </div>
    {status!=='ready'&&<p className={`display-status ${status==='offline'?'is-offline':''}`} role="status">
      {status==='connecting'?'正在连接正常端…':'连接已断开，正在重连…'}
    </p>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="avatar"><DisplayScreen/></AuthGate></React.StrictMode>);
