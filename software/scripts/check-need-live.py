import sys,unittest,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from need_live import NeedLiveRecognizer
spec=importlib.util.spec_from_file_location('fixture',Path(__file__).with_name('check-need-required-motion.py'));fixture=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixture)

class Model:
    def __init__(self,score=1):self.score=score
    def probability(self,frames):return self.score

class LiveTests(unittest.TestCase):
    def test_stable_movement_then_boundary_emits_and_repeats(self):
        r=NeedLiveRecognizer(Model());out=[]
        for start in [0,4]:
            for i in range(60):out.append(r.push_features(start+i/30,fixture.frame(1-.45*np.clip((i-15)/20,0,1))))
            for i in range(30):out.append(r.push_features(start+2+i/30,np.zeros(153)))
        self.assertEqual([x['event']['id'] for x in out if x['event']],[1,2]);self.assertEqual([x['event']['text'] for x in out if x['event']],['需要','需要'])
    def test_static_high_model_score_and_reverse_rejected(self):
        for reverse in [False,True]:
            r=NeedLiveRecognizer(Model());out=[]
            for i in range(90):out.append(r.push_features(i/30,fixture.frame(.55+.45*np.clip((i-15)/20,0,1) if reverse else 1)))
            self.assertTrue(all(x['candidate'] is None and x['event'] is None for x in out))
    def test_motion_cannot_override_classifier_rejection(self):
        r=NeedLiveRecognizer(Model(0));out=[r.push_features(i/30,fixture.frame(1-.45*np.clip((i-15)/20,0,1))) for i in range(60)]
        self.assertTrue(all(x['candidate'] is None for x in out))
    def test_stale_motion_long_gap_and_reset_do_not_emit(self):
        r=NeedLiveRecognizer(Model())
        for i in range(150):r.push_features(i/30,fixture.frame(1-.45*np.clip((i-15)/20,0,1)))
        self.assertTrue(all(r.push_features(5+i/30,np.zeros(153))['event'] is None for i in range(30)))
        r=NeedLiveRecognizer(Model())
        for i in range(60):r.push_features(i/30,fixture.frame(1-.45*np.clip((i-15)/20,0,1)))
        self.assertIsNone(r.push_features(4,np.zeros(153))['event'])
    def test_cached_candidates_do_not_supply_fresh_consensus(self):
        r=NeedLiveRecognizer(Model())
        for i in range(37):out=r.push_features(i/30,fixture.frame(1-.45*np.clip((i-15)/20,0,1)))
        before=r.count
        for i in range(10):r.push_features(1.201+i*.001,fixture.frame(.55))
        self.assertEqual(before,r.count)

if __name__=='__main__':unittest.main()
