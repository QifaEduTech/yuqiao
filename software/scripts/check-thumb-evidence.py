"""Geometric invariance and failure-path checks, not an accuracy estimate."""
import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from thumb_motion import frame_angles,flexion_evidence

def hand(bend=0,side=0,rotation=None,scale=1,offset=None):
    points=np.zeros((21,3),float)
    points[1]=[0,1,0];points[2]=[0,2,0];points[3]=[0,3,0]
    angle=np.radians(bend);points[4]=[np.sin(angle),3+np.cos(angle),0];points[9]=[1,2,0]
    if rotation is not None:points=points@rotation.T
    points=points*scale
    if offset is not None:points+=offset
    slots=np.zeros((2,63));slots[side]=points.reshape(-1)
    return slots.reshape(-1)

class ThumbTests(unittest.TestCase):
    def test_ip_angle_recovers_known_bend_and_is_rigid_transform_invariant(self):
        angle=.7;rotation=np.array([[np.cos(angle),-np.sin(angle),0],[np.sin(angle),np.cos(angle),0],[0,0,1]])
        plain=frame_angles(hand(45),0);moved=frame_angles(hand(45,rotation=rotation,scale=3,offset=[2,3,5]),0)
        self.assertAlmostEqual(plain[2],45);np.testing.assert_allclose(plain,moved,atol=1e-5)
    def test_supported_single_bend_on_either_hand_is_enough(self):
        for side in [0,1]:
            timeline=[(i/30,hand(45 if i in [15,16] else 0,side)) for i in range(30)]
            self.assertTrue(flexion_evidence(timeline)['supported'])
    def test_whole_hand_rotation_and_translation_do_not_create_flexion(self):
        timeline=[]
        for i in range(30):
            a=i/10;rotation=np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
            timeline.append((i/30,hand(0,rotation=rotation,offset=[i/5,0,0])))
        self.assertFalse(flexion_evidence(timeline)['supported'])
    def test_one_tracking_spike_is_not_sustained_evidence(self):
        timeline=[(i/30,hand(60 if i==15 else 0)) for i in range(30)]
        self.assertFalse(flexion_evidence(timeline)['supported'])
    def test_narrow_peak_with_a_smaller_neighbor_is_preserved(self):
        timeline=[(i/30,hand(10 if i==14 else 40 if i==15 else 0)) for i in range(30)]
        self.assertTrue(flexion_evidence(timeline)['supported'])
    def test_small_jitter_and_already_bent_hold_are_not_new_bends(self):
        for angles in [[5+i%3 for i in range(30)],[40]*30]:
            self.assertFalse(flexion_evidence([(i/30,hand(a)) for i,a in enumerate(angles)])['supported'])
    def test_tracking_loss_and_side_switch_cannot_join_unrelated_poses(self):
        missing=[(i/30,hand(0) if i<12 else None if i<15 else hand(45)) for i in range(40)]
        switched=[(i/30,hand(0,0) if i<15 else hand(45,1)) for i in range(40)]
        for timeline in [missing,switched]:self.assertFalse(flexion_evidence(timeline)['supported'])
    def test_no_hands_degenerate_features_and_reversed_time(self):
        self.assertFalse(flexion_evidence([(i/30,None) for i in range(30)])['supported'])
        self.assertIsNone(frame_angles(np.zeros(126),0))
        with self.assertRaises(ValueError):flexion_evidence([(1,hand()),(.5,hand())])

if __name__=='__main__':unittest.main()
