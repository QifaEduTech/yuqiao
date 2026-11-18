"""Synthetic feature benchmark, real existing HelpTCN weights; no user media.

Reference preserves the previous inference-before-motion implementation.
Timings exclude image tracking/HTTP, and are not recognition accuracy.
"""
import sys,json,time,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from help_tcn_live import HelpTCNLive,feature_hands,GUARD
from help_tcn_inference import HelpTCN
from help_motion import inspect_help_motion
from realtime_window import CONFIG
spec=importlib.util.spec_from_file_location('help_fixtures',ROOT/'scripts/check-help-tcn-runtime.py')
fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class ReferenceHelp(HelpTCNLive):
    def detect(self,samples):
        present=[t for t,h in samples if h]
        if len(present)<CONFIG['minHandSamples'] or present[-1]-present[0]<CONFIG['minSpanSeconds']:
            self.score=None;self.motion_supported=None;return False
        frames=[];previous=None
        for t,h in samples:
            frames.append(h.get('features') if h else np.r_[np.zeros(152),min(t-previous if previous is not None else 1/30,1)*30]);previous=t
        self.score=self.model.probability(frames)
        timeline=[(t,feature_hands(h['features'],float(h['aspect'][0])) if h else {}) for t,h in samples]
        evidence=inspect_help_motion(timeline);now=samples[-1][0]
        self.motion_supported=any(r['supported'] and r['lastEvidenceTime'] is not None and now-r['lastEvidenceTime']<=GUARD['maxEvidenceAgeSeconds'] for r in evidence['runs'])
        return self.score>=.5 and self.motion_supported

class Counted:
    def __init__(self,model):self.model=model;self.calls=0
    def probability(self,frames):self.calls+=1;return self.model.probability(frames)

def run(cls,frames,model):
    counted=Counted(model);live=cls(counted);outputs=[];elapsed=[]
    for t,f in frames:
        start=time.perf_counter();r=live.push_features(t,f,aspect_ratio=1);elapsed.append((time.perf_counter()-start)*1000)
        outputs.append({k:r[k] for k in ['candidate','event','eventState','reason','motionSupported']})
    return outputs,{'modelCalls':counted.calls,'totalMs':sum(elapsed),'meanFrameMs':float(np.mean(elapsed)),'p95FrameMs':float(np.percentile(elapsed,95))}

if __name__=='__main__':
    model=HelpTCN();model.probability(np.zeros((30,153),np.float32));reports=[]
    for mode in ['static','single','lateral','opposed','help','swap']:
        frames=[(t,fixtures.vector(h)) for t,h in fixtures.shapes.timeline(mode)]+[(3+i/10,np.zeros(153)) for i in range(10)]
        before=[];after=[]
        for n in range(3):
            order=[ReferenceHelp,HelpTCNLive] if n%2==0 else [HelpTCNLive,ReferenceHelp]
            results={cls:run(cls,frames,model) for cls in order}
            assert results[ReferenceHelp][0]==results[HelpTCNLive][0],mode
            before.append(results[ReferenceHelp][1]);after.append(results[HelpTCNLive][1])
        aggregate=lambda values:{k:round(float(np.median([x[k] for x in values])),4) for k in values[0]}
        reports.append({'case':mode,'frames':len(frames),'decisionsIdentical':True,'before':aggregate(before),'after':aggregate(after)})
    print(json.dumps({'scope':'synthetic_features_real_existing_help_weights_not_accuracy','timingExcludes':'Hands/Pose, camera encoding, HTTP and all other detectors','runsPerCase':3,'reports':reports},ensure_ascii=False))
