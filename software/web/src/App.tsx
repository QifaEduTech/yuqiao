import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Camera, Check, ChevronRight, CircleHelp, Clock3, Hand, Keyboard, LogOut, Maximize2, MessageCircle, Mic, RotateCcw, Save, ShieldCheck, Sparkles, Trash2, UserRound, X } from 'lucide-react';
import Avatar, { type AvatarHandle } from './Avatar';
import { useMediaCapture } from './useMediaCapture';
import { api, ApiError, type SavedRecord, type User } from './api';
import { AuthDialog, HistoryDialog } from './Account';
import { VoiceInput } from './VoiceInput';
import { SettingsDialog } from './Settings';
import signCatalog from '../../shared/sign-catalog.json';
import type {MotionPreview} from './fixedMotionLibrary';
import './learning.css';

type Direction = 'to-sign' | 'to-text';
const examples = [...signCatalog.entries.map(entry=>entry.text),'你好，我爱你','我需要帮助','好，请等候'];
type PreviewMatch={status:'unsupported'|'asset_missing'|'asset_unverified';entry:{id:string;text:string}|null;preview:MotionPreview|null;missing?:string[];reason?:string};

function BridgeLogo() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><rect width="48" height="48" rx="15" fill="currentColor" /><path d="M11 30V19m26 11V19M11 25c7-14 19-14 26 0M18 20v11m12-11v11" fill="none" stroke="white" strokeWidth="3.2" strokeLinecap="round" /></svg>;
}

export default function App() {
  const [navigationOpen,setNavigationOpen]=useState(()=>window.innerWidth>760);
  const navigationToggle=useRef<HTMLButtonElement>(null);
  const [direction, setDirection] = useState<Direction>('to-sign');
  const [inputKind, setInputKind] = useState<'text' | 'voice'>('text');
  const [text, setText] = useState('');
  const [submittedText, setSubmittedText] = useState('');
  const [notice, setNotice] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedText, setSavedText] = useState('');
  const [savedTextId,setSavedTextId]=useState('');
  const [motionMatch,setMotionMatch]=useState<PreviewMatch|null>(null);
  const [playbackRequest,setPlaybackRequest]=useState(0);
  const [matching,setMatching]=useState(false);
  const media = useMediaCapture();
  const avatar = useRef<AvatarHandle>(null);
  const stage = useRef<HTMLElement>(null);
  const help = useRef<HTMLDialogElement>(null);
  const matchRevision=useRef(0);
  const matchRequest=useRef<AbortController|null>(null);
  const invalidateMatch=useCallback(()=>{
    avatar.current?.cancelMotion();
    matchRevision.current++;matchRequest.current?.abort();matchRequest.current=null;
    setMotionMatch(null);setMatching(false);setSubmittedText('');setNotice('');
  },[]);
  useEffect(()=>()=>{matchRevision.current++;matchRequest.current?.abort();},[]);

  useEffect(() => {
    const controller = new AbortController();
    void api<{ user: User | null }>('/api/auth/me', { signal: controller.signal }).then(result => setUser(result.user)).catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!user) { setAvatarUrl(null); setSettingsOpen(false); return; }
    const controller = new AbortController();
    void api<{ avatar: string | null }>('/api/profile', { signal: controller.signal })
      .then(value => setAvatarUrl(value.avatar)).catch(() => {});
    return () => controller.abort();
  }, [user?.id]);

  async function saveRecord(_kind:'text', explicitText?:string) {
    if(!user){setAuthOpen(true);return;}
    const value=(explicitText??text).trim();if(!value)return;
    setSaving(true);setNotice('');
    try { const result=await api<{record:SavedRecord}>('/api/records/text',{method:'POST',body:JSON.stringify({text:value})});setSavedTextId(result.record.id);setSavedText(value);setNotice('文字已保存到“我的记录”，刷新页面后仍可查看。'); }
    catch(caught){if(caught instanceof ApiError&&caught.status===401)setUser(null);setNotice(caught instanceof Error?caught.message:'保存失败，请重试。');}
    finally{setSaving(false);}
  }

  async function logout() {
    setSaving(true);
    try {
      await api('/api/auth/logout', { method: 'POST' });
      setUser(null); setHistoryOpen(false); clearSession(); setNotice('已退出账号。保存的记录仍保留在该账号下。');
    } catch (caught) { setNotice(caught instanceof Error ? caught.message : '退出失败，请重试。'); }
    finally { setSaving(false); }
  }

  function changeDirection(next: Direction) {
    if (next === direction || saving) return;
    invalidateMatch();
    media.clear();
    setDirection(next);
    setSubmittedText('');
    setNotice('');
  }

  function clearSession() {
    setSavedTextId('');
    invalidateMatch();
    media.clear();
    setText('');
    setSubmittedText('');
    setSavedText('');
    setNotice('本次输入已清空，设备已关闭。识别结果、已确认文字和已生成的语音都已失效；已保存的记录可在“我的记录”中管理。');
  }

  async function matchText(value:string) {
    invalidateMatch();
    const input=value.trim();if(!input)return;
    setSubmittedText(input);
    const revision=matchRevision.current,controller=new AbortController();matchRequest.current=controller;
    setMatching(true);setNotice('正在准备动作…');
    const timeout=setTimeout(()=>controller.abort('timeout'),105000);
    try {
      const result=await api<PreviewMatch>('/api/sign/resolve',{method:'POST',body:JSON.stringify({text:input,mode:'playback'}),signal:controller.signal});
      if(revision!==matchRevision.current||controller.signal.aborted)return;
      setMotionMatch(result);setPlaybackRequest(revision);
      setNotice(result.preview?'':result.reason==='too_many_actions'||result.reason==='too_long'?'这段内容过长，请缩短后重试。':'暂时无法完整表达这段内容，请换一种说法或查阅手语词典。');
    } catch(error) {
      if(revision===matchRevision.current)setNotice(controller.signal.reason==='timeout'?'处理超时，文字已保留，请重试。':error instanceof Error?error.message:'暂时无法准备动作，请重试。');
    } finally {clearTimeout(timeout);if(revision===matchRevision.current){matchRequest.current=null;setMatching(false);}}
  }

  function recordDeleted(record:SavedRecord){
    if(record.id===savedTextId){setSavedText('');setSavedTextId('');}
  }

  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await stage.current?.requestFullscreen();
    } catch { setNotice('当前浏览器不支持此处全屏，请使用浏览器的全屏功能。'); }
  }

  return <div className={`app-shell home-page ${navigationOpen?'navigation-open':'navigation-closed'}`}>
    <header className="site-header">
      <a className="brand" href="/" aria-label="语桥首页"><BridgeLogo /><span>语桥<span className="brand-en">YUQIAO</span></span><span className="brand-divider" /><span className="brand-purpose">让每一种表达，都被看见</span></a>
      <section className="intro home-header-intro">
        <div><div className="eyebrow"><span /> 连接中文与手语</div><h1>让交流，<span>自然发生。</span></h1><p>说出想说的话，也看见无声的表达。</p></div>
        <div className="intro-note"><ShieldCheck size={22} /><div><strong>由你掌控每一次输入</strong><span>设备仅在主动开启后使用</span></div></div>
      </section>
      <div className="header-actions">{user ? <><button className="account-name account-settings-entry" title="账号设置" onClick={() => setSettingsOpen(true)}>{avatarUrl ? <img className="account-avatar" src={avatarUrl} alt="" /> : <UserRound size={15} />}{user.username}</button><button className="quiet-button" aria-label="退出登录" disabled={saving} onClick={() => void logout()}><LogOut size={17} /></button></> : <button className="account-button" disabled={saving} onClick={() => setAuthOpen(true)}><UserRound size={16} />登录 / 注册</button>}<button className="quiet-button" aria-label="使用说明" onClick={() => help.current?.showModal()}><CircleHelp size={17} /><span>使用说明</span></button></div>
    </header>
    <aside className="home-navigation-dock" onKeyDown={event=>{if(event.key==='Escape'){setNavigationOpen(false);navigationToggle.current?.focus();}}}>
      <button ref={navigationToggle} className="navigation-toggle" aria-controls="home-navigation" aria-expanded={navigationOpen} onClick={()=>setNavigationOpen(open=>!open)}><ChevronRight size={17} style={{transform:navigationOpen?undefined:'rotate(180deg)'}}/>{navigationOpen?'收起导航':'展开导航'}</button>
      <nav id="home-navigation" className="home-navigation" hidden={!navigationOpen} aria-label="主要功能"><a className="quiet-button" href="/training.html">动作训练</a><a className="quiet-button learning-entry" href="/learning.html" aria-label="手语学习"><Hand size={17}/><span>手语学习</span></a><a className="quiet-button" href="/sign-dictionary.html" aria-label="手语词典"><BookOpen size={17}/><span>手语词典</span></a><button className="quiet-button" disabled={saving} onClick={() => user ? setHistoryOpen(true) : setAuthOpen(true)}><Clock3 size={17} /><span>我的记录</span></button><a className="quiet-button" href="/anny-review.html"><Sparkles size={17}/>固定动作预览</a></nav>
    </aside>

    <main>


      <div className="workspace-toolbar">
        <div className="direction-tabs" role="tablist" aria-label="交流方向">
          <button role="tab" id="to-sign-tab" aria-selected={direction === 'to-sign'} aria-controls="workspace" onClick={() => changeDirection('to-sign')} className={direction === 'to-sign' ? 'active' : ''}><MessageCircle size={18} />文字 / 语音<ArrowRight size={15} /><Hand size={18} />手语</button>
          <button role="tab" id="to-text-tab" aria-selected={direction === 'to-text'} aria-controls="workspace" onClick={() => changeDirection('to-text')} className={direction === 'to-text' ? 'active' : ''}><Hand size={18} />手语<ArrowRight size={15} /><MessageCircle size={18} />文字</button>
        </div>
        <button className="quiet-button clear-button" disabled={saving} onClick={clearSession}><Trash2 size={16} />清空本次交流</button>
      </div>

      <div className="workspace" role="tabpanel" id="workspace" aria-labelledby={`${direction}-tab`}>
        <section className={`stage ${direction === 'to-text' ? 'camera-stage' : motionMatch?.preview?'has-home-motion':''}`} ref={stage} aria-label={direction === 'to-sign' ? '数字人展示区域' : '摄像头取景区域'}>
          <div className="stage-topline">
            <span className="stage-label">{direction === 'to-sign' ? <><span className="status-dot" />数字人空间</> : <><Camera size={15} />实时交流</>}</span>
            <span className="stage-badge">{direction==='to-sign'?'Anny 数字人':'实时试用 · 谢谢'}</span>
          </div>

          {direction === 'to-sign' ? <>
            <div className="stage-orbit orbit-one" /><div className="stage-orbit orbit-two" />
            <div className="stage-greeting"><span className="greeting-line" /><span>你好，我是语桥</span><small>很高兴与你见面</small></div>
            <Avatar ref={avatar} preview={motionMatch?.preview??null} autoPlay requestId={playbackRequest} displayText={submittedText} />
            {!motionMatch?.preview&&<div className="avatar-caption"><span className="caption-dot" />{matching?'正在准备动作…':submittedText?'请修改内容后重试':'准备好，开始一段交流'}</div>}
          </> : <div className="realtime-placeholder"><Hand size={42}/><h2>实时手语试用</h2><p>开启摄像头，先尝试“谢谢”。<br/>持续处理画面，不需要录制或保存。</p><a className="primary-button" href="/realtime.html">进入实时试用<ArrowRight size={17}/></a><a className="text-button" href="/learning.html">前往手语学习</a></div>}

          <div className="stage-bottomline"><span>{direction === 'to-sign' ? '左键旋转 · 右键平移 · 滚轮缩放' : '单动作练习请进入手语学习'}</span><div>{direction === 'to-sign' && <button className="icon-button" title="恢复正面位置与缩放" aria-label="恢复正面视角" onClick={() => avatar.current?.resetView()}><RotateCcw size={16} /></button>}<button className="icon-button" title="全屏查看" aria-label="全屏查看" onClick={() => void fullscreen()}><Maximize2 size={16} /></button></div></div>
        </section>

        <aside className="interaction-panel">
          <div className="panel-heading"><span className="section-kicker">{direction === 'to-sign' ? '你的表达' : '你的手语'}</span><h2>{direction === 'to-sign' ? '想说些什么？' : '先试一次“谢谢”'}</h2><p>{direction === 'to-sign' ? '用你习惯的方式，开启这段对话。' : '实时试用支持按停顿记入“谢谢”，结果需要核对。'}</p></div>


          {direction === 'to-sign' ? <>
            <div className="input-tabs" role="group" aria-label="输入方式"><button aria-pressed={inputKind === 'text'} className={inputKind === 'text' ? 'selected' : ''} onClick={() => { invalidateMatch();media.clear(); setInputKind('text'); }}><Keyboard size={16} />文字输入</button><button aria-pressed={inputKind === 'voice'} className={inputKind === 'voice' ? 'selected' : ''} onClick={() => { invalidateMatch();media.clear(); setInputKind('voice'); }}><Mic size={16} />语音输入</button></div>
            {inputKind === 'text' ? <>
              <div className="textarea-wrap"><label className="sr-only" htmlFor="message">输入要表达的中文</label><textarea id="message" value={text} maxLength={2000} placeholder="在这里输入你想表达的内容…" onChange={event => { invalidateMatch();setText(event.target.value); }} /><div className="textarea-footer"><span>动作表达建议500字以内，文字保存上限2000字</span><span>{text.length}/2000</span></div></div>
              <div className="examples"><span>试着输入</span><div>{examples.map(example => <button key={example} onClick={() => { invalidateMatch();setText(example); }}>{example}<ChevronRight size={14} /></button>)}</div></div>
              <button className="primary-button submit-button" disabled={!text.trim()||matching} onClick={()=>void matchText(text)}>{matching?'正在准备…':'提交文字'}<ArrowRight size={18} /></button>
              <button className="secondary-button save-text-button" disabled={saving || !text.trim() || savedText === text.trim()} onClick={() => void saveRecord('text')}><Save size={16} />{saving ? '正在保存…' : savedText === text.trim() && text.trim() ? '文字已保存' : user ? '保存文字到我的记录' : '登录并保存文字'}</button>
            </> : <VoiceInput media={media} loggedIn={Boolean(user)} saving={saving} savedText={savedText} matching={matching} onInvalidate={invalidateMatch} onMatch={value=>void matchText(value)} onSave={value => void saveRecord('text', value)} onUseText={value => { invalidateMatch();setText(value); media.clear(); setInputKind('text'); setNotice('已转入文字输入，可继续修改，提交后会自动播放。'); }} />}
          </> : <div className="realtime-note"><p>实时试用先只尝试“谢谢”，不要求登录或保存录像。</p><p>做完后让双手移出画面约一秒，候选稳定才记入文字；不是连续整句翻译，不自动播报。</p><p>四词录制练习、词典示范与个人反馈仍在手语学习中。</p></div>}

          {(media.error || notice) && <div className={`inline-notice ${media.error ? 'notice-error' : ''}`} role="status">{media.error || notice}</div>}

          <div className="panel-bottom"><ShieldCheck size={15} /><span>输入由你开启，也可以随时清除。</span></div>
        </aside>
      </div>


      <section className="conversation-strip" aria-label="当前内容"><div className="strip-icon"><MessageCircle size={21} /></div><div><span className="section-kicker">{motionMatch?.preview?'本次原话 · 保留输入内容':submittedText ? '本次原话 · 尚未转换' : '交流，从一句话开始'}</span><p>{submittedText || '选择一种方式，把你想表达的内容带到这里。'}</p></div><span className="strip-note">{motionMatch?.preview?'可暂停或重播':matching?'正在准备动作':submittedText?'请修改后重试':'每一种表达，都值得被理解'}</span></section>

      <section className="stage-info"><span className="stage-number">02</span><div><strong>手语学习 · 从一个动作开始</strong><p>单动作录制与四词候选识别已移到学习模块。文字／语音到手语继续在这里使用；实时页已提供“谢谢”的停顿结束与去重试用，真实重复动作效果待核对。</p></div><a className="progress-tag" href="/anny-review.html"><Sparkles size={14} />固定动作预览</a></section>
    </main>
    <footer><span>语桥 · 让沟通多一种可能</span><span>以国家通用手语规范为后续内容依据</span></footer>

    <dialog ref={help} className="help-dialog" aria-labelledby="help-title" onClick={event => { if (event.target === help.current) help.current.close(); }}>
      <div className="dialog-heading"><span className="section-kicker">欢迎使用语桥</span><button className="icon-button" aria-label="关闭使用说明" onClick={() => help.current?.close()}><X size={20} /></button></div><h2 id="help-title">先试试这三个地方</h2>
      <div className="help-item"><Check size={19} /><div><strong>自由查看数字人</strong><p>在人物区域左键拖动旋转，右键拖动上下、左右平移，滚轮放大缩小；可查看侧面和背面。点击复位按钮恢复正面位置和缩放。触屏使用单指旋转、双指平移或缩放。</p></div></div>
      <div className="help-item"><Keyboard size={19} /><div><strong>整句输入，一次播放</strong><p>提交文字后，数字人会在准备好动作后自动播放完整段。语音输入先核对转写文字，确认后自动播放。可以暂停、重播或调速；修改文字或清空会立即停止旧动作。暂时无法完整表达的内容会提示重试，原话始终保留。</p></div></div>
      <div className="help-item"><Camera size={19} /><div><strong>进入手语学习</strong><p>点击页面顶部“手语学习”，每次录一个完整动作，回看并确认保存后，独立点击识别获取四词候选。学习页已提供词典示范与个人反馈；实时试用入口只尝试“谢谢”，不录制视频。</p></div></div>
      <div className="help-note"><ShieldCheck size={18} /><p>录制时内容先保存在浏览器内存中。只有点击保存，文字或录像才会写入本机项目里的当前账号。清空页面不会删除已保存记录；可在“我的记录”中单独删除。语音录音暂不保存。首页动作试播无需登录，内容仍待核对。</p></div>
      <button className="primary-button" onClick={() => help.current?.close()}>开始体验<ArrowRight size={17} /></button>
    </dialog>
    <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} onSignedIn={next => { setUser(next); setNotice('已登录，可以继续保存当前文字。'); }} />
    <HistoryDialog open={historyOpen} user={user} onClose={() => setHistoryOpen(false)} onDeleted={recordDeleted} />
    <SettingsDialog open={settingsOpen} user={user} onClose={() => setSettingsOpen(false)} onProfileChange={setAvatarUrl} />
  </div>;
}

