import {useEffect,useRef} from 'react';
import {useLocalSpeechQueue} from './useLocalSpeechQueue';

type Event={id:number;text:string;signId:string};
type Result={seq:number;candidate:string|null;reason:string;eventState:string};
export default function RealtimeSpeech({events,phase,result}:{events:Event[];phase:string;result:Result|null}){
  const speech=useLocalSpeechQueue(),seen=useRef(events.at(-1)?.id??0),spoken=useRef(new Set<string>()),completed=useRef(new Set<string>()),lastCandidate=useRef<string|null>(null),awaySince=useRef<number|null>(null);
  useEffect(()=>{
    if(phase!=='running'){speech.cancel();seen.current=0;spoken.current.clear();completed.current.clear();lastCandidate.current=null;awaySince.current=null;return;}
    for(const event of events){
      if(event.id<=seen.current)continue;
      seen.current=event.id;completed.current.add(event.text);
    }
    if(!result)return;
    const now=performance.now();
    if(awaySince.current!==null&&now-awaySince.current>=600){spoken.current.clear();completed.current.clear();lastCandidate.current=null;}
    if(!result.candidate){
      if(result.reason==='no_hands'){if(awaySince.current===null)awaySince.current=now;}
      else if(result.eventState!=='emitted')awaySince.current=null;
      return;
    }
    awaySince.current=null;
    if(result.candidate!==lastCandidate.current){
      for(const word of completed.current){if(word!==result.candidate){spoken.current.delete(word);completed.current.delete(word);}}
    }
    lastCandidate.current=result.candidate;
    if(!spoken.current.has(result.candidate)){completed.current.delete(result.candidate);spoken.current.add(result.candidate);speech.enqueue(result.candidate);}
  },[events,phase,result]);
  return <>
    <p className="settings-hint">千问自动播报 · 播报文字发送至阿里云百炼，需要联网；不上传摄像头画面。</p>
    <audio ref={speech.player} controls preload="metadata" hidden={!speech.needsPlayback} className="realtime-audio-fallback" aria-label="本次播报语音" data-testid="realtime-auto-audio" data-ready={speech.available===null?'checking':speech.available?'ready':'unavailable'}/>
    {speech.needsPlayback&&<p className="inline-notice" role="status">浏览器暂停了自动播放，请点击播放器继续。</p>}
    {speech.error&&<p role="alert" className="inline-notice notice-error">{speech.error}</p>}
  </>;
}
