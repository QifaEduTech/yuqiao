"""Explicit registered need training in memory. No export or production replacement."""
import sys as _db_sys
from pathlib import Path as _DbPath
_db_sys.path.insert(0, str(_DbPath(__file__).resolve().parents[1] / 'server'))
from project_database import connect as _project_db_connect
import argparse,hashlib,importlib.util,json,sqlite3,subprocess,sys,base64
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'server'))
from sign_training_data import inventory
from need_training_data import split_need_development,CONFIG
from sign_training_features import training_frame
from need_directional_features import directional_features
spec=importlib.util.spec_from_file_location('quality',ROOT/'scripts/audit-sample-quality.py');quality=importlib.util.module_from_spec(spec);spec.loader.exec_module(quality)

def main():
    global CONFIG
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--latest-owner',required=True,action='store_true');p.add_argument('--train-registered-development',action='store_true');p.add_argument('--directional',action='store_true');p.add_argument('--stationary-training-negatives',action='store_true');p.add_argument('--export-matching-report');args=p.parse_args();items=inventory();readiness=split_need_development(items)
    if args.export_matching_report and (not args.directional or args.stationary_training_negatives):p.error('isolated export requires directional baseline')
    if args.stationary_training_negatives and not args.directional:p.error('stationary augmentation requires directional mode')
    if args.directional:CONFIG=json.loads((ROOT/'shared/need-directional-training.json').read_text(encoding='utf8'))
    if not args.train_registered_development or not readiness['readyForDevelopmentTraining']:
        print(json.dumps({'readiness':readiness,'trainingStarted':False}));return
    partitions={name:set(v['samples']) for name,v in readiness['splits'].items()};payload={'protocol':CONFIG['id'],'splits':{name:[] for name in partitions},'stationaryTrainingNegatives':args.stationary_training_negatives,'exportNeedCandidate':bool(args.export_matching_report)};versions=[]
    db=_project_db_connect((ROOT/'data/app.sqlite').as_uri()+'?mode=ro',uri=True);db.row_factory=sqlite3.Row
    def current(item):
        r=db.execute('SELECT s.*,r.media_file,r.byte_length FROM sign_samples s JOIN records r ON r.id=s.record_id AND r.user_id=s.user_id WHERE s.record_id=? AND s.user_id=?',(item['recordId'],item['ownerId'])).fetchone()
        if not r or not r['active'] or r['revision']!=item['revision'] or r['source_sha256']!=item['sourceHash']:raise ValueError('registration_changed')
        path=(ROOT/'data/media'/r['media_file']).resolve()
        if not path.is_relative_to(ROOT/'data/media') or path.stat().st_size!=r['byte_length'] or path.stat().st_size>32*1024*1024 or hashlib.sha256(path.read_bytes()).hexdigest()!=item['sourceHash']:raise ValueError('source_changed')
        return r,path
    try:
        for item in items:
            name=next((name for name,numbers in partitions.items() if item['sampleNumber'] in numbers),None)
            if name is None:continue
            r,path=current(item);label=json.loads(r['payload']);times=[];frames=[]
            if label['endSeconds']-label['startSeconds']>CONFIG['maxDurationSeconds']:raise ValueError('duration_limit')
            def observe(t,result):
                frames.append(training_frame(result,t-times[-1] if times else 1/30));times.append(t)
                if len(frames)>CONFIG['maxFrames']:raise ValueError('frame_capacity_exceeded')
            checked=quality.inspect_video(path,label,sample_interval_ms=0,on_observation=observe)
            if len(times)<2 or (len(times)-1)/(times[-1]-times[0])<CONFIG['minEffectiveFps']:raise ValueError('frame_rate_insufficient')
            if item['category']=='need' and checked['technicalStatus']!='pilot_checks_passed':raise ValueError('need_quality_requires_review')
            current(item);versions.append(item)
            values=directional_features(frames,times,checked['dimensions'][1]/checked['dimensions'][0]) if args.directional else np.asarray(frames)
            sample={'sampleNumber':item['sampleNumber'],'sourceHash':item['sourceHash'],'group':item['group'],'label':int(item['category']=='need'),'frames':values.tolist()}
            if item['category']=='need' or item['sampleNumber'] in ('28.11','28.12','28.13'):
                present=[i for i,f in enumerate(frames) if f[74]>0 or f[150]>0]
                if present:
                    frozen=np.repeat(np.asarray(frames)[[present[len(present)//2]]],len(frames),axis=0);frozen[:,152]=np.r_[1/30,np.minimum(np.diff(times),1)]*30
                    sample['frozenFrames']=(directional_features(frozen,times,checked['dimensions'][1]/checked['dimensions'][0]) if args.directional else frozen).tolist()
                    if args.stationary_training_negatives and name=='train' and item['category']=='need':
                        variants=[]
                        for fraction in [.25,.5,.75]:
                            frozen=np.repeat(np.asarray(frames)[[present[int((len(present)-1)*fraction)]]],len(frames),axis=0);frozen[:,152]=np.r_[1/30,np.minimum(np.diff(times),1)]*30
                            variants.append(directional_features(frozen,times,checked['dimensions'][1]/checked['dimensions'][0]).tolist())
                        sample['stationaryVariants']=variants
            payload['splits'][name].append(sample)
        result=subprocess.run([str(ROOT/'.venv-anny/Scripts/python.exe'),'-B',str(ROOT/'scripts/help-training-worker.py')],input=json.dumps(payload).encode(),capture_output=True,timeout=180,cwd=ROOT)
        if result.returncode:raise ValueError('need_training_worker_failed')
        experiment=json.loads(result.stdout)
        for item in versions:current(item)
        if args.export_matching_report:
            path=(ROOT/args.export_matching_report).resolve()
            if not path.is_relative_to(ROOT):raise ValueError('report_outside_project')
            expected=json.loads(path.read_text(encoding='utf8'))
            current_versions=[{'number':x['sampleNumber'],'revision':x['revision'],'sourceHash':x['sourceHash']} for x in versions]
            if expected['registeredVersions']!=current_versions or experiment['weightsSha256']!=expected['experiment']['weightsSha256'] or experiment['evaluations']!=expected['experiment']['evaluations']:raise ValueError('candidate_does_not_match_frozen_report')
            content=base64.b64decode(experiment.pop('needCheckpointBase64'),validate=True);directory=ROOT/'models/need-video-tcn/experimental-v1';directory.mkdir(parents=True,exist_ok=True)
            if (directory/'weights.npz').exists():raise ValueError('need_candidate_already_exists')
            (directory/'weights.npz').write_bytes(content)
            manifest={'id':CONFIG['id'],'version':'experimental-v1','featureProtocol':CONFIG['featureProtocol'],'artifactSha256':hashlib.sha256(content).hexdigest(),'weightsSha256':experiment['weightsSha256'],'threshold':CONFIG['threshold'],'review':'development_only_requires_motion_gate_and_live_validation','productionEligible':False,'requiredMotionGuard':'need-required-image-motion-v1','numpyParityMaxError':experiment['numpyParityMaxError']}
            (directory/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf8');experiment['modelPersisted']=True
        print(json.dumps({'protocol':CONFIG['id'],'readiness':readiness,'experiment':experiment,'sourceVersionsVerified':True,'independentAccuracy':None,'datasetPersisted':False,'registeredVersions':[{'number':x['sampleNumber'],'revision':x['revision'],'sourceHash':x['sourceHash']} for x in versions]}))
    finally:db.close()

if __name__=='__main__':main()
