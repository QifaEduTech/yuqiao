import {useEffect,useRef,useState} from 'react';
import {api,practiceChangedEvent,type PracticeAttempt} from './api';
import {PracticeFeedback,feedbackLabels} from './PracticeFeedback';

export function PracticeHistory({recordId}:{recordId:string}){
  const [items,setItems]=useState<PracticeAttempt[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[editing,setEditing]=useState(''),[retry,setRetry]=useState(0);
  const generation=useRef(0);
  useEffect(()=>{setItems([]);setEditing('');setTotal(0);},[recordId]);
  useEffect(()=>{
    let controller:AbortController|null=null;
    const refresh=()=>{const epoch=++generation.current;controller?.abort();controller=new AbortController();setLoading(true);setError('');void api<{attempts:PracticeAttempt[];total:number}>(`/api/records/${recordId}/practice`,{signal:controller.signal}).then(result=>{if(epoch===generation.current){setItems(result.attempts);setTotal(result.total);}}).catch(caught=>{if(epoch===generation.current)setError(caught instanceof Error?caught.message:'读取练习记录失败。');}).finally(()=>{if(epoch===generation.current)setLoading(false);});};
    const changed=(event:Event)=>{if((event as CustomEvent<{recordId:string}>).detail.recordId===recordId)refresh();};
    refresh();window.addEventListener(practiceChangedEvent,changed);window.addEventListener('focus',refresh);
    return()=>{generation.current++;controller?.abort();window.removeEventListener(practiceChangedEvent,changed);window.removeEventListener('focus',refresh);};
  },[recordId,retry]);
  return <section className="practice-history" aria-label="已保存的练习反馈"><h3>练习识别与反馈</h3>
    {loading&&<p role="status">正在读取练习记录…</p>}{error&&<><p role="alert">{error}</p><button type="button" className="text-button" onClick={()=>setRetry(n=>n+1)}>重试读取练习记录</button></>}
    {!loading&&!error&&!items.length&&<p>这段录像尚无练习识别记录。可在下方重新识别；原备注不会被当作识别结果。</p>}
    {total>50&&<p>显示最近50次识别，共{total}次。</p>}
    {items.map(item=><article className="practice-history-item" key={item.id} data-attempt-id={item.id}>
      <time>{new Date(item.createdAt).toLocaleString('zh-CN',{hour12:false})}</time><p>原识别：<strong>{item.candidate??'没有可靠候选'}</strong></p><p>我的反馈：{item.feedback?feedbackLabels[item.feedback]:'尚未反馈'}</p>{item.feedback==='disagree'&&<p>原本想表达：<strong>{item.correction}</strong></p>}
      <details><summary>识别与参考版本</summary><p>模型：{item.snapshot.modelId} · {item.snapshot.modelVersion}</p><p>特征：{item.snapshot.featureId}</p>{item.snapshot.pipelineId&&<p>识别流程：{item.snapshot.pipelineId} · {item.snapshot.pipelineModels?.length??0}个关联模型</p>}<p>词典：{item.snapshot.dictionaryVersion} · 示范：{item.snapshot.motionVersion??'无关联示范'}</p></details>
      <button type="button" className="text-button" onClick={()=>setEditing(v=>v===item.id?'':item.id)}>{editing===item.id?'收起反馈编辑':item.feedback?'修改这次反馈':'填写这次反馈'}</button>
      {editing===item.id&&<PracticeFeedback attempt={item}/>}
    </article>)}
  </section>;
}
