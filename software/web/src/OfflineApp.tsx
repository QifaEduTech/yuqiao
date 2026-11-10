import {useRef,useState,useEffect,lazy,Suspense} from 'react';
import {BookOpen,Box,ChevronRight,Hand,MessageCircle,Play,RotateCcw,UserRound,WifiOff} from 'lucide-react';
import Avatar,{type AvatarHandle} from './Avatar';
import UserAvatar from './UserAvatar';
import {api} from './api';
import type {MotionPreview} from './fixedMotionLibrary';
import catalog from '../../shared/sign-motion-catalog.json';
import {planMotionText} from '../../shared/motion-planner.mjs';
const MobileAccount=lazy(()=>import('./MobileAccount'));
const LocalTracking=lazy(()=>import('./LocalTracking'));
type Tab='talk'|'live'|'learn'|'me';
const tabs=[{id:'talk' as Tab,label:'交流',icon:MessageCircle},{id:'live' as Tab,label:'识别',icon:Hand},{id:'learn' as Tab,label:'学习',icon:BookOpen},{id:'me' as Tab,label:'我的',icon:UserRound}];
const examples=['你好','我需要帮助','好，请等候','谢谢','再见'];
function modelPage(){return import.meta.env.MODE==='android'?'../model-check.html':'/android-app/model-check.html';}
function localPreview(text:string):MotionPreview|null{const result=planMotionText(text);if(result.status==='sequence')return result.preview;if(result.status==='single')return {id:result.entry.id,label:result.entry.label,version:result.entry.version,status:'authored_unverified'};return null;}
export default function OfflineApp(){
 const [tab,setTab]=useState<Tab>((['talk','live','learn','me'].includes(new URLSearchParams(location.search).get('tab')??'')?new URLSearchParams(location.search).get('tab'):'talk') as Tab),[text,setText]=useState(''),[original,setOriginal]=useState(''),[preview,setPreview]=useState<MotionPreview|null>(null),[request,setRequest]=useState(0),[message,setMessage]=useState(''),[search,setSearch]=useState('');
 const [accountAvatar,setAccountAvatar]=useState<string|null>(null);
 const avatar=useRef<AvatarHandle>(null);
 useEffect(()=>{
  // The packaged offline app never probes a computer API. Browser preview can show its existing account avatar.
  if(tab==='me'||import.meta.env.MODE==='android'||location.protocol==='file:')return;
  const task=new AbortController();void api<{avatar:string|null}>('/api/profile',{signal:task.signal}).then(r=>{if(!task.signal.aborted)setAccountAvatar(r.avatar??null);}).catch(()=>{if(!task.signal.aborted)setAccountAvatar(null);});return()=>task.abort();
 },[tab]);
 function changeTab(next:Tab){avatar.current?.cancelMotion();setPreview(null);setOriginal('');setMessage('');setTab(next);window.scrollTo({top:0});}
 function play(value:string){avatar.current?.cancelMotion();setOriginal(value.trim());const result=localPreview(value);setPreview(result);setRequest(n=>n+1);setMessage(result?'':'当前离线动作库不能完整表达这段内容，请使用已支持的词语或示例。');}
 return <div className="mobile-shell offline-shell">
  <header className="mobile-top"><button className="mobile-brand offline-brand" onClick={()=>changeTab('talk')} aria-label="语桥本地版首页"><span className="mobile-logo"><svg viewBox="0 0 40 40"><path d="M6 29Q20 5 34 29M6 29h28M12 21v8m8-13v13m8-8v8"/></svg></span><span>语桥<small>让沟通更简单</small></span></button><button className="mobile-profile" aria-label="打开我的" onClick={()=>changeTab('me')}><UserAvatar src={accountAvatar}/></button></header>
  <div className="mobile-connection"><span className="connected"/>页面与动作资源已内置<span className="mobile-preview-label"><WifiOff size={11}/>动作示范可离线</span></div>
  {tab==='talk'&&<section className="mobile-welcome"><p>每一种表达，都值得被理解</p><h1>把想说的话，<br/><em>带到彼此身边。</em></h1><span className="mobile-welcome-art" aria-hidden="true"><i/><b/><svg viewBox="0 0 110 80"><path d="M5 65Q55-15 105 65M5 65h100M25 40v25M55 24v41M85 40v25"/></svg></span></section>}
  <main className="mobile-content">
   {(tab==='talk'||tab==='learn')&&<>
    {tab==='learn'&&<div className="mobile-section-title"><span>看动作，学表达</span><h1>随身动作库</h1><p>{catalog.entries.length}个固定动作示范 · 均待专业语义核验</p></div>}
    <section className="stage offline-stage" aria-label="本地数字人展示"><div className="stage-topline"><span className="stage-label"><span className="status-dot"/>你的手语伙伴</span><span className="stage-badge">本地资源</span></div><Avatar key={tab} ref={avatar} preview={preview} autoPlay requestId={request} displayText={original}/>{!preview&&<p className="avatar-caption">准备好，开始一段交流</p>}<div className="stage-bottomline"><span/><button className="icon-button" aria-label="恢复正面视角" onClick={()=>avatar.current?.resetView()}><RotateCcw size={16}/></button></div></section>
    {tab==='talk'?<section className="offline-composer"><div className="offline-composer-heading"><h2>想说些什么？</h2><span>离线词库表达</span></div><label className="offline-label" htmlFor="offline-text">输入文字，播放已有动作</label><textarea id="offline-text" value={text} maxLength={500} placeholder="试试：我需要帮助" onChange={e=>{setText(e.target.value);avatar.current?.cancelMotion();setPreview(null);setOriginal('');setMessage('');}}/><div className="offline-examples" aria-label="常用表达">{examples.map(value=><button key={value} onClick={()=>{setText(value);play(value);}}>{value}</button>)}</div><button className="primary-button offline-play" disabled={!text.trim()} onClick={()=>play(text)}><Play size={17}/>播放手语</button><p className="offline-hint">仅使用已内置的动作完整表达，不补猜未覆盖的内容。自由语句理解和语音服务尚未接入本地版。</p></section>:<section className="offline-library"><label htmlFor="offline-search">查找动作</label><input id="offline-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索：我、帮助、谢谢…"/><div>{catalog.entries.filter(e=>e.label.includes(search.trim())).map(entry=><button key={entry.id} className={preview?.id===entry.id?'active':''} onClick={()=>play(entry.label)}><Hand size={17}/><span>{entry.label}</span><Play size={13}/></button>)}</div>{!catalog.entries.some(e=>e.label.includes(search.trim()))&&<p className="offline-hint">内置示范库暂时没有这个动作。</p>}<p className="offline-hint">这里是数字人动作示范，不代表摄像头已经能够识别这些词。训练录像仍保留在电脑端。</p></section>}
    {original&&<section className="offline-original" aria-label="本次原话"><small>本次原话</small><p>{original}</p></section>}{message&&<p className="inline-notice" role="alert">{message}</p>}
   </>}
   {tab==='live'&&<Suspense fallback={<p className="offline-hint">正在载入本地骨架检查…</p>}><LocalTracking/></Suspense>}
   {tab==='me'&&<><Suspense fallback={<p className="offline-hint">正在载入账号界面…</p>}><MobileAccount onAvatarChange={setAccountAvatar}/></Suspense><div className="mobile-menu"><button onClick={()=>changeTab('learn')}><BookOpen/><span>本地动作库<small>离线查看数字人动作</small></span><ChevronRight/></button><a href={modelPage()}><Box/><span>本地模型包<small>不包含训练录像</small></span><ChevronRight/></a></div></>}
  </main>
  <nav className="mobile-bottom" aria-label="移动端导航">{tabs.map(({id,label,icon:Icon})=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>changeTab(id)}><span><Icon size={23}/></span>{label}</button>)}</nav>
 </div>;
}
