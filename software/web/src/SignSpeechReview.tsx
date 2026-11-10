import {useEffect,useId,useRef,useState} from 'react';
import {Check,LoaderCircle,Square,Volume2} from 'lucide-react';
import {api} from './api';
import {useTtsConfigurationVersion} from './ttsConfiguration';

interface TtsResult {audio:string;mime:string;text:string;revision:number;voice:string;voice_version:string;voice_name?:string}
export function SignSpeechReview({candidate}:{candidate:string}){
  const configVersion=useTtsConfigurationVersion();
  const fieldId=useId();
  const [text,setText]=useState(candidate);
  const [confirmed,setConfirmed]=useState(false);
  const [available,setAvailable]=useState<boolean|null>(null);
  const [voice,setVoice]=useState('');
  const [generating,setGenerating]=useState(false);
  const [audio,setAudio]=useState<{url:string;revision:number}|null>(null);
  const [error,setError]=useState('');
  const [playing,setPlaying]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const revision=useRef(0);
  const currentUrl=useRef('');
  const player=useRef<HTMLAudioElement|null>(null);

  function invalidateAudio(){
    revision.current++;controller.current?.abort();controller.current=null;
    player.current?.pause();
    if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);
    currentUrl.current='';setAudio(null);setGenerating(false);setPlaying(false);setError('');
  }
  useEffect(()=>{
    invalidateAudio();setAvailable(null);
    const task=new AbortController();
    void api<{available:boolean;voice?:string;reason?:string}>('/api/tts/status',{signal:task.signal}).then(value=>{
      if(task.signal.aborted)return;setAvailable(value.available);setVoice(value.voice||'');if(!value.available)setError(value.reason||'千问音色暂不可用，文字可以保留。');
    }).catch(error=>{if(!task.signal.aborted){setAvailable(false);setError(error instanceof Error?error.message:'无法连接语音服务。');}});
    return()=>task.abort();
  },[configVersion]);
  useEffect(()=>{invalidateAudio();setText(candidate);setConfirmed(false);},[candidate]);
  useEffect(()=>()=>{revision.current++;controller.current?.abort();if(currentUrl.current)URL.revokeObjectURL(currentUrl.current);},[]);
  useEffect(()=>{const element=player.current;return()=>{element?.pause();element?.removeAttribute('src');element?.load();};},[audio?.url]);

  async function generate(){
    if(!confirmed||!text.trim()||available!==true||generating)return;
    invalidateAudio();const value=text.trim(),version=revision.current;
    const task=new AbortController();controller.current=task;setGenerating(true);
    const timeout=setTimeout(()=>task.abort(),35000);
    try{
      const result=await api<TtsResult>('/api/tts/synthesize',{method:'POST',body:JSON.stringify({text:value,confirmed:true,revision:version}),signal:task.signal});
      if(task.signal.aborted||revision.current!==version)return;
      if(result.text!==value||result.revision!==version||result.mime!=='audio/wav')throw new Error('语音版本与当前文字不一致，请重新生成。');
      const bytes=Uint8Array.from(atob(result.audio),char=>char.charCodeAt(0));
      const url=URL.createObjectURL(new Blob([bytes],{type:result.mime}));
      currentUrl.current=url;setAudio({url,revision:version});setVoice(result.voice);
    }catch(error){if(revision.current===version)setError(task.signal.aborted?'语音生成已取消或超时，可以重试。':error instanceof Error?error.message:'生成失败，文字已保留。');}
    finally{clearTimeout(timeout);if(revision.current===version){controller.current=null;setGenerating(false);}}
  }
  return <section className="sign-speech-review" aria-label="核对文字并播报">
    <h4>核对文字，再生成语音</h4>
    <label htmlFor={fieldId}>本次播报文字</label>
    <textarea id={fieldId} maxLength={500} value={text} onChange={event=>{invalidateAudio();setText(event.target.value);setConfirmed(false);}}/>
    {text!==candidate&&<p>已由你修改，模型原始候选为“{candidate}”。</p>}
    <div className="processing-actions">
      <button className="secondary-button" disabled={!text.trim()||confirmed} onClick={()=>setConfirmed(true)}><Check size={16}/>{confirmed?'文字已确认':'确认播报文字'}</button>
      <button className="primary-button" disabled={!confirmed||!text.trim()||available!==true||generating} onClick={()=>void generate()}>{generating?<LoaderCircle size={16} className="spinning"/>:<Volume2 size={16}/>} {generating?'正在生成语音…':audio?'重新生成语音':'生成语音'}</button>
      {generating&&<button className="text-button" onClick={()=>{invalidateAudio();setError('语音生成已取消。');}}>取消生成语音</button>}
    </div>
    <p className="tts-confirm-state" role="status">{confirmed?'已确认当前文字；再次修改需重新确认。':'待核对确认，尚未生成语音。'}</p>
    {audio&&<div className="tts-player"><audio ref={player} controls preload="metadata" src={audio.url} aria-label="确认文字的语音" onPlay={()=>{if(revision.current===audio.revision)setPlaying(true);}} onPause={()=>{if(revision.current===audio.revision)setPlaying(false);}} onEnded={()=>{if(revision.current===audio.revision)setPlaying(false);}}/>
      <button className="secondary-button" onClick={()=>{if(player.current){player.current.pause();player.current.currentTime=0;}setPlaying(false);}}><Square size={15}/>停止并回到开头</button><p>{playing?'正在播放':'语音已生成，可播放或重播。'}</p></div>}
    {error&&<p className="inline-notice" role="alert">{error}</p>}
    <p className="processing-source">{available===null?'正在检查千问音色…':voice||'千问音色暂不可用'} · 播报文字发送至阿里云百炼，音频不自动保存。</p>
  </section>;
}
