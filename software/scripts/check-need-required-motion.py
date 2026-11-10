import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from need_required_motion import NeedRequiredMotion

def frame(scale=1,side=0,shift=0):
    f=np.zeros(153);v=f[side*76:(side+1)*76];p=v[:63].reshape(21,3)
    for i,index in enumerate([5,9,13,17]):p[index]=[i/3,0,1]
    v[65]=.15*scale;v[63:65]=[.5+shift,.4];v[74]=1
    return f

def play(mode='inward',side=0):
    r=NeedRequiredMotion();out=[]
    for i in range(70):
        amount=np.clip((i-15)/20,0,1)
        scale=1-.45*amount if mode=='inward' else .55+.45*amount if mode=='outward' else (1 if i<30 else .55) if mode=='jump' else 1+.02*np.sin(i) if mode=='noise' else 1
        f=frame(scale,side,shift=i*.01 if mode=='translate' else 0)
        out.append(r.push(i/30,f))
    return out

class MotionGateTests(unittest.TestCase):
    def test_smooth_inward_either_hand(self):
        for side in [0,1]:self.assertTrue(any(x['supported'] for x in play(side=side)))
    def test_static_small_noise_reverse_translation_jump(self):
        for mode in ['static','noise','outward','translate','jump']:self.assertFalse(any(x['supported'] for x in play(mode)),mode)
    def test_missing_or_gap_cannot_join_endpoints(self):
        for mode in ['missing','gap']:
            r=NeedRequiredMotion();out=[]
            for i in range(60):
                f=frame(1 if i<30 else .55)
                if mode=='missing' and 25<=i<30:f[:]=0
                out.append(r.push(i/30+(1 if mode=='gap' and i>=30 else 0),f))
            self.assertFalse(any(x['supported'] for x in out))
    def test_evidence_expires_and_no_semantic_word(self):
        r=NeedRequiredMotion()
        for i in range(70):r.push(i/30,frame(1-.45*np.clip((i-15)/20,0,1)))
        for i in range(70,250):out=r.push(i/30,frame(.55))
        self.assertFalse(out['supported']);self.assertNotIn('candidate',out);self.assertFalse(out['productionEligible'])
    def test_held_endpoint_cannot_refresh_old_movement(self):
        r=NeedRequiredMotion()
        for i in range(90):out=r.push(i/30,frame(1-.45*np.clip((i-15)/20,0,1)))
        self.assertFalse(out['supported'])
    def test_causal_prefix_and_input_validation(self):
        a=NeedRequiredMotion();b=NeedRequiredMotion()
        for i in range(35):self.assertEqual(a.push(i/30,frame(1-i/100)),b.push(i/30,frame(1-i/100)))
        with self.assertRaises(ValueError):a.push(0,frame())
    def test_handedness_flip_preserves_spatial_track(self):
        r=NeedRequiredMotion();out=[]
        for i in range(70):out.append(r.push(i/30,frame(1-.45*np.clip((i-15)/20,0,1),side=i%2)))
        self.assertTrue(any(x['supported'] for x in out))
    def test_valid_evidence_survives_brief_exit_but_not_camera_gap(self):
        r=NeedRequiredMotion()
        for i in range(60):out=r.push(i/30,frame(1-.45*np.clip((i-15)/20,0,1)))
        self.assertTrue(out['supported']);self.assertTrue(r.push(2,np.zeros(153))['supported']);self.assertFalse(r.push(4,np.zeros(153))['supported'])
    def test_two_spatially_distinct_static_hands_cannot_exchange_widths(self):
        r=NeedRequiredMotion();out=[]
        for i in range(70):
            f=frame(1,side=i%2,shift=-.2)+frame(.55,side=1-i%2,shift=.2);out.append(r.push(i/30,f))
        self.assertFalse(any(x['supported'] for x in out))
    def test_overlapping_duplicate_detections_do_not_break_established_track(self):
        r=NeedRequiredMotion();out=[]
        for i in range(70):
            scale=1-.45*np.clip((i-15)/20,0,1);f=frame(scale)
            if 10<=i<=50:f+=frame(scale,side=1,shift=.02)
            out.append(r.push(i/30,f))
        self.assertTrue(any(x['supported'] for x in out))

if __name__=='__main__':unittest.main()
