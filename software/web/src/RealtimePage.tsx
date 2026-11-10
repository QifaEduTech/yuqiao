import {ArrowLeft,ArrowRight,Camera,Hand,ShieldCheck,Square} from 'lucide-react';
import {useState,useEffect} from 'react';
import {api} from './api';
import {useRealtimeSign} from './useRealtimeSign';
import RealtimeSkeleton from './RealtimeSkeleton';
import targets from '../../shared/realtime-targets.json';
import motions from '../../shared/sign-motion-catalog.json';
import RealtimeSpeech from './RealtimeSpeech';
import MeRecognitionStatus from './MeRecognitionStatus';

export default function RealtimePage(){
  const live=useRealtimeSign(),active=['permission','warming','running'].includes(live.phase);
  const [showSkeleton,setShowSkeleton]=useState(true);
  const [labels,setLabels]=useState(Object.values(targets).map(t=>t.text));
  useEffect(()=>{const task=new AbortController();void api<{labels:string[]}>('/api/sign/realtime/status',{signal:task.signal}).then(r=>{if(!task.signal.aborted)setLabels(r.labels);}).catch(()=>{});return()=>task.abort();},[live.phase]);
  const candidate=live.result?.candidate,lastWord=live.events.at(-1)?.text;
  const pictureStatus=live.phase==='warming'?'正在准备自动识别':live.result?.eventState==='emitted'?`本次完成：${live.result.event?.text??lastWord}`:live.result?.reason==='ambiguous_actions'?'动作证据冲突，请重新做一次':live.result?.reason==='action_transition'?'正在切换动作':live.result?.reason==='candidate_transition'?'正在核对动作变化':candidate?`候选：${candidate}`:live.result?.reason==='motion_required'?'尚未确认有效动作':live.result?.reason==='no_hands'?(lastWord?`最近完成：${lastWord}`:'等待手部入镜'):'正在自动识别';
  const status=live.phase==='permission'?'等待摄像头授权…':live.phase==='warming'?'正在准备本机自动识别…':live.phase==='running'?live.result?.reason==='ambiguous_actions'?'检测到不同动作的竞争证据，请将双手移出画面约一秒后重试':live.result?.reason==='action_transition'?'正在确认前后动作的衔接，请继续完成当前动作':live.result?.reason==='candidate_transition'?'正在核对动作变化，请继续完成当前动作':live.result?.eventState==='reset_required'?'观察时间较长，请将双手移出画面约一秒后重试':live.result?.eventState==='ready_to_finish'?`“${candidate}”候选已稳定，${candidate==='我'?'请先双手出画约一秒再做下一词；':'可继续下一个不同动作；'}结束或重复时请将${candidate==='谢谢'?'做动作的手':'双手'}移出画面约一秒`:live.result?.eventState==='ending'?'正在确认本次动作已结束…':live.result?.eventState==='emitted'?`已记入一次“${live.result.event?.text}”，可以继续做下一个动作`:candidate?`正在核对“${candidate}”动作…`:live.result?.reason==='no_hands'?'等待双手入镜':live.result?.reason==='motion_required'?'请自然做出完整动作；做“我”时保持肩部和手入镜':'正在观察并自动区分动作…':'摄像头未开启';
  return <div className="app-shell realtime-page"><header className="site-header"><a href="/" className="realtime-back" aria-label="返回交流首页"><ArrowLeft size={18}/>语桥 · 返回交流</a><a className="quiet-button" href="/learning.html">手语学习<ArrowRight size={16}/></a></header>
    <main><section className="intro"><div><div className="eyebrow"><span/> 实时手语 · 自动识别</div><h1>面对镜头，<span>直接表达。</span></h1><p>不用选择动作，系统自动区分已支持的手语。无需录制或保存视频。</p></div></section>
      <div className="workspace"><section className="stage camera-stage" aria-label="实时摄像头区域"><div className="stage-topline"><span className="stage-label"><Camera size={15}/>实时画面</span><span className="stage-badge">{active?'自动识别 · 未录制':'由你开启'}</span></div>
        <div className="camera-content"><video ref={live.video} className="camera-live" style={{display:live.stream?'block':'none'}} autoPlay playsInline muted aria-label="实时手语摄像头"/>{live.stream&&<RealtimeSkeleton tracking={live.result?.handTracking} seq={live.result?.seq??0} latencyMs={live.metrics.latencyMs} enabled={showSkeleton} badge={pictureStatus}/>}{!live.stream&&<div className="camera-empty"><div className="camera-icon"><Camera size={35}/></div><h2>准备好，直接做动作</h2><p>让双手和上半身完整入镜。<br/>光线均匀，动作自然清楚。</p></div>}</div>
        <div className="stage-bottomline"><span>仅本机处理 · 候选出现即播报</span></div>
      </section><aside className="interaction-panel"><div className="panel-heading"><span className="section-kicker">自动区分动作</span><h2>做什么，就识别什么</h2><p>当前自动区分谢谢、帮助、需要和我。需要：掌心向上，向自己滑回，不点胸。谢谢、帮助、需要可依次完成；“我”完成后，以及结束或重复同词时，请双手移出画面约一秒。“我”：食指指向自己胸前，可短暂停留，请让肩部和手同时入镜。谢谢、帮助、需要仍须各自的运动证据。</p></div>
        <div className="learning-vocabulary" aria-label="当前自动识别范围">{labels.map(text=><span key={text}>{text}</span>)}</div>
        <div className="realtime-controls">{!active?<button className="primary-button" onClick={()=>void live.start()}><Camera size={17}/>开启摄像头并实时识别</button>:<button className="secondary-button" onClick={()=>live.stop()}><Square size={16}/>停止实时识别</button>}</div>
        <label className="realtime-skeleton-toggle"><input type="checkbox" checked={showSkeleton} onChange={e=>setShowSkeleton(e.target.checked)}/>显示手部骨架<span>不影响识别</span></label>
        <p className="realtime-state" role="status" data-testid="realtime-status" data-phase={live.phase} data-frames={live.metrics.frames} data-fps={live.metrics.fps} data-latency-ms={live.metrics.latencyMs}>{status}</p>
        {live.message&&<p className={`inline-notice ${live.phase==='error'?'notice-error':''}`} role={live.phase==='error'?'alert':undefined}>{live.message}</p>}
        <section className="realtime-candidate" aria-label="实时识别候选"><Hand size={24}/><span>当前识别候选</span><strong data-testid="realtime-candidate">{candidate??'等待动作'}</strong><p>{candidate?'候选出现即播报；完整动作确认后才记入下方文字。':'自动比较动作证据；不明确或冲突时不猜词。'}</p></section>
        <section className="realtime-words" aria-label="本次动作文字"><h3>本次动作文字 · 待核对</h3><p data-testid="realtime-words">{live.events.length?live.events.map(word=>word.text).join('，'):'完成动作后，文字会显示在这里。'}</p><span data-testid="realtime-event-count">当前显示 {live.events.length} 次动作</span></section>
        <RealtimeSpeech events={live.events} phase={live.phase} result={live.result}/>
        <div className="annotation-hidden" data-ui-section="realtime-diagnostics">
        <MeRecognitionStatus check={live.result?.meCheck} seq={live.result?.seq??0} active={live.phase==='running'}/>
        <p className="realtime-scope">当前按动作间的停顿识别，不是连续整句翻译。未知动作仍可能误识别；动作记录仅保留最近30次，停止或离开后清空，不自动保存。</p>
        <details className="realtime-scope"><summary>查看识别状态</summary><p data-testid="help-model-score">帮助模型分数 {live.result?.helpScore==null?'—':live.result.helpScore.toFixed(3)} · 双手运动：{live.result?.motionSupported==null?'观察中':live.result.motionSupported?'通过':'未通过'}（分数不是准确率）</p><a href="/learning.html?helpReview=28.9">查看静止双掌误判复盘</a></details>
        <p className="realtime-scope">动作参考：{Object.values(targets).map(action=>{const reference=motions.entries.find(m=>m.id===action.signId);return reference?<a key={action.signId} className="text-button" href={`/anny-review.html?motion=${encodeURIComponent(reference.id)}&version=${encodeURIComponent(reference.version)}`} target="_blank" rel="noreferrer">{action.text}</a>:null;})}</p>
        <div className="panel-bottom"><ShieldCheck size={15}/><span>离开页面或切到后台会停止摄像头。当前仅支持列出的动作。</span></div>
        </div>
      </aside></div>
    </main><footer><span>语桥 · 实时手语</span><span>无需选择动作 · 结果请核对</span></footer></div>;
}
