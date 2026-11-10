import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from need_directional_features import directional_features

def frames(reverse=False):
    a=np.zeros((40,153),np.float32)
    for i in range(40):
        a[i,5*3]=-.5;a[i,17*3]=.5;a[i,5*3+2]=a[i,17*3+2]=1;a[i,65]=.1*(1+i/40 if reverse else 2-i/40);a[i,74]=1
    return a

class DirectionTests(unittest.TestCase):
    def test_direction_and_stationary(self):
        t=np.arange(40)/30
        self.assertLess(directional_features(frames(),t,9/16)[-1,156],0)
        self.assertGreater(directional_features(frames(True),t,9/16)[-1,156],0)
        fixed=np.repeat(frames()[:1],40,axis=0);out=directional_features(fixed,t,9/16);self.assertTrue(np.allclose(out[:,155:160],0))
    def test_causal_prefix_and_no_mutation(self):
        x=frames();copy=x.copy();t=np.arange(40)/30
        full=directional_features(x,t,9/16);short=directional_features(x[:20],t[:20],9/16);np.testing.assert_array_equal(full[:20],short);np.testing.assert_array_equal(x,copy)
    def test_missing_and_gap_reset(self):
        x=frames();x[15:20]=0;t=np.arange(40)/30;out=directional_features(x,t,9/16);self.assertTrue(np.all(out[15:20,153:]==0));self.assertEqual(out[20,160],0)
        t[20:]+=1;out=directional_features(frames(),t,9/16);self.assertEqual(out[20,160],0)
    def test_invalid_input(self):
        with self.assertRaises(ValueError):directional_features(frames(),np.zeros(40),9/16)

if __name__=='__main__':unittest.main()
