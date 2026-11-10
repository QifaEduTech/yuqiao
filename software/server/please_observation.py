"""Spatial hand observations for please diagnostics, not a word classifier.

Anatomical Left/Right labels can coincide during palm-up motion. Preserve two
spatially distinct observations; overlapping detections do not count as two.
"""
import numpy as np

def spatial_hands(observation,aspect):
    if not np.isfinite(aspect) or aspect<=0:raise ValueError('invalid_aspect')
    hands=[]
    for lm in (observation.multi_hand_landmarks or [])[:2]:
        h=np.array([[v.x,v.y*aspect,v.z] for v in lm.landmark],float)
        if h.shape==(21,3) and np.isfinite(h).all():hands.append(h)
    hands.sort(key=lambda h:float(h[0,0]))
    if len(hands)==2:
        scales=[float(np.linalg.norm(h[9,:2]-h[0,:2])) for h in hands]
        if min(scales)<=1e-8 or np.linalg.norm(hands[0][0,:2]-hands[1][0,:2])<=max(.04,.5*min(scales)):
            # Ambiguous overlap: do not invent a second spatial hand.
            return hands[:1]
    return hands
