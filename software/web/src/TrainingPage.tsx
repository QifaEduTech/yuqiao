import {useEffect,useRef,useState} from 'react';
import {FolderOpen,Plus,ArrowLeft,Video} from 'lucide-react';
import {api,type User} from './api';
import {useMediaCapture} from './useMediaCapture';
import {readVideoDuration} from './video/preprocess';
import {trainingDataset} from '../../shared/training-datasets.mjs';

const sections=[{id:'train',name:'训练集'},{id:'test',name:'测试集'}];
const splitNames:Record<string,string>={train:'训练集',validation:'训练集',test:'测试集',regression:'历史资料'};
type Sample={groupSource?:string;batchId?:string;testUsed?:boolean;recordId:string;start:number;end:number;label:number;group:string;split:string;expectedWord:string|null};
type Action={id:string;text:string;description:string;motion:string;hands:number;state:string;revision:number;samples:Sample[];activeVersion:string|null};
type Report={trained?:boolean;passed:boolean;perClass?:{signId:string;text:string;recall:number;precision:number;passed:boolean}[];recall?:number|null;precision?:number|null;falsePositiveRate?:number|null;regressionPassed?:boolean;quality?:{recordId:string;passed:boolean;reason:string}[];recommendations?:string[];details?:{recordId:string;correct:boolean;reason:string}[]};
type Job={id:string;actionId:string;kind:string;status:string;progress:number;message:string;createdAt:number;report:Report|null;reusedBackgrounds?:number;trainingWords?:string[];pendingActions?:{id:string;text:string;trainingCount:number;required:number}[]};
type State={actions:Action[];archivedActions?:Action[];jobs:Job[];busy:boolean;runtimeMode?:string};
type Source={id:string;text:string;duration:number;legacy:boolean};
type DictionaryWord={id:string;text:string;description:string};
type Destination={split:string;label:number;expectedWord?:string};
const folderName=(d:Destination)=>splitNames[d.split];
const belongs=(s:Sample,d:Destination)=>trainingDataset(s.split)===d.split;

export default function TrainingPage(){
 const [user,setUser]=useState<User|null>(null),[state,setState]=useState<State>({actions:[],jobs:[],busy:false}),[sources,setSources]=useState<Source[]>([]);
 const [id,setId]=useState(''),[creating,setCreating]=useState(false),[destination,setDestination]=useState<Destination|null>(null),[recordingPanel,setRecordingPanel]=useState(false);
 const [query,setQuery]=useState(''),[wordId,setWordId]=useState(''),[words,setWords]=useState<DictionaryWord[]>([]),[page,setPage]=useState(0),[pages,setPages]=useState(1),[description,setDescription]=useState(''),[hands,setHands]=useState(2),[motion,setMotion]=useState('dynamic');
 const [imported,setImported]=useState<File|null>(null),[importUrl,setImportUrl]=useState(''),[duration,setDuration]=useState<number|null>(null),[savedDraft,setSavedDraft]=useState<{id:string;duration:number}|null>(null),[existing,setExisting]=useState('');
 const [editing,setEditing]=useState<Sample|null>(null),[editStart,setEditStart]=useState(0),[editEnd,setEditEnd]=useState(0),[editReviewed,setEditReviewed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const media=useMediaCapture(),camera=useRef<HTMLVideoElement>(null),uploadKey=useRef(''),owner=useRef<string|null>(null),epoch=useRef(0),pending=useRef(false);
 const refreshSequence=useRef(0),automaticBatches=useRef<Record<string,string>>({});
 const action=state.actions.find(a=>a.id===id),jobs=state.jobs.filter(j=>j.actionId===id).slice().reverse();
 const blob=imported??media.recordingBlob;
 const locked=busy||media.status==='recording'||media.status==='requesting'||!!blob||!!savedDraft||!!existing;
 const disabled=busy||state.busy;
 const source=existing?sources.find(s=>s.id===existing):null;
 const draftDuration=source?.duration??savedDraft?.duration??duration;
 const folderSamples=action&&destination?action.samples.filter(s=>belongs(s,destination)):[];

 function clearDraft(){media.clear();setImported(null);setDuration(null);setSavedDraft(null);setExisting('');uploadKey.current='';}
 async function refresh(){
  const generation=epoch.current,sequence=++refreshSequence.current;
  try{
   const me=await api<{user:User|null}>('/api/auth/me');if(generation!==epoch.current||sequence!==refreshSequence.current)return;
   if(owner.current!==(me.user?.id??null)){owner.current=me.user?.id??null;setState({actions:[],jobs:[],busy:false});setSources([]);setId('');setDestination(null);automaticBatches.current={};clearDraft();}
   setUser(me.user);if(!me.user)return;
   const [next,list]=await Promise.all([api<State>('/api/training/state'),api<{sources:Source[]}>('/api/training/sources')]);
   if(generation===epoch.current&&sequence===refreshSequence.current){setState(next);setSources(list.sources);}
  }catch(e){if(generation===epoch.current)setError(e instanceof Error?e.message:'读取失败，请重试。');}
 }
 useEffect(()=>{void refresh();const timer=setInterval(()=>{if(!document.hidden&&!pending.current)void refresh();},3000);return()=>{epoch.current++;clearInterval(timer);};},[]);
 useEffect(()=>{if(camera.current)camera.current.srcObject=media.stream;},[media.stream,recordingPanel]);
 useEffect(()=>{
  if(!user||!creating)return;const controller=new AbortController();
  const timer=setTimeout(()=>void api<{entries:DictionaryWord[];pages:number}>('/api/training/dictionary?q='+encodeURIComponent(query)+'&page='+page,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setWords(result.entries);setPages(result.pages);}}).catch(()=>{}),200);
  return()=>{clearTimeout(timer);controller.abort();};
 },[query,page,user?.id,creating]);
 useEffect(()=>{if(!imported){setImportUrl('');return;}const url=URL.createObjectURL(imported);setImportUrl(url);return()=>URL.revokeObjectURL(url);},[imported]);
 useEffect(()=>{
  setDuration(null);uploadKey.current=crypto.randomUUID();if(!blob)return;const controller=new AbortController();
  void readVideoDuration(blob,controller.signal).then(value=>{if(!controller.signal.aborted)setDuration(value);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:'无法读取视频时长。');});
  return()=>controller.abort();
 },[blob]);
 async function run(task:()=>Promise<void>){
  if(pending.current)return;pending.current=true;setBusy(true);setError('');setNotice('');
  try{await task();await refresh();}catch(e){setError(e instanceof Error?e.message:'操作失败，请重试。');}finally{pending.current=false;setBusy(false);}
 }
 function openTask(next:string){if(locked)return;clearDraft();setId(next);setDestination(null);setRecordingPanel(false);setEditing(null);setError('');setNotice('');}
 function openFolder(next:Destination){if(locked)return;clearDraft();setDestination(next);setEditing(null);setRecordingPanel(true);setError('');setNotice('');}
 async function startCapture(){
  if(disabled||locked)return;
  if(!media.stream)await media.open('video');
  media.startRecording();
 }
 async function create(){
  const next=await api<State>('/api/training/actions',{method:'POST',body:JSON.stringify({dictionaryId:wordId,description,hands,motion})});
  setState(next);setCreating(false);setQuery('');setWordId('');setDescription('');setNotice('任务卡片已创建，打开卡片就能放录像。');
 }
 async function saveToFolder(){
  if(!action||!destination||draftDuration===null||draftDuration<.5)throw Error('请准备至少0.5秒的完整录像。');
  const target={...destination},actionId=id;
  const batchKey=id+':'+target.split;const batchId=automaticBatches.current[batchKey]??(automaticBatches.current[batchKey]=crypto.randomUUID());let recordId=existing||savedDraft?.id;
  if(!recordId){
   if(!blob)throw Error('请先录制或添加视频。');
   const uploaded=await api<{record:{id:string}}>('/api/records/video?text='+encodeURIComponent('训练采集：'+action.text)+'&duration='+draftDuration,{method:'POST',headers:{'Content-Type':blob.type||'video/webm','X-Yuqiao-Save-Key':uploadKey.current},body:blob});
   recordId=uploaded.record.id;setSavedDraft({id:recordId,duration:draftDuration});
  }
  // Clicking Save confirms the preview and this explicit destination, without
  // rerunning recognition or asking for the same split/label a second time.
  await api('/api/training/actions/'+actionId,{method:'POST',body:JSON.stringify({operation:'sample',recordId,start:0,end:draftDuration,label:target.label,split:target.split,groupMode:'automatic',batchId,reviewed:true})});
  clearDraft();setNotice('已放入「'+folderName(target)+'」，可以继续录下一条。');
 }
 function startEdit(sample:Sample){if(locked)return;media.clear();setEditing(sample);setEditStart(sample.start);setEditEnd(sample.end);setEditReviewed(false);setRecordingPanel(false);}
 async function saveEdit(){
  if(!editing||!editReviewed)return;
  await api('/api/training/actions/'+id,{method:'POST',body:JSON.stringify({...editing,operation:'sample',start:editStart,end:editEnd,groupMode:editing.groupSource==='automatic'?'automatic':undefined,batchId:editing.batchId,reviewed:true,realGroupConfirmed:editing.groupSource!=='automatic'})});
  setEditing(null);setNotice('范围已更新，原片保留。');
 }
 const saveReason=disabled?'请等待当前任务结束。':!blob&&!source&&!savedDraft?'先录一条，或添加已有视频。':draftDuration===null?'正在读取录像时长…':draftDuration<.5?'录像不足0.5秒，请录一个完整动作。':'';
 return <div className="app-shell training-page">
  <header className="site-header"><a href="/">语桥 · 返回首页</a><nav><a href="/learning.html">手语学习</a><span className="account-name">{user?.username}</span></nav></header>
  <main>
   <div className="training-heading"><div><p className="eyebrow">我的手语训练</p><h1>{action?action.text+'的录像文件夹':'一个词，一张任务卡片。'}</h1><p>{action?'点下面的入口录制，视频会放到你选的位置。':'选择词语创建任务，再把录好的视频放进去。'}</p></div>{!action&&<button className="primary-button" disabled={disabled} onClick={()=>setCreating(!creating)}><Plus size={18}/>{creating?'收起':'创建任务'}</button>}</div>
   {error&&<p role="alert" className="inline-notice notice-error">{error}{savedDraft&&' 原片已经保存，重试不会重复上传。'}</p>}{notice&&<p role="status" className="inline-notice">{notice}</p>}
   {state.runtimeMode==='unified-tcn'&&<section className="training-section" aria-label="统一训练"><h2>全部动作，一起训练</h2><p>所有资料准备好的动作一起从零训练，不要求先补齐原四词；资料不足的任务继续保留。后台自动复用已授权的共享旧背景和本账号反例，无需逐个任务添加。召回率达到90%并通过测试检查后，任务卡片自动移除，视频归档保留。</p><div className="training-buttons"><button className="primary-button" disabled={disabled||locked} onClick={()=>void run(async()=>{await api('/api/training/joint/jobs',{method:'POST'});setNotice('统一训练已开始。');})}>开始统一训练</button><button className="secondary-button" disabled={disabled||locked} onClick={()=>void run(async()=>{await api('/api/training/bootstrap',{method:'POST'});})}>添加已有动作任务</button></div><p className="small-hint">动作结束后把双手移出画面约1秒，再结束录制。未达标保留任务，不会无限反复训练。</p>{state.jobs.filter(j=>j.kind==='unified').slice(-3).reverse().map(j=><article className="training-job" key={j.id}><strong>{j.status==='complete'?'已达标并归档':j.status==='running'?'正在统一训练':'任务保留，待继续完善'}</strong><p role="status">{j.message}</p>{j.trainingWords&&<p>本轮训练：{j.trainingWords.join('、')}</p>}{!!j.pendingActions?.length&&<details><summary>待补充动作（{j.pendingActions.length}）</summary>{j.pendingActions.map(a=><p key={a.id}>{a.text}：训练集{a.trainingCount}/{a.required}条</p>)}</details>}{j.reusedBackgrounds!==undefined&&<p>后台复用 {j.reusedBackgrounds} 条旧背景／反例，仅用于训练。</p>}{j.status==='running'&&<><progress max={100} value={j.progress}/><button className="text-button" onClick={()=>void run(async()=>{await api('/api/training/jobs/'+j.id+'/cancel',{method:'POST'});})}>停止本轮</button></>}{j.report?.perClass?.map(c=><p key={c.signId}>{c.text}：召回率 {(c.recall*100).toFixed(1)}% · {c.passed?'通过':'需补充资料'}</p>)}</article>)}</section>}
   {action&&<button className="text-button" disabled={disabled||locked} onClick={()=>{if(window.confirm('移除这张任务卡片？原视频会归档保留，可在归档中恢复。'))void run(async()=>{await api('/api/training/actions/'+action.id+'/archive',{method:'POST'});setId('');setDestination(null);});}}>移除这个任务文件夹</button>}
   {!!state.archivedActions?.length&&!action&&<details className="training-section"><summary>已归档任务（{state.archivedActions.length}）</summary><p>视频仍然保留，达标资料会继续参与统一训练。</p>{state.archivedActions.map(a=><p key={a.id}>{a.text} · {a.samples.length}条资料 <button className="text-button" disabled={disabled} onClick={()=>void run(async()=>{await api('/api/training/actions/'+a.id+'/restore',{method:'POST'});})}>恢复任务</button></p>)}</details>}
   {!action?<>
    {creating&&<section className="training-section training-create"><h2>选一个词语</h2><form onSubmit={e=>{e.preventDefault();void run(create);}}>
     <div className="training-form-row"><label>搜索词语<input aria-label="搜索词典词语" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);setWordId('');}} placeholder="例如：你、好、请"/></label><label>词典词语<select aria-label="词典词语" value={wordId} required onChange={e=>{setWordId(e.target.value);setDescription(words.find(w=>w.id===e.target.value)?.description||'');}}><option value="">请选择</option>{words.map(w=><option key={w.id} value={w.id}>{w.text}</option>)}</select></label></div>
     {pages>1&&<div className="training-buttons"><button type="button" disabled={!page} onClick={()=>{setPage(page-1);setWordId('');}}>上一页</button><span>{page+1}/{pages}</span><button type="button" disabled={page+1>=pages} onClick={()=>{setPage(page+1);setWordId('');}}>下一页</button></div>}
     {wordId&&<><div className="training-form-row"><label>用几只手<select value={hands} onChange={e=>setHands(Number(e.target.value))}><option value={1}>一只手</option><option value={2}>两只手</option></select></label><label>怎么做<select value={motion} onChange={e=>setMotion(e.target.value)}><option value="dynamic">手会移动</option><option value="static">保持一个手势</option></select></label></div><details className="training-more"><summary>动作说明</summary><textarea aria-label="动作说明" maxLength={400} value={description} onChange={e=>setDescription(e.target.value)}/></details></>}
     <button className="primary-button" disabled={disabled||!wordId||!description.trim()}>创建这张任务卡片</button><p className="small-hint">已有任务直接打开，不用重复创建。</p>
    </form></section>}
    <div className="training-task-grid">{state.actions.map(a=><button className="training-task-card" key={a.id} onClick={()=>openTask(a.id)} aria-label={'打开任务：'+a.text}><FolderOpen size={30}/><strong>{a.text}</strong><span>{a.samples.length}条视频 · {a.activeVersion?'已启用':a.state==='ready'?'已达标':'继续收集'}</span><div>{sections.map(s=><small key={s.id}>{s.name}<b>{a.samples.filter(v=>trainingDataset(v.split)===s.id).length}条</b></small>)}</div><span className="training-card-open">打开文件夹 →</span></button>)}</div>
    {!state.actions.length&&!creating&&<section className="training-section training-empty"><FolderOpen size={42}/><h2>先创建第一张任务卡片</h2><p>例如选择“你”，然后按卡片里的入口录制。</p></section>}
   </>:<>
    <button className="text-button training-back" disabled={locked} onClick={()=>openTask('')}><ArrowLeft size={17}/>全部任务</button>
    <div className="training-buckets">{sections.map(s=><section className="training-bucket" key={s.id}><button disabled={locked} className={'training-folder '+(destination?.split===s.id?'selected':'')} aria-label={s.name+'，点击录制'} aria-pressed={destination?.split===s.id} onClick={()=>openFolder({split:s.id,label:1})}><FolderOpen size={23}/><span><strong>{s.name}</strong><small><b>{action.samples.filter(v=>trainingDataset(v.split)===s.id).length}</b> 条视频</small></span><Video size={17}/><em>打开</em></button></section>)}</div>
    {!destination&&<p className="training-folder-guide">训练集用于学习，测试集用于检查效果。每个动作先准备至少20条训练视频，另外录制20条测试视频；数量只是起步要求。</p>}
    {destination&&<section className="training-section training-folder-content" aria-label="当前录像文件夹">
     <div className="training-section-title"><div><p className="eyebrow">当前文件夹</p><h2>{folderName(destination)}</h2></div><span>{folderSamples.length}条视频</span><button className="secondary-button" disabled={locked||state.busy} onClick={()=>{setEditing(null);setRecordingPanel(true);}}><Plus size={17}/>录新视频</button></div>
     {recordingPanel&&<>
      <p className="small-hint">当前录制：{destination.label===1?action.text:'其他动作或背景'}</p>
      <details className="training-more"><summary>添加其他动作或背景</summary><label className="training-check"><input type="checkbox" checked={destination.label===0} disabled={locked||state.busy} onChange={e=>setDestination({...destination,label:e.target.checked?0:1})}/>这条视频不是“{action.text}”，用于检查误识别</label><p className="small-hint">通常保持默认，直接录制本动作即可。</p></details>
      <div className="training-recorder-simple">
       <div className="training-camera"><h3>{blob||source?'录好了，确认保存':'录制视频'}{media.status==='recording'&&<span className="training-recording">录制中 · {media.seconds}秒</span>}</h3><video ref={camera} aria-label="训练摄像头画面" autoPlay playsInline muted hidden={!media.stream}/>
        {blob||source||savedDraft?<video aria-label="待加入的录像" src={source?'/api/records/'+source.id+'/media':importUrl||media.recordingUrl||(savedDraft?'/api/records/'+savedDraft.id+'/media':'')} controls playsInline/>:!media.stream&&<div className="training-camera-placeholder"><Video size={36}/><p>录完后直接保存到<br/>{folderName(destination)}</p></div>}
        <div className="training-buttons">{blob||source||savedDraft?<><button className="primary-button" disabled={!!saveReason} onClick={()=>void run(saveToFolder)}>确认保存</button><button className="secondary-button" disabled={busy} onClick={()=>{if(savedDraft)setNotice('已上传的原片保留，可从已保存录像重新添加。');clearDraft();}}>重新录制</button></>:media.status==='recording'?<button className="primary-button" onClick={media.finish}>结束录制</button>:<button className="primary-button" disabled={disabled||media.status==='requesting'} onClick={()=>void startCapture()}>{media.status==='requesting'?'正在打开摄像头…':'开始录制'}</button>}</div>
        {saveReason&&(blob||source||savedDraft)&&<p className="training-add-help" aria-live="polite">{saveReason}</p>}{media.error&&<p role="alert">{media.error}</p>}
       </div></div>
      <details className="training-more"><summary>添加已有视频</summary><label className="secondary-button">从电脑选择视频<input className="sr-only" type="file" accept="video/webm,video/mp4" disabled={locked||state.busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file){clearDraft();setImported(file);}}}/></label><label>从已保存录像添加<select aria-label="选择已保存录像" value={existing} disabled={!!blob||!!savedDraft||busy||media.status==='recording'} onChange={e=>{media.clear();setExisting(e.target.value);}}><option value="">请选择</option>{sources.filter(s=>!action.samples.some(v=>v.recordId===s.id)).map((s,i)=><option key={s.id} value={s.id} disabled={destination.split==='test'&&s.legacy}>{s.text||'录像'} · {Number(s.duration??0).toFixed(1)}秒 · {i+1}{s.legacy?'（旧登记）':''}</option>)}</select></label></details>
     </>}
     <div className="training-files-heading"><h3>文件夹里的视频</h3><button className="text-button" disabled={locked} onClick={()=>{media.clear();setRecordingPanel(false);}}>只看视频列表</button></div>
     {folderSamples.length===0?<p className="small-hint">这里还没有视频，录好保存后就会出现。</p>:<div className="training-file-grid">{folderSamples.map((s,i)=><article className="training-file" key={s.recordId}><Video size={23}/><strong>录像 {String(i+1).padStart(2,'0')}</strong><span>{(s.end-s.start).toFixed(1)}秒 · {s.label===1?'本动作':'其他动作/背景'}</span>{s.testUsed&&<small>已参加过测试</small>}<div><button className="text-button" disabled={locked} onClick={()=>startEdit(s)}>回看 / 调整</button><button className="text-button" disabled={disabled||locked} onClick={()=>void run(async()=>{await api('/api/training/actions/'+id,{method:'POST',body:JSON.stringify({operation:'removeSample',recordId:s.recordId})});})}>移出</button></div>{s.testUsed&&<button className="text-button" disabled={disabled||locked} onClick={()=>void run(async()=>{await api('/api/training/actions/'+id,{method:'POST',body:JSON.stringify({operation:'moveGroup',group:s.group,split:'train'})});})}>整轮移入训练集</button>}</article>)}</div>}
     <p className="small-hint">移出只取消训练关联，保留原视频。</p>
    </section>}
    {editing&&<section className="training-section"><h2>回看与范围调整</h2><p>{splitNames[editing.split]} · {editing.label?'这个词':editing.expectedWord||'不是这个词'} · {editing.group}</p><video src={'/api/records/'+editing.recordId+'/media'} controls playsInline/><details className="training-more"><summary>只在需要时调整起止位置</summary><div className="training-form-row"><label>开始秒<input type="number" min={0} step={.01} value={editStart} onChange={e=>{setEditStart(Number(e.target.value));setEditReviewed(false);}}/></label><label>结束秒<input type="number" min={0} step={.01} value={editEnd} onChange={e=>{setEditEnd(Number(e.target.value));setEditReviewed(false);}}/></label></div><label className="training-check"><input type="checkbox" checked={editReviewed} onChange={e=>setEditReviewed(e.target.checked)}/>已回看并确认新的完整动作范围</label><button className="primary-button" disabled={disabled||!editReviewed||editStart<0||editEnd-editStart<.5} onClick={()=>void run(saveEdit)}>保存范围调整</button></details><button className="text-button" onClick={()=>setEditing(null)}>关闭回看</button></section>}
    <details className="training-section training-training" hidden={!jobs.length}><summary>历史训练记录</summary>
     {jobs.map(j=><article className="training-job" key={j.id}><strong>{j.kind==='quality'?'质量检查':'训练版本'} · {new Date(j.createdAt).toLocaleString()}</strong><p role="status">{j.message}</p>{j.status==='running'&&<><progress max={100} value={j.progress}/><button className="text-button" onClick={()=>void run(async()=>{await api('/api/training/jobs/'+j.id+'/cancel',{method:'POST'});})}>停止任务</button></>}{j.report&&<><p>{j.report.trained?'训练已完成':'尚未训练'} · {j.report.passed?'已达标':'仍需检查或补录'}</p>{j.report.recommendations?.filter(t=>!t.includes('回归')).map(t=><p key={t}>{t}</p>)}<details><summary>查看结果与错误录像</summary>{j.report.trained&&<p>完整动作识别率：{j.report.recall==null?'未测试':(j.report.recall*100).toFixed(1)+'%'}；输出正确率：{j.report.precision==null?'未测试':(j.report.precision*100).toFixed(1)+'%'}；误报率：{j.report.falsePositiveRate==null?'未测试':(j.report.falsePositiveRate*100).toFixed(1)+'%'}</p>}{[...(j.report.quality?.filter(q=>!q.passed)||[]),...(j.report.details?.filter(q=>!q.correct)||[])].map((q,i)=><p key={i}>{q.reason}<button className="text-button" disabled={locked} onClick={()=>{const sample=action.samples.find(s=>s.recordId===q.recordId);if(sample)startEdit(sample);}}>回看</button></p>)}</details>{state.runtimeMode!=='unified-tcn'&&j.kind==='train'&&j.report.trained&&j.report.passed&&<button className="primary-button" disabled={disabled||locked||action.activeVersion===j.id} onClick={()=>void run(async()=>{await api('/api/training/actions/'+id+'/activate',{method:'POST',body:JSON.stringify({version:j.id})});})}>{action.activeVersion===j.id?'正在使用此版本':'启用 / 回退到此版本'}</button>}</>}</article>)}
    </details>
   </>}
  </main>
 </div>;
}
