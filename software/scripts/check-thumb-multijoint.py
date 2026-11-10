import sys
from pathlib import Path
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from thumb_multijoint import multijoint_evidence,thumb_span_ratio
from thumb_motion import flexion_evidence

def hand(cmc=0,mcp=0,ip=0,side=0,rotation=None,offset=None):
    points=np.zeros((21,3));points[1]=[0,1,0];points[9]=[2,2,0]
    angle=0
    for index,amount in zip([2,3,4],[cmc,mcp,ip]):
        angle+=np.radians(amount);points[index]=points[index-1]+[np.sin(angle),np.cos(angle),0]
    if rotation is not None:points=points@rotation.T
    if offset is not None:points+=offset
    slots=np.zeros((2,63));slots[side]=points.reshape(-1);return slots.reshape(-1)

class MultiJointTests(unittest.TestCase):
    def test_each_joint_can_supply_evidence_without_a_fixed_bend_count(self):
        for joint in ['cmc','mcp','ip']:
            for side in [0,1]:
                timeline=[(i/30,hand(side=side,**{joint:10 if i==14 else 40 if i==15 else 0})) for i in range(30)]
                result=multijoint_evidence(timeline);self.assertTrue(result['supported']);self.assertIn(joint,[e['joint'].replace('_proxy','') for e in result['evidence']])
    def test_root_motion_does_not_require_distal_bend(self):
        timeline=[(i/30,hand(cmc=40 if i in [15,16] else 0)) for i in range(30)]
        self.assertFalse(flexion_evidence(timeline)['supported']);self.assertTrue(multijoint_evidence(timeline)['supported'])
    def test_rigid_movement_or_constant_bent_hold_is_not_new_articulation(self):
        for held in [0,40]:
            timeline=[]
            for i in range(30):
                a=i/9;rotation=np.array([[np.cos(a),0,np.sin(a)],[0,1,0],[-np.sin(a),0,np.cos(a)]])
                timeline.append((i/30,hand(cmc=held,mcp=held,ip=held,rotation=rotation,offset=[i/10,2,1])))
            self.assertFalse(multijoint_evidence(timeline)['supported'])
    def test_spikes_cannot_borrow_support_from_another_joint(self):
        timeline=[(i/30,hand(cmc=50 if i==15 else 0,mcp=50 if i==16 else 0)) for i in range(30)]
        self.assertFalse(multijoint_evidence(timeline)['supported'])
    def test_gaps_and_handedness_switches_do_not_join_baselines(self):
        for timeline in [
            [(i/30,hand() if i<12 else None if i<15 else hand(cmc=40)) for i in range(40)],
            [(i/30,hand(side=0) if i<15 else hand(cmc=40,side=1)) for i in range(40)],
        ]:self.assertFalse(multijoint_evidence(timeline)['supported'])
    def test_no_hands_and_invalid_timing(self):
        self.assertFalse(multijoint_evidence([(i/30,None) for i in range(30)])['supported'])
        with self.assertRaises(ValueError):multijoint_evidence([(1,hand()),(0,hand())])
    def test_observed_shortening_can_survive_straight_estimated_joint_angles(self):
        timeline=[]
        for i in range(30):
            value=hand();points=value[:63].reshape(21,3)
            if i in [15,16]:points[3:5]=points[2]+(points[3:5]-points[2])*.6
            timeline.append((i/30,value))
        self.assertFalse(flexion_evidence(timeline)['supported'])
        result=multijoint_evidence(timeline);self.assertTrue(result['supported']);self.assertIn('thumb_span',[v['joint'] for v in result['evidence']])
    def test_uniform_scale_and_single_shortening_spike_do_not_pass(self):
        self.assertAlmostEqual(thumb_span_ratio(hand()*3,0),thumb_span_ratio(hand(),0))
        scaled=[(i/30,hand()*(.5 if i in [15,16] else 1)) for i in range(30)]
        single=[]
        for i in range(30):
            value=hand();points=value[:63].reshape(21,3)
            if i==15:points[3:5]=points[2]+(points[3:5]-points[2])*.5
            single.append((i/30,value))
        for timeline in [scaled,single]:self.assertFalse(multijoint_evidence(timeline)['supported'])

if __name__=='__main__':unittest.main()
