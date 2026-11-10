"""Development split only: this does not weaken the existing independent gate."""
import json
from pathlib import Path
from collections import Counter
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'shared/help-video-training.json').read_text(encoding='utf8'))

def split_help_development(items):
    rows=sorted([r for r in items if r['category'] in ('help','thanks','background','other') and r['reviewed'] and (r['category']!='help' or r['complete'])],key=lambda r:(r['createdAt'],r['sampleNumber']))
    grouped={}
    for row in rows:grouped.setdefault(row['group'],[]).append(row)
    positives=[group for group,values in grouped.items() if any(x['category']=='help' for x in values)]
    negatives=[group for group,values in grouped.items() if all(x['category']!='help' for x in values) and len(values)>=2]
    reasons=[];splits={}
    if len(rows)>CONFIG['maxSamples']:reasons.append('sample_limit_exceeded')
    if len({r['sourceHash'] for r in rows})!=len(rows):reasons.append('duplicate_source')
    if len(positives)<2:reasons.append('need_two_actual_help_capture_groups')
    if not negatives:reasons.append('need_separate_negative_validation_group')
    if len(positives)>=2 and negatives:
        validation_groups={positives[-1],negatives[-1]}
        for split in ['train','validation']:
            selected=[r for r in rows if (r['group'] in validation_groups)==(split=='validation')]
            counts=Counter(r['category'] for r in selected);help_count=counts['help'];other_count=len(selected)-help_count
            splits[split]={'samples':[r['sampleNumber'] for r in selected],'groups':sorted({r['group'] for r in selected}),'help':help_count,'notHelp':other_count,'categories':dict(counts)}
            if min(help_count,other_count)<2:reasons.append('insufficient_classes_'+split)
    return {'scope':'development_validation_on_previously_inspected_sources','eligibleSamples':len(rows),'groups':len(grouped),'counts':dict(Counter(r['category'] for r in rows)),
            'readyForDevelopmentTraining':not reasons,'reasons':reasons,'splits':splits,'independentTestSamples':0,'productionEligible':False}
