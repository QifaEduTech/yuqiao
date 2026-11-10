import sys,unittest,importlib.util
from types import SimpleNamespace as N
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from help_tcn_inference import HelpTCN,SHAPES
from help_tcn_live import HelpTCNLive
from sign_training_features import training_frame
spec=importlib.util.spec_from_file_location('shapes',Path(__file__).with_name('check-help-motion.py'));shapes=importlib.util.module_from_spec(spec);spec.loader.exec_module(shapes)
def vector(hands):
    observation=N(multi_hand_landmarks=[N(landmark=[N(x=p[0],y=p[1],z=p[2]) for p in h]) for h in hands.values()],multi_handedness=[N(classification=[N(label=side,score=1.)]) for side in hands])
    return training_frame(observation,1/30)
class High:
    def probability(self,x):return .84
class ModelRuntimeTests(unittest.TestCase):
    def test_exported_model_loads_and_scores_finite(self):
        model=HelpTCN();self.assertEqual(model.manifest['weightsSha256'],'befc21ff332b488eb4db00b0aeeaf24fa224440ffca472d7d759c045ee168de6')
        self.assertTrue(0<=model.probability(np.zeros((30,153)))<=1)
    def test_invalid_arrays_and_features_rejected(self):
        arrays={k:np.zeros(shape) for k,shape in SHAPES.items()}
        with self.assertRaises(ValueError):HelpTCN(arrays)
        model=HelpTCN()
        for shape in [(1,153),(400,153),(30,126)]:
            with self.assertRaises(ValueError):model.probability(np.zeros(shape))
    def test_no_hands_does_not_invoke_model_and_shutdown_boundary(self):
        class Never:
            def probability(self,x):raise AssertionError('No hand model call')
        live=HelpTCNLive(Never())
        for i in range(90):self.assertIsNone(live.push_features(i/30,np.zeros(153))['candidate'])
    def test_high_score_is_not_hidden_by_old_geometry_and_emits_once(self):
        class High:
            def probability(self,x):return .84
        live=HelpTCNLive(High(),motion_check=False);frame=np.ones(153,dtype=np.float32)
        outputs=[live.push_features(i/30,frame) for i in range(90)];self.assertTrue(any(x['candidate']=='帮助' for x in outputs))
        outputs += [live.push_features(3+i/10,np.zeros(153)) for i in range(10)]
        self.assertEqual(sum(x['event'] is not None for x in outputs),1)
    def test_thanks_conflict_revokes_model_candidate(self):
        class High:
            def probability(self,x):return .84
        live=HelpTCNLive(High(),motion_check=False);frame=np.ones(153)
        for i in range(90):live.push_features(i/30,frame)
        result=live.push_features(3,frame,True);self.assertIsNone(result['candidate']);self.assertIsNone(result['helpScore']);self.assertFalse(live.qualified)
    def test_high_model_score_cannot_pass_static_single_lateral_or_jitter(self):
        for mode in ['static','single','lateral','opposed','jitter']:
            live=HelpTCNLive(High());rows=shapes.timeline(mode if mode!='jitter' else 'static');outputs=[]
            for i,(t,hands) in enumerate(rows):
                if mode=='jitter':hands={side:(h-h[0])*(1+.01*np.sin(i))+h[0]+[.001*np.sin(i),0,0] for side,h in hands.items()}
                outputs.append(live.push_features(t,vector(hands),aspect_ratio=1))
            self.assertTrue(all(x['candidate'] is None for x in outputs),mode)
            self.assertTrue(any(x['helpScore']==.84 and x['motionSupported'] is False for x in outputs),mode)
            self.assertTrue(all(live.push_features(3+i/10,np.zeros(153))['event'] is None for i in range(10)))
    def test_real_bilateral_motion_can_emit_with_high_model_score(self):
        live=HelpTCNLive(High());outputs=[live.push_features(t,vector(h),aspect_ratio=1) for t,h in shapes.timeline()]
        self.assertTrue(any(x['candidate']=='帮助' for x in outputs));outputs += [live.push_features(3+i/10,np.zeros(153)) for i in range(10)]
        self.assertEqual(sum(x['event'] is not None for x in outputs),1)
    def test_motion_cannot_override_low_model_score(self):
        class Low:
            def probability(self,x):return .1
        live=HelpTCNLive(Low());outputs=[live.push_features(t,vector(h),aspect_ratio=1) for t,h in shapes.timeline()]
        self.assertTrue(all(x['candidate'] is None for x in outputs))
    def test_natural_one_hand_leaves_first_does_not_lose_completed_action(self):
        live=HelpTCNLive(High());rows=shapes.timeline()
        for t,h in rows:live.push_features(t,vector(h),aspect_ratio=1)
        one={'Left':rows[-1][1]['Left']}
        for i in range(2):live.push_features(3+i/30,vector(one),aspect_ratio=1)
        ended=[live.push_features(3.1+i/10,np.zeros(153)) for i in range(10)]
        self.assertEqual(sum(x['event'] is not None for x in ended),1)
    def test_old_movement_expires_when_hands_stop(self):
        live=HelpTCNLive(High())
        for t,h in shapes.timeline():live.push_features(t,vector(h),aspect_ratio=1)
        frame=vector(shapes.timeline('static')[0][1]);outputs=[live.push_features(3+i/30,frame,aspect_ratio=1) for i in range(150)]
        self.assertIsNone(outputs[-1]['candidate']);self.assertFalse(outputs[-1]['motionSupported']);self.assertFalse(live.qualified)

if __name__=='__main__':unittest.main()
