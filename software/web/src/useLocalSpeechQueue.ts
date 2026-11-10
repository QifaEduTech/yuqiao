import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {useTtsConfigurationVersion} from './ttsConfiguration';

type SpeechResult={text:string;revision:number;mime:string;audio:string;voice:string};
export function useLocalSpeechQueue(){
  const configVersion=useTtsConfigurationVersion();
  const player=useRef<HTMLAudioElement|null>(null),queue=useRef<string[]>([]),busy=useRef(false),epoch=useRef(0),serial=useRef(0),controller=useRef<AbortController|null>(null),release=useRef<(()=>void)|null>(null),url=useRef('');
  const [available,setAvailable]=useState<boolean|null>(null),[voice,setVoice]=useState(''),[error,setError]=useState(''),[status,setStatus]=useState('等待播报'),[pending,setPending]=useState(0),[audio,setAudio]=useState<{url:string;text:string}|null>(null),[failedText,setFailedText]=useState('');
  const [needsPlayback,setNeedsPlayback]=useState(false);
  const cancel=useCallback(()=>{
    epoch.current++;controller.current?.abort();controller.current=null;queue.current=[];busy.current=false;release.current?.();release.current=null;
    const el=player.current;if(el){el.pause();el.removeAttribute('src');el.load();}
    if(url.current)URL.revokeObjectURL(url.current);url.current='';setAudio(null);setPending(0);setFailedText('');setError('');setNeedsPlayback(false);setStatus('等待播报');
  },[]);
  useEffect(()=>{
    cancel();setAvailable(null);
    const task=new AbortController();void api<{available:boolean;voice?:string;reason?:string}>('/api/tts/status',{signal:task.signal}).then(r=>{if(!task.signal.aborted){setAvailable(r.available);setVoice(r.voice??'');if(!r.available)setError(r.reason??'千问音色不可用，文字仍可使用。');}}).catch(e=>{if(!task.signal.aborted){setAvailable(false);setError(e instanceof Error?e.message:'无法连接语音服务。');}});
    return()=>task.abort();
  },[configVersion,cancel]);
  useEffect(()=>{
    const hide=()=>{if(document.hidden)cancel();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',cancel);
    return()=>{document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',cancel);cancel();};
  },[cancel]);
  async function pump(){
    if(busy.current)return;busy.current=true;const token=epoch.current;
    try{
      while(queue.current.length&&token===epoch.current){
        const text=queue.current.shift()!;setPending(queue.current.length);setStatus('正在生成语音…');setError('');setFailedText('');setNeedsPlayback(false);
        const el=player.current;if(!el)break;el.pause();el.removeAttribute('src');el.load();if(url.current)URL.revokeObjectURL(url.current);url.current='';setAudio(null);
        const task=new AbortController();controller.current=task;const revision=++serial.current;const timeout=setTimeout(()=>task.abort(),35000);
        try{
          const result=await api<SpeechResult>('/api/tts/synthesize',{method:'POST',body:JSON.stringify({text,confirmed:true,revision}),signal:task.signal});
          if(token!==epoch.current||task.signal.aborted)return;
          if(result.text!==text||result.revision!==revision||result.mime!=='audio/wav'||typeof result.audio!=='string'||result.audio.length>16*1024*1024)throw Error('播报内容或语音版本不匹配，请重试。');
          const bytes=Uint8Array.from(atob(result.audio),c=>c.charCodeAt(0));
          if(bytes.length<44||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='WAVE')throw Error('语音内容无效，请重试。');
          clearTimeout(timeout);controller.current=null;url.current=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));setAudio({url:url.current,text});setVoice(result.voice);el.src=url.current;
          await new Promise<void>(resolve=>{
            const cleanup=()=>{el.removeEventListener('ended',ended);el.removeEventListener('error',failed);el.removeEventListener('play',playing);el.removeEventListener('pause',paused);if(release.current===finish)release.current=null;};
            const finish=()=>{cleanup();resolve();};
            const ended=()=>{if(token===epoch.current)setStatus('本段播报完成');finish();};
            const failed=()=>{if(token===epoch.current){setError('播放失败，请稍后重试。');setFailedText(text);}finish();};
            const playing=()=>{if(token===epoch.current)setStatus('正在播报');};
            const paused=()=>{if(token===epoch.current&&!el.ended)setStatus('已暂停，可在播放器中继续。');};
            release.current=finish;el.addEventListener('ended',ended);el.addEventListener('error',failed);el.addEventListener('play',playing);el.addEventListener('pause',paused);
            void el.play().catch(()=>{if(token===epoch.current){setNeedsPlayback(true);setStatus('浏览器暂停了自动播放，请点击下方播放器。');}});
          });
        }catch(e){if(token===epoch.current){setError(task.signal.aborted?'语音生成超时，请重试。':e instanceof Error?e.message:'语音生成失败。');setFailedText(text);setStatus('本段未播报');}}
        finally{clearTimeout(timeout);if(token===epoch.current)controller.current=null;}
      }
    }finally{if(token===epoch.current){busy.current=false;setPending(queue.current.length);}}
  }
  function enqueue(value:string){
    const text=value.trim();if(!text||text.length>500)return false;
    if(available===false){setError('千问语音不可用，识别仍可继续。');return false;}
    if(queue.current.length>=5){setError('待播内容较多，暂时无法播报新的候选。');return false;}
    queue.current.push(text);setPending(queue.current.length);if(available===true)void pump();return true;
  }
  useEffect(()=>{
    if(available===true&&queue.current.length)void pump();
    if(available===false&&queue.current.length){queue.current=[];setPending(0);setError('千问语音不可用，识别仍可继续。');}
  },[available]);
  return {player,available,voice,error,status,pending,audio,failedText,needsPlayback,cancel,enqueue};
}
