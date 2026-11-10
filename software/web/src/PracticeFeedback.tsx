import {useEffect,useRef,useState} from 'react';
import {api,ApiError,notifyPracticeChanged,type PracticeAttempt} from './api';
import './practice.css';

export const feedbackLabels={agree:'与我的意思一致',disagree:'不一致',uncertain:'不确定'};
export function PracticeFeedback({attempt}:{attempt:PracticeAttempt}){
  const [saved,setSaved]=useState(attempt),[choice,setChoice]=useState(attempt.feedback),[correction,setCorrection]=useState(attempt.correction);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[conflict,setConflict]=useState(false);
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const draft=useRef({saved,choice,correction});draft.current={saved,choice,correction};
  useEffect(()=>{
    generation.current++;request.current?.abort();request.current=null;setBusy(false);setNotice('');
    const current=draft.current;
    const dirty=current.choice!==current.saved.feedback||(current.choice==='disagree'?current.correction.trim():'')!==current.saved.correction;
    if(current.saved.id===attempt.id&&current.saved.revision!==attempt.revision&&dirty){
      setConflict(true);setError('这条反馈有更新，你的填写已保留。请重新载入反馈后再操作。');
    }else{setSaved(attempt);setChoice(attempt.feedback);setCorrection(attempt.correction);setError('');setConflict(false);}
    return()=>{generation.current++;request.current?.abort();request.current=null;};
  },[attempt.id,attempt.revision]);
  function accept(value:PracticeAttempt){
    if(value.id!==attempt.id||value.recordId!==attempt.recordId||value.candidate!==attempt.candidate||value.status!==attempt.status)throw Error('返回的练习记录不匹配，请重新打开记录。');
    setSaved(value);setChoice(value.feedback);setCorrection(value.correction);setConflict(false);
  }
  async function persist(remove=false){
    if(request.current)return;
    const epoch=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);setError('');setNotice('');
    const timeout=setTimeout(()=>controller.abort('timeout'),30000);
    try{
      const result=await api<{attempt:PracticeAttempt}>(`/api/records/${saved.recordId}/practice/${saved.id}/feedback`,{method:'PUT',body:JSON.stringify({feedback:remove?null:choice,correction:!remove&&choice==='disagree'?correction.trim():'',revision:saved.revision}),signal:controller.signal});
      if(epoch!==generation.current||controller.signal.aborted)return;
      accept(result.attempt);setNotice(remove?'反馈已撤回，原识别结果保留。':'反馈已保存，可在“我的记录”中查看。');notifyPracticeChanged(saved.recordId);
    }catch(caught){if(epoch===generation.current){if(controller.signal.reason==='timeout'){setError('保存响应超时，结果尚未确认。请重新载入反馈后再操作。');setConflict(true);}else if(!controller.signal.aborted){setError(caught instanceof Error?caught.message:'反馈保存失败，请重试。');setConflict(caught instanceof ApiError&&caught.status===409);}}}
    finally{clearTimeout(timeout);if(epoch===generation.current){request.current=null;setBusy(false);}}
  }
  async function reload(){
    if(request.current)return;
    const epoch=++generation.current,controller=new AbortController();request.current=controller;setBusy(true);setError('');
    const timeout=setTimeout(()=>controller.abort('timeout'),30000);
    try{const result=await api<{attempt:PracticeAttempt}>(`/api/records/${saved.recordId}/practice/${saved.id}`,{signal:controller.signal});if(epoch===generation.current&&!controller.signal.aborted){accept(result.attempt);setNotice('已载入最新反馈，请重新核对。');}}
    catch(caught){if(epoch===generation.current){if(controller.signal.reason==='timeout')setError('读取反馈超时，请重试。');else if(!controller.signal.aborted)setError(caught instanceof Error?caught.message:'读取失败，请重试。');}}
    finally{clearTimeout(timeout);if(epoch===generation.current){request.current=null;setBusy(false);}}
  }
  const normalized=choice==='disagree'?correction.trim():'';
  const unchanged=choice===saved.feedback&&normalized===saved.correction;
  return <section className="practice-feedback" aria-label="本次练习反馈">
    <h4>这次识别符合你的意思吗？</h4><p>原识别：<strong>{saved.candidate??'没有可靠候选'}</strong>。你的反馈会单独保存。</p>
    <div className="practice-choices" role="group" aria-label="选择练习反馈">{(Object.keys(feedbackLabels) as Array<keyof typeof feedbackLabels>).map(value=><button type="button" key={value} disabled={busy||value==='agree'&&!saved.candidate} aria-pressed={choice===value} onClick={()=>{setChoice(value);setError('');setNotice('');if(value!=='disagree')setCorrection('');}}>{feedbackLabels[value]}</button>)}</div>
    {choice==='disagree'&&<label>你原本想表达的词<input aria-label="你原本想表达的词" value={correction} maxLength={100} disabled={busy} onChange={e=>{setCorrection(e.target.value);setError('');setNotice('');}} placeholder="例如：谢谢"/></label>}
    {!saved.candidate&&<p className="practice-hint">没有候选时，可填写你想表达的词，或选择“不确定”。</p>}
    <div className="practice-actions"><button type="button" className="secondary-button" disabled={busy||!choice||choice==='disagree'&&!normalized||unchanged||conflict} onClick={()=>void persist()}>{busy?'正在处理…':'保存反馈'}</button>{saved.feedback&&<button type="button" className="text-button" disabled={busy||conflict} onClick={()=>void persist(true)}>撤回反馈</button>}{conflict&&<button type="button" className="text-button" disabled={busy} onClick={()=>void reload()}>重新载入反馈</button>}</div>
    {error&&<p role="alert" className="notice-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <p className="practice-hint">这是你的练习反馈，不是动作规范评分，也不会自动用于训练。</p>
  </section>;
}
