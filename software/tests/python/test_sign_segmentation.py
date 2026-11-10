import sys
import unittest
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'server'))
from sign_segmentation import split_timeline, recognize_segments
from sign_worker import decision, hand_interval


def samples(parts):
    result = []
    for count, label in parts:
        for _ in range(count):
            result.append({'t': len(result)/15, 'rest': label is None,
                           'value': None if label is None else np.full(126, label, np.float32)})
    return result, len(result)/15


def classify(sequence):
    scores = np.zeros(10, np.float32)
    scores[int(sequence[0, 0])] = .98
    return scores


class SegmentationTest(unittest.TestCase):
    def run_parts(self, parts):
        timeline, duration = samples(parts)
        return recognize_segments(timeline, duration, classify, decision, hand_interval)

    def test_order_and_repeated_words(self):
        r = self.run_parts([(15, None), (30, 0), (15, None), (30, 4), (15, None), (30, 0), (15, None)])
        self.assertEqual(r['text'], '你好，谢谢，你好')
        self.assertEqual([s['index'] for s in r['segments']], [1, 2, 3])
        self.assertEqual(r['status'], 'complete')

    def test_short_dropout_does_not_create_boundary(self):
        timeline, duration = samples([(20, 0), (5, None), (20, 0)])
        self.assertEqual(len(split_timeline(timeline, duration)), 1)
        r = self.run_parts([(20, 0), (5, None), (20, 0)])
        self.assertEqual(r['status'], 'partial')
        self.assertEqual(r['text'], '')

    def test_unknown_and_short_segments_are_not_skipped(self):
        for middle in [(30, 3), (4, 4)]:
            r = self.run_parts([(30, 0), (15, None), middle, (15, None), (30, 1)])
            self.assertEqual(len(r['segments']), 3)
            self.assertIsNone(r['segments'][1]['candidate'])
            self.assertEqual(r['text'], '')
            self.assertEqual(r['unresolved_count'], 1)

    def test_no_hands_and_low_rest(self):
        r = self.run_parts([(60, None)])
        self.assertEqual(r['status'], 'no_hands')
        timeline, duration = samples([(30, 0), (15, 0), (30, 1)])
        for sample in timeline[30:45]:
            sample['rest'] = True
        self.assertEqual(len(split_timeline(timeline, duration)), 2)

    def test_limits_and_invalid_time(self):
        timeline, duration = samples([(10, 0), (15, None)]*11)
        with self.assertRaises(ValueError):
            split_timeline(timeline, duration)
        timeline, duration = samples([(30, 0)])
        timeline[1]['t'] = timeline[0]['t']
        with self.assertRaises(ValueError):
            split_timeline(timeline, duration)

    def test_long_unseparated_action_remains_uncertain(self):
        r = self.run_parts([(160, 0), (15, None), (30, 1)])
        self.assertEqual(r['status'], 'partial')
        self.assertIsNone(r['segments'][0]['candidate'])


if __name__ == '__main__':
    unittest.main()
