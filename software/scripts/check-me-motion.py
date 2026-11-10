"""Check invariance, missing evidence and temporal boundaries for offline probe."""
import sys, unittest
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'server'))
from me_motion import frame_evidence, inspect_me_motion

def fixture():
    """Index finger points down-inward at the chest reference below the shoulders."""
    h = np.zeros((21, 3))
    h[0] = [.24, .30, 0]
    h[5:9] = [[.30, .32, 0], [.36, .34, 0], [.40, .355, 0], [.44, .37, 0]]
    for i in (9, 13, 17):
        y = .25 + .01 * (i - 9)
        h[i:i+4] = [[.30, y, 0], [.32, y - .005, 0], [.33, y - .025, 0], [.325, y - .04, 0]]
    return h, np.array([[.30, .22, 1], [.70, .22, 1]])

class Checks(unittest.TestCase):
    def test_finite_support_not_one_frame(self):
        h, b = fixture()
        self.assertTrue(frame_evidence([h], b)['supported'])
        self.assertFalse(inspect_me_motion([(0, [h], b)])['supported'])
        self.assertTrue(inspect_me_motion([(i*.04, [h], b) for i in range(6)])['supported'])

    def test_shared_translation_scale_mirror(self):
        h, b = fixture()
        for scale in (.75, 1.2):
            for sign in (-1, 1):
                hh, bb = h.copy(), b.copy()
                hh[:, :2] = hh[:, :2] * scale + [.1, .05]
                hh[:, 2] *= scale
                bb[:, :2] = bb[:, :2] * scale + [.1, .05]
                hh[:, 0] *= sign; bb[:, 0] *= sign
                self.assertTrue(frame_evidence([hh], bb)['supported'])

    def test_pointing_away_and_fist(self):
        h, b = fixture()
        away = h.copy(); away[5:9, 0] = [.30, .25, .20, .14]
        self.assertFalse(frame_evidence([away], b)['supported'])
        fist = h.copy(); fist[8] = [.31, .33, 0]
        self.assertFalse(frame_evidence([fist], b)['supported'])

    def test_upward_point_is_not_toward_chest(self):
        h, b = fixture()
        # Fingertip travels up from chest height: the old shoulder-midpoint
        # proxy accepted this, the chest reference must not.
        up = h.copy()
        up[5:9] = [[.34, .34, 0], [.36, .30, 0], [.38, .25, 0], [.40, .20, 0]]
        self.assertFalse(frame_evidence([up], b)['supported'])
        center = b[:, :2].mean(axis=0)
        direction = up[8, :2] - up[5, :2]
        target = center - up[5, :2]
        legacy = float(np.dot(direction, target) / (np.linalg.norm(direction) * np.linalg.norm(target)))
        self.assertGreater(legacy, .55)

    def test_foreshortened_receding_index_requires_chest_and_depth_direction(self):
        h,b=fixture()
        h[5:9]=[[.30,.32,0],[.32,.32,-.025],[.34,.32,.05],[.34,.34,.12]]
        result=frame_evidence([h],b)
        self.assertTrue(result['supported']);self.assertFalse(result['indexExtended']);self.assertTrue(result['recedingIndex'])
        toward_camera=h.copy();toward_camera[:,2]*=-1
        self.assertFalse(frame_evidence([toward_camera],b)['supported'])
        pointing_away=h.copy();pointing_away[8,0]=.26
        self.assertFalse(frame_evidence([pointing_away],b)['supported'])
        self.assertFalse(frame_evidence([h],[])['supported'])

    def test_open_palm_not_pointing(self):
        h, b = fixture()
        for i in (9, 13, 17):
            h[i:i+4, 0] = [.30, .35, .40, .46]
            h[i:i+4, 1] = .25 + .01*(i-9)
        self.assertFalse(frame_evidence([h], b)['supported'])

    def test_missing_body_or_hand_breaks_run(self):
        h, b = fixture()
        for middle in (([], b), ([h], [])):
            timeline = [(i*.04, [h], b) for i in range(7)]
            timeline[3] = (.12, *middle)
            self.assertFalse(inspect_me_motion(timeline)['supported'])

    def test_time_gap_and_ambiguous_hands(self):
        h, b = fixture()
        self.assertFalse(inspect_me_motion([(i*.2, [h], b) for i in range(8)])['supported'])
        self.assertFalse(frame_evidence([h, h], b)['supported'])
        with self.assertRaises(ValueError):
            inspect_me_motion([(0, [h], b), (0, [h], b)])

    def test_invalid_reference_never_supported(self):
        h, b = fixture()
        for bad in ([], [[.3, .2, .2], [.7, .2, .2]], [[.3, .2, 1], [.3, .2, 1]], [[float('nan'), .2, 1], [.7, .2, 1]]):
            self.assertFalse(frame_evidence([h], bad)['supported'])
        h[8, 0] = float('nan')
        self.assertFalse(frame_evidence([h], b)['supported'])

if __name__ == '__main__':
    unittest.main()
