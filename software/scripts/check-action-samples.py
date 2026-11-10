"""Read only registered action readiness; never reinterpret free text as labels."""
import argparse,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory

def main():
    profiles=json.loads((ROOT/'shared/sign-development-actions.json').read_text(encoding='utf8'))['actions']
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--action',required=True,choices=[a['category'] for a in profiles]);parser.add_argument('--latest-owner',required=True,action='store_true');args=parser.parse_args()
    profile=next(a for a in profiles if a['category']==args.action);items=inventory();selected=[x for x in items if x['category']==args.action]
    usable=[x for x in selected if x['reviewed'] and x['complete']]
    print(json.dumps({'action':args.action,'signId':profile['signId'],'registered':len(selected),'reviewedComplete':len(usable),'captureGroups':len({x['group'] for x in usable}),'sampleNumbers':[x['sampleNumber'] for x in selected],
        'stage':profile['stage'],'next':'collect_initial_quality_clips' if len(usable)<profile.get('initialQualityClips',3) else 'source_and_action_specific_quality_audit',
        'qualityChecked':False,'trainingStarted':False,'productionRecognitionAdded':False},ensure_ascii=True))

if __name__=='__main__':main()
