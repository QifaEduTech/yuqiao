import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Camera, Check, KeyRound, LoaderCircle, Mail, Phone, Trash2, UserRound, X } from 'lucide-react';
import { api } from './api';
import {notifyTtsConfiguration} from './ttsConfiguration';

interface Profile { username: string; created_at: number | null; record_count: number; email: string | null; phone: string | null; avatar: string | null }
interface VoiceInfo { id: string; name: string; note: string | null; ref_text: string; duration: number; revision: number; status: 'pending' | 'confirmed'; created_at: number; sample_available: boolean }
export function SettingsDialog({ open, user, onClose, onProfileChange }: { open: boolean; user: { id: string; username: string } | null; onClose: () => void; onProfileChange: (avatar: string | null) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    if (!open || !user) { dialog.current?.close(); return; }
    dialog.current?.showModal();
    setError(''); setNotice(''); setVoices([]);
    setCurrentPassword(''); setNewPassword(''); setConfirmation('');
    const controller = new AbortController();
    void (async () => {
      try {
        const value = await api<Profile>('/api/profile', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setProfile(value); setEmail(value.email || ''); setPhone(value.phone || '');
        const sound = await api<{ voices: VoiceInfo[] }>('/api/voices', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setVoices(sound.voices);
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : '读取账号信息失败。'); }
    })();
    return () => controller.abort();
  }, [open, user?.id]);

  async function run(name: string, task: () => Promise<void>) {
    setBusy(name); setError(''); setNotice('');
    try { await task(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败，请重试。'); }
    finally { setBusy(''); }
  }

  function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void run('avatar', async () => {
      const value = await api<{ avatar: string | null }>('/api/profile/avatar', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      setProfile(current => current ? { ...current, avatar: value.avatar } : current);
      onProfileChange(value.avatar);
      setNotice('头像已更新。');
    });
  }

  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="dialog-heading"><span className="section-kicker">{user?.username} 的账号设置</span><button className="icon-button" disabled={Boolean(busy)} aria-label="关闭账号设置" onClick={onClose}><X size={18} /></button></div>
    <h2 id="settings-title">账号设置</h2>
    {error && <div className="inline-notice notice-error" role="alert">{error}</div>}
    {notice && <div className="inline-notice" role="status">{notice}</div>}

    <section className="settings-section">
      <h3><UserRound size={16} />查看账号</h3>
      <div className="avatar-row">
        <span className="avatar-preview" aria-label="当前头像">{profile?.avatar ? <img src={profile.avatar} alt="当前头像" /> : <UserRound size={26} />}</span>
        <div className="avatar-actions">
          <label className="secondary-button compact"><Camera size={15} />更换头像<input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={Boolean(busy)} onChange={uploadAvatar} /></label>
          {profile?.avatar && <button className="text-button" disabled={Boolean(busy)} onClick={() => void run('avatar-del', async () => {
            await api('/api/profile/avatar', { method: 'DELETE' });
            setProfile(current => current ? { ...current, avatar: null } : current); onProfileChange(null); setNotice('头像已移除。');
          })}><Trash2 size={14} />移除头像</button>}
        </div>
      </div>
      <dl className="settings-facts">
        <div><dt>用户名</dt><dd>{profile?.username || '—'}</dd></div>
        <div><dt>注册时间</dt><dd>{profile?.created_at ? new Date(profile.created_at).toLocaleString('zh-CN', { hour12: false }) : '—'}</dd></div>
        <div><dt>已保存记录</dt><dd>{profile ? `${profile.record_count} 条` : '—'}</dd></div>
      </dl>
      <p className="settings-hint">PNG / JPEG / WebP，不超过 2 MB。头像保存在本机项目内，不对外公开。</p>
    </section>

    <section className="settings-section">
      <h3><Mail size={16} />绑定邮箱</h3>
      <form className="settings-inline" noValidate onSubmit={event => { event.preventDefault(); void run('email', async () => {
        const value = await api<{ email: string | null }>('/api/profile/email', { method: 'POST', body: JSON.stringify({ value: email.trim() }) });
        setProfile(current => current ? { ...current, email: value.email } : current); setEmail(value.email || ''); setNotice(value.email ? '邮箱已绑定。' : '已解除邮箱绑定。');
      }); }}>
        <label className="sr-only" htmlFor="settings-email">邮箱地址</label>
        <input id="settings-email" type="email" inputMode="email" value={email} placeholder="you@example.com" disabled={Boolean(busy)} onChange={event => setEmail(event.target.value)} />
        <button className="secondary-button" type="submit" disabled={Boolean(busy)}>{busy === 'email' ? <LoaderCircle className="spinning" size={15} /> : <Check size={15} />}保存</button>
        {profile?.email && <button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => { setEmail(''); void run('email', async () => {
          const value = await api<{ email: string | null }>('/api/profile/email', { method: 'POST', body: JSON.stringify({ value: '' }) });
          setProfile(current => current ? { ...current, email: value.email } : current); setNotice('已解除邮箱绑定。');
        }); }}>解除绑定</button>}
      </form>
      <p className="settings-hint">仅用于展示与联系，当前版本不发送验证邮件。</p>
    </section>

    <section className="settings-section">
      <h3><Phone size={16} />绑定手机号</h3>
      <form className="settings-inline" noValidate onSubmit={event => { event.preventDefault(); void run('phone', async () => {
        const value = await api<{ phone: string | null }>('/api/profile/phone', { method: 'POST', body: JSON.stringify({ value: phone.trim() }) });
        setProfile(current => current ? { ...current, phone: value.phone } : current); setPhone(value.phone || ''); setNotice(value.phone ? '手机号已绑定。' : '已解除手机号绑定。');
      }); }}>
        <label className="sr-only" htmlFor="settings-phone">手机号</label>
        <input id="settings-phone" inputMode="tel" value={phone} placeholder="11 位手机号" disabled={Boolean(busy)} onChange={event => setPhone(event.target.value)} />
        <button className="secondary-button" type="submit" disabled={Boolean(busy)}>{busy === 'phone' ? <LoaderCircle className="spinning" size={15} /> : <Check size={15} />}保存</button>
        {profile?.phone && <button className="text-button" type="button" disabled={Boolean(busy)} onClick={() => { setPhone(''); void run('phone', async () => {
          const value = await api<{ phone: string | null }>('/api/profile/phone', { method: 'POST', body: JSON.stringify({ value: '' }) });
          setProfile(current => current ? { ...current, phone: value.phone } : current); setNotice('已解除手机号绑定。');
        }); }}>解除绑定</button>}
      </form>
      <p className="settings-hint">仅保存在本机账号中，当前版本不发送短信验证码。</p>
    </section>

    <section className="settings-section">
      <h3><KeyRound size={16} />修改密码</h3>
      <form className="settings-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void run('password', async () => {
        if (newPassword !== confirmation) throw new Error('两次输入的新密码不一致。');
        const value = await api<{ message: string }>('/api/auth/password', { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) });
        setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setNotice(value.message);
      }); }}>
        <label className="form-label" htmlFor="settings-current">当前密码</label>
        <input id="settings-current" type="password" autoComplete="current-password" value={currentPassword} disabled={Boolean(busy)} onChange={event => setCurrentPassword(event.target.value)} />
        <label className="form-label" htmlFor="settings-new">新密码</label>
        <input id="settings-new" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={newPassword} disabled={Boolean(busy)} onChange={event => setNewPassword(event.target.value)} />
        <label className="form-label" htmlFor="settings-confirm">再次输入新密码</label>
        <input id="settings-confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirmation} disabled={Boolean(busy)} onChange={event => setConfirmation(event.target.value)} />
        <button className="primary-button" type="submit" disabled={Boolean(busy) || !currentPassword || newPassword.length < 10}>{busy === 'password' ? <LoaderCircle className="spinning" size={16} /> : <KeyRound size={16} />}更新密码</button>
      </form>
      <p className="settings-hint">新密码至少 10 位。修改后，其他设备上的登录会退出。</p>
    </section>

    {open&&<CloudVoiceSection key={user?.id} voices={voices} setVoices={setVoices} />}
  </dialog>;
}

function CloudVoiceSection({voices,setVoices}:{voices:VoiceInfo[];setVoices:(value:VoiceInfo[])=>void}){
  const [voice,setVoice]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [apiKey,setApiKey]=useState(''),[configured,setConfigured]=useState(false),[saving,setSaving]=useState(false);
  const audio=useRef<HTMLAudioElement|null>(null),controller=useRef<AbortController|null>(null),url=useRef('');
  const keyController=useRef<AbortController|null>(null);
  useEffect(()=>{
    const task=new AbortController();
    void api<{available:boolean;voice?:string;reason?:string}>('/api/tts/status',{signal:task.signal}).then(r=>{setVoice(r.voice||'');if(!r.available)setError(r.reason||'千问音色暂不可用');}).catch(e=>{if(!task.signal.aborted)setError(e.message);});
    void api<{configured:boolean}>('/api/profile/tts-key',{signal:task.signal}).then(r=>{if(!task.signal.aborted)setConfigured(r.configured);}).catch(e=>{if(!task.signal.aborted)setError(e.message);});
    const cancel=()=>{controller.current?.abort();audio.current?.pause();};
    const hide=()=>{if(document.hidden)cancel();};document.addEventListener('visibilitychange',hide);window.addEventListener('pagehide',cancel);
    return()=>{task.abort();keyController.current?.abort();cancel();if(url.current)URL.revokeObjectURL(url.current);document.removeEventListener('visibilitychange',hide);window.removeEventListener('pagehide',cancel);};
  },[]);
  async function updateKey(remove=false){
    if(saving)return;
    controller.current?.abort();audio.current?.pause();if(url.current)URL.revokeObjectURL(url.current);url.current='';
    const task=new AbortController();keyController.current=task;setSaving(true);setError('');setNotice('');
    try{
      const value=await api<{configured:boolean}>('/api/profile/tts-key',{method:remove?'DELETE':'PUT',...(remove?{}:{body:JSON.stringify({apiKey})}),signal:task.signal});
      if(task.signal.aborted)return;
      setApiKey('');setConfigured(value.configured);
      notifyTtsConfiguration();
      const state=await api<{available:boolean;voice?:string}>('/api/tts/status',{signal:task.signal});
      if(task.signal.aborted)return;
      setVoice(state.available?state.voice||'千问 · Cherry':'');
      setNotice(remove?'已删除本账号的 API Key，并停用云播报。':'API Key 已加密保存。请点击试听，验证服务权限与额度。');
    }catch(e){if(!task.signal.aborted)setError(e instanceof Error?e.message:'配置未保存，请重试。');}
    finally{if(!task.signal.aborted)setSaving(false);}
  }
  async function preview(){
    controller.current?.abort();audio.current?.pause();if(url.current)URL.revokeObjectURL(url.current);url.current='';
    const task=new AbortController();controller.current=task;setBusy(true);setError('');setNotice('');const timer=setTimeout(()=>task.abort(),35000);
    const text='你好，欢迎使用语桥。谢谢，我需要帮助。';
    try{
      const r=await api<{audio:string;mime:string;text:string;revision:number}>('/api/tts/synthesize',{method:'POST',body:JSON.stringify({text,confirmed:true,revision:1}),signal:task.signal});
      if(task.signal.aborted)return;
      if(r.text!==text||r.revision!==1||r.mime!=='audio/wav'||r.audio.length>16*1024*1024)throw Error('语音结果无效。');
      const bytes=Uint8Array.from(atob(r.audio),c=>c.charCodeAt(0));url.current=URL.createObjectURL(new Blob([bytes],{type:r.mime}));
      if(audio.current){audio.current.src=url.current;await audio.current.play().catch(()=>setNotice('请点击播放器试听。'));}
    }catch(e){if(!task.signal.aborted)setError(e instanceof Error?e.message:'试听失败。');else setNotice('试听已取消或超时。');}
    finally{clearTimeout(timer);setBusy(false);}
  }
  async function remove(id:string){setError('');try{await api('/api/voices/'+id,{method:'DELETE'});setVoices(voices.filter(v=>v.id!==id));}catch(e){setError(e instanceof Error?e.message:'删除失败。');}}
  return <section className="settings-section"><h3>播报音色</h3>
    <p>{voice||'千问音色'} · 阿里云百炼</p>
    <form className="settings-form" onSubmit={event=>{event.preventDefault();void updateKey();}}>
      <label className="form-label" htmlFor="qwen-api-key">千问 API Key（中国内地）</label>
      <input id="qwen-api-key" type="password" autoComplete="off" spellCheck={false} maxLength={1024} value={apiKey} placeholder={configured?'已配置；输入新 Key 可替换':'输入你自己的百炼 API Key'} disabled={saving||busy} onChange={event=>setApiKey(event.target.value)}/>
      <div className="avatar-actions"><button className="secondary-button" type="submit" disabled={saving||busy||!apiKey.trim()}>{saving?'正在保存…':configured?'替换 API Key':'保存 API Key'}</button>
      {configured&&<button className="text-button" type="button" disabled={saving||busy} onClick={()=>void updateKey(true)}>删除 API Key</button>}</div>
    </form>
    <p className="settings-hint">仅用于本账号的千问播报。Key 在当前电脑后端加密保存，不会再次显示；换电脑后重新填写。模型：qwen3-tts-flash，音色：Cherry。</p>
    <p className="settings-hint">播报文字发送至阿里云百炼，需要联网；本项目不自动保存合成音频。摄像头画面和旧录音不会上传。</p>
    <button className="secondary-button" disabled={busy||saving||!voice} onClick={()=>void preview()}>{busy?'正在生成试听…':'试听千问音色'}</button>
    <audio ref={audio} controls aria-label="千问音色试听" onError={()=>setError('音频播放失败，请重试。')}/>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {voices.length>0&&<><h4>旧参考录音</h4><p className="settings-hint">本地个人音色已停用。以下录音仅保留在你的账号中，可自行删除。</p>{voices.map(v=><div key={v.id}><span>{v.name}</span><button className="text-button" onClick={()=>void remove(v.id)}><Trash2 size={16}/>删除录音</button></div>)}</>}
  </section>;
}

