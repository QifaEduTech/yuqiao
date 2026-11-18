import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import type {MotionPreview} from './fixedMotionLibrary';

export function useDisplayChannel(userId:string|undefined){
 const [notice,setNotice]=useState(''),generation=useRef(0),queue=useRef(Promise.resolve()),activeRequest=useRef<AbortController|null>(null);
 useEffect(()=>{generation.current++;activeRequest.current?.abort();queue.current=Promise.resolve();setNotice('');return()=>{generation.current++;activeRequest.current?.abort();};},[userId]);
 const send=useCallback((payload:{preview:MotionPreview|null}|{control:'play'|'pause'|'replay'})=>{
  if(!userId)return Promise.resolve();
  const clearing='preview' in payload&&payload.preview===null;
  if(clearing){generation.current++;activeRequest.current?.abort();queue.current=Promise.resolve();}
  const epoch=generation.current,commandId=crypto.randomUUID();
  queue.current=queue.current.catch(()=>{}).then(async()=>{
   if(epoch!==generation.current)return;
   const request=new AbortController();activeRequest.current=request;
   try{const result=await api<{delivered:number}>('/api/display/command',{method:'POST',body:JSON.stringify({...payload,commandId}),signal:request.signal});
    if(epoch===generation.current)setNotice(result.delivered||clearing?'':'数字人端未连接，动作只在本页播放；打开数字人端并登录同一账号即可。');
   }catch(error){if(epoch===generation.current)setNotice(error instanceof Error?error.message:'显示端指令发送失败。');}finally{if(activeRequest.current===request)activeRequest.current=null;}
  });return queue.current;
 },[userId]);
 return {notice,send};
}
