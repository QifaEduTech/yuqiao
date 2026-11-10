"""Pure single-recording aggregation checks; no user media or trained predictions."""
import unittest,sys,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from recording_result import RecordingResult
TARGETS=json.loads((ROOT/'shared/realtime-targets.json').read_text(encoding='utf8'))
def result(word=None,event=None,reason='target'):
 return {'candidate':word,'event':event,'reason':reason,'eventState':'ready_to_finish' if word else 'waiting'}
class Checks(unittest.TestCase):
 def test_all_current_words_and_no_synthetic_end(self):
  for target in TARGETS.values():
   s=RecordingResult(TARGETS);s.add(1,True,result(target['text']));out=s.finish();self.assertEqual(out['candidate'],target['text']);self.assertEqual(out['sign_id'],target['signId']);self.assertFalse(out['end_boundary_observed'])
 def test_multiple_candidates_and_repeats_are_not_collapsed(self):
  s=RecordingResult(TARGETS);s.add(1,True,result('谢谢'));s.add(2,True,result('帮助'));self.assertEqual(s.finish()['reason'],'multiple_actions_detected');self.assertIsNone(s.finish()['candidate'])
  s=RecordingResult(TARGETS);event={'text':'谢谢','signId':'csl.thanks','endMs':1200};s.add(1,True,result('谢谢'));s.add(1.8,False,result(event=event));s.add(2,True,result('谢谢'));self.assertEqual(s.finish()['reason'],'multiple_actions_detected')
 def test_conflict_never_chooses_a_word(self):
  s=RecordingResult(TARGETS);s.add(1,True,result('帮助'));s.add(2,True,result(reason='ambiguous_actions'));self.assertEqual(s.finish()['reason'],'conflicting_evidence');self.assertIsNone(s.finish()['candidate'])
 def test_no_hands_and_no_motion_are_separate(self):
  s=RecordingResult(TARGETS);s.add(0,False,result(reason='no_hands'));self.assertEqual(s.finish()['status'],'no_hands');s.add(1,True,result(reason='motion_required'));self.assertEqual(s.finish()['status'],'uncertain')
 def test_real_completion_and_retired_word(self):
  s=RecordingResult(TARGETS);s.add(1,True,result('我'));s.add(2,False,result(event={'text':'我','signId':'csl.me','endMs':1400}));self.assertTrue(s.finish()['end_boundary_observed']);self.assertEqual(s.finish()['candidate'],'我')
  with self.assertRaises(ValueError):RecordingResult(TARGETS).add(1,True,result('再见'))
if __name__=='__main__':unittest.main()
