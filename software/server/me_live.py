"""Me candidate requires the trained model AND current body-pointing evidence."""
import json
from pathlib import Path
from collections import deque
import numpy as np
from me_tcn_inference import MeTCN
from me_motion import frame_evidence,RULES
from me_training_features import body_training_frame
from me_diagnostics import describe_me_evidence
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/me-live.json').read_text(encoding='utf8'))

def me_observation(hands,pose,delta,aspect):
    raw=[np.array([[p.x,p.y*aspect,p.z] for p in lm.landmark]) for lm in hands.multi_hand_landmarks or []]
    body=[[pose.pose_landmarks.landmark[i].x,pose.pose_landmarks.landmark[i].y*aspect,pose.pose_landmarks.landmark[i].visibility] for i in (11,12)] if pose.pose_landmarks else []
    return {'frame':body_training_frame(hands,pose,delta,aspect),'hands':raw,'shoulders':body}

class MeLiveRecognizer:
    def __init__(self,model=None):self.model=model if model is not None else MeTCN();self.last_time=None;self.next_id=1;self.reset()
    def reset(self):
        self.samples=deque(maxlen=CONFIG['maxSamples']);self.started=None;self.missing_since=None;self.last_support=None;self.support_since=None;self.count=0;self.qualified=False;self.blocked=False;self.candidate=None;self.score=None;self.last_prediction=-100.;self.evidence_start=None;self.evidence_count=0;self.last_evidence=None;self.last_wrist=None
        self.diagnostic_score=None;self.last_diagnostic=-100.;self.latest_check=None;self.latest_check_time=None
    def restart(self):self.reset();self.last_time=None
    def begin_segment(self,t):
        if self.started is not None:self.started=max(self.started,t);self.blocked=False
    def push_payload(self,t,payload):
        frame=np.asarray(payload['frame'] if payload is not None else np.zeros(178),np.float32)
        if frame.shape!=(178,) or not np.isfinite(frame).all() or not np.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time:raise ValueError('invalid_me_live_input')
        gap=self.last_time is not None and t-self.last_time>RULES['maxGapSeconds']
        if self.last_time is not None and t-self.last_time>CONFIG['resetGapSeconds']:self.reset()
        self.last_time=t;present=bool(frame[74]>0 or frame[150]>0)
        evidence=frame_evidence(payload['hands'],payload['shoulders']) if payload else {'supported':False,'reason':'missing_body_reference'}
        if evidence['supported']:
            wrist=np.array(evidence['wristRelative'])
            if gap or self.last_wrist is None or np.linalg.norm(wrist-self.last_wrist)>RULES['maxWristStepShoulderSpans']:self.evidence_start=t;self.evidence_count=0
            self.evidence_count+=1;self.last_wrist=wrist
            if self.evidence_count>=CONFIG['minEvidenceFrames'] and t-self.evidence_start>=RULES['minSupportSeconds']-1e-6:self.last_evidence=t
        else:self.evidence_start=None;self.evidence_count=0;self.last_wrist=None
        if gap or (present and evidence.get('reason') in ('missing_body_reference','invalid_body_scale','ambiguous_hands')):
            self.last_evidence=None
        supported=self.last_evidence is not None and t-self.last_evidence<=CONFIG['evidenceAgeSeconds']
        self.samples.append((t,frame.copy()))
        while self.samples and t-self.samples[0][0]>CONFIG['maxWindowSeconds']:self.samples.popleft()
        event=None;state='collecting';reason='me_evidence_required'
        if not present:
            self.candidate=None
            if self.missing_since is None:self.missing_since=t
            state='ending' if self.qualified else 'waiting';reason='no_hands'
            if t-self.missing_since>=CONFIG['missingEndSeconds']-1e-6:
                if self.qualified and not self.blocked and self.last_support is not None and self.missing_since-self.last_support<=CONFIG['maxSupportAgeSeconds']:
                    event={'id':self.next_id,'text':'我','signId':'csl.me','startMs':round(self.started*1000),'endMs':round(self.missing_since*1000)};self.next_id+=1
                self.reset();state='emitted' if event else 'waiting'
        else:
            if self.started is None:self.started=t
            if self.missing_since is not None:self.count=0;self.support_since=None
            self.missing_since=None
            if t-self.started>CONFIG['maxSegmentSeconds']:self.blocked=True
            if not supported or self.blocked:
                self.candidate=None;self.count=0;self.support_since=None
                if self.blocked:self.qualified=False
            elif len(self.samples)>=CONFIG['minSamples'] and t-self.samples[0][0]>=CONFIG['minSpanSeconds'] and t-self.last_prediction>=CONFIG['predictIntervalSeconds']-1e-6:
                self.last_prediction=t;self.score=self.model.probability([row[1] for row in self.samples]);self.candidate='我' if self.score>=CONFIG['threshold'] else None
                if self.candidate:
                    if self.support_since is None:self.support_since=t
                    self.count+=1;self.last_support=t;self.qualified=self.count>=CONFIG['minPredictions'] and t-self.support_since>=CONFIG['stableSeconds']-1e-6
                else:self.qualified=False;self.count=0;self.support_since=None
                reason='me_model' if self.candidate else 'me_below_threshold'
            if self.last_support is not None and t-self.last_support>CONFIG['maxSupportAgeSeconds']:self.candidate=None;self.qualified=False
            state='reset_required' if self.blocked else 'ready_to_finish' if self.qualified else 'collecting'
        # Observe the model separately when geometry blocks it; never feed this
        # diagnostic prediction into candidate/event decisions or speech.
        if present and not supported and not self.blocked and len(self.samples)>=CONFIG['minSamples'] and t-self.samples[0][0]>=CONFIG['minSpanSeconds'] and t-self.last_diagnostic>=.24:
            self.diagnostic_score=self.model.probability([row[1] for row in self.samples]);self.last_diagnostic=t
        diagnostic=self.score if t-self.last_prediction<=.3 else self.diagnostic_score if t-self.last_diagnostic<=.3 else None
        check=describe_me_evidence(payload,evidence,supported,diagnostic);self.latest_check=check;self.latest_check_time=t
        return {'candidate':self.candidate,'event':event,'eventState':state,'reason':reason,'meScore':self.score,'meEvidenceSupported':supported,'meCheck':check,'samples':len(self.samples),'handSamples':sum(bool(f[74]>0 or f[150]>0) for _,f in self.samples)}
