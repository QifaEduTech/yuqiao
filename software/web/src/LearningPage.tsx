import LearningPreview from './LearningPreview';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,BookOpen,Camera,Clock3,Hand,LogOut,Maximize2,RotateCcw,Save,ShieldCheck,Square,Trash2,UserRound,Video} from 'lucide-react';
import {api,ApiError,type SavedRecord,type User} from './api';
import {AuthDialog,HistoryDialog} from './Account';
import {SettingsDialog} from './Settings';
import {useMediaCapture} from './useMediaCapture';
import {VideoPreprocessing} from './VideoPreprocessing';
import realtimeTargets from '../../shared/realtime-targets.json';
const recordingEntries=Object.values(realtimeTargets).map(t=>({id:t.signId,text:t.text}));
import {readVideoDuration} from './video/preprocess';

export default function LearningPage(){
  const media=useMediaCapture();
  const [supportedWords,setSupportedWords]=useState(recordingEntries.map(e=>e.text));
  const [user,setUser]=useState<User|null>(null),[authOpen,setAuthOpen]=useState(false),[historyOpen,setHistoryOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
  const [avatarUrl,setAvatarUrl]=useState<string|null>(null);
  const [step,setStep]=useState<'capture'|'review'|'saved'>('capture'),[note,setNote]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false);
  const [saved,setSaved]=useState<{blob:Blob;id:string;userId:string;token:number}|null>(null);
  const [recognition,setRecognition]=useState<{blob:Blob;recordId:string;saveToken:number}|null>(null);
  const [durationInfo,setDurationInfo]=useState<{blob:Blob;seconds:number}|null>(null);
  const recordingDuration=durationInfo?.blob===media.recordingBlob?durationInfo.seconds:null;
  useEffect(()=>{
    setDurationInfo(null);const blob=media.recordingBlob,controller=new AbortController();
    if(blob)void readVideoDuration(blob,controller.signal).then(seconds=>{if(!controller.signal.aborted)setDurationInfo({blob,seconds});}).catch(error=>{if(!controller.signal.aborted)setNotice(error instanceof Error?error.message:'无法确认录像时长。');});
    return()=>controller.abort();
  },[media.recordingBlob]);
  const saveIdentity=useRef<{blob:Blob;userId:string;key:string}|null>(null);
  const liveVideo=useRef<HTMLVideoElement>(null),stage=useRef<HTMLElement>(null);
  const owner=useRef<User|null>(null),revision=useRef(0),counter=useRef(0),request=useRef<AbortController|null>(null),sessionRequest=useRef<AbortController|null>(null);
  const clear=useCallback(()=>{
    revision.current++;request.current?.abort();request.current=null;setSaving(false);
    media.clear();setSaved(null);setRecognition(null);setStep('capture');setNote('');setNotice('');saveIdentity.current=null;
  },[media.clear]);
  const signedIn=useCallback((next:User)=>{sessionRequest.current?.abort();owner.current=next;setUser(next);setNotice('已登录，请继续确认保存录像。');},[]);
  useEffect(()=>{
    const refresh=()=>{
      sessionRequest.current?.abort();const controller=new AbortController();sessionRequest.current=controller;
      void api<{user:User|null}>('/api/auth/me',{signal:controller.signal}).then(value=>{
        if(controller.signal.aborted)return;
        if(owner.current&&owner.current.id!==value.user?.id){clear();setHistoryOpen(false);setSettingsOpen(false);}
        owner.current=value.user;setUser(value.user);void api<{labels:string[]}>('/api/sign/status',{signal:controller.signal}).then(s=>{if(!controller.signal.aborted&&Array.isArray(s.labels))setSupportedWords(s.labels);}).catch(()=>{});
      }).catch(()=>{});
    };
    const leave=()=>{revision.current++;request.current?.abort();setRecognition(null);};
    refresh();window.addEventListener('focus',refresh);window.addEventListener('pagehide',leave);
    return()=>{leave();sessionRequest.current?.abort();window.removeEventListener('focus',refresh);window.removeEventListener('pagehide',leave);};
  },[clear]);
  useEffect(()=>{
    if(liveVideo.current)liveVideo.current.srcObject=media.stream;
  },[media.stream]);
  useEffect(()=>{
    // A new or cleared Blob must never inherit the previous save/recognition token.
    revision.current++;request.current?.abort();request.current=null;setSaving(false);setSaved(null);setRecognition(null);setStep('capture');
  },[media.recordingBlob]);
  useEffect(()=>{
    setAvatarUrl(null);if(!user){setSettingsOpen(false);return;}
    const controller=new AbortController();void api<{avatar:string|null}>('/api/profile',{signal:controller.signal}).then(v=>{if(!controller.signal.aborted)setAvatarUrl(v.avatar);}).catch(()=>{});return()=>controller.abort();
  },[user?.id]);
  async function save(){
    if(saving||request.current)return;
    if(!user){setAuthOpen(true);return;}
    const blob=media.recordingBlob;if(!blob||saved?.blob===blob)return;
    if(recordingDuration===null){setNotice('正在读取录像实际时长，请稍候。');return;}
    if(saveIdentity.current?.blob!==blob||saveIdentity.current.userId!==user.id)saveIdentity.current={blob,userId:user.id,key:crypto.randomUUID()};
    const saveKey=saveIdentity.current.key;
    const epoch=++revision.current,account=user.id,controller=new AbortController();request.current=controller;setSaving(true);setNotice('');
    try{
      const session=await api<{user:User|null}>('/api/auth/me',{signal:controller.signal});
      if(controller.signal.aborted||epoch!==revision.current)return;
      if(session.user?.id!==account){clear();owner.current=session.user;setUser(session.user);setNotice('账号状态已变化，请在当前账号重新开始练习。');if(!session.user)setAuthOpen(true);return;}
      const result=await api<{record:SavedRecord;registration?:{sample:{sampleNumber:string}|null}|null}>(`/api/records/video?text=${encodeURIComponent(note.trim()||'单动作练习')}&duration=${recordingDuration}`,{method:'POST',headers:{'Content-Type':blob.type||'video/webm','X-Yuqiao-Save-Key':saveKey},body:blob,signal:controller.signal});
      if(controller.signal.aborted||epoch!==revision.current||owner.current?.id!==account)return;
      setSaved({blob,id:result.record.id,userId:account,token:++counter.current});setStep('saved');setNotice('练习录像已保存；不会进入训练集。需要时可以手动识别。');
    }catch(error){
      if(epoch!==revision.current||controller.signal.aborted)return;
      if(error instanceof ApiError&&error.status===401){owner.current=null;setUser(null);setAuthOpen(true);}
      setNotice(error instanceof Error?error.message:'保存失败，请重试。');
    }finally{if(epoch===revision.current){request.current=null;setSaving(false);}}
  }
  async function logout(){
    if(saving)return;setSaving(true);
    try{await api('/api/auth/logout',{method:'POST'});owner.current=null;setUser(null);setHistoryOpen(false);clear();setNotice('已退出账号，当前练习已清除；已保存录像仍在原账号中。');}
    catch(error){setNotice(error instanceof Error?error.message:'退出失败，请重试。');}finally{setSaving(false);}
  }
  function recordDeleted(record:SavedRecord){if(record.id===saved?.id){clear();setNotice('本次录像已删除，旧识别结果已清除。');}}
  function restart(){clear();void media.open('video');}
  async function fullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await stage.current?.requestFullscreen();}catch{setNotice('当前浏览器不支持此处全屏。');}}
  const capturing=media.status==='recording',requesting=media.status==='requesting';
  const sampleReady=recordingDuration!==null;
  const token=saved&&saved.blob===media.recordingBlob&&saved.userId===user?.id?saved.token:0;
  const recognitionCurrent=!!token&&recognition?.blob===media.recordingBlob&&recognition?.recordId===saved?.id&&recognition?.saveToken===token;
  const timer=`00:${String(media.seconds).padStart(2,'0')}`;
  return <div className="app-shell learning-page">
    <header className="site-header"><a className="learning-brand" href="/" aria-label="返回交流首页"><ArrowLeft size={18}/><strong>语桥</strong><span>返回交流</span></a><div className="header-actions"><a className="quiet-button" href="/training.html">动作训练</a><a className="quiet-button" href="/realtime.html">实时试用</a>
      <a className="quiet-button" href="/sign-dictionary.html" aria-label="手语词典"><BookOpen size={17}/><span>手语词典</span></a>
      <button className="quiet-button" aria-label="我的记录" title="我的记录" disabled={saving} onClick={()=>user?setHistoryOpen(true):setAuthOpen(true)}><Clock3 size={17}/><span>我的记录</span></button>
      {user?<><button className="account-name account-settings-entry" disabled={saving} title="账号设置" onClick={()=>setSettingsOpen(true)}>{avatarUrl?<img className="account-avatar" src={avatarUrl} alt=""/>:<UserRound size={15}/>} {user.username}</button><button className="quiet-button" aria-label="退出登录" disabled={saving} onClick={()=>void logout()}><LogOut size={17}/></button></>:<button className="account-button" disabled={saving} onClick={()=>setAuthOpen(true)}><UserRound size={16}/>登录 / 注册</button>}
    </div></header>
    <main><section className="intro"><div><div className="eyebrow"><span/> 手语学习 · 单动作练习</div><h1>一个动作，<span>慢慢练好。</span></h1><p>每次录一个完整动作，保存与识别分开操作。需要识别时，再点击开始识别。</p></div><div className="intro-note"><Hand size={24}/><div><strong>当前账号可识别</strong><span>{supportedWords.join(' · ')}</span></div></div></section>
      <div className="learning-toolbar"><div className="learning-vocabulary" aria-label="当前可识别词语">{supportedWords.map(text=><span key={text}>{text}</span>)}</div><button className="quiet-button" disabled={saving} onClick={()=>{clear();setNotice('本次练习已清空，摄像头已关闭。已保存录像可在“我的记录”中删除。');}}><Trash2 size={16}/>清空本次练习</button></div>
      <div className="learning-split"><LearningPreview/><div className="workspace learning-practice"><section className="stage camera-stage" ref={stage} aria-label="学习摄像头取景区域"><div className="stage-topline"><span className="stage-label"><Camera size={15}/>练习取景区</span><span className={`stage-badge ${capturing?'is-recording':''}`}>{capturing?<>录制中 {timer}</>:media.status==='preview'?'摄像头已开启':media.recordingUrl?'本次录制已结束':'摄像头未开启'}</span></div>
        <div className="camera-content">{media.stream?<><video className="camera-live" ref={liveVideo} autoPlay playsInline muted aria-label="摄像头实时预览"/><div className="viewfinder"><i/><i/><i/><i/></div><span className="camera-guide">让面部、双手与上半身完整入镜</span></>:media.recordingUrl?<video className="camera-replay" src={media.recordingUrl} controls playsInline aria-label="本段手语录像预览"/>:<div className="camera-empty"><div className="camera-icon"><Camera size={35}/></div><h2>先练一个完整动作</h2><p>开启摄像头后调整位置。<br/>准备好，再开始录制。</p><button className="primary-button" disabled={requesting||saving} onClick={()=>void media.open('video')}><Camera size={17}/>{requesting?'等待设备授权…':'开启摄像头'}</button><span><ShieldCheck size={14}/>仅确认保存后写入当前账号</span></div>}</div>
        <div className="stage-bottomline"><span>{media.recordingUrl?'先回看，确认双手和动作完整':'光线均匀 · 背景简洁 · 不采集声音'}</span><button className="icon-button" aria-label="全屏查看" onClick={()=>void fullscreen()}><Maximize2 size={16}/></button></div>
      </section><aside className={`interaction-panel learning-session-panel ${step==='capture'?'is-capture':''} ${step==='capture'&&!media.stream&&!media.recordingBlob&&!requesting&&!media.error&&!notice?'is-idle':''}`}><div className="panel-heading"><span className="section-kicker">本次练习</span><h2>{step==='saved'?'录像已保存':step==='review'?'检查录像，再保存':'准备好，就开始吧'}</h2><p>{step==='saved'?'保存不会自动识别，需要时点击下方的开始识别。':'一次录一个完整动作，保持自然速度，前后留短暂停顿。'}</p></div>

        {step==='capture'?<><ol className="capture-steps"><li className={media.stream?'step-active':''}><span>1</span><div><strong>调整取景</strong><p>面部、双手与上半身完整入镜</p></div></li><li className={capturing?'step-active':''}><span>2</span><div><strong>录一个动作</strong><p>完整做完，再结束录制</p></div></li><li className={media.recordingBlob?'step-active':''}><span>3</span><div><strong>回看并保存</strong><p>先保存，需要时再点识别</p></div></li></ol><div className="capture-controls">
          {media.status==='recorded'&&<button className="primary-button" onClick={()=>{setStep('review');setNotice('');}}>下一步：确认并保存<ArrowRight size={17}/></button>}
          {media.status==='preview'?<button className="primary-button" onClick={media.startRecording}><Video size={17}/>开始录制</button>:capturing?<button className="primary-button stop-button" onClick={media.finish}><Square size={17}/>结束录制<span>{timer}</span></button>:(media.recordingBlob||media.status==='error')&&<button className="secondary-button" disabled={requesting} onClick={restart}><RotateCcw size={16}/>{media.recordingBlob?'重新录制':'重新开启摄像头'}</button>}
          {(media.stream||requesting||media.recordingBlob)&&<button className="secondary-button" onClick={clear}>关闭并清除</button>}</div><p className="small-hint">练习录像与训练数据分开管理；开发新动作请进入动作训练。录制上限30秒，每条保留一个完整动作。</p></>:step==='review'?<div className="record-review-panel"><h3>确认保存录像</h3><p>保存到学习记录；不会作为训练样本。</p><label className="form-label" htmlFor="learning-note">录像备注（可选）</label><textarea id="learning-note" maxLength={500} value={note} onChange={e=>setNote(e.target.value)} disabled={saving} placeholder="例如：今天的第一次练习"/><button className="primary-button" disabled={saving||!sampleReady} onClick={()=>void save()}><Save size={16}/>{saving?'正在保存录像…':user?'确认保存录像':'登录并保存录像'}</button><button className="secondary-button" disabled={saving} onClick={restart}>重新录制</button><button className="text-button" disabled={saving} onClick={()=>setStep('capture')}>返回回看</button></div>:<div className="saved-record-summary"><span className="section-kicker">录像已保存</span><h3>这次练习，已经留下来了</h3><div className="saved-record-actions"><button className="secondary-button" onClick={()=>setHistoryOpen(true)}><Clock3 size={15}/>查看我的记录</button><button className="secondary-button" onClick={restart}>重新录制</button></div></div>}
        {(media.error||notice)&&<div className={`inline-notice ${media.error?'notice-error':''}`} role="status">{media.error||notice}</div>}
        {Boolean(token)&&saved&&<section className="learning-recognition-actions" aria-label="手动识别本次录像"><h3>识别这段录像 <small>可选</small></h3><p>保存已完成，不会自动识别。录像与实时试用统一支持谢谢、帮助、需要、我；每段只做一个完整动作，结果仍需核对。</p>{recognitionCurrent?<button className="secondary-button" onClick={()=>setRecognition(null)}>停止并清除本次识别</button>:<button className="primary-button" onClick={()=>setRecognition({blob:saved.blob,recordId:saved.id,saveToken:saved.token})}>开始识别</button>}</section>}
        {recognitionCurrent&&<VideoPreprocessing key={`${saved?.id}:${token}`} videoBlob={media.recordingBlob} captureActive={capturing||requesting||media.status==='preview'} autoToken={token} recordId={saved?.id} learning/>}
        <div className="panel-bottom"><ShieldCheck size={15}/><span>{user?'录像只属于当前账号，可在“我的记录”中删除。':'可以先取景录制，登录保存后按需点击开始识别。'}</span></div>
      </aside></div></div><section className="stage-info"><span className="stage-number">01</span><div><strong>先完成一次单动作练习</strong><p>识别后可以查看词典说明和人物示范；没有可靠候选也可手动查词。你可以保存自己的练习反馈；实时页现可试用“谢谢、帮助、需要、我”，尚不是完整连续翻译。</p></div></section>
    </main><footer><span>语桥 · 手语学习</span><span>候选需要核对 · 不是连续手语翻译</span></footer>
    <AuthDialog open={authOpen} onClose={()=>setAuthOpen(false)} onSignedIn={signedIn}/><HistoryDialog trainingRegistration={false} speechEnabled={false} open={historyOpen} user={user} onClose={()=>setHistoryOpen(false)} onDeleted={recordDeleted}/><SettingsDialog open={settingsOpen} user={user} onClose={()=>setSettingsOpen(false)} onProfileChange={setAvatarUrl}/>
  </div>;
}
