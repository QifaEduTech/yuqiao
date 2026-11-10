/* Sequential handoffs and simultaneous evidence conflicts; never compare uncalibrated scores. */
((scope)=>{
 const ids={'谢谢':'csl.thanks','帮助':'csl.ref.bmcx.1900','需要':'csl.ref.bmcx.1874','我':'csl.me'},ms=scope.YuqiaoRecognizers.ms;
 class Multi {
  constructor(detectors,cfg){this.detectors=detectors;this.cfg=cfg;this.lastTime=null;this.nextId=1;this.floor=0;this.pending=[];this.buffer=[];this.clear();}
  clear(){this.active=null;this.conflicted=false;this.missing=null;this.overlap=null;this.started=null;this.buffer=[];}
  resetDetectors(keep=null){for(const [word,d] of Object.entries(this.detectors))if(word!==keep)d.reset();}
  activate(word,t,start){this.active={word,start:Math.max(start,this.floor),lastStable:t,retired:null,seeded:false,handCount:this.handCount??0,countChange:null};this.overlap=null;}
  invoke(word,d,row){const [t,value,vector,aspect,body]=row;return word==='谢谢'?d.push(t,value,vector,aspect):word==='我'?d.push(t,body):d.push(t,vector,aspect);}
  reseed(start=null){const rows=this.buffer.filter(r=>r[0]>=(start??this.active.retired-this.cfg.transitions.preRollSeconds)),out={};for(const [word,d] of Object.entries(this.detectors)){if(word===this.active.word)continue;d.restart();for(const row of rows)out[word]=this.invoke(word,d,row);}this.active.seeded=true;return out;}
  rebase(word,start){this.detectors[word].beginSegment(start/1000);}
  queue(event){const floor=this.pending.length?this.pending.at(-1).endMs+1:this.floor,value={...event,startMs:Math.max(event.startMs,floor)};if(value.endMs>value.startMs){this.pending.push(value);return true;}return false;}
  emitted(){const event={...this.pending.shift(),id:this.nextId++};this.floor=event.endMs+1;return {status:'waiting',candidate:null,reason:'action_finished',eventState:'emitted',event,samples:0,handSamples:0};}
  handoff(word,t){const old=this.active,r=this.cfg.transitions;if(!old||old.retired===null||t-old.retired<r.quietSeconds-1e-6)return false;const boundary=ms(old.retired),recent=old.retired-old.lastStable<=this.cfg.realtime.events.maxSupportAgeSeconds&&t-old.retired<=r.maxPendingSeconds;if(recent)this.queue({text:old.word,signId:ids[old.word],startMs:old.start,endMs:boundary});this.activate(word,t,boundary+1);this.started=(boundary+1)/1000;this.resetDetectors(word);this.rebase(word,boundary+1);return true;}
  push(t,value,vector,aspect,body){
   const c=this.cfg.realtime,r=this.cfg.transitions;if(!Number.isFinite(t)||t<0||this.lastTime!==null&&t<=this.lastTime)throw Error('invalid_timestamp_order');if(this.lastTime!==null&&t-this.lastTime>c.resetGapSeconds){this.clear();this.pending=[];this.resetDetectors();}this.lastTime=t;if(this.pending.length)return this.emitted();
   const row=[t,value?Float32Array.from(value):null,Float32Array.from(vector),aspect,body?{frame:Float32Array.from(body.frame),hands:body.hands.map(h=>h.map(p=>p.slice())),shoulders:body.shoulders.map(p=>p.slice())}:null];this.buffer.push(row);if(this.buffer.length>c.maxSamples)this.buffer.shift();
   const byWord=Object.fromEntries(Object.entries(this.detectors).map(([word,d])=>[word,this.invoke(word,d,row)])),has=value!==null||vector[74]>0||vector[150]>0;this.handCount=Number(vector[74]>0)+Number(vector[150]>0);if(has&&this.started===null)this.started=t;
   let outputs=Object.values(byWord),candidates,stable,completed;const summarize=()=>{candidates=new Set(outputs.filter(o=>o.candidate).map(o=>o.candidate));stable=new Set(outputs.filter(o=>o.candidate&&o.eventState==='ready_to_finish').map(o=>o.candidate));completed=outputs.filter(o=>o.event).map(o=>o.event);};summarize();
   const meBoundary=this.active?.word==='我';if(meBoundary&&byWord['我']){outputs=[byWord['我']];summarize();}
   if(this.active&&!meBoundary){
    let updated={};if(this.handCount&&this.handCount!==this.active.handCount){let change=this.active.countChange;if(!change||change.count!==this.handCount)this.active.countChange=change={count:this.handCount,since:t,seeded:false};if(!change.seeded&&t-change.since>=r.handConfigurationSeconds-1e-6){updated=this.reseed(change.since);change.seeded=true;}}else this.active.countChange=null;
    if(candidates.has(this.active.word)){if(this.active.retired!==null&&this.handCount===this.active.handCount)this.active.seeded=false;this.active.retired=null;}else if(this.active.retired===null)this.active.retired=t;
    if(has&&!this.conflicted&&this.active.retired!==null&&!this.active.seeded&&t-this.active.retired>=r.quietSeconds-1e-6)updated=this.reseed();
    if(Object.keys(updated).length){Object.assign(byWord,updated);outputs=Object.values(byWord);summarize();}
   }
   let transition=false;
   if(stable.size>1){if(this.active&&stable.has(this.active.word)){if(this.overlap===null)this.overlap=t;transition=t-this.overlap<r.overlapGraceSeconds;if(!transition)this.conflicted=true;}else this.conflicted=true;}else this.overlap=null;
   if(completed.length>1)this.conflicted=true;
   if(!this.conflicted&&completed.length===1){let event=completed[0];const word=event.text;if(this.active&&this.active.word!==word&&!this.handoff(word,t))this.conflicted=true;if(!this.conflicted){if(this.active)event={...event,startMs:Math.max(event.startMs,this.active.start)};this.queue(event);const floor=this.pending.length?this.pending.at(-1).endMs+1:this.floor,others=[...stable].filter(w=>w!==word);this.clear();if(has&&others.length===1){this.activate(others[0],t,floor);this.started=floor/1000;this.resetDetectors(others[0]);this.rebase(others[0],floor);}else this.resetDetectors();if(this.pending.length)return this.emitted();}}
   if(!this.conflicted&&stable.size===1){const word=[...stable][0];if(!this.active)this.activate(word,t,ms(this.started??t));else if(this.active.word===word)this.active.lastStable=t;else{transition=true;if(this.handoff(word,t)){transition=false;if(this.pending.length)return this.emitted();}}}
   let candidate=candidates.size===1&&!this.conflicted?[...candidates][0]:null;if(candidate&&this.active&&candidate!==this.active.word){candidate=null;transition=true;}const selected=outputs.find(o=>candidate&&o.candidate===candidate);let state='collecting',reason='collecting';
   if(has){this.missing=null;if(this.conflicted){state='reset_required';reason='ambiguous_actions';}else if(transition)reason='action_transition';else if(selected){state=selected.eventState;reason=selected.reason;}else if(outputs.every(o=>o.eventState==='reset_required')){state='reset_required';reason='segment_too_long';}else if(candidates.size>1)reason='candidate_transition';else if(outputs.some(o=>o.eventState==='ending')){state='ending';reason='action_ending';}else reason=['still','thumb_motion_required'].includes(byWord['谢谢']?.reason)||byWord['帮助']?.reason==='help_motion_required'||byWord['需要']?.reason==='need_motion_required'?'motion_required':'no_supported_action';}
   else{if(this.missing===null)this.missing=t;state=outputs.some(o=>o.eventState==='ending')&&!this.conflicted?'ending':'waiting';reason='no_hands';if(t-this.missing>=c.missingResetSeconds){this.clear();this.resetDetectors();}}
   return {status:candidate?'candidate':!has?'waiting':this.conflicted?'uncertain':'observing',candidate,reason,eventState:state,event:null,samples:Math.max(byWord['谢谢']?.samples??0,this.detectors['帮助']?.samples.length??0),handSamples:Math.max(byWord['谢谢']?.handSamples??0,this.detectors['帮助']?.samples.filter(r=>r[1]).length??0)};
  }
 }
 scope.YuqiaoMulti=Multi;
})(globalThis);
