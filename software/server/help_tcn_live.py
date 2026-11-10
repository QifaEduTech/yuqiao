"""Help model plus a required recent bilateral-motion veto; weights unchanged."""
import json
from pathlib import Path
import numpy as np
from help_live_probe import HelpLiveProbe
from help_tcn_inference import HelpTCN
from realtime_window import CONFIG
from help_motion import inspect_help_motion
GUARD=json.loads((Path(__file__).resolve().parents[1]/'shared/help-runtime.json').read_text(encoding='utf8'))['motionGuard']

def feature_hands(frame,aspect_ratio):
    hands={}
    for side,label in enumerate(['Left','Right']):
        f=frame[side*76:(side+1)*76]
        if f[74]<=0 or f[65]<=1e-8:continue
        raw=f[:63].reshape(21,3).astype(float)*f[65]
        raw[:,:2]+=f[63:65];raw[:,1]*=aspect_ratio
        hands[label]=raw
    return hands

class HelpTCNLive(HelpLiveProbe):
    def __init__(self,model=None,motion_check=True):
        self.model=model if model is not None else HelpTCN();self.motion_check=motion_check;super().__init__()
    def reset(self):super().reset();self.score=None;self.motion_supported=None
    def detect(self,samples):
        present=[t for t,h in samples if h]
        if len(present)<CONFIG['minHandSamples'] or present[-1]-present[0]<CONFIG['minSpanSeconds']:
            self.score=None;self.motion_supported=None;return False
        frames=[];previous=None
        for t,h in samples:
            frame=h.get('features') if h else np.r_[np.zeros(152),min(t-previous if previous is not None else 1/30,1)*30]
            frames.append(frame);previous=t
        self.score=self.model.probability(frames)
        if self.motion_check:
            timeline=[(t,feature_hands(h['features'],float(h['aspect'][0])) if h else {}) for t,h in samples]
            evidence=inspect_help_motion(timeline);now=samples[-1][0]
            # Evidence must come from a continuous two-hand run. It may survive
            # briefly while one hand naturally leaves the camera before the
            # other; requiring both in the very last frame loses valid endings.
            self.motion_supported=any(r['supported'] and r['lastEvidenceTime'] is not None and now-r['lastEvidenceTime']<=GUARD['maxEvidenceAgeSeconds'] for r in evidence['runs'])
        else:self.motion_supported=None
        return self.score>=.5 and (not self.motion_check or self.motion_supported)
    def push_features(self,t,frame,thanks_candidate=False,aspect_ratio=9/16):
        frame=np.asarray(frame,dtype=np.float32)
        if frame.shape!=(153,) or not np.isfinite(frame).all():raise ValueError('invalid_help_features')
        if not np.isfinite(aspect_ratio) or not .1<=aspect_ratio<=10:raise ValueError('invalid_image_aspect')
        present=bool(frame[74]>0 or frame[150]>0)
        result=super().push(t,{'features':frame,'aspect':np.array([aspect_ratio])} if present else {},thanks_candidate)
        if not present or thanks_candidate:self.score=None;self.motion_supported=None
        if result['reason']=='help_geometry':result['reason']='help_model'
        elif result['reason']=='insufficient_help_geometry':result['reason']='help_model_collecting' if self.score is None else 'help_motion_required' if self.motion_supported is False else 'help_model_below_threshold'
        return {**result,'helpScore':self.score,'helpEngine':'video-tcn','modelVersion':'v1','motionSupported':self.motion_supported,'motionGuard':GUARD['id'] if self.motion_check else None}
