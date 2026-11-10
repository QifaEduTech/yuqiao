import {useEffect,useState,type MouseEvent} from 'react';
import {BookOpen,ChevronRight,Hand,History,MessageCircle,Settings,ShieldCheck,UserRound,Wifi,LogOut,Box} from 'lucide-react';
import App from './App';
import RealtimePage from './RealtimePage';
import LearningPage from './LearningPage';
import {AuthDialog,HistoryDialog} from './Account';
import {SettingsDialog} from './Settings';
import {api,type User} from './api';
type Tab='talk'|'live'|'learn'|'me';
const tabs=[{id:'talk' as Tab,label:'交流',icon:MessageCircle},{id:'live' as Tab,label:'识别',icon:Hand},{id:'learn' as Tab,label:'学习',icon:BookOpen},{id:'me' as Tab,label:'我的',icon:UserRound}];
export default function MobileApp(){
 const initial=new URLSearchParams(location.search).get('tab');
 const [tab,setTab]=useState<Tab>(tabs.some(t=>t.id===initial)?initial as Tab:'talk'),[revision,setRevision]=useState(0),[user,setUser]=useState<User|null>(null),[auth,setAuth]=useState(false),[history,setHistory]=useState(false),[settings,setSettings]=useState(false),[connected,setConnected]=useState<boolean|null>(null),[error,setError]=useState('');
 useEffect(()=>{const c=new AbortController();void api<{user:User|null}>('/api/auth/me',{signal:c.signal}).then(r=>setUser(r.user)).catch(()=>{});void api<{ok:boolean}>('/api/health',{signal:c.signal}).then(r=>setConnected(r.ok)).catch(()=>setConnected(false));return()=>c.abort();},[tab]);
 function navigate(value:Tab,search=''){window.dispatchEvent(new Event('pagehide'));const query=new URLSearchParams(search);query.set('tab',value);window.history.replaceState(null,'','/android.html?'+query);setTab(value);setRevision(n=>n+1);window.scrollTo({top:0});}
 function captureLink(e:MouseEvent){const anchor=(e.target as HTMLElement).closest('a');if(!anchor)return;const u=new URL(anchor.href,location.href);if(u.origin!==location.origin)return;const routes:Record<string,Tab>={'/':'talk','/index.html':'talk','/realtime.html':'live','/learning.html':'learn'};if(routes[u.pathname]){e.preventDefault();navigate(routes[u.pathname],u.search);}}
 async function logout(){try{await api('/api/auth/logout',{method:'POST'});setUser(null);}catch(e){setError(e instanceof Error?e.message:'退出失败，请重试。');}}
 return <div className="mobile-shell" onClickCapture={captureLink}>
  <header className="mobile-top"><a href="/android.html" className="mobile-brand" aria-label="语桥移动端首页"><span className="mobile-logo"><svg viewBox="0 0 40 40"><path d="M6 29Q20 5 34 29M6 29h28M12 21v8m8-13v13m8-8v8"/></svg></span><span>语桥<small>让沟通更简单</small></span></a><button className="mobile-profile" aria-label="打开我的" onClick={()=>navigate('me')}><UserRound size={21}/></button></header>
  <div className="mobile-connection"><span className={connected?'connected':''}/>{connected===null?'正在连接':connected?'电脑服务已连接':'电脑服务未连接'}<span className="mobile-preview-label">移动端联调</span></div>
  {tab==='talk'&&<section className="mobile-welcome"><p>每一种表达，都值得被理解</p><h1>把想说的话，<br/><em>带到彼此身边。</em></h1><span className="mobile-welcome-art" aria-hidden="true"><i/><b/><svg viewBox="0 0 110 80"><path d="M5 65Q55-15 105 65M5 65h100M25 40v25M55 24v41M85 40v25"/></svg></span></section>}
  <main className={'mobile-content mobile-tab-'+tab}>
   {tab==='talk'&&<App key={'talk'+revision}/>}
   {tab==='live'&&<><div className="mobile-section-title"><span>手语 → 文字与语音</span><h1>让动作被听见</h1><p>谢谢 · 帮助 · 需要 · 我</p></div><p className="mobile-mode-note">当前使用电脑识别服务。安卓本地摄像头识别适配中。</p><RealtimePage key={'live'+revision}/></>}
   {tab==='learn'&&<><div className="mobile-section-title"><span>一步一步，学会表达</span><h1>手语学习</h1><p>查看动作、练习与主动保存</p></div><LearningPage key={'learn'+revision}/></>}
   {tab==='me'&&<section className="mobile-account"><div className="mobile-user-card"><span><UserRound size={32}/></span><div><h1>{user?.username??'你好，欢迎来到语桥'}</h1><p>{user?'让每次练习都有迹可循':'登录后查看你的记录与账号设置'}</p></div></div>{!user&&<button className="primary-button mobile-login" onClick={()=>setAuth(true)}>登录 / 注册<ChevronRight size={18}/></button>}
    <div className="mobile-menu"><button onClick={()=>user?setHistory(true):setAuth(true)}><History/><span>我的记录<small>主动保存的内容</small></span><ChevronRight/></button><button onClick={()=>user?setSettings(true):setAuth(true)}><Settings/><span>账号与音色<small>资料设置 · 千问播报</small></span><ChevronRight/></button><a href="/sign-dictionary.html"><BookOpen/><span>手语词典<small>查词与动作示范</small></span><ChevronRight/></a><a href="/android-app/model-check.html"><Box/><span>本地模型包<small>只携带权重，不包含训练视频</small></span><ChevronRight/></a></div>
    <div className="mobile-trust"><ShieldCheck size={20}/><p>摄像头由你主动开启。训练录像留在电脑，不随安装包分发；账号数据由后端管理。</p></div><div className="mobile-backend"><Wifi size={16}/><span>电脑联调 · {connected?'服务已连接':'连接待检查'}</span></div>{user&&<button className="text-button mobile-logout" onClick={()=>void logout()}><LogOut size={16}/>退出登录</button>}{error&&<p role="alert">{error}</p>}
   </section>}
  </main>
  <nav className="mobile-bottom" aria-label="移动端导航">{tabs.map(({id,label,icon:Icon})=><button key={id} aria-current={tab===id?'page':undefined} onClick={()=>navigate(id)}><span><Icon size={23}/></span>{label}</button>)}</nav>
  <AuthDialog open={auth} onClose={()=>setAuth(false)} onSignedIn={setUser}/><HistoryDialog open={history} user={user} onClose={()=>setHistory(false)} onDeleted={()=>{}}/><SettingsDialog open={settings} user={user} onClose={()=>setSettings(false)} onProfileChange={()=>{}}/>
 </div>;
}
