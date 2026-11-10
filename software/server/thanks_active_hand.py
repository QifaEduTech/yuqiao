"""Keep the original detector; add isolated-hand evidence only with a passive peer."""
import json
from pathlib import Path
from collections import deque
import numpy as np
from realtime_events import LiveRecognizer
from realtime_window import CONFIG,recent_thumb_motion
RULES=json.loads((Path(__file__).resolve().parents[1]/'shared/thanks-active-hand.json').read_text(encoding='utf8'))

class ActiveHandThanks:
    def __init__(self,classify):
        self.classify=classify;self.next_id=1;self.reset()
    def reset(self):
        self.context=deque(maxlen=CONFIG['maxSamples'])
        self.full=LiveRecognizer(self.classify)
        self.sides=[LiveRecognizer(self.classify,motion_gate=lambda rows,t,side=side:self.passive_peer(side,t) and recent_thumb_motion(rows,t)) for side in [0,1]]
    def begin_segment(self,t):
        for detector in [self.full,*self.sides]:
            if detector.started is not None:detector.started=max(detector.started,t);detector.blocked=False
    def restart(self):self.reset()
    def passive_peer(self,active,t):
        peer=1-active
        if not self.context:return False
        current=self.context[-1][1]
        if current[peer*76+74]<=0:return True
        rows=[(time,vec[peer*76:(peer+1)*76],aspect) for time,vec,aspect in self.context if t-time<=RULES['passiveWindowSeconds'] and vec[peer*76+74]>0]
        if len(rows)<RULES['minSamples'] or rows[-1][0]-rows[0][0]<RULES['minSpanSeconds']:return False
        if any(b[0]-a[0]>.2 for a,b in zip(rows,rows[1:])):return False
        wrists=[];palms=[];shapes=[]
        for _,f,aspect in rows:
            local=f[:63].reshape(21,3).copy();local[:,1]*=aspect
            wrist=f[63:65].copy();wrist[1]*=aspect;wrists.append(wrist)
            palms.append(float(np.linalg.norm(local[9])*f[65]));shapes.append(local)
        scale=max(float(np.median(palms)),1e-8)
        wrist_span=float(np.linalg.norm(np.diff(np.percentile(wrists,[10,90],axis=0),axis=0)[0])/scale)
        shape_span=float(np.max(np.diff(np.percentile(shapes,[10,90],axis=0),axis=0)))
        scale_span=float(np.diff(np.percentile(palms,[10,90]))[0]/scale)
        return wrist_span<=RULES['maxWristRangePalmLengths'] and shape_span<=RULES['maxLocalShapeRange'] and scale_span<=RULES['maxPalmScaleRelativeRange']
    def push(self,t,value,vector,aspect_ratio=9/16):
        self.context.append((t,np.asarray(vector,dtype=float).copy(),aspect_ratio))
        while self.context and t-self.context[0][0]>RULES['passiveWindowSeconds']+.2:self.context.popleft()
        outputs=[self.full.push(t,value)]
        for side,detector in enumerate(self.sides):
            masked=None
            if value is not None and np.any(value[side*63:(side+1)*63]):
                masked=np.zeros(126,dtype=np.float32);masked[side*63:(side+1)*63]=value[side*63:(side+1)*63]
            result=detector.push(t,masked);outputs.append(result)
        completed=[r['event'] for i,r in enumerate(outputs) if r['event'] and (i==0 or self.passive_peer(i-1,t))]
        if completed:
            event={**completed[0],'id':self.next_id,'startMs':min(x['startMs'] for x in completed),'endMs':max(x['endMs'] for x in completed)};self.next_id+=1
            self.reset()
            return {'status':'waiting','candidate':None,'event':event,'eventState':'emitted','reason':'action_hand_left','samples':0,'handSamples':0}
        available=[r for r in outputs if r['candidate'] and r['eventState']!='reset_required']
        if available:return next((r for r in available if r['eventState']=='ready_to_finish'),available[0])
        ending=next((r for r in outputs if r['eventState']=='ending'),None)
        if ending:return ending
        return outputs[0]
