"""Synthetic boundary and arbitrary-word contracts; no user training/media."""
import unittest,sys,tempfile,hashlib,json
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from realtime_paragraph import ParagraphBuffer,format_words
from me_handoff import MeHandoff
from realtime_multi import MultiLiveRecognizer
from trained_runtime import TrainedLiveRecognizer
from me_tcn_inference import SHAPES

def base(word=None):return {'candidate':word,'event':None,'eventState':'ready_to_finish' if word else 'collecting','reason':'target' if word else 'no_hands'}
def event(i,text,start,end):return {'id':i,'text':text,'signId':'test.'+text,'startMs':start,'endMs':end}
def palm():
    h=np.zeros((21,3));h[0]=[.3,.6,0]
    for n,i in enumerate([5,9,13,17]):
        h[i:i+4,:2]=[[.2+n*.04,y] for y in [.45,.35,.27,.2]]
    return h

class Stub:
    def __init__(self,word=None):self.result=base();self.samples=[];self.entry={'text':word,'signId':'test.'+str(word)};self.resets=0
    def push(self,*a,**kw):return self.result
    def push_features(self,*a,**kw):return self.result
    def push_payload(self,*a,**kw):return self.result
    def reset(self):self.resets+=1
    def restart(self):self.resets+=1
    def begin_segment(self,*a):pass

class ParagraphChecks(unittest.TestCase):
    def test_recorded_pause_does_not_split_and_repeated_words_stay_in_order(self):
        b=ParagraphBuffer(auto_finish=False)
        words=['我','发烧','我','需要','医生','帮助']
        events={3:words[0],6:words[1],30:words[2],33:words[3],36:words[4],39:words[5]}
        index=0
        for tick in range(1,40):
            w=events.get(tick)
            result=base()
            if w:
                index+=1
                result['event']=event(index,w,tick*100-50,tick*100)
            r=b.push(tick/10,result,bool(w),finish=tick==39)
            self.assertIsNone(r['autoEnd'])
            if tick<39:self.assertIsNone(r['final'])
        self.assertEqual(r['final']['words'],words)
        self.assertFalse(r['final']['partial'])

    def test_arbitrary_order_and_repetition_are_not_a_fixed_sentence(self):
        for words in [['我','需要','帮助','谢谢'],['没有','医院','门诊','医生'],['挂号','挂号','不','可以'],['自定义甲','自定义乙']]:
            b=ParagraphBuffer()
            for i,w in enumerate(words):b.push((i+1)*.2,{**base(),'event':event(i+1,w,i*100,i*100+50)},True)
            out=b.push((len(words)+1)*.2,base(),False,True)
            self.assertEqual(out['final']['words'],words);self.assertEqual(out['final']['text'],''.join(words)+'。');self.assertFalse(out['final']['partial'])
    def test_short_pause_keeps_one_paragraph_and_long_quiet_finishes_once(self):
        b=ParagraphBuffer();b.push(.1,{**base(),'event':event(1,'甲',0,50)},True)
        for t in [.2,.4,.8,1.2]:self.assertIsNone(b.push(t,base(),False)['final'])
        b.push(1.3,{**base(),'event':event(2,'乙',200,1000)},True)
        final=None
        for n in range(14,37):
            r=b.push(n/10,base(),False)
            if r['final']:final=r['final']
        self.assertEqual(final['words'],['甲','乙']);self.assertEqual(final['id'],1)
        self.assertIsNone(b.push(3.8,base(),False)['final'])
    def test_candidate_alone_is_not_committed(self):
        b=ParagraphBuffer();self.assertIsNone(b.push(0,base('未知'),True)['final'])
        out=b.push(.2,base(),False,True);self.assertEqual(out['wordCount'],0);self.assertIsNone(out['final'])
    def test_auto_end_progress_resets_when_hands_return(self):
        b=ParagraphBuffer();b.push(.1,{**base(),'event':event(1,'我',0,50)},True)
        self.assertEqual(b.push(.2,base(),False)['autoEnd']['remainingMs'],2000)
        self.assertEqual(b.push(.8,base(),False)['autoEnd']['remainingMs'],1400)
        self.assertIsNone(b.push(.9,base(),True)['autoEnd'])
        for t in [1.2,1.8,2.4,3.0]:self.assertIsNone(b.push(t,base(),True)['final'])
        self.assertEqual(b.push(3.1,base(),False)['autoEnd']['remainingMs'],2000)
        for t in [3.6,4.1,4.6]:self.assertIsNone(b.push(t,base(),False)['final'])
        out=b.push(5.1,base(),False);self.assertEqual(out['final']['endReason'],'quiet');self.assertIsNone(out['autoEnd'])
    def test_two_auto_paragraphs_need_no_manual_finish_and_keep_ids(self):
        b=ParagraphBuffer();finals=[]
        for index in range(2):
            start=index*3
            b.push(start+.1,{**base(),'event':event(index+1,'谢谢',start*1000,start*1000+50)},True)
            for n in range(2,25):
                out=b.push(start+n/10,base(),False)
                if out['final']:finals.append(out['final'])
        self.assertEqual([f['id'] for f in finals],[1,2]);self.assertTrue(all(f['endReason']=='quiet' and not f['partial'] for f in finals))
    def test_incomplete_candidate_conflict_or_gap_needs_review(self):
        for kind in ['candidate','conflict','gap']:
            b=ParagraphBuffer();b.push(.1,{**base(),'event':event(1,'甲',0,50)},True)
            if kind=='candidate':b.push(.2,base('乙'),True)
            if kind=='conflict':b.push(.2,{**base(),'reason':'ambiguous_actions'},True)
            t=1.5 if kind=='gap' else .3
            self.assertTrue(b.push(t,base(),False,True)['final']['partial'])
    def test_order_cannot_reuse_or_skip_events(self):
        b=ParagraphBuffer();b.push(.2,{**base(),'event':event(1,'甲',0,100)},True)
        with self.assertRaises(ValueError):b.push(.3,{**base(),'event':event(1,'甲',0,100)},True)
    def test_no_event_only_final_even_after_many_empty_frames(self):
        b=ParagraphBuffer()
        for i in range(100):self.assertIsNone(b.push(i/10,base(),False)['final'])

class HandoffChecks(unittest.TestCase):
    def test_actual_custom_weight_loader_uses_the_generic_adapter(self):
        parent=ROOT/'.runtime-logs/paragraph-adapter-check';parent.mkdir(parents=True,exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as temporary:
            directory=Path(temporary)
            arrays={k:np.zeros(shape,np.float32) for k,shape in SHAPES.items()};arrays['std'][:]=1;arrays['classifier.bias'][:]=9
            np.savez_compressed(directory/'weights.npz',**arrays)
            digest=hashlib.sha256((directory/'weights.npz').read_bytes()).hexdigest()
            meta={'protocol':'self-service-body178-v1','sha256':digest,'hands':1,'motion':'static','threshold':.9}
            (directory/'model.json').write_text(json.dumps(meta),encoding='utf8')
            entry={'text':'合成扩展词','signId':'synthetic.extended','path':str(directory/'model.json'),'sha256':digest}
            detector=TrainedLiveRecognizer(entry);frame=np.zeros(178,np.float32);frame[74]=1;payload={'frame':frame,'hands':[palm()]}
            observations=[detector.push_payload(i/30,payload) for i in range(50)]
            self.assertTrue(any(r['candidate']=='合成扩展词' for r in observations))
            events=[]
            for i in range(50,76):
                r=detector.push_payload(i/30,None)
                if r['event']:events.append(r['event'])
            self.assertEqual([e['text'] for e in events],['合成扩展词'])
            with self.assertRaises(ValueError):TrainedLiveRecognizer({**entry,'sha256':'0'*64})
    def test_open_palm_must_be_fresh_stable_and_not_me(self):
        g=MeHandoff();payload={'hands':[palm()]};r={'candidate':None,'meEvidenceSupported':False}
        for t in [0,.1,.2]:self.assertIsNone(g.push(t,payload,r))
        self.assertEqual(g.push(.3,payload,r),0)
        self.assertIsNone(g.push(.4,payload,{'candidate':'我'}))
        self.assertIsNone(g.push(.5,None,r))
    def test_folded_or_missing_hand_does_not_release(self):
        h=palm();h[12,:2]=h[9,:2]
        for payload in [None,{'hands':[]},{'hands':[h]},{'hands':[palm(),palm()]}]:
            g=MeHandoff()
            for i in range(10):self.assertIsNone(g.push(i/10,payload,{}))
    def make(self,extras=None):
        a,b,c,d=[Stub() for _ in range(4)]
        live=MultiLiveRecognizer(None,thanks_detector=a,help_detector=b,need_detector=c,me_detector=d,continuous=True,additional_detectors=extras)
        return live,a,b,c,d
    def test_me_withdrawal_blocked_until_open_palm_then_fresh_window(self):
        live,a,b,c,d=self.make();f=np.zeros(153);f[74]=1
        d.result=base('我');self.assertEqual(live.push(0,np.ones(126),f)['candidate'],'我')
        d.result=base();c.result=base('需要')
        for t in [.1,.2,.3]:self.assertIsNone(live.push(t,np.ones(126),f)['candidate'])
        c.result=base();payload={'hands':[palm()]}
        for t in [.4,.5,.6]:self.assertIsNone(live.push(t,np.ones(126),f,me_input=payload)['event'])
        out=live.push(.7,np.ones(126),f,me_input=payload);self.assertEqual(out['event']['text'],'我');self.assertGreater(c.resets,0)
        c.result=base('需要');self.assertEqual(live.push(.8,np.ones(126),f,me_input=payload)['candidate'],'需要')
    def test_any_new_action_can_handoff_to_another_new_action(self):
        x,y=Stub('扩展甲'),Stub('扩展乙');live,a,b,c,d=self.make({'扩展甲':x,'扩展乙':y});f=np.zeros(153);f[74]=1
        x.result=base('扩展甲');live.push(0,np.ones(126),f)
        x.result=base();live.push(.1,np.ones(126),f)
        y.result=base('扩展乙');out=live.push(.4,np.ones(126),f)
        self.assertEqual(out['event']['text'],'扩展甲');self.assertEqual(out['event']['signId'],'test.扩展甲')
        self.assertEqual(live.push(.5,np.ones(126),f)['candidate'],'扩展乙')
        self.assertEqual(live.finish_for_paragraph(.6)['event']['text'],'扩展乙')
    def test_conflicting_new_actions_are_not_forced(self):
        x,y=Stub('扩展甲'),Stub('扩展乙');live,a,b,c,d=self.make({'扩展甲':x,'扩展乙':y});f=np.zeros(153);f[74]=1;x.result=base('扩展甲');y.result=base('扩展乙')
        r=live.push(0,np.ones(126),f);self.assertIsNone(r['candidate']);self.assertEqual(r['reason'],'ambiguous_actions');self.assertIsNone(live.finish_for_paragraph(.1))
    def test_me_can_transition_to_arbitrary_new_action_without_palm_only_rule(self):
        x=Stub('扩展甲');live,a,b,c,d=self.make({'扩展甲':x});f=np.zeros(153);f[74]=1
        d.result=base('我');live.push(0,np.ones(126),f);d.result=base();live.push(.1,np.ones(126),f)
        x.result=base('扩展甲');self.assertEqual(live.push(.4,np.ones(126),f)['event']['text'],'我')
        self.assertEqual(live.push(.5,np.ones(126),f)['candidate'],'扩展甲')

if __name__=='__main__':unittest.main()
