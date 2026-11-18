"""One unified model, shared event adapter for camera and recording.

The isolated experiment and frozen report remain unchanged. This adapter adds
service IDs, explicit finish and metadata; it never loads legacy detectors.
"""
import json,hashlib,os
from pathlib import Path
import numpy as np
from unified_runtime import UnifiedTCN,UnifiedStream,CONFIG
ROOT=Path(__file__).resolve().parents[1]
ACTIVE=ROOT/'data/unified-models/active.json'
ENGINE=json.loads(os.environ['YUQIAO_MODEL_DESCRIPTOR']) if os.environ.get('YUQIAO_MODEL_DESCRIPTOR') else json.loads((ACTIVE if ACTIVE.exists() else ROOT/'shared/recognition-engine.json').read_text(encoding='utf8'))
LIMITS=json.loads((ROOT/'shared/realtime-sign.json').read_text(encoding='utf8'))

def load_model():
    directory=ROOT/ENGINE['modelDirectory']
    if hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest()!=ENGINE['weightsSha256']:raise ValueError('active_unified_hash')
    meta=json.loads((directory/'model.json').read_text(encoding='utf8'))
    if meta['protocol']=='joint-body178-tcn-v2':
        from joint_model import JointTCN
        if meta['labels']!=ENGINE['labels']:raise ValueError('joint_label_mismatch')
        return JointTCN(directory)
    if CONFIG['labels']!=['unknown']+[e['category'] for e in ENGINE['labels']]:raise ValueError('active_unified_labels')
    return UnifiedTCN(directory)

class UnifiedLiveRecognizer:
    def __init__(self,model=None):
        self.model=load_model() if model is None else model
        self.stream=UnifiedStream(self.model);self.next_id=1;self.last_end=-1
        self.last_candidate=None;self.last_count=0;self.last_hands=0
    def _event(self,event):
        item=ENGINE['labels'][event['label']-1]
        start=max(round(event['start']*1000),self.last_end+1);end=round(event['end']*1000)
        if end<=start:return None
        result={'id':self.next_id,'text':item['text'],'signId':item['signId'],'startMs':start,'endMs':end}
        self.next_id+=1;self.last_end=end;return result
    def _result(self,candidate,event,state,reason,present):
        return {'candidate':candidate,'event':event,'eventState':state,'reason':reason,
                'status':'waiting' if event or not present else 'candidate' if candidate else 'uncertain' if reason=='ambiguous_actions' else 'observing',
                'samples':self.last_count,'handSamples':self.last_hands,
                'helpEngine':ENGINE['engine'],'recognitionEngine':ENGINE['engine'],'modelVersion':ENGINE['version'],
                'loadedModelCount':1,'helpScore':None,'motionSupported':None,'motionGuard':None,'meCheck':None}
    def push(self,t,payload):
        frame=np.asarray(payload['frame'] if payload is not None else np.zeros(178),np.float32)
        result=self.stream.push(t,frame);present=bool(frame[74] or frame[150])
        self.last_count=min(len(self.stream.frames),LIMITS['maxSamples'])
        self.last_hands=min(sum(bool(f[74] or f[150]) for _,f in self.stream.frames),self.last_count)
        candidate=ENGINE['labels'][result['candidate']-1]['text'] if result['candidate'] else None
        self.last_candidate=candidate
        event=self._event(result['event']) if result['event'] else None
        if event:return self._result(None,event,'emitted','action_finished',present)
        if result['conflict']:return self._result(None,None,'reset_required','ambiguous_actions',present)
        ready=bool(result['candidate'] and self.stream.qualified==result['candidate'])
        return self._result(candidate,None,'ready_to_finish' if ready else 'ending' if not present and self.stream.qualified else 'collecting' if present else 'waiting','target' if candidate else 'no_supported_action' if present else 'no_hands',present)
    def finish_for_paragraph(self,t):
        s=self.stream
        if s.conflict or not s.qualified or s.proposed!=s.qualified or s.last_support is None or t-s.last_support>.4:return None
        event=self._event({'label':s.qualified,'start':s.started,'end':t})
        if event is None:return None
        s.reset();self.last_candidate=None;self.last_count=0;self.last_hands=0
        return self._result(None,event,'emitted','action_finished',True)
