"""A fresh open palm can end self-pointing; withdrawal alone never ends it."""
import json
from pathlib import Path
import numpy as np
from me_motion import angle

RULES=json.loads((Path(__file__).resolve().parents[1]/'shared/realtime-paragraph.json').read_text(encoding='utf8'))['meHandoff']

class MeHandoff:
    def __init__(self):self.reset()
    def reset(self):self.since=None;self.frames=0;self.last=None;self.wrist=None
    def push(self,t,payload,me_result):
        if me_result.get('candidate') or me_result.get('meEvidenceSupported'):
            self.reset();return None
        hands=(payload or {}).get('hands',[])
        if len(hands)!=1:
            self.reset();return None
        hand=np.asarray(hands[0],float)
        if hand.shape!=(21,3) or not np.isfinite(hand).all():
            self.reset();return None
        flat=np.c_[hand[:,:2],np.zeros(21)]
        # All four fingers must extend; folded self-pointing withdrawal fails.
        for i in (5,9,13,17):
            values=[angle(h[i],h[i+1],h[i+3]) for h in (hand,flat)]
            if any(v is None for v in values) or max(values)<RULES['minFingerAngleDegrees']:
                self.reset();return None
        width=float(np.linalg.norm(hand[5,:2]-hand[17,:2]))
        if width<.015:
            self.reset();return None
        if self.last is not None and (t-self.last>RULES['maxFrameGapSeconds'] or np.linalg.norm(hand[0,:2]-self.wrist)/width>RULES['maxWristStepPalmWidths']):self.reset()
        if self.since is None:self.since=t
        self.frames+=1;self.last=t;self.wrist=hand[0,:2].copy()
        return self.since if self.frames>=RULES['minFrames'] and t-self.since>=RULES['minOpenPalmSeconds']-1e-6 else None
