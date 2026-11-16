import React,{useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowLeft,ArrowRight,ListVideo,Square} from 'lucide-react';
import Avatar from './Avatar';
import {AuthGate} from './AuthGate';
import scene from '../../shared/hospital-mutual-aid-scene.json';
import {planMotionText} from '../../shared/motion-planner.mjs';
import type {MotionPreview} from './fixedMotionLibrary';
import './styles.css';
import './hospital-scene.css';

type Line=typeof scene.dialogue[number];
function previewFor(line:Line):MotionPreview|null{
  const plan=planMotionText(line.signText);
  if(plan.status==='single')return {id:plan.entry.id,label:plan.entry.label,version:plan.entry.version,status:'authored_unverified'};
  if(plan.status==='sequence')return plan.preview;
  return null;
}

function Scene(){
  const lines=useMemo(()=>scene.dialogue.map(line=>({line,preview:previewFor(line)})),[]);
  const [index,setIndex]=useState(-1);
  const [playingAll,setPlayingAll]=useState(false);
  const [requestId,setRequestId]=useState(0);
  const [status,setStatus]=useState('点击某一句单独播放，或从头播放整段。');
  const current=index>=0?lines[index]:null;
  function play(next:number,all:boolean){
    if(next<0||next>=lines.length)return;
    setIndex(next);setPlayingAll(all);setRequestId(value=>value+1);
    setStatus(`${all?'整段播放':'单独播放'}：${lines[next].line.role} · ${lines[next].line.text}`);
  }
  function stop(){
    setPlayingAll(false);setIndex(-1);setRequestId(value=>value+1);
    setStatus('已停止。');
  }
  function ended(){
    if(playingAll&&index>=0&&index<lines.length-1)play(index+1,true);
    else{setPlayingAll(false);setStatus('本段播放结束。');}
  }
  return <div className="scene-page">
    <header className="scene-header">
      <a href="/" className="scene-back"><ArrowLeft size={17}/>返回正常端</a>
      <div><span className="scene-kicker">医院互助 · 数字人场景</span><h1>{scene.title}</h1></div>
      <span className="scene-badge">动作演示 · 待专业核验</span>
    </header>
    <main className="scene-main">
      <section className="scene-stage" aria-label="数字人场景演示">
        <Avatar preview={current?.preview??null} autoPlay bare requestId={requestId} displayText={current?.line.text} onEnded={ended}/>
        <div className="scene-controls">
          <button className="primary-button" onClick={()=>play(0,true)} disabled={playingAll}><ListVideo size={16}/>播放整段</button>
          <button className="secondary-button" onClick={()=>index>=0&&play(index,false)} disabled={!current}><ArrowRight size={16}/>重播本句</button>
          <button className="secondary-button" onClick={stop} disabled={index<0}><Square size={15}/>停止</button>
        </div>
        <p className="scene-status" role="status">{status}</p>
        <p className="scene-note">数字人只演示当前动作库能覆盖的词语，不是逐字手语翻译；不替代医生诊断、挂号受理、检查安排或医疗决策。全部动作来自用户观看核对，尚未专业验收。</p>
      </section>
      <aside className="scene-dialogue" aria-label="场景对话">
        <h2>对话与动作</h2>
        {lines.map(({line},i)=><button key={i} className={`scene-line ${i===index?'current':''}`} onClick={()=>play(i,false)} aria-pressed={i===index}>
          <span className={`scene-role role-${line.role==='聋人患者'?'patient':line.role==='医生'?'doctor':'volunteer'}`}>{line.role}</span>
          <span className="scene-text">{line.text}</span>
          <span className="scene-sign">{line.signText}</span>
        </button>)}
      </aside>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><AuthGate entry="normal"><Scene/></AuthGate></React.StrictMode>);
