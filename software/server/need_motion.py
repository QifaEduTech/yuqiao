"""Offline projection hypothesis; no recognition label or production integration.

Projected palm width avoids inferred-z wrist-length changes on static palms.
Perspective, wrist rotation and camera movement still require real validation.
"""
import json
from pathlib import Path
import numpy as np
RULES=json.loads((Path(__file__).resolve().parents[1]/'shared/need-motion.json').read_text(encoding='utf8'))

def inspect_need_motion(timeline):
    last=None
    for t,_ in timeline:
        if not np.isfinite(t) or t<0 or last is not None and t<=last:raise ValueError('invalid_time_order')
        last=t
    runs=[]
    for side,sign in [('Left',-1),('Right',1)]:
        current=[];previous=None
        for t,hands in timeline:
            h=np.asarray(hands.get(side,[]),dtype=float);value=None
            if h.shape==(21,3) and np.isfinite(h).all():
                n=np.cross(h[5]-h[0],h[17]-h[0]);length=np.linalg.norm(n)
                if length>1e-8:
                    n/=length;width=float(np.linalg.norm(h[5,:2]-h[17,:2]))
                    if n[1]*sign>=RULES['minUpNormal'] and width>=RULES['minPalmWidth']:value=(t,width,n)
            if value is None or previous is not None and t-previous>RULES['maxGapSeconds']:
                if current:runs.append((side,current))
                current=[]
            if value is not None:current.append(value)
            previous=t
        if current:runs.append((side,current))
    results=[]
    for side,run in runs:
        if len(run)<RULES['minimumFrames'] or run[-1][0]-run[0][0]<RULES['minimumSpanSeconds']:continue
        first=[x for x in run if x[0]-run[0][0]<=RULES['endpointSeconds']];last=[x for x in run if run[-1][0]-x[0]<=RULES['endpointSeconds']]
        start=float(np.median([x[1] for x in first]));end=float(np.median([x[1] for x in last]));drop=(start-end)/start
        width=np.array([x[1] for x in run]);smooth=np.array([np.median(width[max(0,i-1):i+2]) for i in range(len(width))]);variation=float(np.abs(np.diff(smooth)).sum());consistency=max(0.,float((smooth[0]-smooth[-1])/max(variation,1e-8)))
        normals=[]
        for rows in [first,last]:
            n=np.mean([x[2] for x in rows],axis=0);normals.append(n/max(np.linalg.norm(n),1e-8))
        rotation=float(np.degrees(np.arccos(np.clip(np.dot(*normals),-1,1))))
        supported=drop>=RULES['minimumRelativeDecrease'] and consistency>=RULES['minimumDirectionalConsistency'] and rotation<=RULES['maxNormalRotationDegrees']
        results.append({'side':side,'start':run[0][0],'end':run[-1][0],'frames':len(run),'relativeDecrease':drop,'directionalConsistency':consistency,'normalRotationDegrees':rotation,'supported':bool(supported)})
    return {'scope':'development_projection_not_semantic_recognition','supported':any(x['supported'] for x in results),'runs':results,'productionEligible':False}
