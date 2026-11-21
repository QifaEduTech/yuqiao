import {lazy,Suspense,useEffect,useRef,useState,type MouseEvent} from 'react';
import {ArrowLeft,BookOpen,ChevronRight,FolderOpen,Hand,MessageCircle,UserRound} from 'lucide-react';
import {api,type User} from './api';
import UserAvatar from './UserAvatar';
const Conversation=lazy(()=>import('./MobileConversation'));
const Recorded=lazy(()=>import('./RealtimePage'));
const LiveRecognition=lazy(()=>import('./LiveRecognitionPage'));
const Learning=lazy(()=>import('./LearningPage'));
const Training=lazy(()=>import('./TrainingPage'));
const Account=lazy(()=>import('./MobileAccount'));
const Dictionary=lazy(()=>import('./MobileDictionary'));
type Tab='talk'|'live'|'live-camera'|'learn'|'train'|'me'|'dictionary';
const tabs=[{id:'talk',label:'交流',icon:MessageCircle},{id:'live',label:'识别',icon:Hand},{id:'learn',label:'学习',icon:BookOpen},{id:'train',label:'训练',icon:FolderOpen},{id:'me',label:'我的',icon:UserRound}] as const;
const valid=(value:string|null):Tab=>value==='dictionary'||value==='live-camera'||tabs.some(t=>t.id===value)?value as Tab:'talk';
export default function MobileApp(){
 const currentUrl=useRef(location.pathname+location.search);
 const canLeave=()=>window.dispatchEvent(new Event('yuqiao-before-mobile-navigation',{cancelable:true}));
 const [tab,setTab]=useState<Tab>(()=>valid(new URLSearchParams(location.search).get('tab'))),[revision,setRevision]=useState(0),[user,setUser]=useState<User|null>(null),[avatar,setAvatar]=useState<string|null>(null),[connected,setConnected]=useState<boolean|null>(null);
 useEffect(()=>{const c=new AbortController();void api<{user:User|null}>('/api/auth/me',{signal:c.signal}).then(async r=>{if(c.signal.aborted)return;setUser(r.user);if(r.user){const p=await api<{avatar:string|null}>('/api/profile',{signal:c.signal});if(!c.signal.aborted)setAvatar(p.avatar);}}).catch(()=>{});void api<{ok:boolean}>('/api/health',{signal:c.signal}).then(r=>setConnected(r.ok)).catch(()=>{if(!c.signal.aborted)setConnected(false);});return()=>c.abort();},[]);
 useEffect(()=>{const back=()=>{if(!canLeave()){window.history.pushState(null,'',currentUrl.current);return;}window.dispatchEvent(new Event('pagehide'));currentUrl.current=location.pathname+location.search;setTab(valid(new URLSearchParams(location.search).get('tab')));setRevision(n=>n+1);window.scrollTo(0,0);};window.addEventListener('popstate',back);return()=>window.removeEventListener('popstate',back);},[]);
 function navigate(next:Tab,search=''){
  if(next===tab&&!search)return;if(!canLeave())return;window.dispatchEvent(new Event('pagehide'));const query=new URLSearchParams(search);query.delete('next');query.set('tab',next);currentUrl.current='/android.html?'+query;window.history.pushState(null,'',currentUrl.current);setTab(next);setRevision(n=>n+1);window.scrollTo(0,0);
 }
 function captureLink(e:MouseEvent){
  if(e.button!==0||e.ctrlKey||e.metaKey||e.shiftKey||e.altKey)return;const anchor=(e.target as HTMLElement).closest('a');if(!anchor||anchor.target==='_blank'||anchor.hasAttribute('download'))return;const u=new URL(anchor.href,location.href);if(u.origin!==location.origin)return;
  const routes:Record<string,Tab>={'/':'talk','/index.html':'talk','/android.html':valid(u.searchParams.get('tab')),'/realtime.html':'live','/live-recognition.html':'live-camera','/learning.html':'learn','/training.html':'train','/sign-dictionary.html':'dictionary'};if(routes[u.pathname]){e.preventDefault();navigate(routes[u.pathname],u.search);}
 }
 return <div className="mobile-shell android-browser-preview" onClickCapture={captureLink}>
  <header className="mobile-top"><a href="/android.html" className="mobile-brand" aria-label="语桥安卓端首页"><span className="mobile-logo"><svg viewBox="0 0 40 40"><path d="M6 29Q20 5 34 29M6 29h28M12 21v8m8-13v13m8-8v8"/></svg></span><span>语桥<small>让沟通更简单</small></span></a><button className="mobile-profile" aria-label="打开我的" onClick={()=>navigate('me')}><UserAvatar src={avatar}/></button></header>
  <div className="mobile-connection"><span className={connected?'connected':''}/>{connected===null?'正在连接':connected?'服务已连接':'服务未连接'}<span className="mobile-preview-label">安卓端</span></div>
  {tab==='talk'&&<section className="mobile-welcome"><p>每一种表达，都值得被理解</p><h1>把想说的话，<br/><em>带到彼此身边。</em></h1><span className="mobile-welcome-art" aria-hidden="true"><i/><b/><svg viewBox="0 0 110 80"><path d="M5 65Q55-15 105 65M5 65h100M25 40v25M55 24v41M85 40v25"/></svg></span></section>}
  <main className={'mobile-content mobile-tab-'+tab}><Suspense fallback={<p className="mobile-mode-note" role="status">正在打开…</p>}>
   {tab==='talk'&&<Conversation key={'talk'+revision} user={user}/>}
   {tab==='live'&&<><div className="mobile-section-title"><span>手语转文字与语音</span><h1>让动作被听见</h1><p>使用当前启用的统一识别模型</p></div><Recorded key={'live'+revision}/></>}
   {tab==='live-camera'&&<><div className="mobile-section-title"><h1>实时识别</h1></div><LiveRecognition key={'live-camera'+revision}/></>}
   {tab==='learn'&&<><div className="mobile-section-title"><h1>手语学习</h1><p>查看动作、录制练习与保存</p></div><Learning key={'learn'+revision}/></>}
   {tab==='train'&&<Training key={'train'+revision}/>}
   {tab==='me'&&<><Account onAvatarChange={setAvatar}/><div className="mobile-menu"><button onClick={()=>navigate('dictionary')}><BookOpen/><span>手语词典<small>查词与动作示范</small></span><ChevronRight/></button><button onClick={()=>navigate('train')}><FolderOpen/><span>我的训练任务<small>录制资料、训练与查看结果</small></span><ChevronRight/></button></div></>}
   {tab==='dictionary'&&<><button className="text-button mobile-dictionary-back" onClick={()=>navigate('me')}><ArrowLeft size={16}/>返回我的</button><Dictionary/></>}
  </Suspense></main>
  <nav className="mobile-bottom" aria-label="移动端导航">{tabs.map(({id,label,icon:Icon})=><button key={id} aria-current={tab===id||tab==='dictionary'&&id==='me'||tab==='live-camera'&&id==='live'?'page':undefined} onClick={()=>navigate(id)}><span><Icon size={22}/></span>{label}</button>)}</nav>
 </div>;
}
