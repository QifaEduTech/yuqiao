import sys
import unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from sign_temporal import pack_sequence,WholeActionBuffer,PROTOCOL


class TemporalTests(unittest.TestCase):
    def test_whole_long_action_keeps_both_ends_and_has_30_positions(self):
        timeline=[(i/10,np.full(126,i%3/2)) for i in range(81)]
        result=pack_sequence(timeline)
        self.assertEqual(result['tensor'].shape,(30,126));self.assertEqual(result['start'],0);self.assertEqual(result['end'],8)
        np.testing.assert_array_equal(result['tensor'][0],timeline[0][1]);np.testing.assert_array_equal(result['tensor'][-1],timeline[-1][1])
    def test_elapsed_time_sampling_is_not_frame_index_sampling(self):
        timeline=[(0,np.full(126,1)),(.01,np.full(126,2)),(.02,np.full(126,3)),(.9,np.full(126,4)),(1,np.full(126,5))]
        result=pack_sequence(timeline)
        # The large unobserved gap must not be filled with an invented gesture.
        self.assertFalse(result['observed'][15]);self.assertTrue(np.all(result['tensor'][15]==0))
        self.assertEqual(result['selectedTimes'][15],.9)
    def test_missing_hand_slot_and_internal_tracking_loss_are_preserved(self):
        value=np.concatenate([np.ones(63),np.zeros(63)])
        timeline=[(i/10,None if 8<=i<=17 else value) for i in range(30)]
        result=pack_sequence(timeline)
        self.assertIn('tracking_gap',result['reasons']);self.assertFalse(result['observed'][10]);self.assertTrue(result['handMask'][0,0]);self.assertFalse(result['handMask'][:,1].any())
    def test_offline_and_incremental_producers_get_identical_tensors(self):
        for duration in [3,8]:
            timeline=[(i/10,np.full(126,i%2)) for i in range(duration*10+1)]
            buffer=WholeActionBuffer()
            for t,v in timeline:buffer.push(t,v)
            expected=pack_sequence(timeline);actual=buffer.finish()
            np.testing.assert_array_equal(actual['tensor'],expected['tensor']);np.testing.assert_array_equal(actual['observed'],expected['observed'])
    def test_uniform_time_scaling_retains_sequence_order(self):
        timeline=[(i/10,np.full(126,i%3)) for i in range(30)]
        np.testing.assert_array_equal(pack_sequence(timeline)['tensor'],pack_sequence([(t*2,v) for t,v in timeline])['tensor'])
    def test_capacity_and_duration_never_silently_truncate(self):
        for count,step,reason in [(170,.01,'sample_capacity_exceeded'),(140,.1,'action_duration_exceeded')]:
            buffer=WholeActionBuffer()
            for i in range(count):buffer.push(i*step,np.full(126,i%2))
            with self.assertRaisesRegex(ValueError,reason):buffer.finish()
            self.assertEqual(buffer.samples[0][0],0);self.assertLessEqual(len(buffer.samples),PROTOCOL['maxBufferedSamples'])
    def test_capture_gap_and_reversed_times_are_rejected(self):
        for time,reason in [(2,'capture_gap'),(0,'invalid_timestamp_order')]:
            buffer=WholeActionBuffer();buffer.push(0,np.ones(126));buffer.push(time,np.ones(126))
            with self.assertRaisesRegex(ValueError,reason):buffer.finish()
            with self.assertRaisesRegex(ValueError,reason):pack_sequence([(0,np.ones(126)),(time,np.ones(126))])
    def test_empty_background_is_not_eligible_for_word_classification(self):
        result=pack_sequence([(i/10,None) for i in range(30)])
        self.assertFalse(result['eligible']);self.assertFalse(result['observed'].any());self.assertTrue(np.all(result['tensor']==0))

if __name__=='__main__':unittest.main()
