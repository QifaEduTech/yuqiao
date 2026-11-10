"""Development geometry candidate, not a semantic recognizer or production label.

Uses screen-side tracks only while the hands remain clearly separated; the
MediaPipe anatomical labels are not trusted as persistent object identities.
Scale is an image proxy, not measured depth. Camera motion remains a limitation.
"""
import json
from pathlib import Path
import numpy as np
from thumb_motion import bend_degrees
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/help-motion.json').read_text(encoding='utf8'))

def hand_features(hand):
    h=np.asarray(hand,float)
    if h.shape!=(21,3) or not np.isfinite(h).all():return None
    scale=float(np.linalg.norm(h[9]-h[0]))
    if scale<1e-8:return None
    opened=0
    for root,joint,distal,tip in [(5,6,7,8),(9,10,11,12),(13,14,15,16),(17,18,19,20)]:
        angle=bend_degrees(h[root],h[joint],h[distal])
        if angle is not None and angle<CONFIG['maxFingerBendDegrees'] and np.linalg.norm(h[tip]-h[0])>1.2*np.linalg.norm(h[root]-h[0]):opened+=1
    return h[0,:2],scale,opened

def inspect_help_motion(timeline):
    runs=[];run=[];previous_t=None;previous_wrists=None;ambiguous=0
    for t,hands in timeline:
        if not np.isfinite(t) or t<0 or previous_t is not None and t<=previous_t:raise ValueError('invalid_timestamp_order')
        gap=previous_t is not None and t-previous_t>CONFIG['maxTrackingGapSeconds'];previous_t=t
        # Hands dictionary is the tracker output, never a human target label.
        values=[hand_features(h) for h in hands.values()];values=[v for v in values if v is not None]
        values.sort(key=lambda v:float(v[0][0]))
        good=len(values)==2
        if good:
            wrists=np.asarray([v[0] for v in values]);scale=float(np.mean([v[1] for v in values]))
            good=float(wrists[1,0]-wrists[0,0])>=scale*CONFIG['minSeparationPalmLengths']
            if previous_wrists is not None and not gap:good=good and float(np.max(np.linalg.norm(wrists-previous_wrists,axis=1)))<CONFIG['maxWristJumpImageWidths']
        if not good or gap:
            if run:runs.append(run)
            run=[];previous_wrists=None
            if not good:ambiguous+=1;continue
        previous_wrists=wrists
        run.append((t,values))
    if run:runs.append(run)
    reports=[]
    for run in runs:
        span=run[-1][0]-run[0][0]
        if len(run)<CONFIG['minBothHandFrames'] or span<CONFIG['minSpanSeconds']:continue
        scales=np.array([[v[1] for v in row] for _,row in run]);opens=np.array([[v[2]>=3 for v in row] for _,row in run])
        med=np.maximum(np.median(scales,axis=0),1e-8);normalized=scales/med
        ranges=np.percentile(normalized,90,axis=0)-np.percentile(normalized,10,axis=0)
        correlation=float(np.corrcoef(normalized.T)[0,1]) if np.min(np.std(normalized,axis=0))>1e-6 else 0.
        # Require a supported rise and fall, not merely bringing hands into view.
        smooth=np.array([np.median(normalized[max(0,i-1):i+2],axis=0) for i in range(len(run))])
        common=np.mean(smooth,axis=1);cycles=0;last_evidence=None
        for i,(t,_) in enumerate(run):
            past=[j for j in range(i) if CONFIG['supportSeconds']<=t-run[j][0]<=CONFIG['cycleWindowSeconds']]
            future=[j for j in range(i+1,len(run)) if CONFIG['supportSeconds']<=run[j][0]-t<=CONFIG['cycleWindowSeconds']]
            if past and future and common[i]-min(common[j] for j in past)>=CONFIG['minScaleExcursion'] and common[i]-min(common[j] for j in future)>=CONFIG['minScaleExcursion']:
                cycles+=1
                completed=next(j for j in future if common[i]-common[j]>=CONFIG['minScaleExcursion'])
                last_evidence=max(last_evidence or 0,run[completed][0])
        reasons=[]
        if float(np.min(opens.mean(axis=0)))<CONFIG['minOpenFraction']:reasons.append('hands_not_open')
        if float(np.min(ranges))<CONFIG['minScaleExcursion']:reasons.append('insufficient_bilateral_change')
        if correlation<CONFIG['minScaleCorrelation']:reasons.append('hands_not_coordinated')
        if cycles==0:reasons.append('no_supported_return_motion')
        reports.append({'start':round(run[0][0],3),'end':round(run[-1][0],3),'frames':len(run),'openFractions':opens.mean(axis=0).round(4).tolist(),'scaleRanges':ranges.round(4).tolist(),'scaleCorrelation':round(correlation,4),'supported':not reasons,'reasons':reasons,'lastEvidenceTime':last_evidence})
    return {'protocol':CONFIG['id'],'scope':'development_geometry_not_semantic_recognition','supported':any(r['supported'] for r in reports),'runs':reports,'ambiguousOrMissingFrames':ambiguous}
