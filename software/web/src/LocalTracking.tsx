import {useEffect,useState} from 'react';
import {Camera,Hand,Square,ShieldCheck} from 'lucide-react';
import {useLocalTracking} from './useLocalTracking';
import RealtimeSkeleton from './RealtimeSkeleton';
import RealtimeSpeech from './RealtimeSpeech';
import './realtime.css';
import needMotion from '../../shared/need-required-motion.json';
export default function LocalTracking(){
 const track=useLocalTracking(),active=['permission','loading','running'].includes(track.phase),[overlay,setOverlay]=useState(true),[fresh,setFresh]=useState(false);
 useEffect(()=>{setFresh(true);const timer=setTimeout(()=>setFresh(false),750);return()=>clearTimeout(timer);},[track.result?.seq]);
 const hands=track.result?.handTracking.hands.length??0,recognition=track.result?.recognition,candidate=recognition?.candidate;
 const picture=recognition?.reason==='ambiguous_actions'?'动作证据冲突，请双手出画后重试':recognition?.reason==='action_transition'?'正在切换动作':candidate?`候选：${candidate}`:track.events.length?`最近完成：${track.events.at(-1)!.text}`:hands?'正在观察动作':'等待手部入镜';
 return <section className="local-tracking" data-testid="local-tracking" data-phase={track.phase} data-frames={track.metrics.frames}>
  <div className="mobile-section-title"><span>当前设备处理 · 不上传画面</span><h1>本地手语试用</h1><p>自动判断：谢谢 · 帮助 · 需要 · 我</p></div>
  <div className="local-camera stage"><video ref={track.video} autoPlay playsInline muted aria-label="本地摄像头画面"/>{!active&&<div className="local-camera-placeholder"><Hand size={52}/><span>摄像头尚未开启</span></div>}
   {track.phase==='running'&&<RealtimeSkeleton tracking={track.result?.handTracking} seq={track.result?.seq??0} latencyMs={track.metrics.latency} enabled={overlay} badge={picture}/>}
   {overlay&&fresh&&track.metrics.latency<=750&&track.result?.shoulders.length===2&&<svg className="local-shoulders" viewBox={`0 0 ${track.result.handTracking.width} ${track.result.handTracking.height}`} preserveAspectRatio="xMidYMid meet" aria-label="肩部位置参考"><line x1={track.result.shoulders[0][0]*track.result.handTracking.width} y1={track.result.shoulders[0][1]*track.result.handTracking.height} x2={track.result.shoulders[1][0]*track.result.handTracking.width} y2={track.result.shoulders[1][1]*track.result.handTracking.height} stroke="#fff2b5" strokeWidth="3"/>{track.result.shoulders.map(([x,y],i)=><circle key={i} cx={x*track.result!.handTracking.width} cy={y*track.result!.handTracking.height} r="5" fill="#fff2b5"/>)}</svg>}
  </div>
  <div className="offline-service-card local-controls">{!active?<button className="primary-button" onClick={()=>void track.start()}><Camera size={17}/>开启本地手语试用</button>:<button className="secondary-button" onClick={()=>track.stop()}><Square size={16}/>停止本地试用</button>}<label className="local-overlay-toggle"><input type="checkbox" checked={overlay} onChange={e=>setOverlay(e.target.checked)}/>显示骨架与肩部参考</label><p role={track.phase==='error'?'alert':'status'}>{track.message||'开启后可看到手部21点；请让双手和肩部完整入镜。'}</p><div className="local-tracking-metrics"><span>双手：{hands}/2</span><span>肩部：{track.result?.shoulders.length===2?'可见':'待入镜'}</span><span>{track.metrics.fps} 帧/秒</span></div><div className="local-tracking-metrics" data-testid="local-feature-state"><span>手部特征：{track.result?.featureSummary?.handPresent?'已生成':'待入镜'}</span><span>身体参考：{track.result?.featureSummary?.bodyReference?'可用':'待入镜'}</span></div>{track.phase==='running'&&track.metrics.frames>20&&track.metrics.fps<(needMotion.minEndpointFrames-1)/needMotion.endpointSeconds&&<p className="offline-hint">当前帧率较低，部分动作可能漏识别。可先关闭其他占用资源的程序，再重新试用。</p>}<p className="offline-hint">当前是四词本地试用，未知动作仍可能误报。“我”结束后，请双手出画约一秒再继续；不是连续整句翻译。</p></div>
  <section className="offline-service-card local-word-result"><small>本地候选 · 待核对</small><strong data-testid="local-candidate">{candidate??'等待动作'}</strong><p data-testid="local-words">{track.events.length?track.events.map(e=>e.text).join('，'):'完整动作结束后，文字会显示在这里。'}</p></section>
  {import.meta.env.MODE!=='android'&&location.protocol!=='file:'&&track.phase==='running'?<RealtimeSpeech phase={track.phase} events={track.events} result={recognition?{...recognition,seq:track.result!.seq}:null}/>:<p className="offline-hint">安装版原生运行与云语音仍待验证；当前按设备本地处理。</p>}
  <div className="mobile-trust"><ShieldCheck size={20}/><p>不录制、不保存、不上传。停止、切换页面或进入后台会关闭摄像头并清除本次骨架。</p></div>
 </section>;
}
