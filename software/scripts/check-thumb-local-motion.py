"""Synthetic geometry/temporal checks; no private recordings or accuracy claims."""
import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from thumb_local_motion import local_thumb_evidence

def hand(bend=0,shorten=1,side=0,rotate=0,scale=1,offset=0):
    h=np.zeros((21,3));h[1]=[0,1,0];h[2]=[0,2,0];h[3]=[0,3,0]
    a=np.radians(bend);h[4]=[np.sin(a),3+np.cos(a),0]
    h[3:5]=h[2]+(h[3:5]-h[2])*shorten
    h[5]=[1,1.5,0];h[9]=[.7,2,0];h[17]=[-1,1,0]
    a=np.radians(rotate);rotation=np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
    h=(h@rotation.T)*scale+offset
    v=np.zeros((2,63));v[side]=h.reshape(-1);return v.reshape(-1)

class LocalMotionTests(unittest.TestCase):
    def test_static_thumbs_up_and_already_bent_hold_rejected(self):
        for bend in [0,45]:self.assertFalse(local_thumb_evidence([(i/30,hand(bend=bend)) for i in range(45)])['supported'])
    def test_single_real_bend_on_either_side(self):
        for side in [0,1]:
            rows=[(i/30,hand(bend=40 if 15<=i<=18 else 0,side=side)) for i in range(45)]
            self.assertTrue(local_thumb_evidence(rows)['supported'])
    def test_span_contraction_survives_straight_estimated_joints(self):
        rows=[(i/30,hand(shorten=.6 if 15<=i<=18 else 1)) for i in range(45)]
        self.assertTrue(local_thumb_evidence(rows)['supported'])
    def test_rigid_rotation_translation_scale_do_not_create_motion(self):
        rows=[(i/30,hand(rotate=i*3,scale=1+i/100,offset=i/20)) for i in range(45)]
        self.assertFalse(local_thumb_evidence(rows)['supported'])
    def test_rotation_with_apparent_shortening_or_angle_spike_rejected(self):
        for mode in ['bend','shorten']:
            rows=[]
            for i in range(45):
                active=15<=i<=18
                rows.append((i/30,hand(bend=45 if active and mode=='bend' else 0,shorten=.5 if active and mode=='shorten' else 1,rotate=50 if active else 0)))
            result=local_thumb_evidence(rows);self.assertFalse(result['supported']);self.assertGreater(result['rejectedEvents'],0)
    def test_single_frame_noise_does_not_pass(self):
        for mode in ['bend','shorten']:
            rows=[(i/30,hand(bend=70 if i==15 and mode=='bend' else 0,shorten=.4 if i==15 and mode=='shorten' else 1)) for i in range(45)]
            self.assertFalse(local_thumb_evidence(rows)['supported'])
    def test_missing_hand_and_side_switch_break_evidence(self):
        for rows in [
            [(i/30,hand() if i<15 else None if i<18 else hand(bend=40)) for i in range(45)],
            [(i/30,hand() if i<15 else hand(bend=40,side=1)) for i in range(45)],
            [(i/30 if i<15 else i/30+1,hand(bend=0 if i<15 else 40)) for i in range(45)],
        ]:self.assertFalse(local_thumb_evidence(rows)['supported'])
    def test_later_valid_motion_not_hidden_by_first_ambiguous_event(self):
        rows=[(i/30,hand(bend=45 if 15<=i<=18 or 40<=i<=43 else 0,rotate=50 if 15<=i<=18 else 0)) for i in range(65)]
        result=local_thumb_evidence(rows);self.assertTrue(result['supported']);self.assertGreater(result['rejectedEvents'],0)
    def test_fixed_view_and_uniform_transform_preserve_true_motion(self):
        rows=[(i/30,hand(bend=45 if 15<=i<=18 else 0,rotate=70,scale=3,offset=2)) for i in range(45)]
        self.assertTrue(local_thumb_evidence(rows)['supported'])
    def test_no_hand_degenerate_palm_and_invalid_clock(self):
        self.assertFalse(local_thumb_evidence([(i/30,None) for i in range(45)])['supported'])
        rows=[]
        for i in range(45):
            v=hand(bend=45 if 15<=i<=18 else 0);v[:63].reshape(21,3)[17]=[2,3,0];rows.append((i/30,v))
        self.assertFalse(local_thumb_evidence(rows)['supported'])
        for rows in [[(0,hand()),(0,hand())],[(1,hand()),(.5,hand())],[(float('nan'),hand())]]:
            with self.assertRaises(ValueError):local_thumb_evidence(rows)

if __name__=='__main__':unittest.main()
