import {useEffect,useState} from 'react';
import type {MeCheck} from './useRealtimeSign';

function number(value?:number|null,digits=2){return value===null||value===undefined?'—':value.toFixed(digits);}

export default function MeRecognitionStatus({check,seq,active}:{check?:MeCheck|null;seq:number;active:boolean}){
  const [fresh,setFresh]=useState(false);
  useEffect(()=>{setFresh(true);const id=setTimeout(()=>setFresh(false),750);return()=>clearTimeout(id);},[seq]);
  const current=active&&fresh?check:null;
  return <details className="realtime-scope" open data-testid="me-check"><summary>“我”的动作检查</summary>
    {!current?<p>开启识别后查看当前检查；停止或画面中断后清空。</p>:<>
      <p>肩部参照：{current.bodyVisible?'已找到':'不够清楚，暂不能判断指向胸前'}</p>
      {!current.hands.length?<p>手部姿态：暂未取得完整点位</p>:current.hands.map((h,i)=><p key={i}>手{i+1}：食指姿态{(h.indexPointing??h.indexExtended)?'符合':'未符合'}（约{number(h.indexAngle,0)}°{h.recedingIndex?'，有向身体侧缩短的估计证据':''}），其余手指{h.otherFingersFolded?'符合':'未符合'}；{current.bodyVisible?`指向胸前${h.towardChest?'符合':'未符合'}（吻合度${number(h.chestCosine)}），位置${h.nearBody?'符合':'未符合'}（${number(h.tipDistance)}肩宽）`:'等待身体参照'}</p>)}
      <p>姿态持续检查：{current.stableSupported?'通过':'尚未通过'} · 模型分数：{current.modelScore===null?'等待足够画面':current.modelScore.toFixed(3)}（不是准确率）</p>
      {current.modelScore!==null&&current.modelScore>=.5&&!current.stableSupported&&<p>模型已有支持，但额外的姿态条件尚未通过，因此没有输出“我”。</p>}
      <p>“胸前”是由肩部推算的参照点，不是实测胸部位置；镜头倾斜或侧身会影响判断。这是程序当前的检查结果，不是对你手语是否规范的评分。只显示当前数值，不保存画面。</p>
    </>}
  </details>;
}
