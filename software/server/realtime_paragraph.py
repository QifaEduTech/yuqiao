"""In-memory paragraphs made ONLY from confirmed action events."""
import json,math
from pathlib import Path

CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/realtime-paragraph.json').read_text(encoding='utf8'))

def format_words(words):
    text=''.join(words)
    return text+'。' if text else ''

class ParagraphBuffer:
    def __init__(self):
        self.serial=0;self.last_event_id=0;self.last_event_end=-1;self.last_time=None;self.reset()
    def reset(self):self.words=[];self.start=None;self.end=None;self.quiet=None;self.blocked=False;self.last_activity=None;self.limit=False;self.pending=None
    def push(self,t,result,present,finish=False):
        if not math.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time:raise ValueError('paragraph_time_order')
        if self.words and self.last_time is not None and t-self.last_time>CONFIG['maxFrameGapSeconds']:self.blocked=True
        self.last_time=t
        if result.get('candidate'):self.pending=result['candidate']
        if result.get('reason')=='ambiguous_actions' or result.get('eventState')=='reset_required':self.blocked=True
        event=result.get('event')
        if event:
            if event['id']!=self.last_event_id+1 or event['startMs']<=self.last_event_end or event['endMs']<=event['startMs'] or event['endMs']>round(t*1000):raise ValueError('paragraph_event_order')
            self.last_event_id=event['id'];self.last_event_end=event['endMs']
            if self.pending==event['text']:self.pending=None
            proposed=self.words+[event['text']]
            if len(proposed)>CONFIG['maxWords'] or len(format_words(proposed))>CONFIG['maxCharacters']:self.limit=True;self.blocked=True
            else:
                self.words=proposed
                if self.start is None:self.start=event['startMs']
                self.end=event['endMs'];self.last_activity=t
        if present or result.get('candidate'):
            self.quiet=None
        elif self.quiet is None:self.quiet=t
        if self.words and self.start is not None and t-self.start/1000>CONFIG['maxSeconds']:self.limit=True;self.blocked=True
        ended=bool(self.words) and self.quiet is not None and t-self.quiet>=CONFIG['endQuietSeconds']-1e-6
        final=None
        if (finish or ended or self.limit) and self.words:
            # Finishing while an unconfirmed candidate is still in progress does
            # not convert that candidate into a confirmed word or silently omit it.
            partial=self.blocked or self.pending is not None
            self.serial+=1
            final={'id':self.serial,'text':format_words(self.words),'words':list(self.words),'wordCount':len(self.words),'startMs':self.start,'endMs':self.end,'partial':bool(partial),'endReason':'limit' if self.limit else 'manual' if finish else 'quiet'}
            self.reset()
        elif finish and not self.words:self.reset()
        state='needs_review' if self.blocked else 'collecting' if self.words else 'empty'
        # The UI reports this observed no-hand interval; it must not run a
        # speculative client timer that finishes without fresh recognition frames.
        auto_end=None
        if self.words and self.quiet is not None:
            auto_end={'remainingMs':max(0,round((CONFIG['endQuietSeconds']-(t-self.quiet))*1000))}
        return {'state':state,'text':format_words(self.words),'words':list(self.words),'wordCount':len(self.words),'final':final,'autoEnd':auto_end}
