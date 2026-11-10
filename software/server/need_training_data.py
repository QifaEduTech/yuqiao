"""Need-only development split; existing help/thanks data and models unchanged."""
import json
from pathlib import Path
from collections import Counter
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/need-video-training.json').read_text(encoding='utf8'))

def split_need_development(items):
    rows=sorted([r for r in items if r['category'] in ('need','help','thanks','background','other') and r['reviewed'] and (r['category']!='need' or r['complete'])],key=lambda r:(r['createdAt'],r['sampleNumber']))
    grouped={}
    for r in rows:grouped.setdefault(r['group'],[]).append(r)
    positive=[g for g,v in grouped.items() if any(r['category']=='need' for r in v)]
    negative=[g for g,v in grouped.items() if all(r['category']!='need' for r in v) and len(v)>=2]
    reasons=[];splits={}
    if len(rows)>CONFIG['maxSamples']:reasons.append('sample_limit_exceeded')
    if len({r['sourceHash'] for r in rows})!=len(rows):reasons.append('duplicate_source')
    if len(positive)<2:reasons.append('need_two_actual_need_capture_groups')
    if not negative:reasons.append('need_separate_negative_validation_group')
    if len(positive)>=2 and negative:
        validation={positive[-1],negative[-1]}
        for name in ['train','validation']:
            selected=[r for r in rows if (r['group'] in validation)==(name=='validation')];counts=Counter(r['category'] for r in selected);target=counts['need'];other=len(selected)-target
            splits[name]={'samples':[r['sampleNumber'] for r in selected],'groups':sorted({r['group'] for r in selected}),'need':target,'notNeed':other,'categories':dict(counts)}
            if min(target,other)<2:reasons.append('insufficient_classes_'+name)
    return {'scope':'development_validation_not_independent_test','eligibleSamples':len(rows),'positiveGroups':len(positive),'counts':dict(Counter(r['category'] for r in rows)),'readyForDevelopmentTraining':not reasons,'reasons':reasons,'splits':splits,'independentTestSamples':0,'productionEligible':False}
