import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from realtime_multi import MultiLiveRecognizer
def response(word=None,event=None,state='collecting'):
    return {'status':'candidate' if word else 'waiting','candidate':word,'event':event,'eventState':state,'reason':'target' if word else 'no_hands','samples':1,'handSamples':int(word is not None)}
class ThanksStub:
    result=response()
    def push(self,*args,**kwargs):return self.result
class HelpStub:
    result=response();samples=[]
    def push_features(self,*args,**kwargs):return self.result
    def reset(self):pass

class AutomaticTests(unittest.TestCase):
    def setUp(self):
        self.a=ThanksStub();self.b=HelpStub();self.live=MultiLiveRecognizer(None,thanks_detector=self.a,help_detector=self.b);self.clock=0.
    def frame(self,a=None,b=None,present=True,event_a=None,event_b=None,stable=False):
        self.a.result=response(a,event_a,'emitted' if event_a else 'ready_to_finish' if stable else 'collecting');self.b.result=response(b,event_b,'emitted' if event_b else 'ready_to_finish' if stable else 'collecting')
        value=np.ones(126) if present else None;vector=np.ones(153) if present else np.zeros(153)
        result=self.live.push(round(self.clock,3),value,vector);self.clock+=.1;return result
    def test_alternating_and_repeated_words_share_global_event_ids(self):
        events=[]
        for word in ['谢谢','帮助','谢谢','谢谢']:
            self.frame(a=word if word=='谢谢' else None,b=word if word=='帮助' else None)
            # Child event is emitted on the actual first confirmed boundary.
            for _ in range(6):self.frame(present=False)
            event={'id':42,'text':word,'signId':'csl.thanks' if word=='谢谢' else 'csl.ref.bmcx.1900','startMs':0,'endMs':round(self.clock*1000)}
            out=self.frame(present=False,event_a=event if word=='谢谢' else None,event_b=event if word=='帮助' else None)
            if not out['event']:
                # Floating boundary can need one more 100ms observation.
                out=self.frame(present=False,event_a=event if word=='谢谢' else None,event_b=event if word=='帮助' else None)
            self.assertIsNotNone(out['event']);events.append(out['event'])
            self.frame(present=False)
        self.assertEqual([x['text'] for x in events],['谢谢','帮助','谢谢','谢谢']);self.assertEqual([x['id'] for x in events],[1,2,3,4])
    def test_simultaneous_words_are_not_selected_by_order(self):
        out=self.frame('谢谢','帮助');self.assertIsNone(out['candidate']);self.assertEqual(out['reason'],'candidate_transition')
        self.assertEqual(self.frame(a='谢谢')['candidate'],'谢谢')
        for _ in range(10):self.assertIsNone(self.frame(present=False)['event'])
        self.assertEqual(self.frame(b='帮助')['candidate'],'帮助')
    def test_ordered_switch_emits_previous_then_new_with_nonoverlapping_times(self):
        self.frame(a='谢谢',stable=True);out=self.frame(b='帮助',stable=True);self.assertIsNone(out['event']);self.assertEqual(out['reason'],'action_transition')
        self.frame(b='帮助',stable=True);out=self.frame(b='帮助',stable=True)
        first=out['event'];self.assertEqual(first['text'],'谢谢');self.assertEqual(first['id'],1);self.assertFalse(self.live.conflicted)
        self.frame(b='帮助',stable=True)
        out=self.frame(present=False,event_b={'id':7,'text':'帮助','signId':'csl.ref.bmcx.1900','startMs':0,'endMs':500})
        self.assertEqual(out['event']['text'],'帮助');self.assertEqual(out['event']['id'],2);self.assertGreater(out['event']['startMs'],first['endMs'])
    def test_transient_switch_does_not_finish_previous_action(self):
        self.frame(a='谢谢',stable=True)
        for _ in range(5):self.assertIsNone(self.frame(b='帮助')['event'])
        self.assertIsNone(self.frame(a='谢谢',stable=True)['event']);self.assertFalse(self.live.conflicted)
    def test_stable_overlap_has_grace_but_sustained_overlap_rejects(self):
        self.frame(a='谢谢',stable=True);self.assertEqual(self.frame('谢谢','帮助',stable=True)['reason'],'action_transition')
        for _ in range(6):out=self.frame('谢谢','帮助',stable=True)
        self.assertEqual(out['reason'],'ambiguous_actions');self.assertIsNone(out['event'])
    def test_short_overlap_then_retirement_can_handoff(self):
        self.frame(a='谢谢',stable=True);self.frame('谢谢','帮助',stable=True)
        self.frame(b='帮助',stable=True);self.frame(b='帮助',stable=True);out=self.frame(b='帮助',stable=True)
        self.assertEqual(out['event']['text'],'谢谢');self.assertFalse(self.live.conflicted)
    def test_expired_old_action_is_not_spoken_late(self):
        self.frame(a='谢谢',stable=True)
        for _ in range(50):self.assertIsNone(self.frame()['event'])
        self.assertIsNone(self.frame(b='帮助',stable=True)['event']);self.assertEqual(self.live.words,{'帮助'})
    def test_completed_new_action_can_flush_two_ordered_events(self):
        self.frame(a='谢谢',stable=True);self.frame(b='帮助');self.frame(b='帮助')
        first=self.frame(present=False,event_b={'id':4,'text':'帮助','signId':'csl.ref.bmcx.1900','startMs':0,'endMs':300})['event']
        second=self.frame(present=False)['event'];self.assertEqual([first['text'],second['text']],['谢谢','帮助']);self.assertGreater(second['startMs'],first['endMs']);self.assertIsNone(self.frame(present=False)['event'])
    def test_new_hand_configuration_restarts_only_incoming_detector(self):
        class Incoming(HelpStub):
            def __init__(self):self.restarts=0;self.times=[];self.result=response()
            def restart(self):self.restarts+=1;self.times=[]
            def push_features(self,t,*args,**kwargs):
                if self.times:assert t>self.times[-1]
                self.times.append(t);return self.result
        incoming=Incoming();live=MultiLiveRecognizer(None,thanks_detector=self.a,help_detector=incoming);self.a.result=response('谢谢',state='ready_to_finish')
        one=np.zeros(153);one[74]=1;two=one.copy();two[150]=1
        for t in [0,.1,.2]:live.push(t,np.ones(126),one)
        live.push(.3,np.ones(126),two);live.push(.4,np.ones(126),two)
        self.assertEqual(incoming.restarts,1);self.assertGreaterEqual(min(incoming.times),.3);self.assertEqual(live.words,{'谢谢'})
    def test_camera_gap_discards_queued_second_completion(self):
        self.frame(a='谢谢',stable=True);self.frame(b='帮助');self.frame(b='帮助')
        self.frame(present=False,event_b={'id':4,'text':'帮助','signId':'csl.ref.bmcx.1900','startMs':0,'endMs':300})
        self.clock+=2;self.assertIsNone(self.frame(present=False)['event'])
    def test_brief_wrong_candidate_does_not_poison_stable_word(self):
        self.frame(b='帮助');out=self.frame(a='谢谢',stable=True)
        self.assertEqual(out['candidate'],'谢谢');self.assertFalse(self.live.conflicted)
        self.assertIsNone(self.frame(b='帮助')['candidate']);self.assertFalse(self.live.conflicted)
        self.assertEqual(self.frame(a='谢谢',stable=True)['candidate'],'谢谢')
    def test_confirmed_active_hand_boundary_with_passive_hand_visible(self):
        self.frame(a='谢谢',stable=True)
        out=self.frame(event_a={'id':5,'text':'谢谢','signId':'csl.thanks','startMs':0,'endMs':100})
        self.assertEqual(out['event']['id'],1);self.assertEqual(self.live.words,set())
    def test_two_stable_words_reject_even_a_confirmed_child_event(self):
        self.frame('谢谢','帮助',stable=True)
        out=self.frame(present=False,event_a={'id':1,'text':'谢谢','startMs':0,'endMs':100})
        self.assertIsNone(out['event'])
    def test_unknown_no_hands_and_invalid_clock(self):
        for _ in range(30):self.assertIsNone(self.frame(present=False)['event'])
        self.assertIsNone(self.frame()['candidate'])
        with self.assertRaises(ValueError):self.live.push(-1,None,np.zeros(153))
    def test_long_gap_clears_prior_conflict(self):
        self.frame('谢谢','帮助',stable=True);self.clock+=2;self.assertEqual(self.frame(b='帮助')['candidate'],'帮助')
    def test_optional_third_action_has_global_event_identity(self):
        c=HelpStub();self.live.need=c;c.result=response('需要',state='ready_to_finish');self.assertEqual(self.frame()['candidate'],'需要')
        c.result=response(event={'id':99,'text':'需要','signId':'csl.ref.bmcx.1874','startMs':0,'endMs':100},state='emitted');out=self.frame(present=False)
        self.assertEqual(out['event']['id'],1);self.assertEqual(out['event']['text'],'需要')
    def test_third_action_stable_conflict_still_rejected(self):
        c=HelpStub();self.live.need=c;c.result=response('需要',state='ready_to_finish');out=self.frame(a='谢谢',stable=True)
        self.assertIsNone(out['candidate']);self.assertEqual(out['reason'],'ambiguous_actions')


class MeBoundaryTests(unittest.TestCase):
    def test_me_withdrawal_cannot_become_need_until_completion(self):
        class Me(HelpStub):
            def push_payload(self,*args):return self.result
        a=ThanksStub();b=HelpStub();c=HelpStub();d=Me()
        a.result=response();b.result=response();c.result=response();d.result=response('我',state='ready_to_finish')
        live=MultiLiveRecognizer(None,thanks_detector=a,help_detector=b,need_detector=c,me_detector=d)
        vector=np.zeros(153);vector[74]=1
        self.assertEqual(live.push(0,np.ones(126),vector)['candidate'],'我')
        d.result=response();c.result=response('需要',state='ready_to_finish')
        for t in [.1,.2,.3,.4]:
            out=live.push(t,np.ones(126),vector);self.assertIsNone(out['candidate']);self.assertIsNone(out['event'])
        d.result=response(event={'id':77,'text':'我','signId':'csl.me','startMs':0,'endMs':500},state='emitted');c.result=response()
        event=live.push(.5,None,np.zeros(153))['event'];self.assertEqual(event['text'],'我');self.assertEqual(event['id'],1)
        d.result=response();c.result=response('需要',state='ready_to_finish')
        self.assertEqual(live.push(.6,np.ones(126),vector)['candidate'],'需要')

if __name__=='__main__':unittest.main()
