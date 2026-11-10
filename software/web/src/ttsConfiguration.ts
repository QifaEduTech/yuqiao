import {useEffect,useState} from 'react';
const eventName='yuqiao-tts-config-changed';
export function notifyTtsConfiguration(){
  window.dispatchEvent(new Event(eventName));
  if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel(eventName);channel.postMessage('changed');channel.close();}
}
export function useTtsConfigurationVersion(){
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    const update=()=>setVersion(v=>v+1);
    const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel(eventName):null;
    channel?.addEventListener('message',update);window.addEventListener(eventName,update);window.addEventListener('focus',update);
    return()=>{channel?.close();window.removeEventListener(eventName,update);window.removeEventListener('focus',update);};
  },[]);
  return version;
}
