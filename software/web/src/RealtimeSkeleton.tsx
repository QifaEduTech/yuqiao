import {useEffect,useState} from 'react';

export type HandTracking={width:number;height:number;mirrored:true;hands:{side:'Left'|'Right';points:[number,number][]}[]};
// MediaPipe's 21 keypoints: thumb, four fingers, and the palm perimeter.
const chains=[[0,1,2,3,4],[0,5,6,7,8],[5,9,10,11,12],[9,13,14,15,16],[13,17,18,19,20],[0,17]];
const colors=['#ffb84d','#65edce','#73c5ff','#cfabff','#ff94b6','#65edce'];
export default function RealtimeSkeleton({tracking,seq,latencyMs,enabled,badge}:{tracking?:HandTracking;seq:number;latencyMs:number;enabled:boolean;badge:string}){
  const [fresh,setFresh]=useState(false);
  useEffect(()=>{setFresh(true);const timer=setTimeout(()=>setFresh(false),750);return()=>clearTimeout(timer);},[seq]);
  const current=enabled&&fresh&&latencyMs<=750?tracking:undefined;
  return <>
    {current&&current.hands.length>0&&<svg className="realtime-skeleton" viewBox={`0 0 ${current.width} ${current.height}`} preserveAspectRatio="xMidYMid meet" aria-label="实时手部骨架" data-testid="realtime-skeleton" data-hands={current.hands.length} data-seq={seq}>
      {current.hands.map((hand,i)=><g key={i} data-side={hand.side}>
        {chains.map((chain,j)=><polyline key={j} points={chain.map(k=>`${hand.points[k][0]*current.width},${hand.points[k][1]*current.height}`).join(' ')} fill="none" stroke={colors[j]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>)}
        {hand.points.map(([x,y],j)=><circle key={j} cx={x*current.width} cy={y*current.height} r={j===0?4:2.7} fill={j<=4?'#ffcf77':'#f3fffc'} stroke="#163f3c" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}
      </g>)}
    </svg>}
    <div className="realtime-picture-status" role="status" data-testid="realtime-picture-status"><span className="realtime-tracking-dot"/><div><strong>{badge}</strong><small>{!enabled?'骨架已隐藏':!fresh||latencyMs>750?'等待新的分析画面':current?.hands.length?`正在追踪 ${current.hands.length} 只手 · 拇指为橙色`:'等待手部进入画面'}</small></div></div>
  </>;
}
