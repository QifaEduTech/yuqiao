import {ArrowLeft,Camera,RotateCcw,Square,Volume2} from 'lucide-react';
import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from './api';
import {useMediaCapture} from './useMediaCapture';
import {useLocalSpeechQueue} from './useLocalSpeechQueue';
import {organizeCompletedParagraph,type OrganizedParagraph} from '../../shared/recognized-chinese.mjs';
import type {CompletedParagraph} from '../../shared/realtime-paragraph.mjs';
import RecognizedParagraph from './RecognizedParagraph';

type Analysis={
  kind:'recorded-sign-paragraph';
  status:'recognized'|'uncertain'|'no_hands';
  paragraph:(CompletedParagraph&Partial<Pick<OrganizedParagraph,'chinese'>>)|null;
};

const hospitalDemoWords = new Set(['医生', '我', '发烧', '需要', '帮助']);

export default function RealtimePage({hospitalDemo = false}: {hospitalDemo?: boolean}){
  const capture=useMediaCapture();
  const speech=useLocalSpeechQueue();
  const preview=useRef<HTMLVideoElement>(null);
  const request=useRef<AbortController|null>(null);
  const [analyzing,setAnalyzing]=useState(false);
  const [item,setItem]=useState<OrganizedParagraph|null>(null);
  const [demoText,setDemoText]=useState('');
  const [message,setMessage]=useState('');
  const [ending,setEnding]=useState(false);
  const live=Boolean(capture.stream);
  const recorded=capture.status==='recorded'&&Boolean(capture.recordingBlob);
  const recording=capture.status==='recording';
  const finishing=recording&&(ending||!live);
  const recordingBlob=capture.recordingBlob;

  useEffect(()=>{
    if(preview.current)preview.current.srcObject=capture.stream;
  },[capture.stream]);

  const cancelSpeech=speech.cancel;
  useEffect(()=>{
    const cancel=()=>{
      request.current?.abort();
      request.current=null;
      cancelSpeech();
      setEnding(false);
      setAnalyzing(false);
      setItem(null);
      setDemoText('');
      setMessage('');
    };
    const hide=()=>{if(document.hidden)cancel();};
    document.addEventListener('visibilitychange',hide);
    window.addEventListener('pagehide',cancel);
    return()=>{
      document.removeEventListener('visibilitychange',hide);
      window.removeEventListener('pagehide',cancel);
      request.current?.abort();
      request.current=null;
    };
  },[cancelSpeech]);

  function reset(){
    request.current?.abort();
    request.current=null;
    speech.cancel();
    capture.clear();
    setEnding(false);
    setAnalyzing(false);
    setItem(null);
    setDemoText('');
    setMessage('');
  }

  const analyze = useCallback(async (video: Blob | null)=>{
    if(!video||request.current||document.hidden)return;
    const task=new AbortController();
    request.current=task;
    setAnalyzing(true);
    setMessage('');
    setItem(null);
    setDemoText('');
    cancelSpeech();
    try{
      const result=await api<Analysis>('/api/sign/paragraph',{
        method:'POST',body:video,headers:{'Content-Type':video.type.split(';')[0]},signal:task.signal
      });
      if(task.signal.aborted)return;
      if(result.kind!=='recorded-sign-paragraph')throw Error('识别结果格式有误，请重试。');
      if(hospitalDemo){
        const matched=Array.isArray(result.paragraph?.words) &&
          result.paragraph.words.some(word=>hospitalDemoWords.has(word));
        setDemoText(matched?'医生，我发烧了，我需要帮助':'谢谢');
      }else if(result.paragraph){
        const paragraph=result.paragraph;
        setItem(paragraph.chinese?{...paragraph,chinese:paragraph.chinese}:organizeCompletedParagraph(paragraph));
      }else{
        setMessage(result.status==='no_hands'
          ?'录像里没有检测到清晰的手部画面，请让双手和上半身入镜后重录。'
          :'这段录像里的动作未能确认。请回看录像，或放慢动作重录。');
      }
    }catch(error){
      if(!task.signal.aborted)setMessage(error instanceof Error?error.message:'识别失败，请重试。');
    }finally{
      if(request.current===task){
        request.current=null;
        setAnalyzing(false);
      }
    }
  },[cancelSpeech,hospitalDemo]);

  useEffect(()=>{
    if(hospitalDemo&&recordingBlob)void analyze(recordingBlob);
  },[analyze,hospitalDemo,recordingBlob]);

  return <div className="app-shell realtime-page recorded-sign-page">
    <header className="site-header"><a href="/" className="realtime-back" aria-label="返回交流首页"><ArrowLeft size={18}/>语桥 · 返回交流</a></header>
    <main>
      <section className="intro"><div><h1>{hospitalDemo?'医院互助录像演示':'录一段，'}{!hospitalDemo&&<span>转成文字。</span>}</h1><p>{hospitalDemo?'录完后自动显示文字。':'录下整段手语，确认后一次显示结果。'}</p></div></section>
      <div className="workspace">
        <section className="stage camera-stage" aria-label="录像区域">
          <div className="stage-topline"><span className="stage-label"><Camera size={15}/>{recorded?'录像回看':'摄像头'}</span></div>
          <div className="camera-content">
            {live&&<video ref={preview} className="camera-live" autoPlay playsInline muted aria-label="摄像头预览"/>}
            {recorded&&<video className="recorded-sign-preview" src={capture.recordingUrl} controls playsInline aria-label="回看本段录像"/>}
            {!live&&!recorded&&<div className="camera-empty"><div className="camera-icon"><Camera size={35}/></div><h2>{finishing?'正在处理录像…':'让双手和上半身入镜'}</h2></div>}
          </div>
        </section>
        <aside className="interaction-panel" aria-label="录制与识别">
          <div className="realtime-controls">
            {recorded?<>{hospitalDemo
              ? message&&<button className="primary-button" onClick={()=>void analyze(recordingBlob)} disabled={analyzing}>重试识别</button>
              : !item&&<button className="primary-button" onClick={()=>void analyze(recordingBlob)} disabled={analyzing}>{analyzing?'正在分析整段…':'确认识别'}</button>}
              <button className="secondary-button" onClick={reset}><RotateCcw size={16}/>{analyzing?'取消分析':'重新录制'}</button></>
              :recording?<button className="primary-button" disabled={finishing} onClick={()=>{setEnding(true);capture.finish();}}><Square size={16}/>{finishing?'正在结束…':'结束录制'}</button>
              :capture.status==='preview'?<button className="primary-button" onClick={capture.startRecording}><Camera size={17}/>开始录制</button>
              :<button className="primary-button" disabled={capture.status==='requesting'} onClick={()=>void capture.open('video')}><Camera size={17}/>{capture.status==='requesting'?'正在开启摄像头…':'开启摄像头'}</button>}
          </div>
          {recording&&!finishing&&<p role="status">录制中 · {capture.seconds} 秒</p>}
          {!live&&!recorded&&!recording&&capture.status!=='requesting'&&<a href="/live-recognition.html" className="text-button">改用实时识别</a>}
          {!hospitalDemo&&!live&&!recorded&&!recording&&capture.status!=='requesting'&&
            <a href="/realtime.html?demo=hospital" className="text-button">医院互助录像演示</a>}
          {analyzing&&<p role="status">正在分析录像，请稍候。</p>}
          {(message||capture.error)&&<p role="alert" className="inline-notice notice-error">{message||capture.error.replace('，或使用文字输入','')}</p>}
          {demoText&&<section className="realtime-paragraph is-final" aria-live="polite">
            <p data-testid="hospital-demo-output">{demoText}</p>
          </section>}
          {item&&<><RecognizedParagraph item={item}/>
            {item.chinese.status==='ready'&&<button className="secondary-button" onClick={()=>{speech.cancel();speech.enqueue(item.chinese.text);}}><Volume2 size={16}/>朗读整段</button>}
          </>}
          <audio ref={speech.player} controls hidden={!speech.needsPlayback} className="realtime-audio-fallback" aria-label="整段语音"/>
          {speech.needsPlayback&&<p className="small-hint">点击播放器继续播放。</p>}
          {item&&speech.error&&<p className="small-hint" role="status">{speech.error}</p>}
        </aside>
      </div>
    </main>
  </div>;
}
