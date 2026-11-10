"""Development-only thumb joint geometry; never count bends as word tokens."""
import json
from pathlib import Path
import numpy as np

RULES=json.loads((Path(__file__).resolve().parents[1]/'shared/thumb-motion.json').read_text(encoding='utf8'))


def continuous_runs(timeline,side,max_gap,dimensions=3):
    run=[];previous=None
    for t,value in timeline:
        if not np.isfinite(t) or t<0 or previous is not None and t<=previous:
            raise ValueError('invalid_timestamp_order')
        if previous is not None and t-previous>max_gap:
            if run:yield run
            run=[]
        previous=t;angles=frame_angles(value,side,dimensions)
        if angles is None:
            if run:yield run
            run=[];continue
        run.append((t,angles))
    if run:yield run


def bend_degrees(a,b,c):
    u=np.asarray(a)-np.asarray(b);v=np.asarray(c)-np.asarray(b)
    denominator=float(np.linalg.norm(u)*np.linalg.norm(v))
    if denominator<1e-10:return None
    return 180-float(np.degrees(np.arccos(np.clip(np.dot(u,v)/denominator,-1,1))))


def frame_angles(value,side,dimensions=3):
    if dimensions not in (2,3) or side not in (0,1):raise ValueError('invalid_geometry')
    if value is None:return None
    data=np.asarray(value,dtype=float)
    if data.shape!=(126,) or not np.isfinite(data).all():return None
    hand=data[side*63:(side+1)*63].reshape(21,3)
    if dimensions==2:hand=hand[:,:2]
    if not np.any(hand):return None
    cmc=bend_degrees(hand[0],hand[1],hand[2])
    mcp=bend_degrees(hand[1],hand[2],hand[3])
    ip=bend_degrees(hand[2],hand[3],hand[4])
    palm=bend_degrees(hand[9],hand[0],hand[0]+hand[4]-hand[2])
    if any(v is None for v in [cmc,mcp,ip,palm]):return None
    return np.array([cmc,mcp,ip,palm])


def inspect_thumb_motion(timeline):
    """Report robust angle variation within continuous single-hand runs.

    Use segment-local three-observation medians and p90-p10; a missing hand,
    reversed clock or >350 ms gap breaks a run. No interpolation across loss.
    """
    hands=[]
    for side,label in enumerate(['Left','Right']):
        summaries=[]
        for points in continuous_runs(timeline,side,.35):
            if len(points)<8 or points[-1][0]-points[0][0]<.7:continue
            raw=np.asarray([a for _,a in points])
            # Drop edge-only evidence so one tracking spike cannot define a range.
            smooth=np.asarray([np.median(raw[i-1:i+2],axis=0) for i in range(1,len(raw)-1)])
            low,high=np.percentile(smooth,[10,90],axis=0)
            summary={'samples':len(points),'spanSeconds':round(points[-1][0]-points[0][0],3)}
            for i,name in enumerate(['cmc','mcp','ip','palmRelative']):
                summary[name+'RangeDegrees']=round(float(high[i]-low[i]),3)
                summary[name+'RawMinDegrees']=round(float(raw[:,i].min()),3)
                summary[name+'RawMaxDegrees']=round(float(raw[:,i].max()),3)
                summary[name+'RawP90Degrees']=round(float(np.percentile(raw[:,i],90)),3)
                summary[name+'LowDegrees']=round(float(low[i]),3)
                summary[name+'HighDegrees']=round(float(high[i]),3)
            summaries.append(summary)
        hands.append({'side':label,'runs':summaries})
    return {'protocol':'thumb-joint-angles-v1','review':'development_only','hands':hands}


def flexion_evidence(timeline,dimensions=3):
    """A candidate veto, never a sign classifier. At least one supported change.

    Exploratory thresholds require independent validation. Do not infer word
    count, thanks intensity, or a standard sign from these geometric signals.
    """
    for side,label in enumerate(['Left','Right']):
        for run in continuous_runs(timeline,side,RULES['maxTrackingGapSeconds'],dimensions):
            if len(run)<RULES['minRunSamples'] or run[-1][0]-run[0][0]<RULES['minRunSeconds']:continue
            for i,(t,angles) in enumerate(run):
                past=[(time,a[2]) for time,a in run[:i] if t-time<=RULES['baselineLookbackSeconds']]
                if len(past)<RULES['minBaselineSamples'] or past[-1][0]-past[0][0]<RULES['minBaselineSpanSeconds']:continue
                baseline=float(np.percentile([a for _,a in past],20))
                if angles[2]<RULES['minIpBendDegrees'] or angles[2]-baseline<RULES['minIpChangeDegrees']:continue
                # Hysteresis: a short true peak can have smaller neighboring
                # observations. Preserve them instead of requiring two peaks.
                def shoulder(a):return a[2]-baseline>=RULES['minIpChangeDegrees']*RULES['shoulderChangeFraction']
                begin=end=i
                while begin>0 and run[begin][0]-run[begin-1][0]<=RULES['maxSupportGapSeconds'] and shoulder(run[begin-1][1]):begin-=1
                while end+1<len(run) and run[end+1][0]-run[end][0]<=RULES['maxSupportGapSeconds'] and shoulder(run[end+1][1]):end+=1
                if end-begin+1>=RULES['minSupportSamples'] and run[end][0]-run[begin][0]>=RULES['minSupportSpanSeconds']:
                    return {'protocol':RULES['id'],'geometry':'xyz' if dimensions==3 else 'xy','supported':True,'side':label,'supportSamples':end-begin+1,
                            'supportSeconds':round(run[end][0]-run[begin][0],3),'peakChangeDegrees':round(max(a[2] for _,a in run[begin:end+1])-baseline,3),
                            'reason':'supported_thumb_flexion','review':RULES['review']}
    return {'protocol':RULES['id'],'geometry':'xyz' if dimensions==3 else 'xy','supported':False,'reason':'insufficient_thumb_flexion_evidence','review':RULES['review']}
