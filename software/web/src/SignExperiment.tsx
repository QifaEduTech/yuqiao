import {useEffect,useRef,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import {api,notifyPracticeChanged,type PracticeAttempt} from './api';
import {PracticeFeedback} from './PracticeFeedback';
import realtimeTargets from '../../shared/realtime-targets.json';
import {SignSpeechReview} from './SignSpeechReview';

interface SignResult {status:'candidate'|'uncertain'|'no_hands'|'unsupported';candidate:string|null;attempt?:PracticeAttempt;reason?:string;realtimeAvailable?:boolean;actionText?:string;end_boundary_observed?:boolean;low_frame_rate?:boolean}

/** A compact result view. Numeric diagnostics remain in the local backend. */
export function SignExperiment({source,captureActive,autoToken=0,learning=false,speechEnabled=!learning,recordId}:{source:Blob|null;captureActive:boolean;autoToken?:number;learning?:boolean;speechEnabled?:boolean;recordId?:string}){
  const [labels,setLabels]=useState(Object.values(realtimeTargets).map(t=>t.text));
  const [available,setAvailable]=useState<boolean|null>(null),[attempt,setAttempt]=useState(0);
  const [running,setRunning]=useState(false),[message,setMessage]=useState('');
  const [result,setResult]=useState<{source:Blob;token:number;recordId?:string;value:SignResult}|null>(null);
  const controller=useRef<AbortController|null>(null),revision=useRef(0);
  const eligible=!!source&&autoToken>0&&!captureActive;
  useEffect(()=>{
    const task=new AbortController();
    void api<{available:boolean;labels?:string[]}>('/api/sign/status',{signal:task.signal}).then(v=>{if(!task.signal.aborted){setAvailable(v.available);if(v.labels)setLabels(v.labels);}}).catch(()=>{if(!task.signal.aborted)setAvailable(false);});
    return()=>task.abort();
  },[attempt]);
  useEffect(()=>{
    const epoch=++revision.current,task=new AbortController();controller.current=task;
    setResult(null);setMessage('');setRunning(false);
    if(!source||!autoToken||captureActive||available!==true)return()=>task.abort();
    if(!source.size||source.size>32*1024*1024){setMessage('录像为空或超过32 MB，请重新录制较短的视频。');return()=>task.abort();}
    setRunning(true);
    const timeout=setTimeout(()=>task.abort(new DOMException('处理超时','TimeoutError')),130000);
    void api<SignResult>('/api/sign/experiments',{method:'POST',headers:{'Content-Type':source.type.split(';')[0]||'video/webm',...(recordId?{'X-Yuqiao-Record-Id':recordId}:{})},body:source,signal:task.signal})
      .then(value=>{if(epoch===revision.current&&!task.signal.aborted){setResult({source,token:autoToken,recordId,value});if(recordId&&value.attempt?.recordId===recordId)notifyPracticeChanged(recordId);}})
      .catch(error=>{if(epoch===revision.current)setMessage(task.signal.aborted?'识别已取消或超时，可以重试本段录像。':error instanceof Error?error.message:'识别失败，请重试。');})
      .finally(()=>{clearTimeout(timeout);if(epoch===revision.current){setRunning(false);controller.current=null;}});
    return()=>{revision.current++;task.abort();clearTimeout(timeout);};
  },[source,captureActive,autoToken,available,attempt,recordId]);
  if(!eligible)return null;
  const current=available===true&&!running&&result?.source===source&&result.token===autoToken&&result.recordId===recordId?result.value:null;
  const allowed=(word:string|null)=>word!==null&&labels.includes(word);
  const candidate=current?.status==='candidate'&&allowed(current.candidate)?current.candidate:null;
  const retry=()=>{setAvailable(null);setAttempt(v=>v+1);};
  return <div className="sign-experiment compact-result">
    {available===null&&<p role="status">正在准备识别服务…</p>}
    {available===false&&<><p className="inline-notice" role="alert">识别服务暂不可用，录像已保存，可以稍后重试。</p><button className="secondary-button" onClick={retry}>重试识别</button></>}
    {running&&<div className="recognition-busy"><p role="status"><LoaderCircle className="spinning" size={15}/>正在识别这段录像…</p><button className="text-button" onClick={()=>{revision.current++;controller.current?.abort();controller.current=null;setResult(null);setRunning(false);setMessage('识别已取消，录像仍保存在账号中。');}}>取消识别</button></div>}
    {message&&!running&&<><p role="alert" className="inline-notice">{message}</p><button className="secondary-button" onClick={retry}>重试识别</button></>}
    {current&&<div className="sign-result" data-testid="sign-result" aria-live="polite">
      <h4>{candidate?`识别候选：${candidate}`:current.reason==='recording_action_not_connected'?'这类动作尚未接入录像识别':current.reason==='multiple_actions_detected'?'本段可能包含多个动作':current.reason==='conflicting_evidence'?'本段动作证据存在冲突':'本次没有可靠候选'}</h4>
      {recordId&&current.attempt?.recordId===recordId&&current.attempt.candidate===candidate&&<PracticeFeedback key={current.attempt.id} attempt={current.attempt}/>}
      {current.reason==='recording_action_not_connected'?<p>{current.realtimeAvailable?'这类动作已接入实时试用，这个录像入口暂未接入；录像和采集登记已保留。':`“${current.actionText??'这个动作'}”仍在采集验证，尚未接入识别；录像和采集登记已保留，无需因此重拍。`}{current.realtimeAvailable&&<> <a href="/realtime.html">进入实时试用</a></>}</p>:candidate?<>{current.end_boundary_observed===false&&<p>本段出现了这个候选，但未观察到结束边界；不据此判断动作已完整完成。</p>}{speechEnabled&&<SignSpeechReview candidate={candidate}/>}</>:<><p>{current.reason==='multiple_actions_detected'?'此入口仅复核单个动作，不会选取部分词或自动拼句。原录像已保留，请选择只包含一个动作的录像。':current.reason==='conflicting_evidence'?'不同动作的证据发生竞争，系统没有强行选择词语。可先回看原片再核对。':current.status==='no_hands'?'没有足够的清晰手部画面，请先回看取景。':'本段尚无足够的动作证据，可先回看原片并核对动作，再重试。'}</p><button className="secondary-button" onClick={retry}>重试识别</button></>}
      {current.low_frame_rate&&<p className="result-scope">录像帧率偏低，可能影响短暂动作的判断；系统没有通过补帧放宽要求。</p>}
    </div>}
    {!running&&speechEnabled&&<p className="result-scope">与实时试用一致：{labels.join('、')}。单动作候选需要核对，不是连续整句翻译。</p>}
  </div>;
}
