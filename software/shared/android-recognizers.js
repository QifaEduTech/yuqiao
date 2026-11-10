/* Ported per-action state machines. Configuration is copied from the desktop contracts. */
((scope)=>{
 const M=scope.YuqiaoMotion,F=scope.YuqiaoFeatures,{norm,sub,q}=M.math;
 const ms=t=>{const x=t*1000,n=Math.floor(x);return x-n===.5?(n%2?n+1:n):Math.round(x);};
 const bounded=(rows,t,c)=>{while(rows.length>c.maxSamples||rows.length&&t-rows[0][0]>c.maxWindowSeconds)rows.shift();};
 const present=f=>!!(f[74]>0||f[150]>0);
 function clock(owner,t,resetGap){if(!Number.isFinite(t)||t<0||owner.lastTime!==null&&t<=owner.lastTime)throw Error('invalid_timestamp_order');const gap=owner.lastTime===null?0:t-owner.lastTime;if(gap>resetGap)owner.reset();owner.lastTime=t;return gap;}
 class ThanksSingle {
  constructor(classify,cfg,gate){this.classify=classify;this.cfg=cfg;this.gate=gate;this.lastTime=null;this.nextId=1;this.reset();}
  resetWindow(){this.samples=[];this.latest=null;this.lastPrediction=-100;this.windowMissing=null;this.lastStatus='observing';this.lastReason='collecting';}
  clearSegment(){this.started=null;this.missing=null;this.supportSince=null;this.lastSupport=null;this.count=0;this.qualified=false;this.blocked=false;}
  reset(){this.resetWindow();this.clearSegment();}
  windowPush(t,value){
   const c=this.cfg.realtime;this.samples.push([t,value===null?null:Float32Array.from(value)]);bounded(this.samples,t,c);
   const report=(status,reason)=>{this.lastStatus=status;this.lastReason=reason;return {status,reason,candidate:this.latest,samples:this.samples.length,handSamples:this.samples.filter(r=>r[1]!==null).length};};
   if(value===null){this.latest=null;this.lastPrediction=-100;if(this.windowMissing===null)this.windowMissing=t;if(t-this.windowMissing>=c.missingResetSeconds)this.resetWindow();return report('waiting','no_hands');}this.windowMissing=null;
   const valid=this.samples.filter(r=>r[1]!==null);if(valid.length<c.minHandSamples||valid.at(-1)[0]-valid[0][0]<c.minSpanSeconds){this.latest=null;return report('observing','collecting');}
   const first=this.samples.findIndex(r=>r[1]!==null),last=this.samples.findLastIndex(r=>r[1]!==null);let missing=null,longest=0;for(const [time,v] of this.samples.slice(first,last+1)){if(v===null&&missing===null)missing=time;else if(v!==null&&missing!==null){longest=Math.max(longest,time-missing);missing=null;}}const coverage=valid.length/(last-first+1);
   if(coverage<.6||longest>.6){this.latest=null;return report('uncertain','visibility');}if(t-this.lastPrediction<c.predictIntervalSeconds)return report(this.lastStatus,this.lastReason);this.lastPrediction=t;
   if(!this.gate(this.samples,t)){this.latest=null;return report('observing','thumb_motion_required');}
   const scores=this.classify(Array.from({length:30},(_,i)=>valid[Math.floor(i*(valid.length-1)/29)][1])),order=scores.map((v,i)=>({v,i})).sort((a,b)=>b.v-a.v||b.i-a.i),best=order[0];
   this.latest=best.i===this.cfg.thanksIndex&&best.v>=.8&&best.v-order[1].v>=.25?'谢谢':null;return report(this.latest?'candidate':'uncertain',this.latest?'target':'not_target');
  }
  push(t,value){
   clock(this,t,this.cfg.realtime.resetGapSeconds);const c=this.cfg.realtime,r=c.events,previous=this.lastPrediction,result=this.windowPush(t,value),fresh=value!==null&&previous!==this.lastPrediction;let event=null,state='collecting';
   if(value===null){if(this.missing===null)this.missing=t;state=this.qualified?'ending':'waiting';if(t-this.missing>=c.missingResetSeconds){if(this.qualified&&!this.blocked&&this.lastSupport!==null&&this.missing-this.lastSupport<=r.maxSupportAgeSeconds)event={id:this.nextId++,signId:'csl.thanks',text:'谢谢',startMs:ms(this.started),endMs:ms(this.missing)};this.reset();state=event?'emitted':'waiting';}}
   else{if(this.started===null)this.started=t;if(this.missing!==null){this.supportSince=null;this.count=0;}this.missing=null;if(t-this.started>r.maxSegmentSeconds){this.blocked=true;this.qualified=false;}if(fresh&&!this.blocked){if(result.candidate==='谢谢'){if(this.supportSince===null)this.supportSince=t;this.lastSupport=t;this.count++;if(this.count>=r.minPredictions&&t-this.supportSince>=r.stableSeconds)this.qualified=true;}else{this.supportSince=null;this.count=0;this.qualified=false;}}if(this.lastSupport!==null&&t-this.lastSupport>r.maxSupportAgeSeconds)this.qualified=false;state=this.blocked?'reset_required':this.qualified?'ready_to_finish':'collecting';}
   return {...result,event,eventState:state};
  }
 }
 class Thanks {
  constructor(classify,cfg){this.classify=classify;this.cfg=cfg;this.nextId=1;this.reset();}
  reset(){this.context=[];this.full=new ThanksSingle(this.classify,this.cfg,(rows,t)=>M.recentThumb(rows,t,this.cfg));this.sides=[0,1].map(side=>new ThanksSingle(this.classify,this.cfg,(rows,t)=>this.passivePeer(side,t)&&M.recentThumb(rows,t,this.cfg)));}
  restart(){this.reset();}
  beginSegment(t){for(const d of [this.full,...this.sides]){if(d.started!==null)d.started=Math.max(d.started,t);d.blocked=false;}}
  passivePeer(active,t){const peer=1-active,R=this.cfg.activeHand;if(!this.context.length)return false;if(this.context.at(-1)[1][peer*76+74]<=0)return true;const rows=this.context.filter(([time,v])=>t-time<=R.passiveWindowSeconds&&v[peer*76+74]>0);if(rows.length<R.minSamples||rows.at(-1)[0]-rows[0][0]<R.minSpanSeconds||rows.some((r,i)=>i&&r[0]-rows[i-1][0]>.2))return false;
   const wrists=[],palms=[],shapes=[];for(const [time,vec,aspect] of rows){const o=peer*76,local=Array.from({length:21},(_,i)=>[vec[o+i*3],vec[o+i*3+1]*aspect,vec[o+i*3+2]]);wrists.push([vec[o+63],vec[o+64]*aspect]);palms.push(norm(local[9])*vec[o+65]);shapes.push(local.flat());}
   const scale=Math.max(q(palms,.5),1e-8),wrist=norm([0,1].map(i=>q(wrists.map(w=>w[i]),.9)-q(wrists.map(w=>w[i]),.1)))/scale,shape=Math.max(...Array.from({length:63},(_,i)=>q(shapes.map(v=>v[i]),.9)-q(shapes.map(v=>v[i]),.1))),relative=(q(palms,.9)-q(palms,.1))/scale;return wrist<=R.maxWristRangePalmLengths&&shape<=R.maxLocalShapeRange&&relative<=R.maxPalmScaleRelativeRange;
  }
  push(t,value,vector,aspect){this.context.push([t,Array.from(vector),aspect]);while(this.context.length>this.cfg.realtime.maxSamples||this.context.length&&t-this.context[0][0]>this.cfg.activeHand.passiveWindowSeconds+.2)this.context.shift();const outputs=[this.full.push(t,value)];for(let side=0;side<2;side++){let masked=null;if(value&&Array.from(value.slice(side*63,side*63+63)).some(v=>v!==0)){masked=new Float32Array(126);masked.set(value.slice(side*63,side*63+63),side*63);}outputs.push(this.sides[side].push(t,masked));}
   const completed=outputs.filter((r,i)=>r.event&&(i===0||this.passivePeer(i-1,t))).map(r=>r.event);if(completed.length){const event={...completed[0],id:this.nextId++,startMs:Math.min(...completed.map(e=>e.startMs)),endMs:Math.max(...completed.map(e=>e.endMs))};this.reset();return {status:'waiting',candidate:null,event,eventState:'emitted',reason:'action_hand_left',samples:0,handSamples:0};}const available=outputs.filter(r=>r.candidate&&r.eventState!=='reset_required');return available.find(r=>r.eventState==='ready_to_finish')??available[0]??outputs.find(r=>r.eventState==='ending')??outputs[0];
  }
 }
 class Help {
  constructor(probability,cfg){this.model=probability;this.cfg=cfg;this.lastTime=null;this.nextId=1;this.reset();}
  reset(){this.samples=[];this.lastPrediction=-100;this.latest=false;this.started=null;this.missing=null;this.supportSince=null;this.count=0;this.lastSupport=null;this.qualified=false;this.blocked=false;this.reason='collecting';this.score=null;this.motion=null;}
  restart(){this.reset();this.lastTime=null;}beginSegment(t){if(this.started!==null)this.started=Math.max(this.started,t);this.blocked=false;}
  push(t,frame,aspect){clock(this,t,this.cfg.realtime.resetGapSeconds);const c=this.cfg.realtime,r=c.events,has=present(frame);this.samples.push([t,has?Float32Array.from(frame):null,aspect]);bounded(this.samples,t,c);let event=null,state='collecting',reason;
   if(!has){this.latest=false;if(this.missing===null)this.missing=t;state=this.qualified?'ending':'waiting';if(t-this.missing>=c.missingResetSeconds){if(this.qualified&&!this.blocked&&this.lastSupport!==null&&this.missing-this.lastSupport<=r.maxSupportAgeSeconds)event={id:this.nextId++,text:'帮助',signId:'csl.ref.bmcx.1900',startMs:ms(this.started),endMs:ms(this.missing)};this.reset();state=event?'emitted':'waiting';}reason='no_hands';this.score=null;this.motion=null;}
   else{if(this.started===null)this.started=t;if(this.missing!==null){this.supportSince=null;this.count=0;}this.missing=null;if(t-this.started>r.maxSegmentSeconds){this.blocked=true;this.qualified=false;this.latest=false;}if(!this.blocked&&t-this.lastPrediction>=c.predictIntervalSeconds){this.lastPrediction=t;const valid=this.samples.filter(r=>r[1]);this.latest=false;
     if(valid.length<c.minHandSamples||valid.at(-1)[0]-valid[0][0]<c.minSpanSeconds){this.score=null;this.motion=null;}
     else{let previous=null;const frames=this.samples.map(([time,f])=>{const out=f??new Float32Array(153);if(!f)out[152]=Math.min(previous===null?1/30:time-previous,1)*30;previous=time;return out;});this.score=this.model(frames);const timeline=this.samples.map(([time,f,a])=>[time,f?Object.fromEntries([0,1].map(side=>[['Left','Right'][side],M.handFrom153(f,side,a)]).filter(r=>r[1])):{}]),motion=M.helpMotion(timeline,this.cfg.helpMotion);this.motion=motion.runs.some(r=>r.supported&&r.lastEvidenceTime!==null&&t-r.lastEvidenceTime<=this.cfg.helpRuntime.motionGuard.maxEvidenceAgeSeconds);this.latest=this.score>=.5&&this.motion;}
     this.reason=this.latest?'help_model':this.score===null?'help_model_collecting':this.motion===false?'help_motion_required':'help_model_below_threshold';if(this.latest){if(this.supportSince===null)this.supportSince=t;this.count++;this.lastSupport=t;if(this.count>=r.minPredictions&&t-this.supportSince>=r.stableSeconds)this.qualified=true;}else{this.qualified=false;this.supportSince=null;this.count=0;}}
    if(this.lastSupport!==null&&t-this.lastSupport>r.maxSupportAgeSeconds)this.qualified=false;state=this.blocked?'reset_required':this.qualified?'ready_to_finish':'collecting';reason=this.reason;
   }return {candidate:this.latest&&!this.blocked?'帮助':null,event,eventState:state,reason,helpScore:this.score,motionSupported:this.motion,samples:this.samples.length,handSamples:this.samples.filter(r=>r[1]).length};
  }
 }
 class Need {
  constructor(probability,cfg){this.model=probability;this.cfg=cfg;this.lastTime=null;this.nextId=1;this.reset();}
  reset(){this.samples=[];this.gate=new M.NeedMotion(this.cfg.needMotion);this.lastPrediction=-100;this.started=null;this.missing=null;this.supportSince=null;this.lastSupport=null;this.count=0;this.qualified=false;this.blocked=false;this.candidate=null;this.score=null;}
  restart(){this.reset();this.lastTime=null;}beginSegment(t){if(this.started!==null)this.started=Math.max(this.started,t);this.blocked=false;}
  push(t,frame,aspect){const c=this.cfg.needLive;clock(this,t,c.resetGapSeconds);const has=present(frame),motion=this.gate.push(t,frame,aspect);this.samples.push([t,Float32Array.from(frame)]);bounded(this.samples,t,c);let event=null,state='collecting',reason='collecting';
   if(!has){this.candidate=null;if(this.missing===null)this.missing=t;state=this.qualified?'ending':'waiting';reason='no_hands';if(t-this.missing>=c.missingEndSeconds){if(this.qualified&&!this.blocked&&this.lastSupport!==null&&this.missing-this.lastSupport<=c.maxSupportAgeSeconds)event={id:this.nextId++,text:'需要',signId:'csl.ref.bmcx.1874',startMs:ms(this.started),endMs:ms(this.missing)};this.reset();state=event?'emitted':'waiting';}}
   else{if(this.started===null)this.started=t;if(this.missing!==null){this.supportSince=null;this.count=0;}this.missing=null;if(t-this.started>c.maxSegmentSeconds)this.blocked=true;const ready=this.samples.length>=c.minSamples&&t-this.samples[0][0]>=c.minSpanSeconds;
    if(!motion.supported||this.blocked){this.candidate=null;this.qualified=false;this.supportSince=null;this.count=0;reason='need_motion_required';}
    else if(ready&&t-this.lastPrediction>=c.predictIntervalSeconds){this.lastPrediction=t;const values=F.directional171(this.samples.map(r=>r[1]),this.samples.map(r=>r[0]),aspect);this.score=this.model(values);this.candidate=this.score>=c.threshold?'需要':null;if(this.candidate){if(this.supportSince===null)this.supportSince=t;this.count++;this.lastSupport=t;this.qualified=this.count>=c.minPredictions&&t-this.supportSince>=c.stableSeconds;}else{this.qualified=false;this.supportSince=null;this.count=0;}reason=this.candidate?'need_model':'need_below_threshold';}
    if(this.lastSupport!==null&&t-this.lastSupport>c.maxSupportAgeSeconds){this.qualified=false;this.candidate=null;}state=this.blocked?'reset_required':this.qualified?'ready_to_finish':'collecting';
   }return {candidate:this.candidate,event,eventState:state,reason,needScore:this.score,needMotionSupported:motion.supported,samples:this.samples.length,handSamples:this.samples.filter(r=>present(r[1])).length};
  }
 }
 class Me {
  constructor(probability,cfg){this.model=probability;this.cfg=cfg;this.lastTime=null;this.nextId=1;this.reset();}
  reset(){this.samples=[];this.started=null;this.missing=null;this.lastSupport=null;this.supportSince=null;this.count=0;this.qualified=false;this.blocked=false;this.candidate=null;this.score=null;this.lastPrediction=-100;this.evidenceStart=null;this.evidenceCount=0;this.lastEvidence=null;this.lastWrist=null;}
  restart(){this.reset();this.lastTime=null;}beginSegment(t){if(this.started!==null)this.started=Math.max(this.started,t);this.blocked=false;}
  push(t,payload){const c=this.cfg.meLive,r=this.cfg.meMotion,frame=payload?.frame??new Float32Array(178),gap=clock(this,t,c.resetGapSeconds)>r.maxGapSeconds,has=present(frame),evidence=payload?M.meFrame(payload.hands,payload.shoulders,r):{supported:false,reason:'missing_body_reference'};
   if(evidence.supported){const wrist=evidence.wristRelative;if(gap||this.lastWrist===null||norm(sub(wrist,this.lastWrist))>r.maxWristStepShoulderSpans){this.evidenceStart=t;this.evidenceCount=0;}this.evidenceCount++;this.lastWrist=wrist;if(this.evidenceCount>=c.minEvidenceFrames&&t-this.evidenceStart>=r.minSupportSeconds-1e-6)this.lastEvidence=t;}else{this.evidenceStart=null;this.evidenceCount=0;this.lastWrist=null;}
   if(gap||(has&&['missing_body_reference','invalid_body_scale','ambiguous_hands'].includes(evidence.reason)))this.lastEvidence=null;
   const supported=this.lastEvidence!==null&&t-this.lastEvidence<=c.evidenceAgeSeconds;this.samples.push([t,Float32Array.from(frame)]);bounded(this.samples,t,c);let event=null,state='collecting',reason='me_evidence_required';
   if(!has){this.candidate=null;if(this.missing===null)this.missing=t;state=this.qualified?'ending':'waiting';reason='no_hands';if(t-this.missing>=c.missingEndSeconds-1e-6){if(this.qualified&&!this.blocked&&this.lastSupport!==null&&this.missing-this.lastSupport<=c.maxSupportAgeSeconds)event={id:this.nextId++,text:'我',signId:'csl.me',startMs:ms(this.started),endMs:ms(this.missing)};this.reset();state=event?'emitted':'waiting';}}
   else{if(this.started===null)this.started=t;if(this.missing!==null){this.count=0;this.supportSince=null;}this.missing=null;if(t-this.started>c.maxSegmentSeconds)this.blocked=true;
    if(!supported||this.blocked){this.candidate=null;this.count=0;this.supportSince=null;if(this.blocked)this.qualified=false;}
    else if(this.samples.length>=c.minSamples&&t-this.samples[0][0]>=c.minSpanSeconds&&t-this.lastPrediction>=c.predictIntervalSeconds-1e-6){this.lastPrediction=t;this.score=this.model(this.samples.map(r=>r[1]));this.candidate=this.score>=c.threshold?'我':null;if(this.candidate){if(this.supportSince===null)this.supportSince=t;this.count++;this.lastSupport=t;this.qualified=this.count>=c.minPredictions&&t-this.supportSince>=c.stableSeconds-1e-6;}else{this.qualified=false;this.count=0;this.supportSince=null;}reason=this.candidate?'me_model':'me_below_threshold';}
    if(this.lastSupport!==null&&t-this.lastSupport>c.maxSupportAgeSeconds){this.candidate=null;this.qualified=false;}state=this.blocked?'reset_required':this.qualified?'ready_to_finish':'collecting';
   }return {candidate:this.candidate,event,eventState:state,reason,meScore:this.score,meEvidenceSupported:supported,samples:this.samples.length,handSamples:this.samples.filter(r=>present(r[1])).length};
  }
 }
 scope.YuqiaoRecognizers={ThanksSingle,Thanks,Help,Need,Me,ms};
})(globalThis);
