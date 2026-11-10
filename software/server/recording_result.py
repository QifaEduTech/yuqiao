"""A single-action review, not segmentation, a sentence, or a ground-truth label."""
class RecordingResult:
    def __init__(self,targets):
        self.targets={v['text']:v['signId'] for v in targets.values()}
        self.words=set();self.events=0;self.conflicts=0;self.hand_frames=0;self.frames=0
        self.last_event_end=None;self.after_completion=False;self.stable=False
    def add(self,t,present,result):
        self.frames+=1;self.hand_frames+=int(present)
        if result.get('reason')=='ambiguous_actions':self.conflicts+=1
        candidate=result.get('candidate')
        if candidate is not None:
            if candidate not in self.targets:raise ValueError('Unexpected live candidate')
            self.words.add(candidate)
            if self.last_event_end is not None and t*1000>self.last_event_end:self.after_completion=True
            if result.get('eventState')=='ready_to_finish':self.stable=True
        event=result.get('event')
        if event:
            if event['text'] not in self.targets or event['signId']!=self.targets[event['text']]:raise ValueError('Unexpected live event')
            self.words.add(event['text']);self.events+=1;self.last_event_end=event['endMs'];self.stable=True
    def finish(self):
        result={'candidate':None,'sign_id':None,'observed_word_count':len(self.words),'completed_event_count':self.events,'conflict_frames':self.conflicts,'candidate_after_completion':self.after_completion,'stable_candidate_seen':self.stable,'end_boundary_observed':self.events==1}
        if not self.hand_frames:return {**result,'status':'no_hands','reason':'no_hands'}
        if self.conflicts:return {**result,'status':'uncertain','reason':'conflicting_evidence'}
        if len(self.words)>1 or self.events>1 or self.after_completion:return {**result,'status':'uncertain','reason':'multiple_actions_detected'}
        if len(self.words)==1:
            word=next(iter(self.words));return {**result,'status':'candidate','candidate':word,'sign_id':self.targets[word],'reason':'single_realtime_candidate'}
        return {**result,'status':'uncertain','reason':'insufficient_evidence'}
