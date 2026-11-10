"""Compare articulated thumb evidence without changing the frozen IP-only v2.

CMC uses wrist->CMC->MCP landmarks as a proxy, not an anatomical angle measure.
An accepted geometric change still requires a classifier candidate and later
independent evaluation; it never creates a sign label by itself.
"""
import json
from pathlib import Path
import numpy as np
from thumb_motion import continuous_runs,RULES

CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/thumb-multijoint.json').read_text(encoding='utf8'))
if RULES['id']!=CONFIG['baseProtocol']:raise ValueError('base_protocol_changed')


def thumb_span_ratio(value,side):
    if value is None:return None
    data=np.asarray(value,dtype=float)
    if data.shape!=(126,) or not np.isfinite(data).all():return None
    hand=data[side*63:(side+1)*63].reshape(21,3)
    scale=float(np.mean([np.linalg.norm(hand[i]-hand[0]) for i in [5,9,17]]))
    span=float(np.linalg.norm(hand[4]-hand[2]))
    if scale<1e-8 or span<1e-8:return None
    return span/scale


def span_contraction_evidence(timeline):
    result=[]
    for side,label in enumerate(['Left','Right']):
        runs=[];run=[];previous=None
        for t,value in timeline:
            if not np.isfinite(t) or t<0 or previous is not None and t<=previous:raise ValueError('invalid_timestamp_order')
            ratio=thumb_span_ratio(value,side)
            if previous is not None and t-previous>RULES['maxTrackingGapSeconds'] or ratio is None:
                if run:runs.append(run)
                run=[]
            previous=t
            if ratio is not None:run.append((t,ratio))
        if run:runs.append(run)
        for run in runs:
            if len(run)<RULES['minRunSamples'] or run[-1][0]-run[0][0]<RULES['minRunSeconds']:continue
            for i,(t,ratio) in enumerate(run):
                past=[(time,v) for time,v in run[:i] if t-time<=RULES['baselineLookbackSeconds']]
                if len(past)<RULES['minBaselineSamples'] or past[-1][0]-past[0][0]<RULES['minBaselineSpanSeconds']:continue
                baseline=float(np.percentile([v for _,v in past],80))
                if baseline<=0 or 1-ratio/baseline<CONFIG['minThumbSpanContractionFraction']:continue
                shoulder=CONFIG['minThumbSpanContractionFraction']*RULES['shoulderChangeFraction']
                begin=end=i
                while begin>0 and run[begin][0]-run[begin-1][0]<=RULES['maxSupportGapSeconds'] and 1-run[begin-1][1]/baseline>=shoulder:begin-=1
                while end+1<len(run) and run[end+1][0]-run[end][0]<=RULES['maxSupportGapSeconds'] and 1-run[end+1][1]/baseline>=shoulder:end+=1
                if end-begin+1>=RULES['minSupportSamples'] and run[end][0]-run[begin][0]>=RULES['minSupportSpanSeconds']:
                    result.append({'side':label,'joint':'thumb_span','peakTime':round(t,3),
                                   'startTime':round(run[begin][0],3),'endTime':round(run[end][0],3),'supportSamples':end-begin+1,
                                   'peakContractionFraction':round(1-min(v for _,v in run[begin:end+1])/baseline,4)})
                    break
    return result


def multijoint_evidence(timeline):
    evidence=[]
    for side,label in enumerate(['Left','Right']):
        for run in continuous_runs(timeline,side,RULES['maxTrackingGapSeconds']):
            if len(run)<RULES['minRunSamples'] or run[-1][0]-run[0][0]<RULES['minRunSeconds']:continue
            for joint in CONFIG['joints']:
                channel=joint['index']
                for i,(t,angles) in enumerate(run):
                    past=[(time,a[channel]) for time,a in run[:i] if t-time<=RULES['baselineLookbackSeconds']]
                    if len(past)<RULES['minBaselineSamples'] or past[-1][0]-past[0][0]<RULES['minBaselineSpanSeconds']:continue
                    baseline=float(np.percentile([a for _,a in past],20))
                    # Identical amplitude/time criteria for every joint, without
                    # a sample-specific threshold or special case for 26.6.
                    if angles[channel]<RULES['minIpBendDegrees'] or angles[channel]-baseline<RULES['minIpChangeDegrees']:continue
                    def shoulder(a):return a[channel]-baseline>=RULES['minIpChangeDegrees']*RULES['shoulderChangeFraction']
                    begin=end=i
                    while begin>0 and run[begin][0]-run[begin-1][0]<=RULES['maxSupportGapSeconds'] and shoulder(run[begin-1][1]):begin-=1
                    while end+1<len(run) and run[end+1][0]-run[end][0]<=RULES['maxSupportGapSeconds'] and shoulder(run[end+1][1]):end+=1
                    if end-begin+1>=RULES['minSupportSamples'] and run[end][0]-run[begin][0]>=RULES['minSupportSpanSeconds']:
                        evidence.append({'side':label,'joint':joint['name'],'peakTime':round(t,3),
                                         'startTime':round(run[begin][0],3),'endTime':round(run[end][0],3),
                                         'supportSamples':end-begin+1,
                                         'peakChangeDegrees':round(max(a[channel] for _,a in run[begin:end+1])-baseline,3)})
                        break
    evidence.extend(span_contraction_evidence(timeline))
    return {'protocol':CONFIG['id'],'review':CONFIG['review'],'supported':bool(evidence),
            'reason':'thumb_shape_change' if evidence else 'insufficient_multijoint_evidence','evidence':evidence}
