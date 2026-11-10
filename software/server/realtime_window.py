"""Bounded causal feature window. Experimental candidates, not word-boundary events."""
import json
from collections import deque
from pathlib import Path
import numpy as np
from sign_worker import hand_interval, decision
from thumb_local_motion import local_thumb_evidence,geometry

def recent_thumb_motion(timeline,t):
    evidence=local_thumb_evidence(timeline)
    # Inspect all accepted events, not only an event count or the classifier's
    # handshape score. Missing/changed hands cannot inherit an earlier bend.
    for event in evidence['latestAcceptedBySide']:
        if not event['accepted'] or t-event['endTime']>CONFIG['thumbEvidenceMaxAgeSeconds']:continue
        side=0 if event['side']=='Left' else 1
        tail=[(time,value) for time,value in timeline if time>=event['endTime']-.001]
        if tail and all(geometry(v,side) is not None for _,v in tail) and all(b[0]-a[0]<=.2 for a,b in zip(tail,tail[1:])):return True
    return False

CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/realtime-sign.json').read_text(encoding='utf8'))

class LiveWindow:
    def __init__(self, classify, motion_gate=recent_thumb_motion):
        self.classify=classify
        self.motion_gate=motion_gate
        self.samples=deque(maxlen=CONFIG['maxSamples'])
        self.last_time=None
        self.missing_since=None
        self.last_prediction=-100.0
        self.latest=None
        self.last_status='observing'
        self.last_reason='collecting'

    def reset(self):
        self.samples.clear()
        self.latest=None
        self.last_prediction=-100.0
        self.missing_since=None
        self.last_status='observing'
        self.last_reason='collecting'

    def push(self,t,value):
        if self.last_time is not None and t<=self.last_time:
            raise ValueError('Non-monotonic frame time')
        if self.last_time is not None and t-self.last_time>CONFIG['resetGapSeconds']:
            self.reset()
        self.last_time=t
        if value is not None and (np.asarray(value).shape!=(126,) or not np.isfinite(value).all()):
            raise ValueError('Invalid features')
        self.samples.append((t,None if value is None else np.asarray(value,dtype=np.float32).copy()))
        while self.samples and t-self.samples[0][0]>CONFIG['maxWindowSeconds']:
            self.samples.popleft()
        if value is None:
            self.latest=None
            self.last_prediction=-100.0
            if self.missing_since is None:self.missing_since=t
            if t-self.missing_since>=CONFIG['missingResetSeconds']:self.reset()
            return self.report('waiting','no_hands')
        self.missing_since=None
        valid=[(time,v) for time,v in self.samples if v is not None]
        span=valid[-1][0]-valid[0][0]
        if len(valid)<CONFIG['minHandSamples'] or span<CONFIG['minSpanSeconds']:
            self.latest=None
            return self.report('observing','collecting')
        interval=hand_interval([(time,v is not None) for time,v in self.samples],t)
        if interval['active_hand_coverage']<.6 or interval['internal_missing_seconds']>.6:
            self.latest=None
            return self.report('uncertain','visibility')
        if t-self.last_prediction<CONFIG['predictIntervalSeconds']:
            return self.report(self.last_status,self.last_reason)
        self.last_prediction=t
        if not self.motion_gate(list(self.samples),t):
            self.latest=None
            return self.report('observing','thumb_motion_required')
        values=np.asarray([v for _,v in valid])
        # Local thumb evidence replaces whole-hand mean motion: an otherwise
        # still hand with an articulating thumb is precisely the target case.
        indices=np.linspace(0,len(values)-1,30).astype(int)
        result=decision(self.classify(values[indices]),interval['active_hand_coverage'],interval['internal_missing_seconds'])
        self.latest=CONFIG['targetText'] if result['status']=='candidate' and result.get('sign_id')==CONFIG['targetSignId'] else None
        return self.report('candidate' if self.latest else 'uncertain','target' if self.latest else 'not_target')

    def report(self,status,reason):
        self.last_status=status
        self.last_reason=reason
        return {'status':status,'candidate':self.latest,'reason':reason,'samples':len(self.samples),'handSamples':sum(v is not None for _,v in self.samples)}
