import sys,unittest
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'server'))
from unified_runtime import UnifiedStream, SETTLED_END_POLICY
from joint_evaluation import evaluate_joint, select_end_policy
from recording_result import RecordingResult
POLICY={'minTestPositive':1,'minTestNegative':1,'recallTarget':.9,'precisionTarget':.9,'maxFalsePositiveRate':.05}
LABELS=[{'signId':'test.one','text':'目标'}]
class Fixed:
    label=1
    def classify(self,frames):return self.label if any(f[74] for f in frames) else 0
def row(present=45,absent=0,label=1):
    frames=np.zeros((present+absent,178),np.float32);frames[:present,74]=frames[:present,177]=1
    return {'recordId':'test','split':'test','label':label,'frames':frames.tolist(),'times':[i/30 for i in range(len(frames))]}
class Checks(unittest.TestCase):
    def test_sparse_motion_alignment_only_inside_continuously_tracked_intervals(self):
        from joint_model import cadence_features
        x=np.zeros((5,178),np.float32);x[:,152]=3;x[[0,1,3,4],74]=1
        x[:,63]=[0,.3,0,.6,.9]
        out=cadence_features(x)
        np.testing.assert_allclose(out[:,63],[0,.1,.2,.3,0,.6,.7,.8,.9],atol=1e-5)
        self.assertEqual(np.count_nonzero(out[:,74]==0),1)
        self.assertAlmostEqual(out[:,152].sum(),x[:,152].sum(),places=5)

    def test_new_confirmation_ignores_brief_candidates_and_emits_sustained_motion_once(self):
        model=Fixed();model.end_policy=SETTLED_END_POLICY;model.confirmed_evidence=True
        stream=UnifiedStream(model);events=[];candidates=set()
        for i in range(100):
            model.label=2 if i<19 else 1
            f=np.zeros(178,np.float32);f[74]=f[177]=1;f[63]=.025*i
            r=stream.push(i/30,f)
            if r['event']:events.append(r['event']['label'])
            if r['candidate']:candidates.add(r['candidate'])
        self.assertEqual(events,[1]);self.assertEqual(candidates,{1})
    def test_policy_selected_only_on_validation_rejects_new_background_emissions(self):
        target={**row(), 'split':'validation'}
        model=Fixed()
        quiet={**row(present=0,absent=45,label=0), 'split':'validation'}
        self.assertEqual(select_end_policy([target,quiet,row(label=0)],model,LABELS,POLICY)['selected'],SETTLED_END_POLICY)
        background={**row(label=0), 'split':'validation'}
        result=select_end_policy([target,background],model,LABELS,POLICY)
        self.assertIsNone(result['selected'])
        self.assertEqual(result['comparisons'][1]['backgroundErrors'],1)

    def test_measured_hold_emits_once_and_requires_release_for_same_word(self):
        model=Fixed();model.end_policy=SETTLED_END_POLICY
        stream=UnifiedStream(model); events=[]
        for i in range(170):
            f=np.zeros(178,np.float32)
            if i<70 or i>=100:
                f[74]=f[177]=1
            result=stream.push(i/30,f)
            if result['event']:events.append(result['event'])
        self.assertEqual([e['label'] for e in events],[1,1])
        self.assertLess(events[0]['end'],70/30)
        self.assertIsNone(stream.finish_explicit(170/30))

    def test_stable_label_while_hand_is_moving_cannot_finish_by_hold(self):
        model=Fixed();model.end_policy=SETTLED_END_POLICY
        stream=UnifiedStream(model)
        for i in range(32):
            f=np.zeros(178,np.float32);f[74]=f[177]=1;f[63]=i*.025
            self.assertIsNone(stream.push(i/30,f)['event'])

    def test_different_sign_can_follow_hold_with_hands_still_in_view(self):
        model=Fixed();model.end_policy=SETTLED_END_POLICY
        stream=UnifiedStream(model);events=[]
        for i in range(120):
            f=np.zeros(178,np.float32);f[74]=f[177]=1
            if i>=60:
                model.label=2
                f[63]=.2
            result=stream.push(i/30,f)
            if result['event']:events.append(result['event'])
        self.assertEqual([e['label'] for e in events],[1,2])
        self.assertGreater(events[1]['start'],events[0]['end'])

    def test_stable_clip_can_finish_at_explicit_boundary_without_faking_auto_end(self):
        r=evaluate_joint([row()],Fixed(),LABELS,POLICY)
        self.assertEqual(r['recordingPerClass'][0]['recall'],1);self.assertEqual(r['classificationPerClass'][0]['recall'],1);self.assertEqual(r['perClass'][0]['recall'],0)
        self.assertFalse(r['perClass'][0]['passed']);self.assertTrue(r['details'][0]['explicitRecordingEnd'])
    def test_observed_end_is_counted_once(self):
        r=evaluate_joint([row(absent=30)],Fixed(),LABELS,POLICY);self.assertEqual(r['details'][0]['automaticEvents'],[1]);self.assertEqual(r['details'][0]['recordingEvents'],[1])
    def test_short_missing_tail_at_known_recording_boundary(self):
        r=evaluate_joint([row(absent=5)],Fixed(),LABELS,POLICY);self.assertEqual(r['recordingPerClass'][0]['recall'],1);self.assertEqual(r['perClass'][0]['recall'],0)
    def test_short_or_rejected_clip_not_promoted(self):
        for model,data in [(Fixed(),row(present=3))]:self.assertEqual(evaluate_joint([data],model,LABELS,POLICY)['recordingPerClass'][0]['recall'],0)
        model=Fixed();model.label=0;self.assertEqual(evaluate_joint([row()],model,LABELS,POLICY)['recordingPerClass'][0]['recall'],0)
    def test_conflicting_stable_words_cannot_force_finish(self):
        model=Fixed();stream=UnifiedStream(model);data=row(present=80)
        for i,(t,f) in enumerate(zip(data['times'],data['frames'])):
            model.label=1 if i<40 else 2;stream.push(t,f)
        self.assertIsNone(stream.finish_explicit(data['times'][-1]))
    def test_stale_qualified_evidence_cannot_force_finish(self):
        model=Fixed();stream=UnifiedStream(model);data=row()
        for t,f in zip(data['times'],data['frames']):stream.push(t,f)
        self.assertIsNone(stream.finish_explicit(data['times'][-1]+.6))
    def test_missing_class_denominator_is_unavailable(self):
        r=evaluate_joint([row(present=0,absent=45,label=0)],Fixed(),LABELS,POLICY)
        self.assertIsNone(r['recordingPerClass'][0]['recall']);self.assertFalse(r['recordingPerClass'][0]['passed'])
    def test_recording_boundary_does_not_fabricate_no_hand_frames_or_events(self):
        summary=RecordingResult({'one':{'text':'目标','signId':'test.one'}})
        summary.add(1,True,{'candidate':'目标','eventState':'ready_to_finish'})
        summary.confirm_recording_end({'event':{'text':'目标','signId':'test.one'}})
        r=summary.finish();self.assertTrue(r['recording_output_confirmed']);self.assertTrue(r['recording_end_confirmed']);self.assertFalse(r['end_boundary_observed']);self.assertEqual(r['completed_event_count'],0);self.assertEqual(summary.frames,1)
if __name__=='__main__':unittest.main()
