"""Deterministic time-window checks; synthetic features are not accuracy evidence."""
import sys
import unittest
import csv
import json
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from realtime_window import LiveWindow,CONFIG
from realtime_events import LiveRecognizer
from sign_worker import classifier,predict,EXPECTED_LABELS

def target(sequence):
    assert sequence.shape==(30,126)
    scores=np.full(10,.001);scores[4]=.99;return scores

# Legacy classifier/event tests isolate their synthetic non-anatomical vectors.
# The default production motion gate is exercised separately below.
def no_motion_gate(timeline,t):
    values=np.asarray([v for _,v in timeline if v is not None])
    return len(values)>1 and float(np.mean(np.abs(np.diff(values,axis=0))))>=CONFIG['minFeatureMotion']

class LiveWindowTests(unittest.TestCase):
    def test_empty_frames_never_produce_words(self):
        window=LiveWindow(lambda _:self.fail('No hands must not invoke classifier'))
        for i in range(600):
            result=window.push(i/10,None);self.assertIsNone(result['candidate']);self.assertLessEqual(result['samples'],CONFIG['maxSamples'])
    def test_still_handshape_not_dynamic_sign(self):
        window=LiveWindow(lambda _:self.fail('Static input must not invoke classifier'))
        for i in range(70):self.assertIsNone(window.push(i/10,np.ones(126))['candidate'])
    def test_only_target_top_class_may_be_candidate(self):
        window=LiveWindow(target,motion_gate=no_motion_gate)
        for i in range(35):result=window.push(i/10,np.full(126,.3 if i%2 else .8))
        self.assertEqual(result['candidate'],'谢谢')
        def other(_):
            s=np.full(10,.001);s[0]=.99;return s
        window=LiveWindow(other,motion_gate=no_motion_gate)
        for i in range(35):result=window.push(i/10,np.full(126,.3 if i%2 else .8))
        self.assertIsNone(result['candidate']);self.assertEqual(result['status'],'uncertain')
    def test_missing_frame_and_long_time_gap_clear_candidate(self):
        window=LiveWindow(target,motion_gate=no_motion_gate)
        for i in range(35):window.push(i/10,np.full(126,.3 if i%2 else .8))
        self.assertIsNone(window.push(3.5,None)['candidate'])
        result=window.push(6,np.ones(126));self.assertEqual(result['samples'],1);self.assertIsNone(result['candidate'])
        with self.assertRaises(ValueError):window.push(5,np.ones(126))
    def test_window_cannot_grow_without_bound(self):
        window=LiveWindow(target,motion_gate=no_motion_gate)
        for i in range(2000):
            result=window.push(i/100,np.full(126,.3 if i%2 else .8));self.assertLessEqual(result['samples'],CONFIG['maxSamples'])
    def test_partial_motion_needs_enough_time_and_samples(self):
        window=LiveWindow(lambda _:self.fail('Short input must not invoke classifier'))
        for i in range(11):self.assertIsNone(window.push(i/10,np.full(126,.3 if i%2 else .8))['candidate'])
    def test_upstream_reference_compatibility(self):
        root=Path(__file__).resolve().parents[1]
        source=root/'.runtime-logs/sign-source/dynamic_gesture_dataset.csv'
        if not source.exists():self.skipTest('Upstream development CSV not present; no download performed')
        model=classifier();reports=[]
        with source.open(encoding='utf-8-sig') as f:
            for row in csv.reader(f):
                if float(row[0])!=EXPECTED_LABELS.index(CONFIG['targetText']):continue
                seq=np.array(row[1:],np.float32).reshape(30,126)
                window=LiveRecognizer(lambda s:predict(*model,s),motion_gate=no_motion_gate)
                outputs=[window.push(i/10,v) for i,v in enumerate(seq)]
                outputs += [window.push(3+i/10,None) for i in range(10)]
                reports.append({'meanFeatureMotion':float(np.mean(abs(np.diff(seq,axis=0)))),'candidateSeen':any(r['candidate']==CONFIG['targetText'] for r in outputs),'eventsAfterSyntheticBoundary':sum(r['event'] is not None for r in outputs)})
                if len(reports)==3:break
        self.assertEqual(len(reports),3)
        self.assertTrue(all(r['candidateSeen'] for r in reports))
        self.assertTrue(all(r['eventsAfterSyntheticBoundary']==1 for r in reports))
        (root/'.runtime-logs/realtime-reference-check.json').write_text(json.dumps({'scope':'Legacy classifier/event compatibility only; motion gate bypassed for these historical fixtures, not live accuracy','references':reports},indent=2),encoding='utf8')

class LiveEventTests(unittest.TestCase):
    def run_frames(self, recognizer, start, count, hands=True, moving=True):
        return [recognizer.push(round(start+i/10, 3),
                np.full(126,.3 if i%2 else .8) if hands and moving else np.ones(126) if hands else None)
                for i in range(count)]

    def test_stable_action_emits_only_after_observed_end_and_repeats(self):
        r=LiveRecognizer(target,motion_gate=no_motion_gate)
        action=self.run_frames(r,0,35)
        self.assertTrue(any(x['eventState']=='ready_to_finish' for x in action))
        self.assertTrue(all(x['event'] is None for x in action))
        ended=self.run_frames(r,3.5,15,hands=False)
        first=[x['event'] for x in ended if x['event']]
        self.assertEqual([x['id'] for x in first],[1])
        again=self.run_frames(r,5,35)+self.run_frames(r,8.5,15,hands=False)
        self.assertEqual([x['event']['id'] for x in again if x['event']],[2])
        self.assertGreater(next(x['event']['startMs'] for x in again if x['event']),first[0]['endMs'])

    def test_cached_candidate_is_not_fresh_consensus(self):
        r=LiveRecognizer(target,motion_gate=no_motion_gate)
        self.run_frames(r,0,14)
        self.assertEqual(r.support_count,1)
        self.assertFalse(r.qualified)
        outputs=self.run_frames(r,1.4,10,hands=False)
        self.assertTrue(all(x['event'] is None for x in outputs))

    def test_brief_loss_never_duplicates_and_old_still_pose_expires(self):
        r=LiveRecognizer(target,motion_gate=no_motion_gate)
        self.run_frames(r,0,35)
        loss=self.run_frames(r,3.5,3,hands=False)
        self.assertTrue(all(x['event'] is None for x in loss))
        held=self.run_frames(r,3.8,65,moving=False)+self.run_frames(r,10.3,10,hands=False)
        self.assertTrue(all(x['event'] is None for x in held))

    def test_gap_cannot_commit_or_reuse_previous_segment(self):
        r=LiveRecognizer(target,motion_gate=no_motion_gate)
        self.run_frames(r,0,35)
        outputs=self.run_frames(r,6,10,hands=False)
        self.assertTrue(all(x['event'] is None for x in outputs))
        self.assertIsNone(r.push(7,np.ones(126))['event'])
        self.assertFalse(r.qualified)

    def test_rejection_after_consensus_revokes_event(self):
        scores=np.full(10,.001)
        scores[4]=.99
        r=LiveRecognizer(lambda _:scores,motion_gate=no_motion_gate)
        self.run_frames(r,0,35)
        scores[4]=.001;scores[0]=.99
        outputs=self.run_frames(r,3.5,10)+self.run_frames(r,4.5,10,hands=False)
        self.assertTrue(all(x['event'] is None for x in outputs))

    def test_long_motion_requires_boundary_and_background_has_no_event(self):
        r=LiveRecognizer(target,motion_gate=no_motion_gate)
        outputs=self.run_frames(r,0,130)
        self.assertEqual(outputs[-1]['eventState'],'reset_required')
        self.assertTrue(all(x['event'] is None for x in outputs+self.run_frames(r,13,10,hands=False)))
        background=LiveRecognizer(lambda _:self.fail('Background must not classify'))
        results=self.run_frames(background,0,50,hands=False)+self.run_frames(background,5,50,moving=False)+self.run_frames(background,10,10,hands=False)
        self.assertTrue(all(x['event'] is None for x in results))

if __name__=='__main__':unittest.main()
