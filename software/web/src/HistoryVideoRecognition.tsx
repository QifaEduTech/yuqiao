import {useEffect,useRef,useState} from 'react';
import type {SavedRecord} from './api';
import {VideoPreprocessing} from './VideoPreprocessing';

/** Fetch the saved, account-authorized video anew on every explicit retry. */
export function HistoryVideoRecognition({record,disabled,speechEnabled=true}:{record:SavedRecord;disabled:boolean;speechEnabled?:boolean}){
  const [blob,setBlob]=useState<Blob|null>(null),[token,setToken]=useState(0),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const request=useRef<AbortController|null>(null),generation=useRef(0);
  const results=useRef<HTMLDivElement|null>(null);
  function cancel(){generation.current++;request.current?.abort();request.current=null;setBlob(null);setLoading(false);setError('');}
  useEffect(()=>{if(disabled)cancel();},[disabled]);
  useEffect(()=>()=>{generation.current++;request.current?.abort();},[]);
  useEffect(()=>{
    if(!blob)return;
    const frame=requestAnimationFrame(()=>{const element=results.current,container=element?.closest('.record-detail');if(element&&container)container.scrollTo({top:container.scrollTop+element.getBoundingClientRect().top-container.getBoundingClientRect().top-62,behavior:'smooth'});});
    return()=>cancelAnimationFrame(frame);
  },[blob]);
  async function recognize(){
    cancel();if(disabled)return;
    const epoch=generation.current,controller=new AbortController();request.current=controller;setLoading(true);
    const timeout=setTimeout(()=>controller.abort(new Error('录像读取超时，请重试。')),30000);
    try{
      const response=await fetch(`/api/records/${encodeURIComponent(record.id)}/media`,{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{'X-Yuqiao-Request':'1'}});
      if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'录像已删除或暂不可用，请重新打开记录。');}
      const mime=response.headers.get('content-type')?.split(';')[0],size=Number(response.headers.get('content-length'));
      if(!['video/webm','video/mp4'].includes(mime??'')||size>32*1024*1024)throw Error('录像格式或大小不支持重新识别。');
      const video=await response.blob();if(video.size<32||video.size>32*1024*1024||record.byte_length>0&&video.size!==record.byte_length)throw Error('录像为空、未完整读取或超过32 MB，请重试。');
      if(epoch!==generation.current||controller.signal.aborted)return;
      setBlob(video);setToken(value=>value+1);
    }catch(caught){if(epoch===generation.current)setError(controller.signal.aborted?'录像读取已取消或超时。':caught instanceof Error?caught.message:'录像读取失败。');}
    finally{clearTimeout(timeout);if(epoch===generation.current){request.current=null;setLoading(false);}}
  }
  return <section className="history-recognition" aria-label="重新识别已保存录像">
    <h3>重新识别这段录像</h3>
    <p>与实时试用统一支持谢谢、帮助、需要、我。请确认录像中只做了一个完整动作；多动作录像不在此拼句。</p>
    <button className="primary-button" disabled={disabled||loading} onClick={()=>void recognize()}>{loading?'正在读取录像…':'重新识别录像'}</button>
    {(loading||blob)&&<button className="text-button" disabled={disabled} onClick={cancel}>停止并清除本次结果</button>}
    <p>使用已保存的视频，不必重新录制。原录像和备注保留，识别结果需重新核对。</p>
    {error&&<p className="inline-notice notice-error" role="alert">{error}</p>}
    {!disabled&&blob&&<div ref={results}><VideoPreprocessing key={`${record.id}:${token}`} id="history-video-result" videoBlob={blob} captureActive={false} autoToken={token} speechEnabled={speechEnabled} recordId={record.id}/></div>}
  </section>;
}
