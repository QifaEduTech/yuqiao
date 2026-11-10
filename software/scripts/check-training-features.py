import sys
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from sign_training_features import training_frame,DIMENSIONS,FEATURE_ID
from sign_training_data import CONFIG

def observation(offset=0):
    points=[NS(x=.3+(i%5)*.02+offset,y=.4+(i//5)*.02,z=i*.001) for i in range(21)]
    return NS(multi_hand_landmarks=[NS(landmark=points)],multi_handedness=[NS(classification=[NS(label='Right',score=.95)])])

class FeatureTests(unittest.TestCase):
    def test_protocol_and_dimensions_are_explicit(self):
        value=training_frame(observation(),1/30)
        self.assertEqual(value.shape,(DIMENSIONS,));self.assertEqual(DIMENSIONS,CONFIG['dimensions']);self.assertEqual(FEATURE_ID,CONFIG['featureProtocol']);self.assertTrue(np.isfinite(value).all())
        self.assertEqual(value[74],0);self.assertEqual(value[150],1)
    def test_absolute_wrist_motion_survives_local_normalization(self):
        a=training_frame(observation(),1/30);b=training_frame(observation(.1),1/30)
        np.testing.assert_allclose(a[76:139],b[76:139],atol=1e-5)
        self.assertAlmostEqual(float(b[139]-a[139]),.1,places=5)
    def test_empty_hands_are_preserved_as_masked_background(self):
        value=training_frame(NS(multi_hand_landmarks=None,multi_handedness=None),1/30)
        self.assertEqual(np.count_nonzero(value[:-1]),0);self.assertAlmostEqual(value[-1],1)
    def test_invalid_timing_is_not_silently_accepted(self):
        with self.assertRaises(ValueError):training_frame(observation(),-1)

if __name__=='__main__':unittest.main()
