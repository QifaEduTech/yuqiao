import unittest,sys
from pathlib import Path
from types import SimpleNamespace as N
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from hand_overlay import hand_overlay

def observed(count=1):
    return N(multi_hand_landmarks=[N(landmark=[N(x=.2,y=.7) for _ in range(21)]) for _ in range(count)],multi_handedness=[N(classification=[N(label='Left')]) for _ in range(count)])

class OverlayTests(unittest.TestCase):
    def test_same_tracker_coordinates_not_mirrored_twice(self):
        result=hand_overlay(observed(),640,360)
        self.assertEqual(result['hands'][0]['points'][0],[.2,.7]);self.assertTrue(result['mirrored']);self.assertEqual(len(result['hands'][0]['points']),21)
    def test_no_hands_and_limits(self):
        self.assertEqual(hand_overlay(N(multi_hand_landmarks=None,multi_handedness=None),640,360)['hands'],[])
        self.assertEqual(len(hand_overlay(observed(3),640,360)['hands']),2)
    def test_invalid_points_or_labels_are_omitted(self):
        for x in [float('nan'),float('inf'),3]:
            item=observed();item.multi_hand_landmarks[0].landmark[0].x=x
            self.assertEqual(hand_overlay(item,640,360)['hands'],[])
        item=observed();item.multi_hand_landmarks[0].landmark.pop();self.assertEqual(hand_overlay(item,640,360)['hands'],[])
        item=observed();item.multi_handedness[0].classification[0].label='Unknown';self.assertEqual(hand_overlay(item,640,360)['hands'],[])

if __name__=='__main__':unittest.main()
