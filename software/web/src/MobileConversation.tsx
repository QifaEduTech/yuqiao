import {useCallback,useEffect,useRef,useState} from 'react';
import {Keyboard,Mic,RotateCcw,Save,Trash2} from 'lucide-react';
import Avatar,{type AvatarHandle} from './Avatar';
import {api,type User} from './api';
import type {MotionPreview} from './fixedMotionLibrary';
import {useMediaCapture} from './useMediaCapture';
import {VoiceInput} from './VoiceInput';
import {useDisplayChannel} from './useDisplayChannel';
import {motionFeedback} from './motionFeedback';

export default function MobileConversation({user}:{user:User|null}){
 const [kind,setKind]=useState<'text'|'voice'>('text'),[text,setText]=useState(''),[original,setOriginal]=useState(''),[preview,setPreview]=useState<MotionPreview|null>(null),[request,setRequest]=useState(0),[matching,setMatching]=useState(false),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[savedText,setSavedText]=useState('');
 const avatar=useRef<AvatarHandle>(null),controller=useRef<AbortController|null>(null),version=useRef(0),remote=useRef(false),media=useMediaCapture(),display=useDisplayChannel(user?.id);
 const invalidate=useCallback(()=>{version.current++;controller.current?.abort();controller.current=null;avatar.current?.cancelMotion();if(remote.current)void display.send({preview:null});remote.current=false;setPreview(null);setMatching(false);setOriginal('');setNotice('');},[display.send]);
 useEffect(()=>{const hide=()=>{if(document.hidden)invalidate();};window.addEventListener('pagehide',invalidate);document.addEventListener('visibilitychange',hide);return()=>{window.removeEventListener('pagehide',invalidate);document.removeEventListener('visibilitychange',hide);invalidate();};},[invalidate]);
 async function submit(value:string){
  invalidate();const input=value.trim();if(!input)return;const token=version.current,task=new AbortController();controller.current=task;setMatching(true);setOriginal(input);
  const timer=setTimeout(()=>task.abort('timeout'),105000);
  try{const result=await api<{preview:MotionPreview|null;status?:string;reason?:string;missing?:string[]}>('/api/sign/resolve',{method:'POST',body:JSON.stringify({text:input,mode:'playback'}),signal:task.signal});if(token!==version.current||task.signal.aborted)return;setPreview(result.preview);setRequest(n=>n+1);setNotice(motionFeedback(result));if(result.preview){remote.current=true;void display.send({preview:result.preview});}}
  catch(e){if(token===version.current)setNotice(task.signal.reason==='timeout'?'处理超时，原话已保留。':e instanceof Error?e.message:'暂时无法准备动作。');}
  finally{clearTimeout(timer);if(token===version.current){controller.current=null;setMatching(false);}}
 }
 async function save(value:string){if(!user||!value.trim())return;setSaving(true);setNotice('');try{await api('/api/records/text',{method:'POST',body:JSON.stringify({text:value.trim()})});setSavedText(value.trim());setNotice('文字已保存到我的记录。');}catch(e){setNotice(e instanceof Error?e.message:'保存失败。');}finally{setSaving(false);}}
 function switchKind(next:'text'|'voice'){invalidate();media.clear();setKind(next);}
 return <section className="mobile-conversation" aria-label="安卓交流">
  <section className={'stage mobile-talk-stage'+(preview?' has-home-motion':'')} aria-label="安卓数字人"><div className="stage-topline"><span className="stage-label">你的手语伙伴</span><button className="icon-button" aria-label="恢复正面视角" onClick={()=>avatar.current?.resetView()}><RotateCcw size={16}/></button></div><Avatar ref={avatar} preview={preview} autoPlay requestId={request} displayText={original} onControl={control=>void display.send({control})}/></section>
  <section className="mobile-composer"><div className="mobile-composer-title"><h2>想说些什么？</h2><button className="text-button" onClick={()=>{invalidate();media.clear();setText('');setSavedText('');}}><Trash2 size={14}/>清空</button></div>
   <div className="input-tabs" role="group" aria-label="输入方式"><button aria-pressed={kind==='text'} onClick={()=>switchKind('text')}><Keyboard size={16}/>文字输入</button><button aria-pressed={kind==='voice'} onClick={()=>switchKind('voice')}><Mic size={16}/>语音输入</button></div>
   {kind==='text'?<><label className="sr-only" htmlFor="mobile-text">输入要表达的中文</label><textarea id="mobile-text" value={text} maxLength={500} placeholder="例如：我想请医生帮忙" onChange={e=>{invalidate();setText(e.target.value);}}/><div className="mobile-phrase-examples">{['我想请医生帮忙','请志愿者帮我挂号','请问门诊在哪里？','谢谢你'].map(value=><button key={value} onClick={()=>{invalidate();setText(value);}}>{value}</button>)}</div><button className="primary-button" disabled={!text.trim()||saving} onClick={()=>void submit(text)}>{matching?'重新提交文字':'提交文字'}</button><button className="text-button mobile-save" disabled={!user||!text.trim()||saving||savedText===text.trim()} onClick={()=>void save(text)}><Save size={15}/>{saving?'正在保存…':savedText&&savedText===text.trim()?'已保存':'保存到我的记录'}</button></>:<VoiceInput media={media} loggedIn={!!user} saving={saving} savedText={savedText} matching={matching} onInvalidate={invalidate} onMatch={value=>void submit(value)} onSave={value=>void save(value)} onUseText={value=>{switchKind('text');setText(value);}}/>}
  </section>
  {matching&&<p role="status" className="inline-notice">正在准备动作…</p>}{notice&&<p role="status" className="inline-notice" data-testid="mobile-input-feedback">{notice}</p>}{display.notice&&<p className="mobile-mode-note">{display.notice}</p>}{original&&<section className="mobile-original" aria-label="本次原话"><small>本次原话</small><p>{original}</p></section>}
 </section>;
}
