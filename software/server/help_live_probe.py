"""Causal event probe for the opt-in help trial and offline replay.

The help geometry is experimental; positive probe events are not a trained
semantic recognizer. A simultaneous thanks candidate vetoes help evidence.
"""
from collections import deque
import numpy as np
from help_motion import inspect_help_motion
from realtime_window import CONFIG

class HelpLiveProbe:
    def __init__(self):
        self.samples=deque(maxlen=CONFIG['maxSamples']);self.last_time=None;self.next_id=1;self.reset()
    def reset(self):
        self.samples.clear();self.last_prediction=-100.;self.latest=False;self.started=None;self.missing_since=None;self.support_since=None;self.support_count=0;self.last_support=None;self.qualified=False;self.blocked=False;self.reason='collecting'
    def begin_segment(self,t):
        if self.started is not None:self.started=max(self.started,t);self.blocked=False
    def restart(self):self.reset();self.last_time=None
    def detect(self,samples):return inspect_help_motion(samples)['supported']
    def push(self,t,hands,thanks_candidate=False):
        if not np.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time:raise ValueError('invalid_timestamp_order')
        if self.last_time is not None and t-self.last_time>CONFIG['resetGapSeconds']:self.reset()
        self.last_time=t;self.samples.append((t,{k:np.asarray(v).copy() for k,v in hands.items()}))
        while self.samples and t-self.samples[0][0]>CONFIG['maxWindowSeconds']:self.samples.popleft()
        event=None;state='collecting';rules=CONFIG['events']
        if not hands:
            self.latest=False
            if self.missing_since is None:self.missing_since=t
            state='ending' if self.qualified else 'waiting'
            if t-self.missing_since>=CONFIG['missingResetSeconds']:
                if self.qualified and not self.blocked and self.last_support is not None and self.missing_since-self.last_support<=rules['maxSupportAgeSeconds']:
                    event={'id':self.next_id,'text':'帮助','signId':'csl.ref.bmcx.1900','startMs':round(self.started*1000),'endMs':round(self.missing_since*1000)};self.next_id+=1
                self.reset();state='emitted' if event else 'waiting'
            return {'candidate':None,'event':event,'eventState':state,'reason':'no_hands'}
        if self.started is None:self.started=t
        if self.missing_since is not None:self.support_since=None;self.support_count=0
        self.missing_since=None
        if t-self.started>rules['maxSegmentSeconds']:self.blocked=True;self.qualified=False;self.latest=False
        # Conflict revokes even between prediction ticks; it is not a tie-break
        # that silently chooses whichever word was evaluated first.
        if thanks_candidate:
            self.latest=False;self.qualified=False;self.support_since=None;self.support_count=0;self.reason='conflicting_thanks_candidate'
        elif not self.blocked and t-self.last_prediction>=CONFIG['predictIntervalSeconds']:
            self.last_prediction=t
            self.latest=self.detect(list(self.samples));self.reason='help_geometry' if self.latest else 'insufficient_help_geometry'
            if self.latest:
                if self.support_since is None:self.support_since=t
                self.support_count+=1;self.last_support=t
                if self.support_count>=rules['minPredictions'] and t-self.support_since>=rules['stableSeconds']:self.qualified=True
            else:self.qualified=False;self.support_since=None;self.support_count=0
        if self.last_support is not None and t-self.last_support>rules['maxSupportAgeSeconds']:self.qualified=False
        state='reset_required' if self.blocked else 'ready_to_finish' if self.qualified else 'collecting'
        return {'candidate':'帮助' if self.latest and not self.blocked else None,'event':None,'eventState':state,'reason':self.reason}
