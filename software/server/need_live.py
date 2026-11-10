"""Isolated causal candidate/event validation; not registered in production yet."""
import json
from pathlib import Path
from collections import deque
import numpy as np
from need_tcn_inference import NeedTCN
from need_directional_features import directional_features
from need_required_motion import NeedRequiredMotion
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/need-live.json').read_text(encoding='utf8'))

class NeedLiveRecognizer:
    def __init__(self,model=None):self.model=NeedTCN() if model is None else model;self.last_time=None;self.next_id=1;self.reset()
    def reset(self):
        self.samples=deque(maxlen=CONFIG['maxSamples']);self.gate=NeedRequiredMotion();self.last_prediction=-100.;self.started=None;self.missing_since=None;self.support_since=None;self.last_support=None;self.count=0;self.qualified=False;self.blocked=False;self.candidate=None;self.score=None
    def begin_segment(self,t):
        if self.started is not None:self.started=max(self.started,t);self.blocked=False
    def restart(self):self.reset();self.last_time=None
    def push_features(self,t,frame,aspect_ratio=9/16):
        frame=np.asarray(frame,dtype=np.float32)
        if frame.shape!=(153,) or not np.isfinite(frame).all() or not np.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time:raise ValueError('invalid_need_live_input')
        if self.last_time is not None and t-self.last_time>CONFIG['resetGapSeconds']:self.reset()
        self.last_time=t;present=bool(frame[74]>0 or frame[150]>0);motion=self.gate.push(t,frame,aspect_ratio);self.samples.append((t,frame.copy()))
        while self.samples and t-self.samples[0][0]>CONFIG['maxWindowSeconds']:self.samples.popleft()
        event=None;state='collecting';reason='collecting'
        if not present:
            self.candidate=None
            if self.missing_since is None:self.missing_since=t
            state='ending' if self.qualified else 'waiting';reason='no_hands'
            if t-self.missing_since>=CONFIG['missingEndSeconds']:
                if self.qualified and not self.blocked and self.last_support is not None and self.missing_since-self.last_support<=CONFIG['maxSupportAgeSeconds']:
                    event={'id':self.next_id,'text':'需要','signId':'csl.ref.bmcx.1874','startMs':round(self.started*1000),'endMs':round(self.missing_since*1000)};self.next_id+=1
                self.reset();state='emitted' if event else 'waiting'
        else:
            if self.started is None:self.started=t
            if self.missing_since is not None:self.support_since=None;self.count=0
            self.missing_since=None
            if t-self.started>CONFIG['maxSegmentSeconds']:self.blocked=True
            ready=len(self.samples)>=CONFIG['minSamples'] and t-self.samples[0][0]>=CONFIG['minSpanSeconds']
            if not motion['supported'] or self.blocked:
                self.candidate=None;self.qualified=False;self.support_since=None;self.count=0;reason='need_motion_required'
            elif ready and t-self.last_prediction>=CONFIG['predictIntervalSeconds']:
                self.last_prediction=t;rows=list(self.samples);values=directional_features([x[1] for x in rows],[x[0] for x in rows],aspect_ratio);self.score=self.model.probability(values)
                self.candidate='需要' if self.score>=CONFIG['threshold'] else None
                if self.candidate:
                    if self.support_since is None:self.support_since=t
                    self.count+=1;self.last_support=t
                    self.qualified=self.count>=CONFIG['minPredictions'] and t-self.support_since>=CONFIG['stableSeconds']
                else:self.qualified=False;self.support_since=None;self.count=0
                reason='need_model' if self.candidate else 'need_below_threshold'
            if self.last_support is not None and t-self.last_support>CONFIG['maxSupportAgeSeconds']:self.qualified=False;self.candidate=None
            state='reset_required' if self.blocked else 'ready_to_finish' if self.qualified else 'collecting'
        return {'candidate':self.candidate,'event':event,'eventState':state,'reason':reason,'needScore':self.score,'needMotionSupported':motion['supported'],'status':'candidate' if self.candidate else 'observing' if present else 'waiting','samples':len(self.samples),'handSamples':sum(bool(f[74]>0 or f[150]>0) for _,f in self.samples)}
