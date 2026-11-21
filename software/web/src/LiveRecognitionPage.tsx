import {ArrowLeft,Camera,Square} from 'lucide-react';
import {useRealtimeSign} from './useRealtimeSign';
import {paragraphEndHint} from './paragraphEndHint';
import RecognizedParagraph from './RecognizedParagraph';
import RealtimeSpeech from './RealtimeSpeech';

export default function LiveRecognitionPage(){
  const live=useRealtimeSign();
  const active=['permission','warming','running'].includes(live.phase);
  const paragraph=live.result?.paragraph;
  const status=live.phase==='permission'?'正在开启摄像头…'
    :live.phase==='warming'?'正在准备识别…'
    :live.phase==='running'?(paragraphEndHint(paragraph)||'正在识别整段手语…')
    :'';

  return <div className="app-shell realtime-page live-recognition-page">
    <header className="site-header"><a href="/" className="realtime-back" aria-label="返回交流首页"><ArrowLeft size={18}/>语桥 · 返回交流</a></header>
    <main>
      <section className="intro"><div><h1>实时识别</h1></div></section>
      <div className="workspace">
        <section className="stage camera-stage" aria-label="实时取景区域">
          <div className="stage-topline"><span className="stage-label"><Camera size={15}/>实时画面</span></div>
          <div className="camera-content">
            <video ref={live.video} className="camera-live" style={{display:live.stream?'block':'none'}} autoPlay muted playsInline aria-label="实时摄像头预览"/>
            {!live.stream&&<div className="camera-empty"><div className="camera-icon"><Camera size={35}/></div><h2>让双手和上半身入镜</h2></div>}
          </div>
        </section>
        <aside className="interaction-panel" aria-label="实时识别">
          <p>做完一段后让双手离开画面约两秒，系统会显示整段文字并播报。</p>
          <div className="realtime-controls live-recognition-controls">
            {active?<button className="primary-button" onClick={()=>live.stop()}><Square size={16}/>停止实时识别</button>
              :<button className="primary-button" onClick={()=>void live.start()}><Camera size={17}/>开始实时识别</button>}
            {live.phase==='running'&&<button className="secondary-button" disabled={live.finishing||!(paragraph?.wordCount||live.result?.candidate)} onClick={live.finishParagraph}>结束本段</button>}
            {!active&&<a href="/realtime.html" className="text-button">改用录像识别</a>}
          </div>
          {status&&<p className="realtime-state" role="status">{status}</p>}
          {live.message&&<p className="inline-notice" role={live.phase==='error'?'alert':'status'}>{live.message}</p>}
          <div className="paragraph-history">{live.paragraphs.map(item=><RecognizedParagraph key={item.id} item={item}/>)}</div>
          <RealtimeSpeech events={live.events} phase={live.phase} result={live.result} paragraphs={live.paragraphs}/>
        </aside>
      </div>
    </main>
  </div>;
}
