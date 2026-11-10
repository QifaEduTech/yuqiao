import {useCallback,useEffect,useRef,useState} from 'react';
import {ChevronRight,History,LogOut,RefreshCw,Settings,ShieldCheck,UserRound,Wifi} from 'lucide-react';
import {api,type User} from './api';
import {AuthDialog,HistoryDialog} from './Account';
import {SettingsDialog} from './Settings';
import {accountOrigin,openNativeAccount,packagedPage,savedAccountOrigin} from './nativeAccount';
import UserAvatar from './UserAvatar';

export default function MobileAccount({onAvatarChange}:{onAvatarChange?:(avatar:string|null)=>void}){return packagedPage()?<PackagedAccount/>:<ConnectedAccount onAvatarChange={onAvatarChange}/>;}
function PackagedAccount(){
 const [address,setAddress]=useState(savedAccountOrigin),[error,setError]=useState('');const close=useRef<(()=>void)|null>(null);
 useEffect(()=>()=>close.current?.(),[]);
 function connect(){try{setError('');const value=accountOrigin(address);setAddress(value);close.current?.();close.current=openNativeAccount(value,setError);}catch(e){setError(e instanceof Error?e.message:'连接失败。');}}
 return <section className="mobile-account"><div className="mobile-user-card"><span><UserRound size={32}/></span><div><h1>连接你的语桥账号</h1><p>与Web端共用账号和记录</p></div></div><section className="offline-service-card account-connect"><h2>账号服务</h2><p>登录和记录需要联网，离线动作仍可使用。服务窗口中可注册、登录、管理资料和退出。</p><label htmlFor="account-service">服务地址</label><input id="account-service" inputMode="url" value={address} onChange={e=>setAddress(e.target.value)} placeholder="https://你的服务域名"/><button className="primary-button" onClick={connect}>打开账号服务<ChevronRight size={17}/></button><p className="offline-hint">默认地址用于电脑模拟器联调。独立服务器部署后填写 HTTPS 地址，无需电脑常开。</p>{error&&<p role="alert" className="inline-notice notice-error">{error}</p>}</section><div className="mobile-trust"><ShieldCheck size={20}/><p>App只记住服务地址。密码不保存在页面缓存中，MySQL连接信息和千问密钥不会进入安装包。</p></div></section>;
}
function ConnectedAccount({onAvatarChange}:{onAvatarChange?:(avatar:string|null)=>void}){
 const [avatar,setAvatar]=useState<string|null>(null);
 const updateAvatar=useCallback((value:string|null)=>{setAvatar(value);onAvatarChange?.(value);},[onAvatarChange]);
 const [user,setUser]=useState<User|null>(null),[loading,setLoading]=useState(true),[available,setAvailable]=useState(false),[error,setError]=useState(''),[auth,setAuth]=useState(false),[history,setHistory]=useState(false),[settings,setSettings]=useState(false),[count,setCount]=useState<number|null>(null),[logoutBusy,setLogoutBusy]=useState(false);
 const controller=useRef<AbortController|null>(null),generation=useRef(0),avatarOwner=useRef<string|null>(null);
 const refresh=useCallback(async()=>{
  controller.current?.abort();const task=new AbortController();controller.current=task;const version=++generation.current;setLoading(true);setError('');
  try{const r=await api<{user:User|null}>('/api/auth/me',{signal:task.signal});if(task.signal.aborted||version!==generation.current)return;if(avatarOwner.current!==(r.user?.id??null)){avatarOwner.current=r.user?.id??null;updateAvatar(null);}setUser(r.user);setAvailable(true);if(r.user){const profile=await api<{record_count:number;avatar:string|null}>('/api/profile',{signal:task.signal});if(!task.signal.aborted&&version===generation.current){setCount(profile.record_count);updateAvatar(profile.avatar??null);}}else{setCount(null);updateAvatar(null);}}
  catch(e){if(!task.signal.aborted&&version===generation.current){setAvailable(false);setUser(null);setCount(null);updateAvatar(null);setHistory(false);setSettings(false);setError(e instanceof Error?e.message:'账号服务暂不可用。');}}
  finally{if(!task.signal.aborted&&version===generation.current)setLoading(false);}
 },[updateAvatar]);
 useEffect(()=>{void refresh();const onVisible=()=>{if(!document.hidden)void refresh();};document.addEventListener('visibilitychange',onVisible);return()=>{generation.current++;controller.current?.abort();document.removeEventListener('visibilitychange',onVisible);};},[refresh]);
 async function logout(){
  generation.current++;controller.current?.abort();setLoading(false);setLogoutBusy(true);setError('');setHistory(false);setSettings(false);
  try{await api('/api/auth/logout',{method:'POST'});setUser(null);setCount(null);updateAvatar(null);}catch(e){setError(e instanceof Error?e.message:'退出失败，请重试。');}finally{setLogoutBusy(false);}
 }
 function signedIn(value:User){setUser(value);setAuth(false);void refresh();}
 return <section className="mobile-account" aria-label="移动端账号"><div className="mobile-user-card"><span><UserAvatar src={avatar} size={32}/></span><div><h1>{user?.username??'你好，欢迎来到语桥'}</h1><p>{user?'已登录 · 与Web共用账号':'登录后查看你的资料与记录'}</p></div></div>
  <div className="mobile-backend account-service-state"><Wifi size={15}/><span>{loading?'正在检查登录状态…':available?'账号服务已连接':'账号服务暂不可用'}</span><button className="text-button" aria-label="刷新登录状态" disabled={loading||logoutBusy} onClick={()=>void refresh()}><RefreshCw size={15}/></button></div>
  {!user&&<button className="primary-button mobile-login" disabled={loading||!available} onClick={()=>setAuth(true)}>登录 / 注册<ChevronRight size={18}/></button>}
  <div className="mobile-menu"><button disabled={loading||!available||logoutBusy} onClick={()=>user?setHistory(true):setAuth(true)}><History/><span>我的记录<small>{count===null?'查看主动保存的内容':`已保存 ${count} 条记录`}</small></span><ChevronRight/></button><button disabled={loading||!available||logoutBusy} onClick={()=>user?setSettings(true):setAuth(true)}><Settings/><span>账号设置<small>头像 · 联系方式 · 密码 · 音色</small></span><ChevronRight/></button></div>
  {error&&<p className="inline-notice notice-error" role="alert">{error}</p>}
  <div className="mobile-trust"><ShieldCheck size={20}/><p>账号资料与记录通过后端存入 MySQL。登录需要连接账号服务；本地动作示范不受影响。</p></div>
  {user&&<button className="text-button mobile-logout" disabled={logoutBusy} onClick={()=>void logout()}><LogOut size={16}/>{logoutBusy?'正在退出…':'退出登录'}</button>}
  <AuthDialog open={auth} onClose={()=>setAuth(false)} onSignedIn={signedIn} storageHint="与Web端使用同一账号。账号数据保存在后端MySQL；页面不保存明文密码。"/>
  <HistoryDialog open={history} user={user} onClose={()=>setHistory(false)} onDeleted={()=>void refresh()} speechEnabled={false}/>
  <SettingsDialog open={settings} user={user} onClose={()=>{setSettings(false);void refresh();}} onProfileChange={updateAvatar}/>
 </section>;
}
