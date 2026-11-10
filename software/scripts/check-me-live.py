import sys,unittest,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from me_live import MeLiveRecognizer
spec=importlib.util.spec_from_file_location('fixtures',ROOT/'scripts/check-me-motion.py');f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

class Model:
    def __init__(self,score=1):self.score=score
    def probability(self,frames):return self.score

def payload():
    h,b=f.fixture();v=np.zeros(178,np.float32);v[74]=1;v[-1]=1
    return {'frame':v,'hands':[h],'shoulders':b}

class Checks(unittest.TestCase):
    def setUp(self):self.live=MeLiveRecognizer(Model());self.t=0
    def push(self,p):
        out=self.live.push_payload(round(self.t,6),p);self.t+=.04;return out
    def hold(self,p=None):return [self.push(p if p is not None else payload()) for _ in range(30)]
    def test_candidate_before_finish_and_only_one_event(self):
        out=self.hold();self.assertTrue(any(x['candidate']=='我' for x in out));self.assertFalse(any(x['event'] for x in out))
        self.assertFalse(any(x['event'] for x in self.hold()))
        missing=[self.push(None) for _ in range(30)];self.assertEqual([x['event']['text'] for x in missing if x['event']],['我'])
    def test_repeat_after_real_boundary(self):
        events=[]
        for _ in range(2):
            self.hold();events.extend(x['event'] for x in [self.push(None) for _ in range(30)] if x['event'])
        self.assertEqual([x['id'] for x in events],[1,2])
    def test_model_alone_cannot_output(self):
        p=payload();p['shoulders']=[]
        out=self.hold(p);self.assertFalse(any(x['candidate'] for x in out))
        self.assertFalse(out[-1]['meCheck']['bodyVisible']);self.assertEqual(out[-1]['meCheck']['modelScore'],1)
        self.assertFalse(any(x['event'] for x in [self.push(None) for _ in range(30)]))
    def test_geometry_alone_cannot_output(self):
        self.live=MeLiveRecognizer(Model(0));self.assertFalse(any(x['candidate'] for x in self.hold()))
    def test_missing_body_clears_old_qualification(self):
        self.hold();p=payload();p['shoulders']=[]
        self.assertIsNone(self.push(p)['candidate'])
        for _ in range(100):self.push(p)
        self.assertFalse(any(x['event'] for x in [self.push(None) for _ in range(30)]))
    def test_wrong_direction_revokes_after_short_expiry(self):
        self.hold();p=payload();p['hands'][0][5:9,0]=[.3,.25,.2,.14]
        self.hold(p);self.hold(p);out=self.hold(p);self.assertIsNone(out[-1]['candidate']);self.assertFalse(any(x['event'] for x in [self.push(None) for _ in range(30)]))
    def test_gap_and_restart_do_not_restore_events(self):
        self.hold();self.t+=2;self.push(None);self.assertFalse(any(x['event'] for x in [self.push(None) for _ in range(30)]))
        self.live.restart();self.assertIsNone(self.live.push_payload(0,None)['event'])
    def test_duplicate_time_rejected(self):
        self.live.push_payload(1,payload())
        with self.assertRaises(ValueError):self.live.push_payload(1,payload())

if __name__=='__main__':unittest.main()
