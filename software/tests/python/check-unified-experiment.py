"""Leakage, refusal and event-boundary checks for the isolated experiment."""
from pathlib import Path
import sys
import unittest
import numpy as np
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'server'))
from unified_runtime import UnifiedStream,UnifiedTCN,quality,metrics


class Fixed:
    def __init__(self): self.label=1
    def classify(self,frames): return self.label


class Checks(unittest.TestCase):
    def setUp(self):
        self.model=Fixed();self.stream=UnifiedStream(self.model)
        self.frame=np.zeros(178,np.float32);self.frame[74]=self.frame[177]=1

    def active(self,start=0):
        return [self.stream.push(start+i/30,self.frame) for i in range(45)]

    def finish(self,start=1.5):
        return [self.stream.push(start+i/30,np.zeros(178)) for i in range(30)]

    def test_no_eof_completion(self):
        self.assertFalse(any(r['event'] for r in self.active()))

    def test_actual_end_single_event(self):
        self.active();r=self.finish()
        self.assertEqual([v['event']['label'] for v in r if v['event']],[1])

    def test_hold_not_repeated(self):
        self.active()
        r=[self.stream.push(1.5+i/30,self.frame) for i in range(90)]
        self.assertFalse(any(v['event'] for v in r))

    def test_separate_repeat_allowed(self):
        self.active();first=self.finish();self.active(2.5);second=self.finish(4)
        self.assertEqual(sum(bool(v['event']) for v in first+second),2)

    def test_gap_drops_old_evidence(self):
        self.active();r=[self.stream.push(3+i/30,np.zeros(178)) for i in range(30)]
        self.assertFalse(any(v['event'] for v in r))

    def test_short_occlusion_keeps_missing_mask(self):
        self.active()
        self.stream.push(1.5,np.zeros(178))
        self.assertEqual(self.stream.frames[-1][1][74],0)
        self.assertEqual(self.stream.proposed,0)

    def test_conflicting_words_rejected(self):
        self.active();self.model.label=2
        for i in range(30):self.stream.push(1.5+i/30,self.frame)
        self.assertFalse(any(v['event'] for v in self.finish(2.5)))

    def test_quality_requires_body_and_hand(self):
        self.assertFalse(quality(np.zeros((30,178)))['passed'])
        x=np.tile(self.frame,(30,1));self.assertTrue(quality(x)['passed'])
        x[:,177]=0;self.assertFalse(quality(x)['passed'])

    def test_nonfinite_and_out_of_order(self):
        self.stream.push(1,self.frame)
        with self.assertRaises(ValueError):self.stream.push(1,self.frame)
        x=self.frame.copy();x[0]=np.nan
        with self.assertRaises(ValueError):self.stream.push(2,x)

    def test_precision_is_tp_over_outputs(self):
        r=metrics([1,1,2,0],[1,0,1,1])
        self.assertEqual(r['perClass']['thanks']['precision'],1/3)
        self.assertEqual(r['perClass']['thanks']['recall'],.5)
        self.assertEqual(r['unknownFalsePositiveRate'],1)

    def test_invalid_weights_rejected(self):
        with self.assertRaises(ValueError):UnifiedTCN(arrays={})


if __name__=='__main__':unittest.main()
