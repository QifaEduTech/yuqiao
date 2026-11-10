"""Distinguish sequential stable handoffs from simultaneous competing evidence."""
import json
from copy import deepcopy
from pathlib import Path
from collections import deque
import numpy as np
from realtime_window import CONFIG
from help_tcn_live import HelpTCNLive
from thanks_active_hand import ActiveHandThanks
RULES=json.loads((Path(__file__).resolve().parents[1]/'shared/realtime-transitions.json').read_text(encoding='utf8'))
IDS={'谢谢':'csl.thanks','帮助':'csl.ref.bmcx.1900','需要':'csl.ref.bmcx.1874','我':'csl.me'}

class MultiLiveRecognizer:
    def __init__(self,classify,help_model=None,thanks_detector=None,help_detector=None,need_detector=None,me_detector=None):
        self.thanks=thanks_detector if thanks_detector is not None else ActiveHandThanks(classify)
        self.help=help_detector if help_detector is not None else HelpTCNLive(help_model)
        self.need=need_detector;self.me=me_detector;self.last_time=None;self.next_id=1;self.floor_ms=0;self.pending_events=[];self.buffer=deque(maxlen=CONFIG['maxSamples']);self.clear_segment()
    def clear_segment(self):
        self.words=set();self.active=None;self.conflicted=False;self.missing_since=None;self.overlap_since=None;self.started=None;self.buffer.clear()
    def detectors(self):return {'谢谢':self.thanks,'帮助':self.help,**({'需要':self.need} if self.need is not None else {}),**({'我':self.me} if self.me is not None else {})}
    def reset_detectors(self,keep=None):
        for word,detector in self.detectors().items():
            if word!=keep and hasattr(detector,'reset'):detector.reset()
    def activate(self,word,t,start_ms):
        self.active={'word':word,'startMs':max(start_ms,self.floor_ms),'lastStable':t,'retired':None,'seeded':False,'handCount':getattr(self,'current_hand_count',0),'countChange':None};self.words={word};self.overlap_since=None
    def reseed_incoming(self,start=None):
        recent=[row for row in self.buffer if row[0]>=(self.active['retired']-RULES['preRollSeconds'] if start is None else start)]
        results={}
        for word,detector in self.detectors().items():
            if word==self.active['word'] or not hasattr(detector,'restart'):continue
            detector.restart()
            for t,value,vector,aspect,me_input in recent:
                results[word]=detector.push_payload(t,me_input) if word=='我' else detector.push(t,value,vector,aspect_ratio=aspect) if word=='谢谢' else detector.push_features(t,vector,False,aspect_ratio=aspect) if word=='帮助' else detector.push_features(t,vector,aspect_ratio=aspect)
        self.active['seeded']=True
        return results
    def rebase(self,word,start_ms):
        detector=self.detectors()[word]
        if hasattr(detector,'begin_segment'):detector.begin_segment(start_ms/1000)
    def queue_event(self,event):
        floor=self.pending_events[-1]['endMs']+1 if self.pending_events else self.floor_ms
        value={**event,'startMs':max(event['startMs'],floor)}
        if value['endMs']>value['startMs']:self.pending_events.append(value);return True
        return False
    def emitted(self,help_result=None):
        event={**self.pending_events.pop(0),'id':self.next_id};self.next_id+=1;self.floor_ms=event['endMs']+1;b=help_result or {}
        return {'status':'waiting','candidate':None,'reason':'action_finished','eventState':'emitted','event':event,'samples':0,'handSamples':0,'helpEngine':'video-tcn','modelVersion':'v1','helpScore':b.get('helpScore'),'motionSupported':b.get('motionSupported'),'motionGuard':b.get('motionGuard')}
    def handoff(self,word,t):
        old=self.active
        if old is None or old['retired'] is None or t-old['retired']<RULES['quietSeconds']-1e-6:return False
        boundary=round(old['retired']*1000)
        recent=old['retired']-old['lastStable']<=CONFIG['events']['maxSupportAgeSeconds'] and t-old['retired']<=RULES['maxPendingSeconds']
        if recent:self.queue_event({'text':old['word'],'signId':IDS[old['word']],'startMs':old['startMs'],'endMs':boundary})
        self.activate(word,t,boundary+1);self.started=(boundary+1)/1000;self.reset_detectors(keep=word);self.rebase(word,boundary+1);return True
    def push(self,t,value,vector,aspect_ratio=9/16,me_input=None):
        if not np.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time:raise ValueError('invalid_timestamp_order')
        if self.last_time is not None and t-self.last_time>CONFIG['resetGapSeconds']:
            self.clear_segment();self.pending_events=[];self.reset_detectors()
        self.last_time=t
        # Two confirmed completions can share a frame; emit the second next frame.
        if self.pending_events:return self.emitted()
        self.buffer.append((t,None if value is None else np.asarray(value).copy(),np.asarray(vector).copy(),aspect_ratio,deepcopy(me_input)))
        a=self.thanks.push(t,value,vector,aspect_ratio=aspect_ratio);b=self.help.push_features(t,vector,False,aspect_ratio=aspect_ratio)
        c=self.need.push_features(t,vector,aspect_ratio=aspect_ratio) if self.need is not None else None
        d=self.me.push_payload(t,me_input) if self.me is not None else None
        outputs=[a,b]+([c] if c is not None else [])+([d] if d is not None else []);present=value is not None or bool(vector[74]>0 or vector[150]>0)
        self.current_hand_count=int(vector[74]>0)+int(vector[150]>0)
        if present and self.started is None:self.started=t
        candidates={r['candidate'] for r in outputs if r['candidate']}
        stable={r['candidate'] for r in outputs if r['candidate'] and r['eventState']=='ready_to_finish'}
        completed=[r['event'] for r in outputs if r['event']]
        # Me's return-to-rest can resemble inward palm motion. Until a clear
        # no-hands boundary, do not reseed another word from its withdrawal.
        me_boundary=self.active is not None and self.active['word']=='我'
        if me_boundary and d is not None:
            outputs=[d];candidates={d['candidate']} if d['candidate'] else set();stable={d['candidate']} if d['candidate'] and d['eventState']=='ready_to_finish' else set();completed=[d['event']] if d['event'] else []
        if self.active and not me_boundary:
            updated={}
            if self.current_hand_count and self.current_hand_count!=self.active['handCount']:
                change=self.active['countChange']
                if change is None or change['count']!=self.current_hand_count:self.active['countChange']={'count':self.current_hand_count,'since':t,'seeded':False}
                change=self.active['countChange']
                if not change['seeded'] and t-change['since']>=RULES['handConfigurationSeconds']-1e-6:
                    updated=self.reseed_incoming(change['since']);change['seeded']=True
            else:self.active['countChange']=None
            if self.active['word'] in candidates:
                if self.active['retired'] is not None and self.current_hand_count==self.active['handCount']:self.active['seeded']=False
                self.active['retired']=None
            elif self.active['retired'] is None:self.active['retired']=t
            if present and not self.conflicted and self.active['retired'] is not None and not self.active['seeded'] and t-self.active['retired']>=RULES['quietSeconds']-1e-6:
                updated=self.reseed_incoming()
            if updated:
                a=updated.get('谢谢',a);b=updated.get('帮助',b);c=updated.get('需要',c);d=updated.get('我',d)
                outputs=[a,b]+([c] if c is not None else [])+([d] if d is not None else []);candidates={r['candidate'] for r in outputs if r['candidate']};stable={r['candidate'] for r in outputs if r['candidate'] and r['eventState']=='ready_to_finish'};completed=[r['event'] for r in outputs if r['event']]
        transition=False
        if len(stable)>1:
            if self.active and self.active['word'] in stable:
                if self.overlap_since is None:self.overlap_since=t
                transition=t-self.overlap_since<RULES['overlapGraceSeconds']
                if not transition:self.conflicted=True
            else:self.conflicted=True
        else:self.overlap_since=None
        if len(completed)>1:self.conflicted=True
        if not self.conflicted and len(completed)==1:
            event=completed[0];word=event['text']
            if self.active and self.active['word']!=word:
                if not self.handoff(word,t):self.conflicted=True
            if not self.conflicted:
                if self.active:event={**event,'startMs':max(event['startMs'],self.active['startMs'])}
                self.queue_event(event)
                floor=self.pending_events[-1]['endMs']+1 if self.pending_events else self.floor_ms
                others=stable-{word};self.clear_segment()
                if present and len(others)==1:
                    other=next(iter(others));self.activate(other,t,floor);self.started=floor/1000;self.reset_detectors(keep=other);self.rebase(other,floor)
                else:self.reset_detectors()
                if self.pending_events:return self.emitted(b)
        if not self.conflicted and len(stable)==1:
            word=next(iter(stable))
            if self.active is None:self.activate(word,t,round((self.started if self.started is not None else t)*1000))
            elif self.active['word']==word:self.active['lastStable']=t
            else:
                transition=True
                if self.handoff(word,t):
                    transition=False
                    if self.pending_events:return self.emitted(b)
        candidate=next(iter(candidates)) if len(candidates)==1 and not self.conflicted else None
        if candidate and self.active and candidate!=self.active['word']:candidate=None;transition=True
        selected=next((r for r in outputs if candidate and r['candidate']==candidate),None)
        state='collecting';reason='collecting'
        if present:
            self.missing_since=None
            if self.conflicted:state='reset_required';reason='ambiguous_actions'
            elif transition:reason='action_transition'
            elif selected:state=selected['eventState'];reason=selected['reason']
            elif all(r['eventState']=='reset_required' for r in outputs):state='reset_required';reason='segment_too_long'
            elif len(candidates)>1:reason='candidate_transition'
            elif any(r['eventState']=='ending' for r in outputs):state='ending';reason='action_ending'
            else:reason='motion_required' if a.get('reason') in ('still','thumb_motion_required') or b.get('reason')=='help_motion_required' or c is not None and c.get('reason')=='need_motion_required' else 'no_supported_action'
        else:
            if self.missing_since is None:self.missing_since=t
            state='ending' if any(r['eventState']=='ending' for r in outputs) and not self.conflicted else 'waiting';reason='no_hands'
            if t-self.missing_since>=CONFIG['missingResetSeconds']:self.clear_segment();self.reset_detectors()
        status='candidate' if candidate else 'waiting' if not present else 'uncertain' if self.conflicted else 'observing'
        return {'status':status,'candidate':candidate,'reason':reason,'eventState':state,'event':None,'samples':max(a.get('samples',0),len(self.help.samples)),'handSamples':max(a.get('handSamples',0),sum(bool(h) for _,h in self.help.samples)),'helpEngine':'video-tcn','modelVersion':'v1','helpScore':b.get('helpScore'),'motionSupported':b.get('motionSupported'),'motionGuard':b.get('motionGuard')}
