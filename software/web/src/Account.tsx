import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Clock3, Eye, EyeOff, FileText, LogIn, Trash2, Video, X } from 'lucide-react';
import { api, type SavedRecord, type User } from './api';
import {HistoryVideoRecognition} from './HistoryVideoRecognition';
import {PracticeHistory} from './PracticeHistory';
import {SampleRegistration} from './SampleRegistration';

export function AuthDialog({ open, onClose, onSignedIn,storageHint }: { open: boolean; onClose: () => void; onSignedIn: (user: User) => void;storageHint?:string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [captcha,setCaptcha]=useState<{id:string;image:string;expiresAt:number}|null>(null);
  const [captchaCode,setCaptchaCode]=useState(''),[captchaError,setCaptchaError]=useState(''),[captchaLoading,setCaptchaLoading]=useState(false);
  const captchaRequest=useRef<AbortController|null>(null),loginRequest=useRef<AbortController|null>(null);
  const refreshCaptcha=useCallback(async()=>{
    captchaRequest.current?.abort();const controller=new AbortController();captchaRequest.current=controller;
    setCaptcha(null);setCaptchaCode('');setCaptchaError('');setCaptchaLoading(true);
    let timedOut=false;const timeout=setTimeout(()=>{timedOut=true;controller.abort();},10000);
    try{
      const value=await api<{id:string;image:string;expiresAt:number}>('/api/auth/captcha',{method:'POST',signal:controller.signal});
      if(!controller.signal.aborted)setCaptcha(value);
    }catch(caught){if(captchaRequest.current===controller&&(!controller.signal.aborted||timedOut))setCaptchaError(timedOut?'验证码加载超时，请点击重试。':caught instanceof Error?caught.message:'验证码加载失败，请重试。');}
    finally{clearTimeout(timeout);if(captchaRequest.current===controller)setCaptchaLoading(false);}
  },[]);
  useEffect(() => {
    if (open) { dialog.current?.showModal(); setError(''); }
    else { dialog.current?.close(); setPassword(''); setConfirmation(''); setVisible(false); }
  }, [open]);
  useEffect(()=>{
    if(open&&mode==='login')void refreshCaptcha();
    else{setCaptcha(null);setCaptchaCode('');setCaptchaError('');setCaptchaLoading(false);}
    return()=>{captchaRequest.current?.abort();loginRequest.current?.abort();};
  },[open,mode,refreshCaptcha]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'register' && password !== confirmation) { setError('两次输入的密码不一致。'); return; }
    if(mode==='login'&&(!captcha||!/^[a-zA-Z0-9]{5}$/.test(captchaCode.trim()))){setError('请输入5位数字和英文字母验证码。');return;}
    setBusy(true); setError('');
    const controller=new AbortController();loginRequest.current=controller;
    try {
      const result = await api<{ user: User }>(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password,...(mode==='login'?{captchaId:captcha?.id,captchaCode:captchaCode.trim()}:{}) }),signal:controller.signal });
      if(controller.signal.aborted)return;
      onSignedIn(result.user); setPassword(''); setConfirmation(''); onClose();
    } catch (caught) { if(!controller.signal.aborted){setError(caught instanceof Error ? caught.message : '操作失败，请重试。');if(mode==='login')void refreshCaptcha();} }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="help-dialog auth-dialog" aria-labelledby="auth-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><span className="section-kicker">你的语桥账号</span><button className="icon-button" disabled={busy} aria-label="关闭登录窗口" onClick={onClose}><X size={18} /></button></div>
    <h2 id="auth-title">{mode === 'login' ? '欢迎回来' : '创建你的账号'}</h2><p className="auth-description">登录后，可以保存文字与手语录像，随时回来查看。</p>
    <div className="input-tabs"><button aria-pressed={mode === 'login'} className={mode === 'login' ? 'selected' : ''} disabled={busy} onClick={() => { setMode('login'); setError(''); setPassword(''); setConfirmation(''); }}>登录</button><button aria-pressed={mode === 'register'} className={mode === 'register' ? 'selected' : ''} disabled={busy} onClick={() => { setMode('register'); setError(''); setPassword(''); setConfirmation(''); }}>注册</button></div>
    <form onSubmit={event => void submit(event)}><label className="form-label" htmlFor="account-name">用户名</label><input id="account-name" autoComplete="username" required minLength={3} maxLength={24} value={username} onChange={event => setUsername(event.target.value)} placeholder="3–24 位汉字、字母、数字或下划线" disabled={busy} />
      <label className="form-label" htmlFor="account-password">密码</label><div className="password-input"><input id="account-password" type={visible ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={10} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} placeholder="至少 10 位" disabled={busy} /><button type="button" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div>
      {mode === 'register' && <><label className="form-label" htmlFor="account-confirm">再次输入密码</label><input id="account-confirm" type={visible ? 'text' : 'password'} autoComplete="new-password" required minLength={10} maxLength={128} value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} /></>}
      {mode==='login'&&<><label className="form-label" htmlFor="account-captcha">验证码</label><div className="captcha-row">
        <input id="account-captcha" required minLength={5} maxLength={5} pattern="[A-Za-z0-9]{5}" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={captchaCode} disabled={busy||captchaLoading||!captcha} onChange={event=>setCaptchaCode(event.target.value)} placeholder="输入5位验证码" aria-describedby="captcha-hint"/>
        <button className="captcha-image" type="button" aria-label="更换验证码" disabled={busy||captchaLoading} onClick={()=>void refreshCaptcha()}>{captcha?<img src={captcha.image} alt="登录验证码" width={180} height={60} onError={()=>{setCaptcha(null);setCaptchaError('验证码图片加载失败，请换一张。');}}/>:<span>{captchaLoading?'加载中…':'点击重试'}</span>}</button>
      </div><p id="captcha-hint" className="small-hint captcha-hint">5位数字和英文字母，不区分大小写，5分钟有效。<button type="button" className="text-button" disabled={busy||captchaLoading} onClick={()=>void refreshCaptcha()}>换一张</button></p>{captchaError&&<div className="inline-notice notice-error" role="alert">{captchaError}</div>}</>}
      {error && <div className="inline-notice notice-error" role="alert">{error}</div>}
      <button className="primary-button" type="submit" disabled={busy||(mode==='login'&&(captchaLoading||!captcha||captchaCode.trim().length!==5))}>{busy ? '正在处理…' : mode === 'login' ? '登录账号' : '注册并登录'}<ArrowRight size={16} /></button>
    </form><p className="small-hint">{storageHint??'账号与记录由后端管理，私人记录仅属于当前账号。'}</p>
  </dialog>;
}

export function HistoryDialog({ open, user, onClose,onDeleted,speechEnabled=true,trainingRegistration=false }: { open: boolean; user: User | null; onClose: () => void;onDeleted:(record:SavedRecord)=>void;speechEnabled?:boolean;trainingRegistration?:boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const player=useRef<HTMLVideoElement>(null),detail=useRef<HTMLDivElement>(null);
  const [records, setRecords] = useState<SavedRecord[]>([]);
  const [selected, setSelected] = useState<SavedRecord | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!open || !user) { dialog.current?.close(); setRecords([]); setSelected(null); return; }
    dialog.current?.showModal();
    setLoading(true); setError(''); setQuery(''); setConfirmDelete(''); setSelected(null);
    const controller = new AbortController();
    void api<{ records: SavedRecord[] }>('/api/records', { signal: controller.signal }).then(result => {if(!controller.signal.aborted)setRecords(result.records);}).catch(caught => { if (!controller.signal.aborted) setError(caught.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, user?.id]);
  useEffect(()=>{if(detail.current)detail.current.scrollTop=0;const video=player.current;return()=>{video?.pause();video?.removeAttribute('src');video?.load();};},[selected?.id,open]);
  async function remove(record: SavedRecord) {
    setDeleting(true); setError('');
    const video=player.current;video?.pause();video?.removeAttribute('src');video?.load();
    try { await api(`/api/records/${record.id}`, { method: 'DELETE' }); setRecords(current => current.filter(item => item.id !== record.id)); setSelected(null); setConfirmDelete('');onDeleted(record); }
    catch (caught) { if(video&&record.kind==='video')video.src=`/api/records/${record.id}/media`;setError(caught instanceof Error ? caught.message : '删除失败。'); }
    finally { setDeleting(false); }
  }
  const filtered = records.filter(record => (record.text || '手语录像').includes(query));
  return <dialog ref={dialog} className="history-dialog" aria-labelledby="history-title" onCancel={event => { event.preventDefault(); if (!deleting) onClose(); }}>
    <div className="dialog-heading"><span className="section-kicker">{user?.username} 的记录</span><button className="icon-button" disabled={deleting} aria-label="关闭我的记录" onClick={onClose}><X size={18} /></button></div><h2 id="history-title">我的记录</h2><p className="auth-description">保留的视频可随时重新识别。删除视频记录会同时删除录像文件及关联练习反馈；清空首页不会删除这里的记录。</p>
    <input className="history-search" aria-label="搜索我的记录" placeholder="搜索文字或录像备注…" value={query} onChange={event => setQuery(event.target.value)} />
    {error && <div role="alert" className="inline-notice notice-error">{error}</div>}
    <div className="history-layout"><div className="record-list">{loading ? <p className="history-empty">正在读取…</p> : !filtered.length ? <div className="history-empty"><Clock3 size={28} /><p>{query ? '没有匹配的记录' : '还没有保存记录'}</p><span>输入文字或录制完成后，点击保存即可。</span></div> : filtered.map(record => <div key={record.id} className="record-row"><button disabled={deleting} className={`record-item ${selected?.id === record.id ? 'selected' : ''}`} onClick={() => { setSelected(record); setConfirmDelete(''); }}>{record.kind === 'video' ? <Video size={18} /> : <FileText size={18} />}<span><strong>{record.text || '手语录像'}</strong><small>{new Date(record.created_at).toLocaleString('zh-CN', { hour12: false })}</small></span></button><button className="icon-button record-delete" disabled={deleting} aria-label={`删除${record.kind==='video'?'录像':'文字记录'}：${record.text||'手语录像'}`} onClick={()=>{setSelected(record);setConfirmDelete(record.id);}}><Trash2 size={15}/></button></div>)}</div>
      <div className="record-detail" ref={detail}>{selected&&open ? <><span className="section-kicker">{selected.kind === 'video' ? '已保存录像 · 备注为手动填写' : '已保存文字'}</span>{selected.kind === 'video' && <video ref={player} key={selected.id} src={`/api/records/${selected.id}/media`} controls playsInline aria-label="已保存的手语录像" />}<p className="saved-text">{selected.text || '没有备注。可回看或重新识别这段录像。'}</p><div className="delete-actions">{confirmDelete === selected.id ? <><span>{selected.kind==='video'?'将删除录像文件及这条记录、关联练习反馈及试采登记，无法恢复。':'删除后无法恢复。'}</span><button className="danger-button" disabled={deleting} onClick={() => void remove(selected)}>{deleting ? '正在删除…' : '确认删除'}</button><button className="text-button" disabled={deleting} onClick={() => setConfirmDelete('')}>取消</button></> : <button className="text-button" disabled={deleting} aria-label="删除这条记录" onClick={() => setConfirmDelete(selected.id)}><Trash2 size={14} />{selected.kind==='video'?'删除录像及记录':'删除这条记录'}</button>}</div>{selected.kind==='video'&&!deleting&&trainingRegistration&&<SampleRegistration key={'sample:'+user?.id+':'+selected.id} recordId={selected.id}/>}{selected.kind==='video'&&!deleting&&<PracticeHistory key={`practice:${user?.id}:${selected.id}`} recordId={selected.id}/>}{selected.kind==='video'&&<HistoryVideoRecognition key={`${user?.id}:${selected.id}`} record={selected} disabled={deleting} speechEnabled={speechEnabled}/>}</> : <div className="history-empty"><LogIn size={26} /><p>选择一条记录查看</p><span>文字和录像仅属于当前账号。</span></div>}</div></div>
  </dialog>;
}
