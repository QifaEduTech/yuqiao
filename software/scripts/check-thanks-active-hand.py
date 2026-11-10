"""Synthetic isolation/lifecycle tests, not real-user accuracy measurements."""
import sys,unittest,importlib.util
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from thanks_active_hand import ActiveHandThanks
from realtime_multi import MultiLiveRecognizer
spec=importlib.util.spec_from_file_location('shapes',Path(__file__).with_name('check-thumb-local-motion.py'));shapes=importlib.util.module_from_spec(spec);spec.loader.exec_module(shapes)

def classify(rows):
    # Simulate a model that rejects two visible hands but accepts one hand.
    scores=np.full(10,.001)
    both=np.any(rows[:,:63]) and np.any(rows[:,63:])
    scores[0 if both else 4]=.99
    return scores

def frame(i,side=0,kind='bend',active=True):
    bend=45 if kind=='bend' and i%10 in [4,5,6] else 2 if kind=='noise' and i%2 else 0
    value=shapes.hand(bend=bend,side=side) if active else np.zeros(126)
    value+=shapes.hand(side=1-side)
    vector=np.zeros(153)
    for s in [0,1]:
        local=value[s*63:(s+1)*63]
        if not np.any(local):continue
        f=vector[s*76:(s+1)*76];f[:63]=local;f[63:65]=[.3+s*.4,.5];f[65]=.04;f[74:76]=1
        if s!=side and kind=='moving_peer':f[63]+=.08*np.sin(i*.5)
    return value,vector

class NoHelp:
    def probability(self,frames):return 0.

class ActiveHandTests(unittest.TestCase):
    def test_either_active_hand_emits_once_while_peer_stays(self):
        for side in [0,1]:
            r=ActiveHandThanks(classify);out=[]
            for i in range(45):
                v,f=frame(i,side,active=i<35);out.append(r.push(i/10,v,f))
            self.assertTrue(any(x['candidate']=='谢谢' for x in out))
            self.assertEqual([x['event']['text'] for x in out if x['event']],['谢谢'])
    def test_held_thumbs_noise_and_moving_peer_reject(self):
        for kind in ['held','noise','moving_peer']:
            r=ActiveHandThanks(classify);out=[]
            for i in range(45):
                v,f=frame(i,kind=kind,active=i<35)
                if kind=='moving_peer':v[:63]=shapes.hand(bend=45 if i%10 in [4,5,6] else 0)[:63]
                out.append(r.push(i/10,v,f))
            self.assertTrue(all(x['candidate'] is None and x['event'] is None for x in out),kind)
    def test_repeated_actions_after_long_passive_hold_have_new_ids_and_times(self):
        r=MultiLiveRecognizer(classify,help_model=NoHelp());out=[]
        for i in range(240):
            local=i-140 if i<190 else i-190
            active=140<=i<175 or 190<=i<225
            v,f=frame(local,active=active);out.append(r.push(i/10,v,f))
        events=[x['event'] for x in out if x['event']]
        self.assertEqual([e['id'] for e in events],[1,2])
        self.assertGreater(events[1]['startMs'],events[0]['endMs'])
    def test_short_tracking_loss_and_cached_predictions_do_not_finish_action(self):
        r=ActiveHandThanks(classify);out=[]
        for i in range(40):
            v,f=frame(i,active=i not in [25,26]);out.append(r.push(i/10,v,f))
        self.assertTrue(all(x['event'] is None for x in out))
        r=ActiveHandThanks(classify)
        for i in range(18):
            v,f=frame(i);r.push(i/10,v,f)
        for i in range(20):
            v,f=frame(17);out=r.push(1.71+i*.001,v,f)
        self.assertNotEqual(out['eventState'],'ready_to_finish')

if __name__=='__main__':unittest.main()
