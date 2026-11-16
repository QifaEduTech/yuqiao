import {useCallback,useEffect,useState,type ReactNode} from 'react';
import {api,type User} from './api';
import {AuthForm,authEntries,type AuthEntry} from './Account';
import './auth-gate.css';

const entryOrder:AuthEntry[]=['normal','avatar','camera'];
const entryPaths:Record<AuthEntry,string>={normal:'/',avatar:'/avatar',camera:'/camera'};

/**
 * 三个入口共用的登录门禁：未登录先选进入哪个端并登录，登录后才渲染页面。
 * 这不是权限校验的唯一防线，后端接口仍逐个要求会话；这里只负责页面入口。
 * 当前三端共用同一账号空间；分端账号隔离尚未实现。
 */
export function AuthGate({entry,children}:{entry:AuthEntry;children:ReactNode}){
  const [user,setUser]=useState<User|null|undefined>(undefined);
  const [error,setError]=useState('');
  const [target,setTarget]=useState<AuthEntry>(entry);
  const redirectAfterAuth=useCallback((chosen:AuthEntry)=>{
    const next=new URLSearchParams(location.search).get('next');
    if(next&&next.startsWith('/')&&!next.startsWith('//')&&next!==location.pathname+location.search)location.replace(next);
    else if(chosen!==entry)location.replace(entryPaths[chosen]);
  },[entry]);
  const check=useCallback(()=>{
    setUser(undefined);setError('');
    void api<{user:User|null}>('/api/auth/me')
      .then(result=>{setUser(result.user);if(result.user)redirectAfterAuth(target);})
      .catch(()=>setError('暂时无法连接语桥服务，请确认服务已启动后重试。'));
  },[redirectAfterAuth,target]);
  useEffect(()=>{check();},[check]);
  useEffect(()=>{
    const onChange=()=>check();
    window.addEventListener('yuqiao-auth-changed',onChange);
    return()=>window.removeEventListener('yuqiao-auth-changed',onChange);
  },[check]);

  if(error) return <main className="auth-gate"><section className="auth-card">
    <div className="auth-brand"><span className="auth-mark" aria-hidden="true" /><strong>语桥</strong><small>YUQIAO</small></div>
    <h1 className="auth-heading">连接中断</h1>
    <p className="auth-message" role="alert">{error}</p>
    <button className="auth-submit" type="button" onClick={check}>重新连接</button>
  </section></main>;

  if(user===undefined) return <main className="auth-gate"><section className="auth-card auth-card-loading" aria-live="polite">
    <div className="auth-brand"><span className="auth-mark" aria-hidden="true" /><strong>语桥</strong><small>YUQIAO</small></div>
    <p className="auth-message">正在打开{authEntries[entry].name}…</p>
  </section></main>;

  if(!user) return <main className="auth-gate"><section className="auth-card" aria-label={`登录并选择进入的端，当前选择${authEntries[target].name}`}>
    <div className="auth-brand"><span className="auth-mark" aria-hidden="true" /><strong>语桥</strong><small>YUQIAO</small></div>
    <div className="auth-entries" role="group" aria-label="选择进入的端">
      {entryOrder.map(id=><button key={id} type="button" className={`auth-entry-option ${target===id?'selected':''}`} aria-pressed={target===id} onClick={()=>setTarget(id)}>
        <strong>{authEntries[id].name}</strong><span>{authEntries[id].description}</span>
      </button>)}
    </div>
    <AuthForm entry={target} onSignedIn={next=>{setUser(next);redirectAfterAuth(target);}} />
  </section></main>;

  return <>{children}</>;
}
