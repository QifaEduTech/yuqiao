"""Explicit grouped development split; no held-out accuracy claims."""
import json
from collections import Counter
from pathlib import Path
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/me-video-training.json').read_text(encoding='utf8'))

def split_me_development(items):
    rows=sorted([r for r in items if r['category'] in ('me','thanks','help','need','background','other') and r['reviewed'] and (r['category']!='me' or r['complete'])],key=lambda r:(r['createdAt'],r['sampleNumber']))
    positives=list(dict.fromkeys(r['group'] for r in rows if r['category']=='me'))
    reasons=[];splits={}
    if len(positives)<2:reasons.append('need_two_real_me_capture_groups')
    if len(rows)>CONFIG['maxSamples']:reasons.append('sample_limit')
    if len({r['sourceHash'] for r in rows})!=len(rows):reasons.append('duplicate_source')
    if len(positives)>=2:
        latest=positives[-1]
        if any(r['groupSource']!='declared_capture_round' for r in rows if r['group']==latest):reasons.append('validation_round_not_confirmed')
        for name in ('train','validation'):
            selected=[r for r in rows if (r['group']==latest)==(name=='validation')]
            counts=Counter(r['category'] for r in selected);target=counts['me'];other=len(selected)-target
            if target<3 or other<2:reasons.append('insufficient_classes_'+name)
            splits[name]={'samples':[r['sampleNumber'] for r in selected],'groups':sorted({r['group'] for r in selected}),'me':target,'notMe':other,'categories':dict(counts)}
    return {'scope':'development_validation_after_geometric_review','eligibleSamples':len(rows),'positiveGroups':len(positives),'splits':splits,'reasons':reasons,'readyForDevelopmentTraining':not reasons,'independentTestSamples':0,'productionEligible':False}
