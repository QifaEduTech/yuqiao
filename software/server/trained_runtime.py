"""Account-scoped generic 178-channel trials; existing models are never overwritten."""
import json,hashlib
from pathlib import Path
from collections import deque
import numpy as np
from me_tcn_inference import MeTCN

class TrainedDetector:
    def __init__(self,entry):
        self.entry=entry;self.meta=json.loads(Path(entry['path']).read_text(encoding='utf-8'))
        path=Path(entry['path']).parent/'weights.npz';content=path.read_bytes()
        if hashlib.sha256(content).hexdigest()!=entry['sha256'] or self.meta['sha256']!=entry['sha256'] or self.meta['protocol']!='self-service-body178-v1':raise ValueError('custom_model_hash')
        with np.load(path,allow_pickle=False) as saved:self.model=MeTCN(arrays={k:saved[k] for k in saved.files})
        self.reset()
    def reset(self):self.rows=deque(maxlen=140);self.since=None;self.support=0;self.last_predict=-100;self.last_score=None;self.candidate=None;self.last_seen=None;self.started=None
    def push(self,t,payload):
        f=np.asarray(payload['frame'] if payload else np.zeros(178),np.float32);present=bool(f[74] or f[150])
        if self.last_seen is not None and t-self.last_seen>.35:self.reset()
        self.last_seen=t
        if not present:self.candidate=None;return None
        if self.started is None:self.started=t
        self.rows.append((t,f.copy(),[np.asarray(h) for h in (payload or {}).get('hands',[])]))
        while self.rows and t-self.rows[0][0]>4:self.rows.popleft()
        if len(self.rows)<12 or t-self.rows[0][0]<.4 or t-self.last_predict<.20:return self.candidate
        self.last_predict=t;hands=len((payload or {}).get('hands',[]));channels=int(f[74]>0)+int(f[150]>0);supported=hands>=self.meta['hands'] and channels>=self.meta['hands']
        if self.meta['motion']=='dynamic':
            comparable=[np.stack(r[2]) for r in self.rows if len(r[2])==hands and hands>0]
            motion=max((float(np.linalg.norm(x-comparable[0],axis=-1).mean()) for x in comparable),default=0)
            supported=supported and motion>=.018
        self.last_score=self.model.probability([r[1] for r in self.rows]) if supported else 0
        if self.last_score>=self.meta['threshold']:
            if self.since is None:self.since=t
            self.support+=1
            self.candidate=self.entry['text'] if self.support>=3 and t-self.since>=.4 else None
        else:self.since=None;self.support=0;self.candidate=None
        return self.candidate

class TrainedRuntime:
    def __init__(self,entries):self.detectors=[TrainedDetector(x) for x in entries];self.words=set();self.conflict=False;self.missing=None;self.started=None;self.pending=None;self.pending_at=None;self.event_id=0;self.floor=-1
    def merge(self,t,payload,base):
        result=dict(base);present=bool(payload is not None and (payload['frame'][74] or payload['frame'][150]));candidates=[d.push(t,payload) for d in self.detectors];candidates=[x for x in candidates if x]
        if not self.detectors:return result
        if present:
            if self.started is None:self.started=t
            self.missing=None
        elif self.missing is None:self.missing=t
        if base.get('candidate'):self.words.add(base['candidate'])
        self.words.update(candidates)
        if base.get('event'):self.words.add(base['event']['text'])
        if len(self.words)>1:self.conflict=True
        if self.conflict:result.update(status='uncertain' if present else 'waiting',candidate=None,event=None,eventState='reset_required' if present else 'waiting',reason='ambiguous_actions')
        elif candidates:
            word=candidates[0];self.pending=word;self.pending_at=t;result.update(status='candidate',candidate=word,event=None,eventState='ready_to_finish',reason='trained_model_candidate')
        if not present and self.missing is not None and t-self.missing>=.6:
            if self.pending and not self.conflict and self.pending_at is not None and self.missing-self.pending_at<=1.2 and self.started is not None and self.missing-self.started<=12:
                entry=next(d.entry for d in self.detectors if d.entry['text']==self.pending)
                result.update(status='waiting',candidate=None,eventState='emitted',reason='action_finished',event={'text':self.pending,'signId':entry['signId'],'startMs':max(self.floor+1,round((self.started or 0)*1000)),'endMs':round(self.missing*1000)})
            self.words.clear();self.conflict=False;self.started=None;self.pending=None;self.pending_at=None
            for d in self.detectors:d.reset()
        if result.get('event'):
            event=result['event'];event['startMs']=max(event['startMs'],self.floor+1)
            if event['endMs']<=event['startMs']:result.update(event=None,eventState='waiting')
            else:self.event_id+=1;event['id']=self.event_id;self.floor=event['endMs']
        return result
