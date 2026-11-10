import {useEffect,useRef,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {preprocessVideo} from './video/preprocess';
import {SignExperiment} from './SignExperiment';

/** Processing stays private. Only a saved, current recording can open the gate. */
export function VideoPreprocessing({videoBlob,captureActive,autoToken=0,learning=false,speechEnabled=!learning,id='video-result',recordId}:{videoBlob:Blob|null;captureActive:boolean;autoToken?:number;learning?:boolean;speechEnabled?:boolean;id?:string;recordId?:string}){
  const [ready,setReady]=useState<{source:Blob;token:number}|null>(null);
  const [running,setRunning]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const generation=useRef(0);
  const eligible=!!videoBlob&&autoToken>0&&!captureActive;
  useEffect(()=>{
    const epoch=++generation.current,controller=new AbortController();
    setReady(null);setError('');setRunning(false);
    if(!videoBlob||!autoToken||captureActive)return()=>controller.abort();
    setRunning(true);
    const timeout=setTimeout(()=>controller.abort(new Error('这段录像处理超时，请缩短录像后重试。')),60000);
    void preprocessVideo(videoBlob,controller.signal,()=>{}).then(()=>{
      if(epoch===generation.current&&!controller.signal.aborted)setReady({source:videoBlob,token:autoToken});
    }).catch(caught=>{if(epoch===generation.current&&!controller.signal.aborted)setError(caught instanceof Error?caught.message:'录像处理失败，请重试。');else if(epoch===generation.current&&controller.signal.reason instanceof Error)setError(controller.signal.reason.message);})
      .finally(()=>{clearTimeout(timeout);if(epoch===generation.current)setRunning(false);});
    return()=>{generation.current++;controller.abort();clearTimeout(timeout);};
  },[videoBlob,autoToken,captureActive,attempt]);
  const processed=eligible&&ready?.source===videoBlob&&ready.token===autoToken;
  return <section className="video-background video-result-panel" id={id} aria-label={learning?'学习识别结果':speechEnabled?'文字与语音结果':'录像识别结果'}>
    <span className="section-kicker">{learning?'单动作练习':'本次录像'}</span><h3>{speechEnabled?'文字与语音':'识别结果'}</h3>
    {!eligible&&<><p className="video-result-placeholder">开始识别后，识别文字会显示在这里。</p><p className="result-scope">录像与实时试用统一支持谢谢、帮助、需要、我；仅复核单动作，不做连续整句翻译。</p></>}
    {eligible&&running&&<p className="background-status" role="status"><LoaderCircle className="spinning" size={15}/>正在处理这段录像，请稍候…</p>}
    {eligible&&error&&<><p className="inline-notice notice-error" role="alert">{error}</p><button className="secondary-button" onClick={()=>setAttempt(v=>v+1)}>重试本段录像</button></>}
    <SignExperiment source={videoBlob} captureActive={captureActive} autoToken={processed?autoToken:0} learning={learning} speechEnabled={speechEnabled} recordId={recordId}/>
  </section>;
}
