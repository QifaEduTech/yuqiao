"""Offline event logic tests; synthetic frames do not establish accuracy."""
import importlib.util,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from help_live_probe import HelpLiveProbe
spec=importlib.util.spec_from_file_location('geometry_cases',Path(__file__).with_name('check-help-motion.py'));fixtures=importlib.util.module_from_spec(spec);spec.loader.exec_module(fixtures)

class HelpProbeTests(unittest.TestCase):
    def test_emit_once_only_after_boundary_and_repeat_new_segment(self):
        p=HelpLiveProbe();outputs=[]
        for offset in [0,5]:
            action=[p.push(t+offset,h) for t,h in fixtures.timeline()];self.assertTrue(any(x['candidate'] for x in action));self.assertTrue(all(x['event'] is None for x in action))
            outputs += [p.push(offset+3+i/10,{}) for i in range(10)]
        self.assertEqual([x['event']['id'] for x in outputs if x['event']],[1,2])
    def test_static_single_and_lateral_no_events(self):
        for mode in ['static','single','lateral']:
            p=HelpLiveProbe();outputs=[p.push(t,h) for t,h in fixtures.timeline(mode)]+[p.push(3+i/10,{}) for i in range(10)]
            self.assertTrue(all(x['candidate'] is None and x['event'] is None for x in outputs))
    def test_conflicting_thanks_revokes_qualification(self):
        p=HelpLiveProbe()
        for t,h in fixtures.timeline():p.push(t,h)
        self.assertTrue(p.qualified)
        output=p.push(3,fixtures.timeline()[-1][1],True);self.assertIsNone(output['candidate']);self.assertFalse(p.qualified)
        self.assertTrue(all(p.push(3.1+i/10,{})['event'] is None for i in range(10)))
    def test_disconnection_is_not_an_end_event(self):
        p=HelpLiveProbe()
        for t,h in fixtures.timeline():p.push(t,h)
        self.assertIsNone(p.push(5,{})['event']);self.assertFalse(p.qualified)
    def test_old_moving_pose_cannot_be_reused_after_long_static_hold(self):
        p=HelpLiveProbe()
        for t,h in fixtures.timeline():p.push(t,h)
        still=fixtures.timeline('static')[0][1]
        for i in range(210):last=p.push(3+i/30,still)
        self.assertIsNone(last['candidate']);self.assertFalse(p.qualified)
        self.assertTrue(all(p.push(10+i/10,{})['event'] is None for i in range(10)))
    def test_memory_time_and_long_segment_boundaries(self):
        p=HelpLiveProbe();cycle=fixtures.timeline()
        for i in range(420):last=p.push(i/30,cycle[i%len(cycle)][1]);self.assertLessEqual(len(p.samples),140)
        self.assertEqual(last['eventState'],'reset_required');self.assertIsNone(last['candidate'])
        with self.assertRaises(ValueError):p.push(1,{})

if __name__=='__main__':unittest.main()
