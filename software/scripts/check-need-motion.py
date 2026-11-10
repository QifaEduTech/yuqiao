import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from need_motion import inspect_need_motion

def hand(scale,side='Left',angle=0):
    h=np.zeros((21,3));h[5]=[-.5,0,1];h[17]=[.5,0,1];h[9]=[0,0,1]
    if side=='Left':h[:,0]*=-1
    a=np.radians(angle);matrix=np.array([[1,0,0],[0,np.cos(a),-np.sin(a)],[0,np.sin(a),np.cos(a)]])
    return h@matrix.T*scale*.15+[.5,.4,0]

def rows(mode='inward',side='Left'):
    result=[]
    for i in range(60):
        t=i/30;s=1-.45*i/59 if mode not in ['static','spike','outward'] else 1+.45*i/59 if mode=='outward' else .5 if mode=='spike' and i==30 else 1
        result.append((t,{} if mode=='gap' and 15<=i<=45 else {side:hand(s,side,60*i/59 if mode=='rotate' else 0)}))
    return result

class NeedProjectionTests(unittest.TestCase):
    def test_inward_both_sides(self):
        for side in ['Left','Right']:self.assertTrue(inspect_need_motion(rows(side=side))['supported'])
    def test_static_outward_and_single_spike(self):
        for mode in ['static','outward','spike']:self.assertFalse(inspect_need_motion(rows(mode))['supported'],mode)
    def test_missing_tracking_does_not_connect_endpoints(self):self.assertFalse(inspect_need_motion(rows('gap'))['supported'])
    def test_rotation_not_treated_as_pure_inward_translation(self):self.assertFalse(inspect_need_motion(rows('rotate'))['supported'])
    def test_empty_invalid_time_and_scope(self):
        r=inspect_need_motion([]);self.assertFalse(r['supported']);self.assertFalse(r['productionEligible']);self.assertNotIn('candidate',r)
        with self.assertRaises(ValueError):inspect_need_motion([(1,{}),(1,{})])

if __name__=='__main__':unittest.main()
