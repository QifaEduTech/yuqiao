"""Experimental candidate veto: thumb change with locally stable palm geometry.

Never creates a label, counts bends, or changes the frozen IP-v2. Apparent
length changes are tracking evidence, not anatomical bone-length measurements.
Large palm rotation is ambiguous and is conservatively rejected. This can also
reject real signs performed while rotating the hand; new held-out data required.
"""
import json
from pathlib import Path
import numpy as np
from thumb_motion import RULES,frame_angles
from thumb_multijoint import thumb_span_ratio

CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/thumb-local-motion.json').read_text(encoding='utf8'))
if CONFIG['baseProtocol']!=RULES['id']:raise ValueError('base_protocol_changed')

def geometry(value,side):
    angles=frame_angles(value,side)
    ratio=thumb_span_ratio(value,side)
    if angles is None or ratio is None:return None
    hand=np.asarray(value,dtype=float)[side*63:(side+1)*63].reshape(21,3)
    a=hand[5]-hand[0];b=hand[17]-hand[0];normal=np.cross(a,b);axis=hand[9]-hand[0]
    scale=np.linalg.norm(a)*np.linalg.norm(b)
    if scale<1e-10 or np.linalg.norm(normal)/scale<.05 or np.linalg.norm(axis)<1e-8:return None
    return angles[2],ratio,normal/np.linalg.norm(normal),axis/np.linalg.norm(axis)

def angle(a,b):return float(np.degrees(np.arccos(np.clip(np.dot(a,b),-1,1))))

def local_thumb_evidence(timeline):
    # Validate the full clock even if early frames would already supply evidence.
    previous=None
    for t,value in timeline:
        if not np.isfinite(t) or t<0 or previous is not None and t<=previous:raise ValueError('invalid_timestamp_order')
        previous=t
    events=[];accepted=0;rejected=0;latest_accepted={}
    for side,label in enumerate(['Left','Right']):
        runs=[];run=[];previous=None
        for t,value in timeline:
            item=geometry(value,side)
            if item is None or previous is not None and t-previous>RULES['maxTrackingGapSeconds']:
                if run:runs.append(run)
                run=[]
            if item is not None:run.append((t,item))
            previous=t
        if run:runs.append(run)
        for run in runs:
            if len(run)<RULES['minRunSamples'] or run[-1][0]-run[0][0]<RULES['minRunSeconds']:continue
            seen=set()
            for channel,name in [(0,'ip'),(1,'thumb_span')]:
                for i,(t,geom) in enumerate(run):
                    past=[(time,g[channel]) for time,g in run[:i] if t-time<=RULES['baselineLookbackSeconds']]
                    if len(past)<RULES['minBaselineSamples'] or past[-1][0]-past[0][0]<RULES['minBaselineSpanSeconds']:continue
                    baseline=float(np.percentile([v for _,v in past],20 if channel==0 else 80))
                    threshold=RULES['minIpChangeDegrees'] if channel==0 else CONFIG['minThumbSpanContractionFraction']
                    def change(g):return g[0]-baseline if channel==0 else 1-g[1]/baseline
                    if channel==1 and baseline<=0:continue
                    if change(geom)<threshold or channel==0 and geom[0]<RULES['minIpBendDegrees']:continue
                    begin=end=i
                    def shoulder(g):return change(g)>=threshold*RULES['shoulderChangeFraction']
                    while begin>0 and run[begin][0]-run[begin-1][0]<=RULES['maxSupportGapSeconds'] and shoulder(run[begin-1][1]):begin-=1
                    while end+1<len(run) and run[end+1][0]-run[end][0]<=RULES['maxSupportGapSeconds'] and shoulder(run[end+1][1]):end+=1
                    if end-begin+1<RULES['minSupportSamples'] or run[end][0]-run[begin][0]<RULES['minSupportSpanSeconds']:continue
                    key=(channel,begin,end)
                    if key in seen:continue
                    seen.add(key)
                    target=run[begin][0]-CONFIG['referenceBeforeOnsetSeconds']
                    candidates=[j for j in range(begin) if abs(run[j][0]-target)<=CONFIG['maxReferenceDistanceSeconds']]
                    if not candidates:continue
                    reference=min(candidates,key=lambda j:abs(run[j][0]-target))
                    ref=run[reference][1]
                    normal=max(angle(ref[2],g[2]) for _,g in run[reference:end+1])
                    axis=max(angle(ref[3],g[3]) for _,g in run[reference:end+1])
                    stable=normal<=CONFIG['maxPalmNormalRotationDegrees'] and axis<=CONFIG['maxPalmAxisRotationDegrees']
                    accepted+=int(stable);rejected+=int(not stable)
                    if stable and (label not in latest_accepted or run[end][0]>latest_accepted[label]['endTime']):
                        latest_accepted[label]={'side':label,'endTime':run[end][0],'accepted':True}
                    if len(events)<CONFIG['maxReportedEvents']:
                        events.append({'side':label,'signal':name,'startTime':round(run[begin][0],3),'endTime':round(run[end][0],3),
                                       'maxPalmNormalRotation':round(normal,3),'maxPalmAxisRotation':round(axis,3),
                                       'accepted':stable,'reason':'localized_thumb_change' if stable else 'palm_rotation_ambiguous'})
    return {'protocol':CONFIG['id'],'review':CONFIG['review'],'supported':accepted>0,
            'reason':'localized_thumb_change' if accepted else 'no_stable_local_thumb_evidence',
            'acceptedEvents':accepted,'rejectedEvents':rejected,'events':events,'eventsTruncated':accepted+rejected>len(events),
            'latestAcceptedBySide':list(latest_accepted.values())}
