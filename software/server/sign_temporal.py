"""Development temporal contract; no production classifier or label changes.

Whole action -> 30 positions sampled by elapsed time. Missing observations stay
zero with masks. Length overflow is rejected, never silently made into a suffix.
"""
import json
from pathlib import Path
import numpy as np
from sign_worker import FEATURES, hand_interval

PROTOCOL=json.loads((Path(__file__).resolve().parents[1]/'shared/sign-temporal.json').read_text(encoding='utf8'))
if PROTOCOL['featureId'] != FEATURES['id']:
    raise ValueError('Feature version mismatch')


def pack_sequence(timeline):
    if len(timeline)>PROTOCOL['maxBufferedSamples']:
        raise ValueError('sample_capacity_exceeded')
    previous=None
    for t,value in timeline:
        if not np.isfinite(t) or t<0 or previous is not None and t<=previous:
            raise ValueError('invalid_timestamp_order')
        if previous is not None and t-previous>PROTOCOL['maxCaptureGapSeconds']:
            raise ValueError('capture_gap')
        if value is not None and (np.asarray(value).shape!=(126,) or not np.isfinite(value).all()):
            raise ValueError('invalid_features')
        previous=t
    found=[i for i,(_,v) in enumerate(timeline) if v is not None]
    active=timeline[found[0]:found[-1]+1] if found else timeline
    start=active[0][0] if active else 0
    end=active[-1][0] if active else start
    if end-start>PROTOCOL['maxActionSeconds']+1e-6:
        raise ValueError('action_duration_exceeded')
    target=np.linspace(start,end,PROTOCOL['sequenceLength'])
    tensor=np.zeros((PROTOCOL['sequenceLength'],PROTOCOL['dimensions']),np.float32)
    observed=np.zeros(PROTOCOL['sequenceLength'],bool)
    hand_mask=np.zeros((PROTOCOL['sequenceLength'],2),bool)
    selected=[]
    if active:
        times=np.asarray([t for t,_ in active])
        for i,t in enumerate(target):
            index=int(np.argmin(np.abs(times-t)))
            value=active[index][1]
            selected.append(float(times[index]))
            if value is not None and abs(times[index]-t)<=PROTOCOL['maxNearestSeconds']:
                tensor[i]=value;observed[i]=True
                hand_mask[i]=[np.any(tensor[i,:63]),np.any(tensor[i,63:])]
    observations=[(t,v is not None) for t,v in active]
    interval=hand_interval(observations,end)
    values=np.asarray([v for _,v in active if v is not None],np.float32)
    movement=float(np.mean(np.abs(np.diff(values,axis=0)))) if len(values)>1 else 0
    reasons=[]
    if len(found)<PROTOCOL['minHandSamples']:reasons.append('insufficient_hand_samples')
    if not found or end-start<PROTOCOL['minHandSpanSeconds']:reasons.append('insufficient_hand_span')
    if interval['active_hand_coverage']<PROTOCOL['minHandCoverage']:reasons.append('visibility')
    if float(observed.mean())<PROTOCOL['minHandCoverage']:reasons.append('sampled_visibility')
    if interval['internal_missing_seconds']>PROTOCOL['maxInternalMissingSeconds']:reasons.append('tracking_gap')
    if movement<PROTOCOL['minFeatureMotion']:reasons.append('still')
    return {'tensor':tensor,'observed':observed,'handMask':hand_mask,'targetTimes':target,
            'selectedTimes':selected,'protocolId':PROTOCOL['id'],'start':start,'end':end,
            'handSamples':len(found),'coverage':interval['active_hand_coverage'],'sampledCoverage':float(observed.mean()),
            'internalMissingSeconds':interval['internal_missing_seconds'],
            'meanFeatureMotion':movement,'eligible':not reasons,'reasons':reasons}


class WholeActionBuffer:
    """Same packer for live producers; caller supplies a verified end boundary.

    The buffer doesn't count thumb bends or infer how many words were signed.
    On overflow it latches an error until reset, so a tail cannot masquerade as
    the whole action. This adapter is not wired into the production worker yet.
    """
    def __init__(self):self.reset()
    def reset(self):
        self.samples=[];self.error=None;self.last_time=None
    def push(self,t,value):
        if self.error:return
        if not np.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time:
            self.error='invalid_timestamp_order';return
        if self.last_time is not None and t-self.last_time>PROTOCOL['maxCaptureGapSeconds']:
            self.error='capture_gap';return
        self.last_time=t
        if not self.samples and value is None:return
        if value is not None and (np.asarray(value).shape!=(126,) or not np.isfinite(value).all()):
            self.error='invalid_features';return
        if len(self.samples)>=PROTOCOL['maxBufferedSamples']:
            self.error='sample_capacity_exceeded';return
        if value is not None and self.samples and t-self.samples[0][0]>PROTOCOL['maxActionSeconds']+1e-6:
            self.error='action_duration_exceeded';return
        self.samples.append((float(t),None if value is None else np.asarray(value,np.float32).copy()))
    def finish(self):
        if self.error:raise ValueError(self.error)
        return pack_sequence(self.samples)
