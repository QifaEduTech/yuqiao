"""Required causal image-plane contraction evidence, never a semantic classifier.

Uses four projected knuckle distances rather than inferred wrist depth.
Rotation/perspective may also contract a projection: model checks remain required.
"""
import json
from pathlib import Path
from collections import deque
from itertools import permutations
import numpy as np
RULES=json.loads((Path(__file__).resolve().parents[1]/'shared/need-required-motion.json').read_text(encoding='utf8'))
PAIRS=[(5,9),(9,13),(13,17),(5,17)]

class NeedRequiredMotion:
    def __init__(self):self.last_time=None;self.reset()
    def reset(self):self.rows=[deque(),deque()];self.evidence=[None,None];self.positions=[None,None];self.seen=[None,None]
    @staticmethod
    def distances(frame,side,aspect):
        f=frame[side*76:(side+1)*76]
        if f[74]<=0 or f[65]<=1e-8:return None
        p=f[:63].reshape(21,3)[:,:2].astype(float)*f[65];p[:,1]*=aspect
        d=np.asarray([np.linalg.norm(p[a]-p[b]) for a,b in PAIRS])
        return d if d[-1]>=RULES['minPalmWidth'] and np.min(d)>1e-6 else None
    def push(self,t,frame,aspect=9/16):
        f=np.asarray(frame,dtype=float)
        if not np.isfinite(t) or t<0 or self.last_time is not None and t<=self.last_time or f.shape!=(153,) or not np.isfinite(f).all() or not np.isfinite(aspect) or not .1<=aspect<=10:raise ValueError('invalid_motion_input')
        if self.last_time is not None and t-self.last_time>RULES['maxGapSeconds']:self.reset()
        self.last_time=t
        observations=[]
        for anatomical_side in [0,1]:
            d=self.distances(f,anatomical_side,aspect)
            if d is not None:observations.append((d,f[anatomical_side*76+63:anatomical_side*76+65]*[1,aspect]))
        def cost(slot,wrist):
            if self.seen[slot] is None or t-self.seen[slot]>RULES['maxGapSeconds']:return 1.
            distance=float(np.linalg.norm(wrist-self.positions[slot]))
            return distance if distance<=RULES['maxWristStep'] else 2.
        # A tracker sometimes returns two overlapping detections of one hand.
        # Continue the one established spatial track; never merge two already
        # established hands at a crossing, or create a track from ambiguous input.
        if len(observations)==2 and np.linalg.norm(observations[0][1]-observations[1][1])<max(RULES['minHandSeparation'],RULES['overlapPalmWidths']*min(o[0][-1] for o in observations)):
            active=[i for i in range(2) if self.seen[i] is not None and t-self.seen[i]<=RULES['maxGapSeconds']]
            if len(active)==1:observations=[min(observations,key=lambda o:cost(active[0],o[1]))]
            else:self.reset();observations=[]
        assignment=min(permutations(range(2),len(observations)),key=lambda slots:sum(cost(slot,obs[1]) for slot,obs in zip(slots,observations)))
        for side,(d,wrist) in zip(assignment,observations):
            if cost(side,wrist)>=1:
                self.rows[side].clear();self.evidence[side]=None
            self.positions[side]=wrist.copy();self.seen[side]=t;rows=self.rows[side]
            rows.append((t,d))
            while rows and t-rows[0][0]>RULES['maxWindowSeconds']:rows.popleft()
            values=list(rows);end=[x for x in values if t-x[0]<=RULES['endpointSeconds']]
            if len(end)<RULES['minEndpointFrames']:continue
            low=np.median([x[1] for x in end],axis=0)
            if np.max(np.ptp([x[1] for x in end],axis=0)/low)>RULES['maxEndpointRelativeSpread']:continue
            for j in range(len(values)-len(end)):
                center=values[j][0]
                if not RULES['minTransitionSeconds']<=end[0][0]-center<=RULES['maxTransitionSeconds']:continue
                start=[x for x in values[:j+1] if center-x[0]<=RULES['endpointSeconds']]
                if len(start)<RULES['minEndpointFrames']:continue
                high=np.median([x[1] for x in start],axis=0);drop=(high-low)/high
                if np.min(drop)<RULES['minRelativeContraction'] or np.max(np.ptp([x[1] for x in start],axis=0)/high)>RULES['maxEndpointRelativeSpread']:continue
                between=[x for x in values if center<x[0]<end[0][0] and low[-1]+.1*(high[-1]-low[-1])<x[1][-1]<high[-1]-.1*(high[-1]-low[-1])]
                if len(between)<RULES['minIntermediateFrames']:continue
                # Holding the final pose must not refresh the time of movement.
                self.evidence[side]={'trackId':side,'start':start[0][0],'end':between[-1][0],'minRelativeContraction':float(np.min(drop)),'intermediateFrames':len(between)};break
        recent=[e for e in self.evidence if e is not None and t-e['end']<=RULES['evidenceMaxAgeSeconds']]
        return {'supported':bool(recent),'evidence':recent,'scope':'required_image_motion_not_semantic_recognition','productionEligible':False}
