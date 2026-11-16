import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {Camera,Square} from 'lucide-react';
import {AuthGate} from './AuthGate';
import {useRealtimeSign} from './useRealtimeSign';
import RealtimeSpeech from './RealtimeSpeech';
import './camera-entry.css';

/** 端3：登录后直接开启摄像头，稳定识别到手语即播报；不显示其他页面功能。 */
function CameraScreen(){
  const live=useRealtimeSign();
  useEffect(()=>{
    // 进入即开启；React 严格模式的重复挂载由 useRealtimeSign 的 stop/start 自行恢复。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    void live.start();
  },[]);
  const active=['permission','warming','running'].includes(live.phase);
  const result=live.result;
  const lastWord=live.events.at(-1)?.text??live.paragraphs.at(-1)?.text;
  const status=live.phase==='permission'?'正在请求摄像头权限…'
    :live.phase==='warming'?'正在准备识别…'
    :live.phase==='error'?live.message||'摄像头未开启。'
    :live.phase!=='running'?'正在开启摄像头…'
    :result?.candidate?`识别到：${result.candidate}`
    :result?.eventState==='emitted'?`已播报：${result.event?.text??lastWord??''}`
    :result?.reason==='no_hands'?(lastWord?`最近一次：${lastWord}`:'等待手部入镜')
    :'正在识别手语…';
  return <div className="camera-entry">
    <section className="camera-entry-stage" aria-label="摄像头识别">
      <video ref={live.video} className="camera-entry-video" style={{display:live.stream?'block':'none'}} autoPlay playsInline muted aria-label="实时手语摄像头"/>
      {!live.stream&&<div className="camera-entry-empty"><div className="camera-entry-icon"><Camera size={38}/></div><h1>摄像头识别</h1><p>{status}</p>{live.phase==='error'&&<button className="camera-entry-action" onClick={()=>void live.start()}><Camera size={17}/>重新开启摄像头</button>}</div>}
      {live.stream&&<p className="camera-entry-status" role="status" data-phase={live.phase} data-candidate={result?.candidate??''}>{status}</p>}
      {active&&<button className="camera-entry-stop" onClick={()=>live.stop()} aria-label="停止摄像头"><Square size={16}/>停止</button>}
    </section>
    <RealtimeSpeech events={live.events} phase={live.phase} result={result} compact/>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="camera"><CameraScreen/></AuthGate></React.StrictMode>);
