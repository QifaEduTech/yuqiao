"""Unified service adapter parity, shared feature parity and event lifecycle."""
import sys,unittest,json
from pathlib import Path
from types import SimpleNamespace as N
import numpy as np
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'server'))
from unified_live import UnifiedLiveRecognizer,load_model
from unified_runtime import UnifiedStream
from unified_observation import observe_unified_bgr
from realtime_observation import observe_bgr
from realtime_paragraph import ParagraphBuffer

class Fixed:
    label=1
    def classify(self,frames):return self.label

class Checks(unittest.TestCase):
    def setUp(self):
        self.model=Fixed();self.live=UnifiedLiveRecognizer(self.model)
        self.frame=np.zeros(178,np.float32);self.frame[74]=self.frame[177]=1
    def active(self,start=0):return [self.live.push(start+i/30,{'frame':self.frame}) for i in range(45)]
    def ending(self,start=1.5):return [self.live.push(start+i/30,None) for i in range(30)]
    def test_one_model_all_four_labels_without_per_word_gates(self):
        for label,text in enumerate(['谢谢','帮助','需要','我'],1):
            live=UnifiedLiveRecognizer(self.model);self.model.label=label
            rows=[live.push(i/30,{'frame':self.frame}) for i in range(45)]
            self.assertTrue(any(r['candidate']==text and r['eventState']=='ready_to_finish' for r in rows))
            self.assertTrue(all(r['loadedModelCount']==1 and r['helpEngine']=='unified-tcn' for r in rows))
    def test_repeat_ids_and_no_overlap(self):
        self.active();one=self.ending();self.active(2.5);two=self.ending(4)
        events=[r['event'] for r in one+two if r['event']]
        self.assertEqual([e['id'] for e in events],[1,2]);self.assertGreater(events[1]['startMs'],events[0]['endMs'])
    def test_manual_finish_requires_fresh_qualified_current_word(self):
        self.live.push(0,{'frame':self.frame});self.assertIsNone(self.live.finish_for_paragraph(.01))
        for i in range(1,45):self.live.push(i/30,{'frame':self.frame})
        r=self.live.finish_for_paragraph(1.5);self.assertEqual(r['event']['text'],'谢谢');self.assertIsNone(self.live.finish_for_paragraph(1.51))
    def test_conflict_and_stale_evidence_never_force_finish(self):
        self.active();self.model.label=2
        for i in range(30):self.live.push(1.5+i/30,{'frame':self.frame})
        self.assertIsNone(self.live.finish_for_paragraph(2.5));self.assertFalse(any(r['event'] for r in self.ending(2.5)))
    def test_auto_paragraph_after_real_no_hand_observations(self):
        paragraph=ParagraphBuffer();final=[]
        for i in range(125):
            present=i<45;r=self.live.push(i/30,{'frame':self.frame} if present else None)
            p=paragraph.push(i/30,r,present)
            if p['final']:final.append(p['final'])
        self.assertEqual(len(final),1);self.assertEqual(final[0]['words'],['谢谢']);self.assertFalse(final[0]['partial'])
    def test_event_candidate_parity_with_frozen_experiment(self):
        reference=UnifiedStream(self.model)
        for i in range(100):
            frame=self.frame if i<45 else np.zeros(178)
            a=reference.push(i/30,frame);b=self.live.push(i/30,{'frame':frame})
            self.assertEqual(bool(a['candidate']),bool(b['candidate']));self.assertEqual(bool(a['event']),bool(b['event']))
    def test_single_observation_matches_training_feature_path(self):
        hand=N(multi_hand_landmarks=None,multi_handedness=None);pose=N(pose_landmarks=None)
        class Graph:
            def __init__(self,result):self.result=result
            def process(self,inputs):return self.result
        frame=np.zeros((64,64,3),np.uint8)
        _,_,_,old,_=observe_bgr(frame,Graph(hand),Graph(pose),.03)
        _,new=observe_unified_bgr(frame,Graph(hand),Graph(pose),.03)
        np.testing.assert_array_equal(old['frame'],new['frame'])
    def test_real_model_load_once_without_legacy_weight_instances(self):
        model=load_model();self.assertEqual(model.w['classifier.weight'].shape,(5,64))
        self.assertEqual(UnifiedLiveRecognizer(model).push(0,None)['candidate'],None)

if __name__=='__main__':unittest.main()
