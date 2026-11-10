import {useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {HandTracking} from './RealtimeSkeleton';
type Review={sampleNumber:string;label:string;mediaUrl:string;modelVersion:string;motionGuard?:string;rawCandidateSeen?:boolean;guardedCandidateSeen?:boolean;duration:number;annotatedRange:[number,number];threshold:number;fullClipScore:number;frozenFrameScore:number;frozenFrameTime:number;shuffledScore:number;frames:{t:number;score:number|null;candidate:string|null;rawCandidate?:string|null;motionSupported?:boolean|null;eventState:string;tracking:HandTracking}[]};
const chains=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
export default function HelpModelReview({open,userId,onClose}:{open:boolean;userId?:string;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),video=useRef<HTMLVideoElement>(null);
  const [report,setReport]=useState<Review|null>(null),[error,setError]=useState(''),[time,setTime]=useState(0),[loading,setLoading]=useState(false);
  useEffect(()=>{
    if(open)dialog.current?.showModal();else dialog.current?.close();
    if(!open||!userId){setReport(null);return;}
    const controller=new AbortController();let mounted=true;setReport(null);setError('');setLoading(true);
    const timeout=setTimeout(()=>controller.abort(),30000);
    void api<Review>('/api/sign/help-model-review',{signal:controller.signal}).then(value=>{if(mounted&&!controller.signal.aborted)setReport(value);}).catch(e=>{if(mounted)setError(controller.signal.aborted?'读取复盘超时，请关闭后重试。':e.message);}).finally(()=>{clearTimeout(timeout);if(mounted)setLoading(false);});
    return()=>{mounted=false;clearTimeout(timeout);controller.abort();};
  },[open,userId]);
  useEffect(()=>{
    if(!open||!report)return;
    let token=0;const tick=()=>{if(video.current)setTime(video.current.currentTime);token=requestAnimationFrame(tick);};token=requestAnimationFrame(tick);
    const player=video.current;return()=>{cancelAnimationFrame(token);player?.pause();player?.removeAttribute('src');player?.load();};
  },[open,report]);
  function close(){video.current?.pause();onClose();}
  const frame=report?.frames.reduce<Review['frames'][number]|null>((best,next)=>!best||Math.abs(next.t-time)<Math.abs(best.t-time)?next:best,null);
  const current=frame&&report&&time>=report.annotatedRange[0]&&time<report.annotatedRange[1]&&Math.abs(frame.t-time)<.15?frame:null;
  return <dialog ref={dialog} className="help-model-review" aria-label="静止双掌误判复盘" onCancel={e=>{e.preventDefault();close();}}>
    <div className="dialog-heading"><h2>静止双掌为什么被判成帮助？</h2><button className="quiet-button" onClick={close}>关闭复盘</button></div>
    {!userId?<p>请先登录保存这条录像的账号，再打开复盘。</p>:loading?<p role="status">正在核对原片与模型版本…</p>:error?<p role="alert">{error}</p>:report&&<>
      <p>样本 {report.sampleNumber} · 人工登记：{report.label} · 视频模型 {report.modelVersion}。以下是原片离线逐帧复盘，分数不是识别准确率。</p>
      {report.motionGuard&&<p className="inline-notice" data-testid="review-motion-result">已加入双手运动检查。原始模型{report.rawCandidateSeen?'曾给出帮助候选':'没有帮助候选'}；加检查后{report.guardedCandidateSeen?'仍出现帮助候选，需继续核对':'已拦截，未输出帮助候选'}。下方原始高分保留用于对照。</p>}
      <div className="help-review-video">
        <video ref={video} src={report.mediaUrl} controls playsInline aria-label="静止双掌原始录像" onSeeked={e=>setTime(e.currentTarget.currentTime)}/>
        {current&&<svg viewBox={`0 0 ${current.tracking.width} ${current.tracking.height}`} preserveAspectRatio="xMidYMid meet" aria-label="原片追踪骨架">{current.tracking.hands.map((hand,i)=><g key={i}>{chains.map((chain,j)=><polyline key={j} points={chain.map(k=>`${hand.points[k][0]*current.tracking.width},${hand.points[k][1]*current.tracking.height}`).join(' ')} fill="none" stroke={j===0?'#ffbd63':'#63edce'} strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>)}{hand.points.map(([x,y],j)=><circle key={j} cx={x*current.tracking.width} cy={y*current.tracking.height} r={2.5} fill="#fff"/>)}</g>)}</svg>}
        <div className="realtime-picture-status"><div><strong>{current?.candidate?'通过检查：帮助':current?.motionSupported===false?'已拦截：双手运动不足':current?'尚未形成帮助候选':'标注区间外／尚无分析'}</strong><small>{time.toFixed(2)} 秒 · 原始分数 {current?.score===null||current?.score===undefined?'—':current.score.toFixed(3)}</small></div></div>
      </div>
      <div className="help-review-metrics"><p>整段原片分数<strong data-testid="review-full-score">{report.fullClipScore.toFixed(3)}</strong></p><p>判定门槛<strong>{report.threshold.toFixed(2)}</strong></p><p>固定一帧重复输入<strong>{report.frozenFrameScore.toFixed(3)}</strong></p><p>打乱帧顺序输入<strong>{report.shuffledScore.toFixed(3)}</strong></p></div>
      <p>绿线为当时窗口分数，虚线为判定门槛。拖动视频进度，可观察手没有明显拍动时分数是否仍然偏高。</p>
      <svg className="help-review-chart" viewBox="0 0 600 110" role="img" aria-label="帮助模型分数随时间变化"><line x1="0" x2="600" y1={100-report.threshold*90} y2={100-report.threshold*90} stroke="#ce8155" strokeDasharray="5 5"/><polyline fill="none" stroke="#258473" strokeWidth="2" points={report.frames.filter(f=>f.score!==null).map(f=>`${f.t/report.duration*600},${100-f.score!*90}`).join(' ')}/><line x1={time/report.duration*600} x2={time/report.duration*600} y1="0" y2="110" stroke="#334e60"/></svg>
      <button className="secondary-button" onClick={()=>{if(video.current){video.current.pause();video.current.currentTime=report.frozenFrameTime;}}}>定位到静态诊断所用帧（{report.frozenFrameTime.toFixed(2)}秒）</button>
      <p><strong>观察事实：</strong>把中间同一帧重复为整段输入，模型仍给出上述分数。固定帧、打乱顺序是人工构造诊断，不是新拍摄的测试视频。</p>
      <p><strong>待修正的问题：</strong>本轮训练只有3条帮助、1条静止双掌；验证组没有静止双掌。当前短时卷积与池化可能偏重双掌手形，没有充分学会完整拍动过程。这是诊断线索，并非已经证明唯一原因。</p>
      <p>原视频、人工标签和门槛均未在复盘时修改。摄像头实时结果还会受到实际帧率、取景与延迟影响。</p>
    </>}
  </dialog>;
}
