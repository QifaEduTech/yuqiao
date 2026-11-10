/* Direct geometry port. A supported motion is a veto/gate, never a word label. */
((scope)=>{
 const clip=(v,a,b)=>Math.max(a,Math.min(b,v)),sub=(a,b)=>a.map((v,i)=>v-b[i]),dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),norm=a=>Math.sqrt(dot(a,a));
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
 const q=(a,p)=>{const b=[...a].sort((x,y)=>x-y),n=(b.length-1)*p,i=Math.floor(n);return b[i]+(b[Math.min(i+1,b.length-1)]-b[i])*(n-i);};
 const angle=(a,b,c,eps=1e-8)=>{const u=sub(a,b),v=sub(c,b),d=norm(u)*norm(v);return d<eps?null:Math.acos(clip(dot(u,v)/d,-1,1))*180/Math.PI;};
 const bend=(a,b,c)=>{const x=angle(a,b,c,1e-10);return x===null?null:180-x;},vectorAngle=(a,b)=>Math.acos(clip(dot(a,b),-1,1))*180/Math.PI;
 const validHand=h=>Array.isArray(h)&&h.length===21&&h.every(p=>p.length===3&&p.every(Number.isFinite));
 function handFrom153(frame,side,aspect){const o=side*76;if(frame[o+74]<=0||frame[o+65]<=1e-8)return null;return Array.from({length:21},(_,i)=>[frame[o+i*3]*frame[o+65]+frame[o+63],(frame[o+i*3+1]*frame[o+65]+frame[o+64])*aspect,frame[o+i*3+2]*frame[o+65]]);}
 function geometry(value,side){
  if(!value||value.length!==126||!Array.from(value).every(Number.isFinite))return null;const h=Array.from({length:21},(_,i)=>Array.from(value.slice(side*63+i*3,side*63+i*3+3)));if(!h.flat().some(v=>v!==0))return null;
  const angles=[bend(h[0],h[1],h[2]),bend(h[1],h[2],h[3]),bend(h[2],h[3],h[4]),bend(h[9],h[0],h[0].map((v,i)=>v+h[4][i]-h[2][i]))];if(angles.some(x=>x===null))return null;
  const palm=mean([5,9,17].map(i=>norm(sub(h[i],h[0])))),span=norm(sub(h[4],h[2]));if(palm<1e-8||span<1e-8)return null;
  const a=sub(h[5],h[0]),b=sub(h[17],h[0]),normal=cross(a,b),axis=sub(h[9],h[0]),scale=norm(a)*norm(b);if(scale<1e-10||norm(normal)/scale<.05||norm(axis)<1e-8)return null;
  return [angles[2],span/palm,normal.map(v=>v/norm(normal)),axis.map(v=>v/norm(axis))];
 }
 function thumbEvidence(timeline,rules,config){
  let previous=null;for(const [t] of timeline){if(!Number.isFinite(t)||t<0||previous!==null&&t<=previous)throw Error('invalid_timestamp_order');previous=t;}
  let accepted=0,rejected=0;const latest={};
  for(const [side,label] of ['Left','Right'].entries()){
   const runs=[];let run=[],prev=null;for(const [t,v] of timeline){const g=geometry(v,side);if(g===null||prev!==null&&t-prev>rules.maxTrackingGapSeconds){if(run.length)runs.push(run);run=[];}if(g!==null)run.push([t,g]);prev=t;}if(run.length)runs.push(run);
   for(const rows of runs){if(rows.length<rules.minRunSamples||rows.at(-1)[0]-rows[0][0]<rules.minRunSeconds)continue;const seen=new Set();
    for(const channel of [0,1])for(let i=0;i<rows.length;i++){
     const [t,g]=rows[i],past=rows.slice(0,i).filter(r=>t-r[0]<=rules.baselineLookbackSeconds);if(past.length<rules.minBaselineSamples||past.at(-1)[0]-past[0][0]<rules.minBaselineSpanSeconds)continue;
     const baseline=q(past.map(r=>r[1][channel]),channel===0?.2:.8),threshold=channel===0?rules.minIpChangeDegrees:config.minThumbSpanContractionFraction;if(channel===1&&baseline<=0)continue;
     const change=v=>channel===0?v[0]-baseline:1-v[1]/baseline;if(change(g)<threshold||channel===0&&g[0]<rules.minIpBendDegrees)continue;
     let begin=i,end=i;const shoulder=v=>change(v)>=threshold*rules.shoulderChangeFraction;
     while(begin>0&&rows[begin][0]-rows[begin-1][0]<=rules.maxSupportGapSeconds&&shoulder(rows[begin-1][1]))begin--;
     while(end+1<rows.length&&rows[end+1][0]-rows[end][0]<=rules.maxSupportGapSeconds&&shoulder(rows[end+1][1]))end++;
     if(end-begin+1<rules.minSupportSamples||rows[end][0]-rows[begin][0]<rules.minSupportSpanSeconds)continue;const key=channel+','+begin+','+end;if(seen.has(key))continue;seen.add(key);
     const target=rows[begin][0]-config.referenceBeforeOnsetSeconds,refs=Array.from({length:begin},(_,j)=>j).filter(j=>Math.abs(rows[j][0]-target)<=config.maxReferenceDistanceSeconds);if(!refs.length)continue;let ref=refs[0];for(const j of refs)if(Math.abs(rows[j][0]-target)<Math.abs(rows[ref][0]-target))ref=j;
     const normal=Math.max(...rows.slice(ref,end+1).map(r=>vectorAngle(rows[ref][1][2],r[1][2]))),axis=Math.max(...rows.slice(ref,end+1).map(r=>vectorAngle(rows[ref][1][3],r[1][3]))),stable=normal<=config.maxPalmNormalRotationDegrees&&axis<=config.maxPalmAxisRotationDegrees;
     if(stable){accepted++;if(!latest[label]||rows[end][0]>latest[label].endTime)latest[label]={side:label,endTime:rows[end][0],accepted:true};}else rejected++;
    }
   }
  }return {supported:accepted>0,acceptedEvents:accepted,rejectedEvents:rejected,latestAcceptedBySide:Object.values(latest)};
 }
 function recentThumb(rows,t,cfg){return thumbEvidence(rows,cfg.thumb,cfg.thumbLocal).latestAcceptedBySide.some(e=>{if(t-e.endTime>cfg.realtime.thumbEvidenceMaxAgeSeconds)return false;const tail=rows.filter(r=>r[0]>=e.endTime-.001),side=e.side==='Left'?0:1;return tail.length>0&&tail.every(r=>geometry(r[1],side)!==null)&&tail.every((r,i)=>!i||r[0]-tail[i-1][0]<=.2);});}
 function helpMotion(timeline,cfg){
  const runs=[];let run=[],previous=null,previousWrists=null,ambiguous=0;
  for(const [t,hands] of timeline){
   if(!Number.isFinite(t)||t<0||previous!==null&&t<=previous)throw Error('invalid_timestamp_order');const gap=previous!==null&&t-previous>cfg.maxTrackingGapSeconds;previous=t;
   const values=Object.values(hands).map(h=>{if(!validHand(h))return null;const scale=norm(sub(h[9],h[0]));if(scale<1e-8)return null;let opened=0;for(const root of [5,9,13,17]){const a=bend(h[root],h[root+1],h[root+2]);if(a!==null&&a<cfg.maxFingerBendDegrees&&norm(sub(h[root+3],h[0]))>1.2*norm(sub(h[root],h[0])))opened++;}return {wrist:h[0].slice(0,2),scale,opened};}).filter(Boolean).sort((a,b)=>a.wrist[0]-b.wrist[0]);
   let good=values.length===2,wrists;
   if(good){wrists=values.map(v=>v.wrist);good=wrists[1][0]-wrists[0][0]>=mean(values.map(v=>v.scale))*cfg.minSeparationPalmLengths;if(previousWrists&&!gap)good=good&&Math.max(...wrists.map((v,i)=>norm(sub(v,previousWrists[i]))))<cfg.maxWristJumpImageWidths;}
   if(!good||gap){if(run.length)runs.push(run);run=[];previousWrists=null;if(!good){ambiguous++;continue;}}previousWrists=wrists;run.push([t,values]);
  }if(run.length)runs.push(run);const reports=[];
  for(const rows of runs){
   if(rows.length<cfg.minBothHandFrames||rows.at(-1)[0]-rows[0][0]<cfg.minSpanSeconds)continue;
   const scales=[0,1].map(i=>rows.map(r=>r[1][i].scale)),normalized=scales.map(a=>{const m=Math.max(q(a,.5),1e-8);return a.map(v=>v/m);}),ranges=normalized.map(a=>q(a,.9)-q(a,.1)),means=normalized.map(mean),std=normalized.map((a,i)=>Math.sqrt(mean(a.map(v=>(v-means[i])**2))));
   const correlation=Math.min(...std)>1e-6?mean(normalized[0].map((v,i)=>(v-means[0])*(normalized[1][i]-means[1])))/(std[0]*std[1]):0;
   const common=rows.map((_,i)=>mean(normalized.map(a=>q(a.slice(Math.max(0,i-1),i+2),.5))));let cycles=0,lastEvidenceTime=null;
   for(let i=0;i<rows.length;i++){const t=rows[i][0],past=rows.map((_,j)=>j).filter(j=>j<i&&t-rows[j][0]>=cfg.supportSeconds&&t-rows[j][0]<=cfg.cycleWindowSeconds),future=rows.map((_,j)=>j).filter(j=>j>i&&rows[j][0]-t>=cfg.supportSeconds&&rows[j][0]-t<=cfg.cycleWindowSeconds);if(past.length&&future.length&&common[i]-Math.min(...past.map(j=>common[j]))>=cfg.minScaleExcursion&&common[i]-Math.min(...future.map(j=>common[j]))>=cfg.minScaleExcursion){cycles++;const j=future.find(j=>common[i]-common[j]>=cfg.minScaleExcursion);lastEvidenceTime=Math.max(lastEvidenceTime??0,rows[j][0]);}}
   const opens=[0,1].map(i=>mean(rows.map(r=>r[1][i].opened>=3?1:0))),reasons=[];if(Math.min(...opens)<cfg.minOpenFraction)reasons.push('hands_not_open');if(Math.min(...ranges)<cfg.minScaleExcursion)reasons.push('insufficient_bilateral_change');if(correlation<cfg.minScaleCorrelation)reasons.push('hands_not_coordinated');if(!cycles)reasons.push('no_supported_return_motion');reports.push({supported:!reasons.length,reasons,lastEvidenceTime});
  }return {supported:reports.some(r=>r.supported),runs:reports,ambiguousOrMissingFrames:ambiguous};
 }
 class NeedMotion {
  constructor(rules){this.rules=rules;this.lastTime=null;this.reset();}
  reset(){this.rows=[[],[]];this.evidence=[null,null];this.positions=[null,null];this.seen=[null,null];}
  push(t,frame,aspect){
   const R=this.rules;if(!Number.isFinite(t)||t<0||this.lastTime!==null&&t<=this.lastTime||frame.length!==153||!Array.from(frame).every(Number.isFinite)||!Number.isFinite(aspect)||aspect<.1||aspect>10)throw Error('invalid_motion_input');if(this.lastTime!==null&&t-this.lastTime>R.maxGapSeconds)this.reset();this.lastTime=t;let observations=[];
   for(const side of [0,1]){const o=side*76;if(frame[o+74]<=0||frame[o+65]<=1e-8)continue;const p=Array.from({length:21},(_,i)=>[frame[o+i*3]*frame[o+65],frame[o+i*3+1]*frame[o+65]*aspect]),d=[[5,9],[9,13],[13,17],[5,17]].map(([a,b])=>norm(sub(p[a],p[b])));if(d[3]>=R.minPalmWidth&&Math.min(...d)>1e-6)observations.push({d,wrist:[frame[o+63],frame[o+64]*aspect]});}
   const cost=(slot,wrist)=>this.seen[slot]===null||t-this.seen[slot]>R.maxGapSeconds?1:norm(sub(wrist,this.positions[slot]))<=R.maxWristStep?norm(sub(wrist,this.positions[slot])):2;
   if(observations.length===2&&norm(sub(observations[0].wrist,observations[1].wrist))<Math.max(R.minHandSeparation,R.overlapPalmWidths*Math.min(...observations.map(o=>o.d[3])))){const active=[0,1].filter(i=>this.seen[i]!==null&&t-this.seen[i]<=R.maxGapSeconds);if(active.length===1)observations=[observations.reduce((a,b)=>cost(active[0],b.wrist)<cost(active[0],a.wrist)?b:a)];else{this.reset();observations=[];}}
   const possibilities=observations.length===2?[[0,1],[1,0]]:observations.length?[[0],[1]]:[[]];let assignment=possibilities[0],best=Infinity;for(const a of possibilities){const c=a.reduce((s,side,i)=>s+cost(side,observations[i].wrist),0);if(c<best){best=c;assignment=a;}}
   for(let i=0;i<observations.length;i++){
    const side=assignment[i],{d,wrist}=observations[i];if(cost(side,wrist)>=1){this.rows[side]=[];this.evidence[side]=null;}this.positions[side]=wrist.slice();this.seen[side]=t;let rows=this.rows[side];rows.push([t,d]);while(rows.length&&t-rows[0][0]>R.maxWindowSeconds)rows.shift();const end=rows.filter(r=>t-r[0]<=R.endpointSeconds);if(end.length<R.minEndpointFrames)continue;
    const median=a=>[0,1,2,3].map(j=>q(a.map(r=>r[1][j]),.5)),spread=(a,v)=>Math.max(...v.map((x,j)=>(Math.max(...a.map(r=>r[1][j]))-Math.min(...a.map(r=>r[1][j])))/x)),low=median(end);if(spread(end,low)>R.maxEndpointRelativeSpread)continue;
    for(let j=0;j<rows.length-end.length;j++){const center=rows[j][0],transition=end[0][0]-center;if(transition<R.minTransitionSeconds||transition>R.maxTransitionSeconds)continue;const start=rows.slice(0,j+1).filter(r=>center-r[0]<=R.endpointSeconds);if(start.length<R.minEndpointFrames)continue;const high=median(start),drop=high.map((v,k)=>(v-low[k])/v);if(Math.min(...drop)<R.minRelativeContraction||spread(start,high)>R.maxEndpointRelativeSpread)continue;const between=rows.filter(r=>center<r[0]&&r[0]<end[0][0]&&low[3]+.1*(high[3]-low[3])<r[1][3]&&r[1][3]<high[3]-.1*(high[3]-low[3]));if(between.length<R.minIntermediateFrames)continue;this.evidence[side]={trackId:side,start:start[0][0],end:between.at(-1)[0],minRelativeContraction:Math.min(...drop),intermediateFrames:between.length};break;}
   }const evidence=this.evidence.filter(e=>e&&t-e.end<=R.evidenceMaxAgeSeconds);return {supported:!!evidence.length,evidence};
  }
 }
 function meFrame(hands,shoulders,R){
  if(!Array.isArray(shoulders)||shoulders.length!==2||shoulders.some(s=>s.length!==3||!s.every(Number.isFinite))||Math.min(shoulders[0][2],shoulders[1][2])<R.minShoulderVisibility)return {supported:false,reason:'missing_body_reference'};
  const center=[0,1].map(i=>(shoulders[0][i]+shoulders[1][i])/2),span=norm(sub(shoulders[0].slice(0,2),shoulders[1].slice(0,2)));if(span<R.minShoulderSpan)return {supported:false,reason:'invalid_body_scale'};const chest=[center[0],center[1]+R.chestOffsetShoulderSpans*span],candidates=[];
  for(const h of hands){if(!validHand(h))continue;const flat=h.map(p=>[p[0],p[1],0]),a=[5,9,13,17].map(i=>angle(h[i],h[i+1],h[i+3])),b=[5,9,13,17].map(i=>angle(flat[i],flat[i+1],flat[i+3]));if([...a,...b].some(v=>v===null))continue;const index=Math.max(a[0],b[0]),other=Math.min(mean(a.slice(1)),mean(b.slice(1))),direction=sub(h[8].slice(0,2),h[5].slice(0,2)),target=sub(chest,h[5].slice(0,2)),denominator=norm(direction)*norm(target),cos=denominator<1e-8?null:clip(dot(direction,target)/denominator,-1,1),distance=norm(sub(h[8].slice(0,2),center))/span,ray=sub(h[8],h[5]),rayLength=norm(ray),palm=norm(sub(h[9],h[0])),depth=rayLength>1e-8?ray[2]/rayLength:0,ratio=palm>1e-8?rayLength/palm:0;
   const pointing=index>=R.minIndexAngleDegrees||(depth>=R.minRecedingIndexFraction&&ratio>=R.minIndexRayPalmRatio);if(pointing&&other<=R.maxOtherFingerMeanDegrees&&cos!==null&&cos>=R.minPointingCosine&&distance<=R.maxTipDistanceShoulderSpans)candidates.push({wristRelative:sub(h[0].slice(0,2),center).map(v=>v/span)});
  }return candidates.length===1?{supported:true,...candidates[0]}:{supported:false,reason:candidates.length?'ambiguous_hands':'insufficient_shape_direction_evidence'};
 }
 scope.YuqiaoMotion={geometry,thumbEvidence,recentThumb,helpMotion,NeedMotion,meFrame,handFrom153,math:{clip,sub,dot,norm,q,mean}};
})(globalThis);
