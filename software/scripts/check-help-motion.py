"""Synthetic checks of geometry rejection, not sign-language accuracy."""
import sys,unittest
from pathlib import Path
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'server'))
from help_motion import inspect_help_motion

def hand(x,scale):
    h=np.zeros((21,3));h[0]=[x,.5,0]
    for base,dx in [(5,-.03),(9,-.01),(13,.01),(17,.03)]:
        for j in range(4):h[base+j]=h[0]+[dx*scale,-(.06+j*.025)*scale,0]
    for j in range(1,5):h[j]=h[0]+[-j*.02*scale,-j*.01*scale,0]
    return h
def timeline(mode='help'):
    rows=[]
    for i in range(90):
        t=i/30;s=1+.25*np.sin(t*2*np.pi)
        if mode in ['static','lateral','single']:s=1
        x=.08*np.sin(t*2*np.pi) if mode=='lateral' else 0
        hands={'Left':hand(.25+x,s),'Right':hand(.75+x,(2-s) if mode=='opposed' else s)}
        if mode=='single':hands.pop('Right')
        if mode=='swap' and i>=40:hands={'Right':hands['Left'],'Left':hands['Right']}
        rows.append((t,hands))
    return rows
class HelpGeometryTests(unittest.TestCase):
    def test_coordinated_open_palm_proxy_and_label_swap(self):
        a=inspect_help_motion(timeline());b=inspect_help_motion(timeline('swap'))
        self.assertTrue(a['supported']);self.assertEqual(a,b)
    def test_static_single_lateral_and_opposed_changes_rejected(self):
        for mode in ['static','single','lateral','opposed']:self.assertFalse(inspect_help_motion(timeline(mode))['supported'],mode)
    def test_spike_and_missing_data_cannot_create_cycle(self):
        rows=timeline('static');rows[35]=(35/30,{'Left':hand(.25,2),'Right':hand(.75,2)})
        self.assertFalse(inspect_help_motion(rows)['supported'])
        rows=[(i/30,{} if 25<=i<=40 else {'Left':hand(.25,1 if i<25 else 1.5),'Right':hand(.75,1 if i<25 else 1.5)}) for i in range(90)]
        self.assertFalse(inspect_help_motion(rows)['supported'])
    def test_close_or_crossed_hands_do_not_join_wrong_tracks(self):
        rows=[]
        for t,hands in timeline():
            hands['Right'][:,0]-=.49;rows.append((t,hands))
        self.assertFalse(inspect_help_motion(rows)['supported'])
    def test_time_order_and_empty_input(self):
        self.assertFalse(inspect_help_motion([])['supported'])
        for rows in [[(1,{}),(.5,{})],[(0,{}),(0,{})]]:
            with self.assertRaises(ValueError):inspect_help_motion(rows)
    def test_proxy_is_not_a_semantic_label(self):
        report=inspect_help_motion(timeline());self.assertEqual(report['scope'],'development_geometry_not_semantic_recognition');self.assertNotIn('candidate',report);self.assertNotIn('signId',report)

if __name__=='__main__':unittest.main()
