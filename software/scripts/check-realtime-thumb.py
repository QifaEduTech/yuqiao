"""Exercise the real online gate even if the classifier always predicts thanks."""
import sys,unittest,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from realtime_events import LiveRecognizer
from realtime_window import recent_thumb_motion
spec=importlib.util.spec_from_file_location('shapes',Path(__file__).with_name('check-thumb-local-motion.py'));shapes=importlib.util.module_from_spec(spec);spec.loader.exec_module(shapes)
hand=shapes.hand
def target(_):
    scores=np.full(10,.001);scores[4]=.99;return scores
def action(i):return hand(bend=45 if i%10 in [4,5,6] else 0)

class OnlineThumbTests(unittest.TestCase):
    def test_one_supported_bend_is_enough_without_fixed_repetitions(self):
        r=LiveRecognizer(target)
        outputs=[r.push(i/10,hand(bend=45 if 14<=i<=17 else 0)) for i in range(26)]
        outputs += [r.push(2.6+i/10,None) for i in range(10)]
        self.assertEqual(sum(x['event'] is not None for x in outputs),1)
    def test_held_like_translation_rotation_and_other_finger_jitter_never_emit(self):
        for kind in ['held','move','noise','other_finger']:
            r=LiveRecognizer(target);outputs=[]
            for i in range(60):
                v=hand(rotate=i*2 if kind=='move' else 0,offset=i/20 if kind=='move' else 0,bend=(2 if i%2 else 0) if kind=='noise' else 0)
                if kind=='other_finger':v[8*3]+=.3*(i%2)
                outputs.append(r.push(i/10,v))
            outputs += [r.push(6+i/10,None) for i in range(10)]
            self.assertTrue(all(x['candidate'] is None and x['event'] is None for x in outputs),kind)
    def test_natural_bends_emit_once_at_end_and_again_next_segment(self):
        r=LiveRecognizer(target);outputs=[]
        for start in [0,5]:
            outputs += [r.push(start+i/10,action(i)) for i in range(35)]
            outputs += [r.push(start+3.5+i/10,None) for i in range(15)]
        self.assertEqual([x['event']['id'] for x in outputs if x['event']],[1,2])
    def test_stop_moving_revokes_candidate_even_when_classifier_keeps_saying_thanks(self):
        r=LiveRecognizer(target)
        moving=[r.push(i/10,action(i)) for i in range(35)];self.assertTrue(any(x['candidate'] for x in moving))
        held=[r.push(3.5+i/10,hand()) for i in range(30)]
        self.assertIsNone(held[-1]['candidate']);self.assertEqual(held[-1]['reason'],'thumb_motion_required')
        self.assertTrue(all(x['event'] is None for x in [r.push(6.5+i/10,None) for i in range(10)]))
    def test_missing_hand_side_switch_and_single_tracking_jump_do_not_supply_motion(self):
        for kind in ['missing','switch','spike']:
            r=LiveRecognizer(target);outputs=[]
            for i in range(35):
                v=hand(bend=45 if i>=15 and kind!='spike' or i==15 else 0,side=1 if kind=='switch' and i>=15 else 0)
                if kind=='missing' and 12<=i<15:v=None
                outputs.append(r.push(i/10,v))
            self.assertTrue(all(x['candidate'] is None for x in outputs),kind)
    def test_ambiguous_rotation_cannot_pass_even_with_apparent_thumb_contraction(self):
        r=LiveRecognizer(target)
        outputs=[r.push(i/10,hand(shorten=.5 if i%10 in [4,5,6] else 1,rotate=60 if i%10 in [4,5,6] else 0)) for i in range(40)]
        self.assertTrue(all(x['candidate'] is None for x in outputs))
    def test_last_bend_not_lost_when_diagnostic_event_list_is_truncated(self):
        timeline=[(i/30,hand(bend=45 if i%12 in [5,6,7] else 0)) for i in range(180)]
        self.assertTrue(recent_thumb_motion(timeline,timeline[-1][0]))

if __name__=='__main__':unittest.main()
