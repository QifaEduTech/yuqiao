"""Quality rules are technical checks, not semantic recognition or accuracy tests."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
from types import SimpleNamespace as NS

spec=importlib.util.spec_from_file_location('audit_sample_quality',Path(__file__).with_name('audit-sample-quality.py'))
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class QualityTests(unittest.TestCase):
    def test_please_preserves_two_spatial_hands_with_same_anatomical_label(self):
        def hand(x):return NS(landmark=[NS(x=x+(i%4)*.01,y=.4+i*.003,z=0) for i in range(21)])
        obs=NS(multi_hand_landmarks=[hand(.2),hand(.6)],multi_handedness=[NS(label='Left'),NS(label='Left')])
        self.assertEqual(len(audit.spatial_hands(obs,9/16)),2)
        one=[np.r_[np.ones(63),np.zeros(63)]]*30
        result=audit.evaluate('please',0,3,3,[(i/10,True) for i in range(30)],one,30)
        self.assertEqual(result['technicalStatus'],'pilot_checks_passed');self.assertEqual(result['featureBothHandFrames'],0);self.assertEqual(result['bothHandFrames'],30)
        self.assertFalse(result['trainingReady'])
    def test_please_overlapping_detections_do_not_prove_two_hands(self):
        h=NS(landmark=[NS(x=.2+(i%4)*.01,y=.4+i*.003,z=0) for i in range(21)])
        self.assertEqual(len(audit.spatial_hands(NS(multi_hand_landmarks=[h,h]),9/16)),1)
    def test_please_needs_two_hands_but_quality_does_not_prove_invitation(self):
        observations=[(i/10,True) for i in range(30)]
        one=[np.r_[np.ones(63),np.zeros(63)] for _ in range(30)]
        self.assertIn('insufficient_both_hands_visibility',audit.evaluate('please',0,3,3,observations,one)['reasons'])
        result=audit.evaluate('please',0,3,3,observations,[np.ones(126)]*30)
        self.assertEqual(result['technicalStatus'],'pilot_checks_passed')
        self.assertIn('please_lateral_trajectory_and_palm_orientation_require_review',result['warnings'])
        self.assertFalse(result['semanticVerified']);self.assertFalse(result['trainingReady'])
    def test_help_needs_both_hands_but_local_handshape_motion_is_not_wrist_motion(self):
        observations=[(i/10,True) for i in range(30)]
        one_hand=[np.r_[np.ones(63),np.zeros(63)] for _ in range(30)]
        self.assertIn('insufficient_both_hands_visibility',audit.evaluate('help',0,3,3,observations,one_hand)['reasons'])
        both=[np.ones(126) for _ in range(30)]
        result=audit.evaluate('help',0,3,3,observations,both)
        self.assertEqual(result['technicalStatus'],'pilot_checks_passed')
        self.assertIn('help_motion_requires_absolute_wrist_analysis',result['warnings'])
        self.assertFalse(result['trainingReady'])
    def test_long_action_is_not_silently_treated_as_live_window_compatible(self):
        result=audit.evaluate('thanks',0,8,8,[(i/10,True) for i in range(80)],[np.full(126,i%2) for i in range(80)])
        self.assertIn('hand_span_exceeds_current_live_window',result['warnings'])
        self.assertFalse(result['trainingReady'])
    def test_need_requires_visible_hand_but_does_not_claim_trajectory_or_semantics_verified(self):
        absent=audit.evaluate('need',0,3,3,[(i/10,False) for i in range(30)],[])
        self.assertIn('insufficient_hand_samples',absent['reasons'])
        one=[np.r_[np.ones(63),np.zeros(63)] for _ in range(30)]
        result=audit.evaluate('need',0,3,3,[(i/10,True) for i in range(30)],one)
        self.assertNotIn('insufficient_both_hands_visibility',result['reasons'])
        self.assertIn('need_inward_trajectory_requires_review',result['warnings'])
        self.assertFalse(result['semanticVerified']);self.assertFalse(result['trainingReady'])
    def test_me_single_hand_hold_not_forced_to_move_or_use_two_hands(self):
        frames=[np.r_[np.ones(63),np.zeros(63)] for _ in range(30)]
        r=audit.evaluate('me',0,1,1,[(i/30,True) for i in range(30)],frames)
        self.assertEqual(r['technicalStatus'],'pilot_checks_passed');self.assertFalse(r['semanticVerified']);self.assertFalse(r['trainingReady']);self.assertIn('me_self_direction_requires_body_reference_review',r['warnings'])
        absent=audit.evaluate('me',0,1,1,[(i/30,False) for i in range(30)],[]);self.assertIn('insufficient_hand_samples',absent['reasons'])
    def test_no_hand_background_is_useful_but_not_a_positive(self):
        obs=[(i/10,False) for i in range(30)]
        self.assertEqual(audit.evaluate('background',0,3,3,obs,[])['technicalStatus'],'pilot_checks_passed')
        positive=audit.evaluate('thanks',0,3,3,obs,[])
        self.assertIn('insufficient_hand_samples',positive['reasons'])
        self.assertFalse(positive['trainingReady'])
    def test_out_of_bounds_and_uncertain_never_pass(self):
        self.assertIn('annotation_outside_decoded_duration',audit.evaluate('background',0,4,3,[(0,False)],[])['reasons'])
        self.assertIn('uncertain_label_excluded',audit.evaluate('uncertain',0,3,3,[(0,False)],[])['reasons'])
    def test_background_with_hands_is_not_claimed_to_be_empty(self):
        result=audit.evaluate('background',0,3,3,[(i/10,True) for i in range(30)],[np.full(126,i%2) for i in range(30)])
        self.assertEqual(result['technicalStatus'],'pilot_checks_passed')
        self.assertFalse(result['backgroundWithNoHands'])
    def test_still_and_internal_losses_require_review(self):
        obs=[(i/10,True) for i in range(30)]
        self.assertIn('little_feature_motion',audit.evaluate('thanks',0,3,3,obs,[np.ones(126)]*30)['reasons'])
        obs=[(i/10,i<10 or i>22) for i in range(30)]
        self.assertIn('long_internal_tracking_gap',audit.evaluate('thanks',0,3,3,obs,[np.full(126,i%2) for i in range(17)])['reasons'])
    def test_temporal_features_pass_only_technical_rules(self):
        result=audit.evaluate('thanks',0,3,3,[(i/10,True) for i in range(30)],[np.full(126,i%2) for i in range(30)])
        self.assertEqual(result['technicalStatus'],'pilot_checks_passed')
        self.assertFalse(result['semanticVerified']);self.assertFalse(result['trainingReady'])

if __name__=='__main__':unittest.main()
